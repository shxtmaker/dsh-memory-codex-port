import z from '@deepseek-ai/schemastery';
import type { Volatile } from '@deepseek-ai/cordis';
/** 开关通过宿主 ConfigEditor 原子持久化；生产默认不发送历史。 */
export interface Config {
    memoryProfileId: string;
    globalUse: Volatile<boolean>;
    globalGenerate: Volatile<boolean>;
    projectUse: Volatile<boolean>;
    projectGenerate: Volatile<boolean>;
    consent: Volatile<boolean>;
    provider: Volatile<string>;
    model: Volatile<string>;
    idleMinutes: Volatile<number>;
    consolidationMinutes: Volatile<number>;
    outputTokens: Volatile<number>;
    /** 远端检索总开关；连接表的 readEnabled 与之同时为真才允许查询。 */
    knowledgeRead: Volatile<boolean>;
    /** 已批准发布队列总开关；与连接表的 publishEnabled 同时为真才允许外发。 */
    knowledgePublish: Volatile<boolean>;
    /** 单库召回条数初值；待必要样本校准。 */
    matchCount: Volatile<number>;
    /** 向量与关键词召回阈值初值。 */
    vectorThreshold: Volatile<number>;
    keywordThreshold: Volatile<number>;
    /** 每次知识工具调用的总截止，覆盖 HTTP、校验、格式化与提交前检查。 */
    requestDeadlineMs: Volatile<number>;
    /** 会话远端活动槽位字节上限。 */
    remoteEvidenceBytes: Volatile<number>;
    /** 退役后短引用总字节上限。 */
    retiredReferenceBytes: Volatile<number>;
    /** 每用户轮知识工具调用次数上限。 */
    maxKnowledgeCallsPerTurn: Volatile<number>;
    /** 单批整理的最多变化来源数与输入 UTF-8 字节上限。 */
    consolidateBatchSources: Volatile<number>;
    consolidateBatchBytes: Volatile<number>;
}
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    memoryProfileId: z<string, string, "defined">;
    globalUse: z<boolean, boolean, "volatile-defined">;
    globalGenerate: z<boolean, boolean, "volatile-defined">;
    projectUse: z<boolean, boolean, "volatile-defined">;
    projectGenerate: z<boolean, boolean, "volatile-defined">;
    consent: z<boolean, boolean, "volatile-defined">;
    provider: z<string, string, "volatile-defined">;
    model: z<string, string, "volatile-defined">;
    idleMinutes: z<number, number, "volatile-defined">;
    consolidationMinutes: z<number, number, "volatile-defined">;
    outputTokens: z<number, number, "volatile-defined">;
    knowledgeRead: z<boolean, boolean, "volatile-defined">;
    knowledgePublish: z<boolean, boolean, "volatile-defined">;
    matchCount: z<number, number, "volatile-defined">;
    vectorThreshold: z<number, number, "volatile-defined">;
    keywordThreshold: z<number, number, "volatile-defined">;
    requestDeadlineMs: z<number, number, "volatile-defined">;
    remoteEvidenceBytes: z<number, number, "volatile-defined">;
    retiredReferenceBytes: z<number, number, "volatile-defined">;
    maxKnowledgeCallsPerTurn: z<number, number, "volatile-defined">;
    consolidateBatchSources: z<number, number, "volatile-defined">;
    consolidateBatchBytes: z<number, number, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    memoryProfileId: z<string, string, "defined">;
    globalUse: z<boolean, boolean, "volatile-defined">;
    globalGenerate: z<boolean, boolean, "volatile-defined">;
    projectUse: z<boolean, boolean, "volatile-defined">;
    projectGenerate: z<boolean, boolean, "volatile-defined">;
    consent: z<boolean, boolean, "volatile-defined">;
    provider: z<string, string, "volatile-defined">;
    model: z<string, string, "volatile-defined">;
    idleMinutes: z<number, number, "volatile-defined">;
    consolidationMinutes: z<number, number, "volatile-defined">;
    outputTokens: z<number, number, "volatile-defined">;
    knowledgeRead: z<boolean, boolean, "volatile-defined">;
    knowledgePublish: z<boolean, boolean, "volatile-defined">;
    matchCount: z<number, number, "volatile-defined">;
    vectorThreshold: z<number, number, "volatile-defined">;
    keywordThreshold: z<number, number, "volatile-defined">;
    requestDeadlineMs: z<number, number, "volatile-defined">;
    remoteEvidenceBytes: z<number, number, "volatile-defined">;
    retiredReferenceBytes: z<number, number, "volatile-defined">;
    maxKnowledgeCallsPerTurn: z<number, number, "volatile-defined">;
    consolidateBatchSources: z<number, number, "volatile-defined">;
    consolidateBatchBytes: z<number, number, "volatile-defined">;
}>>, "plain">;
