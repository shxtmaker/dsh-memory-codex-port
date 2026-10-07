/**
 * 知识检索的融合、裁剪与文案包装（P05）。
 *
 * 本模块只包含纯函数与纯内存状态：不触达 SQLite、HTTP 或 StorageWorker。
 * 网络与存储由 src/retrieval/evidence.ts 通过注入端口完成，因此这里的每个入口都可隔离测试。
 *
 * 计量口径（方案第 4.2 节）：
 *   - 远端活动槽位上限 3072 UTF-8 字节，标题、引用、正文与 <knowledge-evidence> 封装一起计入；
 *   - 字节一律用 Buffer.byteLength(text, 'utf8') 计算，不用字符数；
 *   - 退役短引用的 256 字节额度独立，由退役流程使用，不参与活动证据计量。
 *
 * 融合原则：不同知识库的原始分数不可比，先按库内排名做轮转融合，
 * 再做来源配额与正文哈希去重，最后执行字节裁剪。
 */
import type { RemoteRef } from '../contracts.ts';
/** 活动槽位的字节预算：activeBytes 是已占用字节，limitBytes 是该槽位上限。 */
export interface KnowledgeBudget {
    activeBytes: number;
    retiredBytes: number;
    limitBytes: number;
    retiredLimitBytes: number;
}
/** 融合前的一条命中：kbRank 是库内排名（0 基，由调用方按库内顺序给出）。 */
export interface RankedHit {
    kbId: string;
    kbRank: number;
    knowledgeId: string;
    chunkId: string;
    title: string;
    content: string;
    score: number;
    bodyHash: string;
    fetchedAt: number;
    matchType: number;
}
/**
 * 合并多个库的结果。参数为每库（按绑定顺序）已按库内排名排序的结果数组。
 *
 * 不同库的原始分数不参与比较：第 r 轮取各库库内第 r 条，因此高排名优先于高分。
 * 同一轮次内视为同分，按 (kbId, knowledgeId, chunkId) 字典序排列，结果与传入的
 * 库数组顺序无关，保证可复现。输出条目的 kbRank 归一为 1 基的库内排名。
 */
export declare function rankAcross(hits: RankedHit[][], limit: number): RankedHit[];
/**
 * 构造远端证据正文。
 *
 * 标题、引用行、正文与首尾封装一起计入 limitBytes；单条放不下时可以截断正文，
 * 但引用标识行必须完整保留。任何一条连引用行都放不下时整份返回 TOO_LARGE 且不产出半条，
 * 由调用方按降级处理（evidence.ts 会释放槽位并给出固定代码）。
 * 无正文可提交（没有命中，或命中正文为空）时返回空文本，不产出空壳证据。
 */
export declare function renderEvidence(hits: RankedHit[], budget: KnowledgeBudget): {
    text: string;
    used: RemoteRef[];
    bytes: number;
    code: 'OK' | 'TOO_LARGE';
};
/**
 * 分页正文裁剪：只按剩余字节返回完整块，超出即停止，不返回半块。
 * nextCursor 取最后一块的 chunkIndex + 1（即下一个尚未读取的块序号）；
 * remainingBytes <= 0 或首块就超限时不返回任何块，nextCursor 为 0。
 * bytes 含块间换行分隔符，与实际拼接后的正文一致。
 */
export declare function clipPage(chunks: readonly {
    id: string;
    chunkIndex: number;
    content: string;
}[], remainingBytes: number): {
    blocks: string[];
    bytes: number;
    nextCursor: number;
};
/**
 * 每用户轮的知识调用计数。同一 userTurn 内超过 limit 即返回 false；
 * userTurn 变化或 reset() 后重新计数。
 *
 * 第二个参数可选，用于按调用覆盖构造时的上限（evidence.ts 以会话为键共享计数器，
 * 上限按当前设置逐次传入）。
 */
export declare class TurnCounter {
    private readonly limit;
    private turn;
    private count;
    constructor(limit: number);
    use(userTurn: number, limit?: number): boolean;
    reset(): void;
}
/**
 * 检索工具结果文案。成功时必须给出引用；失败时必须给出固定代码并写明这是降级，
 * 不能用空结果冒充成功，也不能让模型把“没有取到”当成“没有相关资料”。
 */
export declare function formatSearchResult(hits: readonly RemoteRef[], code: string, message: string): string;
/**
 * 文档分页读取的工具结果文案。成功时给出目标、页码与当页正文；
 * 失败时给出固定代码并明确本页未注入，不用空页冒充读取成功。
 */
export declare function formatReadResult(input: {
    knowledgeId: string;
    title: string;
    page: number;
    blocks: readonly string[];
    total: number;
    code: string;
    message: string;
}): string;
