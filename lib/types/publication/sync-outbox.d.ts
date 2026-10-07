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
import { type WeKnoraClient } from '../weknora/client.ts';
import type { OutboxOperation, Publication, RemoteTombstone, ApprovedSnapshot } from '../contracts.ts';
/** 自动重试上限；达到上限后保留为可手动重试的失败项。 */
export declare const MAX_ATTEMPTS = 4;
/** 索引轮询的总期限；超期不宣称已完成新版本。 */
export declare const INDEX_DEADLINE_MS = 120000;
export interface LoginAccess {
    apiKey: string;
    tenantId: string;
    baseUrl: string;
}
/** 队列执行所需的存储与网络端口；生产实现由 index.ts 提供。 */
export interface OutboxPort {
    pending(): Promise<OutboxOperation[]>;
    publication(publishId: string): Promise<Publication | null>;
    savePublication(publication: Publication): Promise<Publication>;
    updateOperation(operationId: string, patch: Partial<OutboxOperation>): Promise<OutboxOperation>;
    access(connectionId: string, kind: 'publish'): Promise<LoginAccess>;
    client(access: LoginAccess, deadlineMs: number): WeKnoraClient;
    /** 远端墓碑：本地删除、拒绝或来源失效时排队撤回。 */
    tombstonePending(): Promise<RemoteTombstone[]>;
    updateTombstone(tombstone: RemoteTombstone, state: RemoteTombstone['state'], attempts: number): Promise<RemoteTombstone>;
    /** 本地是否已屏蔽该来源（墓碑生效后不允许重新发布与召回）。 */
    isBlocked(memoryId: string, publishId: string): Promise<boolean>;
    settings(connectionId: string): Promise<{
        requestDeadlineMs: number;
    }>;
}
export interface SyncResult {
    processed: number;
    states: string[];
    errors: string[];
}
/** 退避序列；指数增长但封顶，避免长时间占用后台。 */
export declare function backoffMs(attempts: number): number;
/**
 * 处理一个批次。同一发布对象串行：上一个未到终态时跳过它的下一个操作。
 * 返回实际推进的操作数与状态，供页面显示。
 */
export declare class SyncRunner {
    private readonly port;
    constructor(port: OutboxPort);
    /** 处理待办队列与待撤回墓碑；单次调用有界。 */
    run(signal: AbortSignal): Promise<SyncResult>;
    /** 单条队列操作的推进；每一步都先落库再继续，崩溃后可从任意中间态恢复。 */
    private advance;
    /**
     * 第二步：创建草稿。响应丢失时按稳定标记对账，绝不盲目重发。
     */
    private create;
    /**
     * 在目标库中按标记查找唯一匹配。多匹配或读取失败都不算确认。
     * 标题与正文分别提取标记：合并提取会让一种形态遮蔽另一种，导致漏配。
     */
    private findByMarker;
    /** 第三步：写扁平 custom_metadata，合并保留现有非插件字段。 */
    private writeMetadata;
    /** 第四步：提交完整非空正文、status=publish 与低成本 process_config。 */
    private publish;
    /**
     * 第五步：轮询索引状态。无法证明片段版本就不宣称它是新版本。
     * 元数据与正文更新不是原子事务，因此必须同时核对正文 hash 与发布状态。
     */
    private verify;
    /** 撤回：删除远端副本并轮询确认 404；401/403 记为权限错误而不是成功删除。 */
    private withdraw;
    /** 失败按退避重试；达到上限后保留为可手动重试的失败项。 */
    private fail;
}
/** 只有暂时性错误自动重试；权限与冲突必须人工处理。 */
export declare function retryable(code: string): boolean;
/** 稳定标记；正文注释形态由唯一渲染器定义，此处只做转发以保持单一来源。 */
export declare function operationMarker(publishId: string): string;
/**
 * 合并插件自有元数据键，保留远端已有的非插件字段。
 * 服务端是整体替换语义，因此必须先读后写。
 */
export declare function mergePluginMetadata(existing: Record<string, unknown>, publication: Publication, snapshot: ApprovedSnapshot): Record<string, unknown>;
