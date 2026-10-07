/** 稳定版手工文档状态；省略时服务端按 draft 处理。 */
export declare const MANUAL_DRAFT = "draft";
export declare const MANUAL_PUBLISH = "publish";
/** 关闭辅助生成的低成本处理覆盖；创建草稿时不会被保存，发布 PUT 必须再次携带。 */
export declare const LOW_COST_PROCESS_CONFIG: {
    readonly summary_enabled: false;
    readonly enable_multimodel: false;
    readonly vlm_config: {
        readonly enabled: false;
    };
    readonly asr_config: {
        readonly enabled: false;
    };
    readonly question_generation_config: {
        readonly enabled: false;
    };
    readonly graph_enabled: false;
    readonly extract_config: {
        readonly enabled: false;
    };
};
/** 已知文档解析状态；draft 是手工草稿的实际取值，不在服务端常量表中。 */
export type ParseStatus = 'pending' | 'processing' | 'finalizing' | 'completed' | 'failed' | 'deleting' | 'cancelled' | 'draft' | string;
export interface KnowledgeBaseSummary {
    id: string;
    name: string;
    type: string;
    embeddingModelId: string;
    tenantId: number;
}
export interface HybridSearchParams {
    queryText: string;
    matchCount: number;
    vectorThreshold: number;
    keywordThreshold: number;
    skipContextEnrichment: boolean;
}
/** match_type 是整数枚举：0 embedding、1 keywords、2 near_by、3 history、4 parent、5 relation、6 graph、7 web、9 analysis。 */
export type MatchType = number;
export interface SearchHit {
    chunkId: string;
    knowledgeId: string;
    kbId: string;
    title: string;
    content: string;
    chunkIndex: number;
    score: number;
    matchType: MatchType;
    bodyHash: string;
    startAt: number;
    endAt: number;
    customMetadata: string;
}
export interface KnowledgeDetail {
    id: string;
    kbId: string;
    title: string;
    parseStatus: ParseStatus;
    customMetadata: Record<string, unknown>;
    metadata: Record<string, unknown>;
    manualContent: string | null;
    manualStatus: string;
    manualVersion: number;
    bodyHash: string | null;
}
export interface ChunkPage {
    total: number;
    page: number;
    pageSize: number;
    chunks: {
        id: string;
        chunkIndex: number;
        content: string;
        indexStatus: string;
        contentRevision: number;
        isEnabled: boolean;
    }[];
}
export interface SystemInfo {
    version: string;
    edition: string;
    commitId: string;
    keywordIndexEngine: string;
    vectorStoreEngine: string;
}
/** 适配器错误以固定代码表达；正文与请求头不进入错误信息。 */
export type WeKnoraErrorCode = 'UNAUTHORIZED' | 'KB_DENIED' | 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT' | 'RATE_LIMITED' | 'UPSTREAM' | 'DEADLINE' | 'CANCELLED' | 'MALFORMED' | 'NETWORK' | 'CONFIG' | 'LIMIT';
export declare class WeKnoraError extends Error {
    readonly code: WeKnoraErrorCode;
    readonly status: number;
    readonly remoteCode: string;
    constructor(code: WeKnoraErrorCode, status?: number, remoteCode?: string);
}
/**
 * 结构化的错误判定。
 *
 * 每个入口由 esbuild 独立打包，`client.ts` 会被内联进 index/evidence/sync-outbox，
 * 因此 `instanceof WeKnoraError` 跨模块恒为 false。这里按固定代码集合判定，
 * 保证适配器错误在任何模块组合下都能被正确识别。
 */
export declare function isWeKnoraError(error: unknown): error is WeKnoraError;
/** 取固定错误代码；非适配器错误返回 null。 */
export declare function weknoraCode(error: unknown): WeKnoraErrorCode | null;
/** 手工正文上限为 200000 个字符（rune）；本地先拒绝，避免无谓往返。 */
export declare const MANUAL_CONTENT_MAX = 200000;
/** custom_metadata 上限：20 个键、键名 ≤64、值 ≤1000。 */
export declare const CUSTOM_METADATA_MAX_KEYS = 20;
export declare const CUSTOM_METADATA_KEY_MAX = 64;
export declare const CUSTOM_METADATA_VALUE_MAX = 1000;
/** 正文哈希用于证明检索片段与已发布批准快照一致。 */
export declare function bodyHash(text: string): string;
/**
 * 从 manual metadata 中读取正文、发布状态与版本；非手工文档返回 null。
 *
 * 真实 v0.8.2 返回的是**扁平**结构：`metadata.content` / `metadata.status` /
 * `metadata.version` / `metadata.format` / `metadata.updated_at`（已对真实实例核查）。
 * 早期实现按 `metadata.manual.*` 嵌套读取，导致手工正文与版本恒为 null——
 * 那样发布校验无法证明正文一致，索引完成判定也就永远无法成立。
 * 这里两种形态都接受，避免版本差异造成静默失效。
 */
export declare function manualMetadata(metadata: unknown): {
    content: string;
    status: string;
    version: number;
} | null;
export interface ClientOptions {
    baseUrl: string;
    apiKey: string;
    tenantId?: string;
    /** 单次请求总截止，覆盖连接、响应读取与解析。 */
    deadlineMs?: number;
    /** 允许在截止内重试的幂等读操作次数。 */
    retries?: number;
    /** 便于测试注入；默认使用全局 fetch。 */
    fetchImpl?: typeof fetch;
}
/**
 * 版本化的最小 REST 客户端。所有请求在 `deadlineMs` 内完成或按 DEADLINE 失败；
 * 已到达的取消不会发出新请求。读操作在 429/5xx 与网络错误上按小退避重试。
 */
export declare class WeKnoraClient {
    private readonly options;
    private readonly base;
    private readonly fetcher;
    constructor(options: ClientOptions);
    /** 请求头只在此处组装；日志与管理页不记录其内容。 */
    private headers;
    private url;
    /**
     * 状态码到固定错误代码的映射；401/403 不重试也不当作成功。
     * 错误信封的 `code` 是业务错误码整数，另有两种非标准形状需要容忍。
     */
    private classify;
    private once;
    /** 读操作可重试；写操作与不确定结果一律单次发出，由上层对账。 */
    private request;
    /**
     * 连接与能力探针。`/health` 不在 `/api/v1` 下且无鉴权；版本与能力走系统接口。
     * 系统接口要求 `manage_vector_stores` 或 full-access，因此失败只降级为“未知”，
     * 不阻断以知识库列表为准的可用性判断。
     */
    probe(signal?: AbortSignal): Promise<{
        ok: true;
        knowledgeBases: KnowledgeBaseSummary[];
        version: SystemInfo | null;
    }>;
    /** 系统信息使用第二套信封；`version` 可能是编译期默认值 "unknown"。 */
    systemInfo(signal?: AbortSignal): Promise<SystemInfo>;
    listKnowledgeBases(signal?: AbortSignal): Promise<KnowledgeBaseSummary[]>;
    /** 单库有界召回。不同库的原始分数不直接比较，融合由 Host 完成。 */
    hybridSearch(kbId: string, params: HybridSearchParams, signal?: AbortSignal): Promise<SearchHit[]>;
    /** 文档状态与手工正文；用于父库校验和发布版本核对。 */
    getKnowledge(knowledgeId: string, signal?: AbortSignal): Promise<KnowledgeDetail>;
    /**
     * 列出知识库中的文档。用于创建响应丢失后按稳定标记对账：
     * 只能按标记与正文精确确认唯一匹配，禁止盲目重发创建。
     */
    listKnowledge(kbId: string, page: number, pageSize: number, signal?: AbortSignal): Promise<{
        total: number;
        items: KnowledgeDetail[];
    }>;
    private toDetail;
    /**
     * 按 chunk_index 原序分页读取分块。页大小上限 100（handler 自行钳制）。
     * 返回的块可能包含 `is_enabled=false`，调用方需自行判断。
     */
    listChunks(knowledgeId: string, page: number, pageSize: number, signal?: AbortSignal): Promise<ChunkPage>;
    /**
     * 创建草稿文档。每次创建产生新 ID，响应丢失必须走对账而不是重发。
     * 服务端只在 status=publish 时应用 process_config；草稿路径显式传 draft。
     */
    createManual(kbId: string, input: {
        title: string;
        content: string;
        status?: string;
        processConfig?: unknown;
    }, signal?: AbortSignal): Promise<KnowledgeDetail>;
    /**
     * 写文档自定义元数据。服务端是整体替换：未出现的旧键会被删除，
     * 因此调用方必须先读取现有值并合并保留非插件字段。校验失败返回 500 而非 400。
     */
    updateMetadata(knowledgeId: string, customMetadata: Record<string, unknown>, signal?: AbortSignal): Promise<KnowledgeDetail>;
    /**
     * 发布或改正文。必须携带完整非空正文与显式 status=publish；
     * 省略 status 会被服务端当作 draft，把已发布文档打回草稿。
     */
    publishManual(knowledgeId: string, body: string, processConfig?: unknown, signal?: AbortSignal): Promise<KnowledgeDetail>;
    /** 本地先拒绝超限正文；服务端上限为 200000 字符。 */
    private assertManualContent;
    /** 删除。200 仅表示入队；完成需由调用方以 GET 404 确认。 */
    deleteKnowledge(knowledgeId: string, signal?: AbortSignal): Promise<void>;
}
