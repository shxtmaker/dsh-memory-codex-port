/**
 * 持久发布队列的执行器（P08）。
 *
 * 严格执行方案第 4.4/4.5 节的五步协议与对账规则：
 *   1  确认时在本地事务内持久化批准快照与 outbox（状态 approved）。
 *   2  POST manual 创建草稿，标题或正文带稳定 publish_id 标记；取得 knowledge_id 立即持久化。
 *   3  PUT knowledge/:id 写扁平 custom_metadata（合并保留非插件字段）。
 *   4  PUT knowledge/manual/:id 再次提交完整非空正文、status=publish 与低成本 process_config。
 *   5  轮询 GET knowledge/:id，仅在 parse_status=completed、发布状态正确、
 *      手工正文 hash 与批准快照一致且版本校验通过后标记完成。
 *
 * 关键约束：
 *   - 每个发布对象只有一个写入者和一个在途更新；上一索引任务到达终态前不发布下一版。
 *   - POST 无服务端幂等键：响应丢失必须按稳定标记在目标库列表中唯一匹配；
 *     多匹配或状态不明进入 reconcile_required，禁止盲目重发创建。
 *   - worker 只发送明确批准的快照，不能用此刻最新正文替换。
 *   - 404 / 401 / 403 / 429 / 超时分别处理；429 与暂时性错误按退避重试。
 *   - 不把远程发布放进 awaited 的 agent/turn-stopping。
 */
import { isWeKnoraError, weknoraCode, type WeKnoraClient, type KnowledgeDetail } from '../weknora/client.ts'
import { markerOf, extractMarker, PUBLISH_MARKER_PREFIX } from './render.ts'
import type { OutboxOperation, Publication, RemoteTombstone, ApprovedSnapshot } from '../contracts.ts'

/** 自动重试上限；达到上限后保留为可手动重试的失败项。 */
export const MAX_ATTEMPTS = 4
/** 索引轮询的总期限；超期不宣称已完成新版本。 */
export const INDEX_DEADLINE_MS = 120000

export interface LoginAccess { apiKey: string; tenantId: string; baseUrl: string }

/** 队列执行所需的存储与网络端口；生产实现由 index.ts 提供。 */
export interface OutboxPort {
  pending(): Promise<OutboxOperation[]>
  publication(publishId: string): Promise<Publication | null>
  savePublication(publication: Publication): Promise<Publication>
  updateOperation(operationId: string, patch: Partial<OutboxOperation>): Promise<OutboxOperation>
  access(connectionId: string, kind: 'publish'): Promise<LoginAccess>
  client(access: LoginAccess, deadlineMs: number): WeKnoraClient
  /** 远端墓碑：本地删除、拒绝或来源失效时排队撤回。 */
  tombstonePending(): Promise<RemoteTombstone[]>
  updateTombstone(tombstone: RemoteTombstone, state: RemoteTombstone['state'], attempts: number): Promise<RemoteTombstone>
  /** 本地是否已屏蔽该来源（墓碑生效后不允许重新发布与召回）。 */
  isBlocked(memoryId: string, publishId: string): Promise<boolean>
  settings(connectionId: string): Promise<{ requestDeadlineMs: number }>
}

export interface SyncResult { processed: number; states: string[]; errors: string[] }

/** 退避序列；指数增长但封顶，避免长时间占用后台。 */
export function backoffMs(attempts: number): number { return Math.min(3600000, 60000 * 2 ** Math.max(0, attempts - 1)) }

/**
 * 处理一个批次。同一发布对象串行：上一个未到终态时跳过它的下一个操作。
 * 返回实际推进的操作数与状态，供页面显示。
 */
export class SyncRunner {
  constructor(private readonly port: OutboxPort) {}

  /** 处理待办队列与待撤回墓碑；单次调用有界。 */
  async run(signal: AbortSignal): Promise<SyncResult> {
    const result: SyncResult = { processed: 0, states: [], errors: [] }
    const pending = await this.port.pending()
    const busy = new Set<string>()
    for (const operation of pending) {
      if (signal.aborted) break
      // 同一发布对象同一时刻只有一个在途更新。
      if (busy.has(operation.publishId)) continue
      busy.add(operation.publishId)
      try {
        const state = await this.advance(operation, signal)
        result.processed++
        result.states.push(`${operation.op}:${state}`)
      } catch (error) {
        const code = weknoraCode(error) ?? 'UPSTREAM'
        // 保留固定代码与供应商业务码，便于诊断；不记录正文或请求头。
        const fallback = error instanceof Error && /^[A-Z][A-Z0-9_]*$/.test(error.message) ? error.message : error instanceof Error ? error.constructor.name : 'UNKNOWN'
        const detail = isWeKnoraError(error) ? (error.remoteCode ? `${code}/${error.remoteCode}` : code) : `${code}(${fallback})`
        result.errors.push(`${operation.op}:${detail}`)
        await this.fail(operation, detail.slice(0, 64), signal)
      }
    }
    const tombstones = await this.port.tombstonePending()
    for (const tombstone of tombstones) {
      if (signal.aborted) break
      try {
        await this.withdraw(tombstone, signal)
        result.processed++
        result.states.push(`withdraw:done`)
      } catch (error) {
        const code = weknoraCode(error) ?? 'UPSTREAM'
        result.errors.push(`withdraw:${code}`)
        await this.port.updateTombstone(tombstone, 'failed', tombstone.attempts + 1).catch(() => {})
      }
    }
    return result
  }

  /** 单条队列操作的推进；每一步都先落库再继续，崩溃后可从任意中间态恢复。 */
  private async advance(operation: OutboxOperation, signal: AbortSignal): Promise<string> {
    const publication = await this.port.publication(operation.publishId)
    if (!publication) throw new Error('PUBLICATION_MISSING')
    // 墓碑生效后不再外发，避免把已撤回的副本重新发出去。
    if (await this.port.isBlocked(publication.memoryId, publication.publishId)) {
      await this.port.updateOperation(operation.operationId, { state: 'cancelled', lastErrorCode: 'TOMBSTONED' })
      return 'cancelled'
    }
    const snapshot = operation.approvedSnapshot ?? publication.approved
    if (!snapshot) throw new Error('APPROVAL_MISSING')
    const access = await this.port.access(publication.connectionId, 'publish')
    const settings = await this.port.settings(publication.connectionId)
    const client = this.port.client(access, settings.requestDeadlineMs)
    await this.port.updateOperation(operation.operationId, { state: 'running' })
    switch (publication.state) {
      case 'approved': return this.create(publication, snapshot, client, signal)
      case 'created': return this.writeMetadata(publication, snapshot, client, signal)
      case 'metadata': return this.publish(publication, snapshot, client, signal)
      case 'publishing':
      case 'verifying': return this.verify(publication, snapshot, client, signal)
      // 已到终态或需人工介入的操作不再自动推进。
      case 'published': await this.port.updateOperation(operation.operationId, { state: 'done' }); return 'done'
      case 'conflict':
      case 'reconcile_required': return publication.state
      case 'withdraw_queued':
      case 'withdrawing':
      case 'withdrawn': await this.port.updateOperation(operation.operationId, { state: 'cancelled' }); return 'cancelled'
      default: throw new Error('UNEXPECTED_STATE')
    }
  }

  /**
   * 第二步：创建草稿。响应丢失时按稳定标记对账，绝不盲目重发。
   */
  private async create(publication: Publication, snapshot: ApprovedSnapshot, client: WeKnoraClient, signal: AbortSignal): Promise<string> {
    // 标题承载稳定标记：列表接口若不回填手工正文，仍能按标题唯一对账。
    const titleMarker = `${PUBLISH_MARKER_PREFIX}:${publication.publishId}`
    // 先对账：上次可能已经创建成功但响应丢失。
    const existing = await this.findByMarker(client, publication.targetKbId, publication.publishId, signal)
    if (existing === 'ambiguous') {
      await this.port.savePublication({ ...publication, state: 'reconcile_required', error: 'MULTIPLE_MARKER_MATCHES' })
      return 'reconcile_required'
    }
    let detail: KnowledgeDetail
    if (existing) detail = existing
    else {
      detail = await client.createManual(publication.targetKbId, { title: `${snapshot.title} ${titleMarker}`, content: snapshot.body }, signal)
      // 取得 knowledge_id 后立即持久化，缩短响应丢失窗口。
      await this.port.savePublication({ ...publication, remoteId: detail.id, state: 'created', remoteVersion: String(detail.manualVersion) })
      return 'created'
    }
    await this.port.savePublication({ ...publication, remoteId: detail.id, state: 'created', remoteVersion: String(detail.manualVersion) })
    return 'created'
  }

  /**
   * 在目标库中按标记查找唯一匹配。多匹配或读取失败都不算确认。
   * 标题与正文分别提取标记：合并提取会让一种形态遮蔽另一种，导致漏配。
   */
  private async findByMarker(client: WeKnoraClient, kbId: string, publishId: string, signal: AbortSignal): Promise<KnowledgeDetail | 'ambiguous' | null> {
    const page = await client.listKnowledge(kbId, 1, 100, signal)
    const candidates = page.items.filter(item => {
      const titleMarker = extractMarker(item.title)
      const bodyMarker = item.manualContent ? extractMarker(item.manualContent) : null
      return titleMarker === publishId || bodyMarker === publishId
    })
    if (!candidates.length) return null
    if (candidates.length > 1) return 'ambiguous'
    // 唯一匹配还需读取正文精确确认；状态不明时不恢复映射。
    const detail = await client.getKnowledge(candidates[0].id, signal)
    if (!detail.manualContent) return null
    return detail
  }
  /** 第三步：写扁平 custom_metadata，合并保留现有非插件字段。 */
  private async writeMetadata(publication: Publication, snapshot: ApprovedSnapshot, client: WeKnoraClient, signal: AbortSignal): Promise<string> {
    if (!publication.remoteId) throw new Error('REMOTE_ID_MISSING')
    const current = await client.getKnowledge(publication.remoteId, signal)
    const merged = mergePluginMetadata(current.customMetadata, publication, snapshot)
    await client.updateMetadata(publication.remoteId, merged, signal)
    await this.port.savePublication({ ...publication, state: 'metadata' })
    return 'metadata'
  }

  /** 第四步：提交完整非空正文、status=publish 与低成本 process_config。 */
  private async publish(publication: Publication, snapshot: ApprovedSnapshot, client: WeKnoraClient, signal: AbortSignal): Promise<string> {
    if (!publication.remoteId) throw new Error('REMOTE_ID_MISSING')
    const detail = await client.publishManual(publication.remoteId, snapshot.body, undefined, signal)
    await this.port.savePublication({ ...publication, state: 'publishing', remoteVersion: String(detail.manualVersion), lastIndexPollAt: Date.now(), indexDeadline: Date.now() + INDEX_DEADLINE_MS })
    return 'publishing'
  }

  /**
   * 第五步：轮询索引状态。无法证明片段版本就不宣称它是新版本。
   * 元数据与正文更新不是原子事务，因此必须同时核对正文 hash 与发布状态。
   */
  private async verify(publication: Publication, snapshot: ApprovedSnapshot, client: WeKnoraClient, signal: AbortSignal): Promise<string> {
    if (!publication.remoteId) throw new Error('REMOTE_ID_MISSING')
    const detail = await client.getKnowledge(publication.remoteId, signal)
    const now = Date.now()
    const bodyMatches = detail.manualContent !== null && manualBodyHashOf(detail) === snapshot.bodyHash
    const published = detail.manualStatus === 'publish'
    const indexed = detail.parseStatus === 'completed'
    if (indexed && published && bodyMatches) {
      await this.port.savePublication({
        ...publication, state: 'published',
        publishedSourceRevision: snapshot.sourceRevision, publishedBodyHash: snapshot.bodyHash,
        candidateSourceRevision: snapshot.sourceRevision, candidateBodyHash: snapshot.bodyHash,
        remoteVersion: String(detail.manualVersion), error: '', lastIndexPollAt: now,
      })
      return 'published'
    }
    if (published && !bodyMatches) {
      // 远端正文与批准快照不一致：暂停覆盖并显示冲突，不自动改写。
      await this.port.savePublication({ ...publication, state: 'conflict', error: 'REMOTE_BODY_MISMATCH', lastIndexPollAt: now })
      return 'conflict'
    }
    if (now > publication.indexDeadline) {
      await this.port.savePublication({ ...publication, state: 'verifying', error: 'INDEX_TIMEOUT', lastIndexPollAt: now })
      return 'index-timeout'
    }
    await this.port.savePublication({ ...publication, state: 'verifying', lastIndexPollAt: now })
    return 'verifying'
  }

  /** 撤回：删除远端副本并轮询确认 404；401/403 记为权限错误而不是成功删除。 */
  private async withdraw(tombstone: RemoteTombstone, signal: AbortSignal): Promise<void> {
    if (!tombstone.remoteId) {
      await this.port.updateTombstone(tombstone, 'done', tombstone.attempts + 1)
      return
    }
    const access = await this.port.access(tombstone.connectionId, 'publish')
    const settings = await this.port.settings(tombstone.connectionId)
    const client = this.port.client(access, settings.requestDeadlineMs)
    try {
      await client.deleteKnowledge(tombstone.remoteId, signal)
    } catch (error) {
      // 404 说明远端已不存在，视为完成。
      if (weknoraCode(error) !== 'NOT_FOUND') throw error
    }
    try {
      await client.getKnowledge(tombstone.remoteId, signal)
      // 仍可读到：删除尚未完成，保持 pending 让下一轮继续确认。
      await this.port.updateTombstone(tombstone, 'pending', tombstone.attempts + 1)
    } catch (error) {
      if (weknoraCode(error) === 'NOT_FOUND') {
        await this.port.updateTombstone(tombstone, 'done', tombstone.attempts + 1)
        return
      }
      if (['UNAUTHORIZED', 'KB_DENIED'].includes(weknoraCode(error) ?? '')) {
        // 权限错误不能被当成成功删除。
        await this.port.updateTombstone(tombstone, 'failed', tombstone.attempts + 1)
        return
      }
      await this.port.updateTombstone(tombstone, 'pending', tombstone.attempts + 1)
    }
  }

  /** 失败按退避重试；达到上限后保留为可手动重试的失败项。 */
  private async fail(operation: OutboxOperation, code: string, signal: AbortSignal): Promise<void> {
    const attempts = operation.attempts + 1
    const terminal = attempts >= MAX_ATTEMPTS || !retryable(code)
    await this.port.updateOperation(operation.operationId, {
      state: terminal ? 'failed' : 'pending', attempts, lastErrorCode: code,
      nextRetryAt: terminal ? operation.nextRetryAt : Date.now() + backoffMs(attempts),
    }).catch(() => {})
    void signal
  }
}

/** 只有暂时性错误自动重试；权限与冲突必须人工处理。 */
export function retryable(code: string): boolean {
  return ['UPSTREAM', 'NETWORK', 'RATE_LIMITED', 'DEADLINE', 'INDEX_TIMEOUT'].includes(code)
}

/** 稳定标记；正文注释形态由唯一渲染器定义，此处只做转发以保持单一来源。 */
export function operationMarker(publishId: string): string { return markerOf(publishId) }

/**
 * 合并插件自有元数据键，保留远端已有的非插件字段。
 * 服务端是整体替换语义，因此必须先读后写。
 */
export function mergePluginMetadata(existing: Record<string, unknown>, publication: Publication, snapshot: ApprovedSnapshot): Record<string, unknown> {
  return {
    ...existing,
    'dsh-memory-publish-id': publication.publishId,
    'dsh-memory-memory-id': publication.memoryId,
    'dsh-memory-source-revision': snapshot.sourceRevision,
    'dsh-memory-body-hash': snapshot.bodyHash,
    'dsh-memory-source-hash': snapshot.sourceHash,
    'dsh-memory-approved-at': snapshot.approvedAt,
  }
}

/** 手工正文哈希；与 client.ts 使用同一算法。 */
function manualBodyHashOf(detail: KnowledgeDetail): string | null { return detail.bodyHash }
