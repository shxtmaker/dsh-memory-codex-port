import { Worker } from 'node:worker_threads'
/** 所有数据库操作在专用 Worker 串行执行。停止时拒绝尚未完成的请求。 */
export class StorageWorker {
  private worker: Worker
  private seq = 0
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  private stopped = false
  private cancelledReservations=new Set<number>()
  readonly ready: Promise<unknown>
  constructor(root: string, owner: string, trust: string, profile: string) {
    this.worker = new Worker(new URL('./storage-worker.js', import.meta.url), { workerData: { root, owner, trust, profile },execArgv:[] })
    this.worker.on('message', (m: { id: number; value?: unknown; error?: string }) => {
      const pending = this.pending.get(m.id)
      if(this.cancelledReservations.delete(m.id)&&m.value&&typeof m.value==='object'&&'id' in m.value)void this.call('releaseEvidence',{id:(m.value as {id:string}).id}).catch(()=>{})
      if (!pending) return
      this.pending.delete(m.id)
      if (m.error) pending.reject(new Error(m.error)); else pending.resolve(m.value)
    })
    this.worker.on('error', () => this.fail('STORAGE_UNAVAILABLE'))
    this.worker.on('exit', () => this.fail('STORAGE_STOPPED'))
    this.ready = this.call('probe', {})
  }
  call<T = unknown>(op: string, args: object, signal?: AbortSignal): Promise<T> {
    if (this.stopped) return Promise.reject(new Error('STORAGE_STOPPED'))
    if (signal?.aborted) return Promise.reject(new Error('CANCELLED'))
    const id = ++this.seq
    return new Promise<T>((resolve, reject) => {
      const abort = (): void => { this.pending.delete(id);if(op==='reserveEvidence')this.cancelledReservations.add(id); this.worker.postMessage({ cancel: id }); reject(new Error('CANCELLED')) }
      this.pending.set(id, {
        resolve: value => { signal?.removeEventListener('abort', abort); resolve(value as T) },
        reject: error => { signal?.removeEventListener('abort', abort); reject(error) },
      })
      signal?.addEventListener('abort', abort, { once: true })
      this.worker.postMessage({ id, op, args })
    })
  }
  private fail(code: string): void {
    this.stopped = true
    for (const p of this.pending.values()) p.reject(new Error(code))
    this.pending.clear()
    this.cancelledReservations.clear()
  }
  async close(): Promise<void> {
    if (!this.stopped) { try { await this.call('close', {}) } catch { /* 已退出的 Worker 无法 checkpoint。 */ } }
    this.fail('STORAGE_STOPPED')
    await this.worker.terminate()
  }
}
