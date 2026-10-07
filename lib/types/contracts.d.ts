/** 浏览器与 Host 之间的管理请求。作用域由 Host 解析。 */
export interface ManageRequest {
    action: 'overview' | 'providers' | 'models' | 'list' | 'read' | 'save' | 'remove' | 'clear' | 'files' | 'file' | 'export' | 'rebuild' | 'job' | 'projectPolicy' | 'sources' | 'removeSource' | 'connections' | 'connection' | 'binding' | 'knowledgeBases' | 'knowSave' | 'knowRemove' | 'knowToggle' | 'preview' | 'publishConfirm' | 'publications' | 'withdrawRecall' | 'syncNow';
    provider?: string;
    scope?: string;
    id?: string;
    title?: string;
    content?: string;
    revision?: number;
    epoch?: number;
    confirmation?: string;
    cursor?: number;
    limit?: number;
    use?: boolean;
    generate?: boolean;
    sessionId?: string;
    /** WeKnora 连接设置；凭据只以引用名传递，正文永不进入本结构。 */
    connection?: ConnectionInput;
    /** 项目只读/发布知识库绑定。 */
    binding?: BindingInput;
    /** 发布预览与确认所用的一次性快照标识。 */
    previewId?: string;
    publishId?: string;
}
/** 管理页提交的连接设置；密钥不在此结构中传输。 */
export interface ConnectionInput {
    connectionId: string;
    baseUrl: string;
    apiProfile?: string;
    tenantId?: string;
    readCredentialRef?: string;
    publishCredentialRef?: string;
}
/** 项目到连接的显式绑定；跨主机同名目录不会自动对应同一项目。 */
export interface BindingInput {
    projectId: string;
    connectionId: string;
    readKbIds: string[];
    publishKbId?: string;
}
/** JSON 正文经过请求操作所属的校验器解析。 */
export interface ManageResult {
    json: string;
}
/** SQLite 中一条可追溯的记忆。 */
export interface MemoryItem {
    id: string;
    scope: string;
    title: string;
    content: string;
    kind: string;
    status: string;
    pinned: boolean;
    manual: boolean;
    revision: number;
    createdAt: number;
    updatedAt: number;
    sources: string[];
}
/** 已提交会话中的逻辑来源范围；不保存聊天正文。 */
export interface Source {
    id: string;
    sessionId: string;
    project: string;
    start: number;
    end: number;
    hash: string;
    updatedAt: number;
    excluded: boolean;
}
/** 主机上的持久项目身份，严格按工作树隔离。 */
export interface Project {
    id: string;
    root: string;
    target: string;
    name: string;
    use: boolean | null;
    generate: boolean | null;
}
/** 后台任务的持久租约与逐次计量。 */
export interface Job {
    id: string;
    key: string;
    scope: string;
    kind: 'extract' | 'consolidate';
    source: string;
    epoch: number;
    fence: number;
    leaseUntil: number;
    attempts: number;
    retryAt: number;
    state: string;
    reserved: number;
    error: string;
    createdAt: number;
    intervalMs?: number;
    settledAt?: number;
    updatedAt?: number;
    attemptUsage?: number | null;
    diagnostic?: string;
    modelFinish?: string;
}
/** 每次后台模型调用独立计量；未知用量不冒充实际账单。 */
export interface DailyUsage {
    day: string;
    timezone: string;
    tokens: number;
    calls: number;
    unknownCalls: number;
}
/** WeKnora 连接：只保存凭据引用，不保存密钥正文。 */
export interface WeKnoraConnection {
    connectionId: string;
    baseUrl: string;
    apiProfile: string;
    tenantId: string;
    readCredentialRef: string;
    publishCredentialRef: string;
    readEnabled: boolean;
    publishEnabled: boolean;
    configRevision: number;
    createdAt: number;
    updatedAt: number;
}
/** 连接上的预算与策略参数；与方案第二节首版默认值一致。 */
export interface ConnectionSettings {
    maxKnowledgeBases: number;
    requestDeadlineMs: number;
    remoteEvidenceBytes: number;
    retiredReferenceBytes: number;
    maxKnowledgeCallsPerTurn: number;
    publishMode: string;
    useCrossSessionRemoteCache: boolean;
}
export declare const DEFAULT_CONNECTION_SETTINGS: ConnectionSettings;
/** 项目到连接与知识库的绑定；无绑定时禁止远端检索。 */
export interface ProjectBinding {
    localProjectId: string;
    connectionId: string;
    readKbIds: string[];
    publishKbId: string;
    bindingRevision: number;
    updatedAt: number;
}
/** 远端证据槽位状态。终态行保留用于审计与重启对账。 */
export type EvidenceState = 'reserved' | 'active' | 'retired' | 'orphan' | 'failed';
/** 会话内单一远端活动槽位。 */
export interface ExternalEvidence {
    slotId: string;
    sessionId: string;
    generation: number;
    userTurn: number;
    toolCallId: string;
    resultSeq: number;
    state: EvidenceState;
    contentBytes: number;
    bindingRevision: number;
    connectionId: string;
    kbIds: string[];
    toolName: 'search' | 'read';
    remoteRefs: RemoteRef[];
    createdSeq: number;
    createdAt: number;
    replacedBy: string;
    retiredBytes: number;
}
/** 单条远端引用；正文不进入本结构。 */
export interface RemoteRef {
    kbId: string;
    knowledgeId: string;
    chunkId: string;
    rank: number;
    score: number;
    bodyHash: string;
    title: string;
    fetchedAt: number;
    version?: string;
    remoteRevision?: number;
}
/** 已退役结果的短引用；总计不超过配置的退役字节上限。 */
export interface RetiredReference {
    slotId: string;
    sessionId: string;
    generation: number;
    content: string;
    bytes: number;
    retiredAt: number;
}
/** 发布状态机。已发布版本与待复核候选分别保存。 */
export type PublicationState = 'draft' | 'approved' | 'creating' | 'created' | 'metadata' | 'publishing' | 'verifying' | 'published' | 'reconcile_required' | 'conflict' | 'withdraw_queued' | 'withdrawing' | 'withdrawn' | 'failed';
/** 经验卡片的批准快照；worker 只能发送明确批准的快照。 */
export interface ApprovedSnapshot {
    title: string;
    body: string;
    bodyHash: string;
    sourceRevision: number;
    sourceHash: string;
    targetKbId: string;
    approvedAt: number;
}
/** 本地记忆与远端发布副本的映射。 */
export interface Publication {
    publishId: string;
    memoryId: string;
    scope: string;
    targetKbId: string;
    connectionId: string;
    remoteId: string;
    state: PublicationState;
    publishedSourceRevision: number;
    publishedBodyHash: string;
    candidateSourceRevision: number;
    candidateBodyHash: string;
    sourceHash: string;
    approved: ApprovedSnapshot | null;
    remoteVersion: string;
    generation: number;
    approvedAt: number;
    lastIndexPollAt: number;
    indexDeadline: number;
    error: string;
    createdAt: number;
    updatedAt: number;
}
/** 持久发布队列；本地变更与队列写入同事务。 */
export interface OutboxOperation {
    operationId: string;
    publishId: string;
    op: 'create' | 'update' | 'withdraw';
    approvedSnapshot: ApprovedSnapshot | null;
    attempts: number;
    nextRetryAt: number;
    state: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
    lastErrorCode: string;
    generation: number;
    createdAt: number;
    updatedAt: number;
}
/** 远端墓碑；删除完成后仍保留以阻止旧结果重生。 */
export interface RemoteTombstone {
    connectionId: string;
    kbId: string;
    remoteId: string;
    publishId: string;
    memoryId: string;
    sourceEpoch: number;
    state: 'pending' | 'done' | 'failed';
    attempts: number;
    createdAt: number;
    updatedAt: number;
}
/** 重试上限后可由用户手动重试的失败项。 */
export interface OutboxFailure {
    operationId: string;
    publishId: string;
    op: string;
    attempts: number;
    lastErrorCode: string;
    nextRetryAt: number;
}
/** 知识工具路由结果。 */
export interface KnowledgeOutcome {
    ok: boolean;
    code: 'OK' | 'NO_BINDING' | 'READ_DISABLED' | 'NOT_CONFIGURED' | 'DEADLINE' | 'CANCELLED' | 'UPSTREAM' | 'UNAUTHORIZED' | 'KB_DENIED' | 'TURN_LIMIT' | 'SLOT_BUSY' | 'SOURCE_RETIRED' | 'NOT_FOUND' | 'TOO_LARGE';
    status: number;
    message: string;
}
