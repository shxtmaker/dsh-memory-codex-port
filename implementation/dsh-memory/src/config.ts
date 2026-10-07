import z from '@deepseek-ai/schemastery'
import type { Volatile } from '@deepseek-ai/cordis'
/** 开关通过宿主 ConfigEditor 原子持久化；生产默认不发送历史。 */
export interface Config {
  memoryProfileId: string
  globalUse: Volatile<boolean>; globalGenerate: Volatile<boolean>
  projectUse: Volatile<boolean>; projectGenerate: Volatile<boolean>
  consent: Volatile<boolean>; provider: Volatile<string>; model: Volatile<string>
  idleMinutes: Volatile<number>; consolidationMinutes: Volatile<number>
  outputTokens: Volatile<number>
  /** 远端检索总开关；连接表的 readEnabled 与之同时为真才允许查询。 */
  knowledgeRead: Volatile<boolean>
  /** 已批准发布队列总开关；与连接表的 publishEnabled 同时为真才允许外发。 */
  knowledgePublish: Volatile<boolean>
  /** 单库召回条数初值；待必要样本校准。 */
  matchCount: Volatile<number>
  /** 向量与关键词召回阈值初值。 */
  vectorThreshold: Volatile<number>; keywordThreshold: Volatile<number>
  /** 每次知识工具调用的总截止，覆盖 HTTP、校验、格式化与提交前检查。 */
  requestDeadlineMs: Volatile<number>
  /** 会话远端活动槽位字节上限。 */
  remoteEvidenceBytes: Volatile<number>
  /** 退役后短引用总字节上限。 */
  retiredReferenceBytes: Volatile<number>
  /** 每用户轮知识工具调用次数上限。 */
  maxKnowledgeCallsPerTurn: Volatile<number>
  /** 单批整理的最多变化来源数与输入 UTF-8 字节上限。 */
  consolidateBatchSources: Volatile<number>
  consolidateBatchBytes: Volatile<number>
}
export const Config = z.object({
  memoryProfileId: z.string().pattern(/^[a-z0-9-]{1,64}$/).default('local-default'),
  globalUse: z.boolean().default(false).volatile(), globalGenerate: z.boolean().default(false).volatile(),
  projectUse: z.boolean().default(false).volatile(), projectGenerate: z.boolean().default(false).volatile(),
  consent: z.boolean().default(false).volatile(), provider: z.string().default('').volatile(), model: z.string().default('').volatile(),
  idleMinutes: z.number().min(10).max(1440).default(10).volatile(),
  consolidationMinutes: z.number().min(30).max(1440).default(30).volatile(),
  outputTokens: z.number().min(256).max(4096).step(1).default(1024).volatile(),
  knowledgeRead: z.boolean().default(false).volatile(),
  knowledgePublish: z.boolean().default(false).volatile(),
  matchCount: z.number().min(1).max(20).step(1).default(6).volatile(),
  vectorThreshold: z.number().min(0).max(1).default(0.15).volatile(),
  keywordThreshold: z.number().min(0).max(1).default(0.3).volatile(),
  requestDeadlineMs: z.number().min(200).max(30000).step(1).default(1500).volatile(),
  remoteEvidenceBytes: z.number().min(256).max(16384).step(1).default(3072).volatile(),
  retiredReferenceBytes: z.number().min(64).max(4096).step(1).default(256).volatile(),
  maxKnowledgeCallsPerTurn: z.number().min(1).max(8).step(1).default(2).volatile(),
  consolidateBatchSources: z.number().min(1).max(64).step(1).default(8).volatile(),
  consolidateBatchBytes: z.number().min(4096).max(262144).step(1).default(24576).volatile(),
})
