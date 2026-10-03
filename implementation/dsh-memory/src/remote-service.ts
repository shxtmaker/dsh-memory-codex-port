import { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { ManageRequest, ManageResult } from './contracts.ts'
/** 插件自有严格 Remote；所有管理调用复用已认证 Connection。 */
export class MemoryRemote extends TypertRemoteService {
  constructor(ctx: Context, private operation: (request: ManageRequest, signal: AbortSignal) => Promise<ManageResult>) { super(ctx,'memory') }
  @Remote
  async invoke(request: ManageRequest, signal: AbortSignal): Promise<ManageResult> {
    signal.throwIfAborted()
    try { return await this.operation(request,signal) }
    catch(error){const message=error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'MEMORY_UNAVAILABLE';throw new RemoteError('gateway/bad-request',message,{})}
  }
}
declare module '@deepseek-ai/cordis' { interface Context { memory: MemoryRemote } }
