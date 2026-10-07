import type { MemoryItem, Publication } from '../contracts.ts';
/** 稳定发布标记前缀；同一 publish_id 重复渲染必须得到完全相同的标记。 */
export declare const PUBLISH_MARKER_PREFIX = "dsh-memory-publish";
/** 本机绝对路径的剥离规则，导出便于测试与调用方核对同一口径。 */
export declare function stripHostPaths(text: string): string;
/** 发布卡片的渲染输入；publishId 由预览阶段生成，预览与确认必须传入同一个值才能保证幂等。 */
export interface RenderCardInput {
    item: MemoryItem;
    project?: {
        name: string;
        root: string;
    };
    approvedAt: number;
    /**
     * 稳定发布标识。给出时按原样写入标记与卡片；未给出时按键的稳定字段派生，
     * 同一按键的重复渲染仍然得到相同结果。同一按键要发布到多个库时应显式传入不同 publishId。
     */
    publishId?: string;
}
/** 发布卡片的渲染结果；titleMarker 是标题形态，正文形态在 body 内。 */
export interface RenderedCard {
    title: string;
    body: string;
    bodyHash: string;
    marker: string;
    titleMarker: string;
}
/** 正文哈希用于证明发布正文与批准快照一致。 */
export declare function sha256(text: string): string;
/** 浏览器与宿主对同一文本得到的字节数一致；一律按 UTF-8 字节计量。 */
export declare function byteLength(text: string): number;
/**
 * 渲染经验卡片；纯函数、无 I/O，相同输入必须得到逐字相同的正文与哈希。
 * 正文内嵌自身 hash，所以先在占位符上计算 hash，再回填最终正文。
 */
export declare function renderCard(input: RenderCardInput): RenderedCard;
/** 稳定标记：同一 publishId 的重复渲染得到完全相同的字符串。 */
export declare function markerOf(publishId: string): string;
/** 从任意文本中提取发布标记；正文出现多次时要求彼此一致，冲突或缺失返回 null。 */
export declare function extractMarker(text: string): string | null;
/**
 * 合并 custom_metadata：服务端是整体替换语义，必须保留 existing 中所有非插件字段，
 * 只覆盖插件自有键，结果必须是满足服务端上限的扁平标量对象。
 */
export declare function mergeMetadata(existing: Record<string, unknown>, patch: {
    publishId: string;
    memoryId: string;
    sourceRevision: number;
    bodyHash: string;
    sourceHash: string;
    approvedAt: number;
}): Record<string, unknown>;
/** 版本差异：revision 变化优先于正文变化；published 为空表示尚未发布。 */
export declare function versionDiff(published: {
    sourceRevision: number;
    bodyHash: string;
} | null, candidate: {
    sourceRevision: number;
    bodyHash: string;
}): 'none' | 'updated' | 'body-changed' | 'unpublished';
/** 预览标识：把 memoryId、sourceRevision、bodyHash、targetKbId 四者绑进同一个值。 */
export declare function previewKey(input: {
    memoryId: string;
    sourceRevision: number;
    bodyHash: string;
    targetKbId: string;
}): string;
/**
 * 批准快照是否仍然是当前有效版本。任一环节无法证明时返回 false，
 * 宁可显示待复核，也不宣称远端是新的已完成版本。
 */
export declare function isApprovedSnapshotCurrent(publication: Publication, item: MemoryItem, bodyHashNow: string): boolean;
