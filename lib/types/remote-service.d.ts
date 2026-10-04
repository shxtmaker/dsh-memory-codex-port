import { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { ManageRequest, ManageResult } from './contracts.ts';
/** 插件自有严格 Remote；所有管理调用复用已认证 Connection。 */
export declare class MemoryRemote extends TypertRemoteService {
    private operation;
    constructor(ctx: Context, operation: (request: ManageRequest, signal: AbortSignal) => Promise<ManageResult>);
    invoke(request: ManageRequest, signal: AbortSignal): Promise<ManageResult>;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        memory: MemoryRemote;
    }
}
