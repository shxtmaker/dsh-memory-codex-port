import z from '@deepseek-ai/schemastery'
import type { Volatile } from '@deepseek-ai/cordis'
/** 开关通过宿主 ConfigEditor 原子持久化；生产默认不发送历史。 */
export interface Config {
  memoryProfileId: string
  globalUse: Volatile<boolean>; globalGenerate: Volatile<boolean>
  projectUse: Volatile<boolean>; projectGenerate: Volatile<boolean>
  consent: Volatile<boolean>; provider: Volatile<string>; model: Volatile<string>
  idleMinutes: Volatile<number>; consolidationMinutes: Volatile<number>
  dailyTokens: Volatile<number>; outputTokens: Volatile<number>
}
export const Config = z.object({
  memoryProfileId: z.string().pattern(/^[a-z0-9-]{1,64}$/).default('local-default'),
  globalUse: z.boolean().default(false).volatile(), globalGenerate: z.boolean().default(false).volatile(),
  projectUse: z.boolean().default(false).volatile(), projectGenerate: z.boolean().default(false).volatile(),
  consent: z.boolean().default(false).volatile(), provider: z.string().default('').volatile(), model: z.string().default('').volatile(),
  idleMinutes: z.number().min(10).max(1440).default(10).volatile(),
  consolidationMinutes: z.number().min(30).max(1440).default(30).volatile(),
  dailyTokens: z.number().min(0).max(100000).step(1).default(20000).volatile(),
  outputTokens: z.number().min(256).max(4096).step(1).default(1024).volatile(),
})
