/**
 * 知识检索的证据生命周期：预留 → 结算 → 退役，以及失效与重启对账。
 *
 * 计量口径与方案第 4.2 节一致：
 *   本地直接证据 1024 UTF-8 字节（沿用既有 budget_ledger，整会话累计）
 *   远端活动槽位 3072 UTF-8 字节，每会话同时只有一份
 *   退役后短引用合计最多 256 UTF-8 字节
 * 本地账本与远端槽位互不占用；两者合计不超过 4096。
 *
 * 本模块不直接触达 SQLite 或 HTTP：存储与传输通过注入的端口提供，便于隔离测试。
 */
import { WeKnoraClient } from '../weknora/client.ts';
import type { ExternalEvidence, KnowledgeOutcome, RemoteRef, WeKnoraConnection, ConnectionSettings, ProjectBinding } from '../contracts.ts';
/** 远端槽位在一次用户轮内允许的工具调用次数上限。 */
export interface KnowledgeLimits {
    matchCount: number;
    vectorThreshold: number;
    keywordThreshold: number;
    requestDeadlineMs: number;
    remoteEvidenceBytes: number;
    retiredReferenceBytes: number;
    maxKnowledgeCallsPerTurn: number;
}
export interface ResolvedConnection {
    connection: WeKnoraConnection & ConnectionSettings;
    apiKey: string;
}
/** 存储、凭据与网络的最小端口；生产实现由 index.ts 提供。 */
export interface KnowledgePort {
    /** 读取连接设置与解析后的读取凭据；连接不由调用方缓存。 */
    readAccess(connectionId: string): Promise<ResolvedConnection>;
    /** 解析发布凭据；未配置时抛错。 */
    publishAccess(connectionId: string): Promise<ResolvedConnection>;
    binding(projectId: string): Promise<ProjectBinding>;
    reserveSlot(sessionId: string, userTurn: number, toolCallId: string, createdSeq: number, connectionId: string, kbIds: string[], toolName: 'search' | 'read', bindingRevision: number): Promise<ExternalEvidence>;
    slotCheck(slotId: string, projectId: string): Promise<{
        ok: boolean;
        code: string;
    }>;
    activateSlot(slotId: string, resultSeq: number, contentBytes: number, refs: RemoteRef[]): Promise<{
        slot: ExternalEvidence;
        replaced: string;
    }>;
    releaseSlot(slotId: string, reason: string): Promise<void>;
    retireSlot(slotId: string, content: string, limit: number): Promise<void>;
    activeSlot(sessionId: string): Promise<ExternalEvidence | null>;
    markSlotBuild(slotId: string, patch: Record<string, unknown>): Promise<void>;
    slot(slotId: string): Promise<ExternalEvidence | null>;
}
export interface SearchInput {
    sessionId: string;
    projectId: string;
    userTurn: number;
    toolCallId: string;
    createdSeq: number;
    query: string;
    caller: AbortSignal;
}
export interface ReadInput {
    sessionId: string;
    projectId: string;
    userTurn: number;
    toolCallId: string;
    createdSeq: number;
    knowledgeId: string;
    cursor: number;
    caller: AbortSignal;
}
export interface KnowledgeReply {
    text: string;
    outcome: KnowledgeOutcome;
    slotId: string;
    refs: RemoteRef[];
}
/**
 * 一次知识工具调用的完整执行器。
 *
 * 每次调用都在单一总截止内完成 HTTP、校验、格式化与提交前检查；
 * 取消与逾期只释放资源，不产生迟到的补注入。
 */
export declare class KnowledgeService {
    private readonly port;
    private readonly client;
    private readonly counters;
    constructor(port: KnowledgePort, client: (access: ResolvedConnection, deadlineMs: number) => WeKnoraClient);
    /** 每用户轮的调用计数；超限即在 HTTP 之前拒绝。 */
    private counter;
    /** 会话关闭或重启时清理计数。 */
    forget(sessionId: string): void;
    private within;
    private prepare;
    /**
     * 同轮替换的第一半：把当前活动槽位退役为短引用。
     * 单槽位约束在存储层，因此新结果提交前必须先撤下旧正文；
     * 旧正文未成功退役时不继续预留，避免出现两份模型可见正文。
     */
    private clearActive;
    /**
     * 检索：每库最多一次有界召回，按库内排名轮转融合后裁剪为有界证据。
     * 提交前先撤下旧槽位正文；旧正文未成功退役就不发布新结果。
     */
    search(input: SearchInput, limits: KnowledgeLimits): Promise<KnowledgeReply>;
    /**
     * 按需读取文档分页。新页提交前撤下旧远端正文；旧正文未撤下就不发布新页。
     * 必须给出 knowledgeId，不能沿用上一轮的槽位目标。
     */
    read(input: ReadInput, limits: KnowledgeLimits): Promise<KnowledgeReply>;
    /**
     * 下一用户轮入口：把上一轮的远端活动结果退役为短引用。
     * 只在用户轮边界执行，不在每个 agent step 清理。
     */
    retireOnNewTurn(sessionId: string, limit: number): Promise<{
        retired: string[];
    }>;
    /**
     * 即时失效：关闭检索、解绑、凭据或 tenant 变化、来源撤回、远端墓碑生效。
     * 在下一次模型请求之前撤下相关正文与短引用。
     */
    invalidate(sessionId: string, reason: string, limit: number): Promise<{
        retired: string[];
    }>;
}
