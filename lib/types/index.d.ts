import type { Context } from '@deepseek-ai/cordis';
import { type SessionEvent } from '@deepseek-ai/dsh-session';
import { Config } from './config.ts';
export { Config } from './config.ts';
export { MemoryRemote } from './remote-service.ts';
export type { ManageRequest, ManageResult } from './contracts.ts';
export declare const name = "dsh-memory";
export declare const inject: string[];
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'dsh-memory': {
            kind: 'dsh-memory';
            form: 'recall';
            reservation: string;
            epochs: Record<string, number>;
            items: {
                id: string;
                revision: number;
                scope: string;
            }[];
        };
        'dsh-memory-invalidated': {
            kind: 'dsh-memory-invalidated';
            form: 'notice';
            summary: string;
        };
    }
}
/** 从已提交原生日志选取有界证据。隐藏推理、模型记忆工具和所有高优先级指令。 */
export declare function transcript(events: readonly SessionEvent[]): string;
/** 只挂载插件扩展点，不修改宿主的日志解释器或模型请求。 */
export declare function apply(ctx: Context, config: Config): Promise<void>;
