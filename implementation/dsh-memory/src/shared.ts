import { z } from 'zod'
/** 保守证据计量：按 UTF-8 字节计费，覆盖正文、引用和封装。 */
export function tokens(text: string): number { return Buffer.byteLength(text, 'utf8') }
/** 输入与输出均脱敏；不将异常正文写入诊断。 */
export function redact(text: string): string {
  return text.replace(/\b(?:sk-|ghp_|github_pat_|AKIA)[A-Za-z0-9_-]{8,}/g, '[REDACTED]')
    .replace(/(\b(?:api[_-]?key|token|password|secret|authorization)\s*[:=]\s*)([^\s,;"']+)/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/([?&](?:token|key|api_key|secret|password)=)[^&\s]+/gi, '$1[REDACTED]')
}
/** 中文二元组和代码符号精确索引，不依赖英文 FTS 分词。 */
export function terms(text: string): string[] {
  const result = new Set<string>()
  for (const match of text.toLowerCase().matchAll(/[a-z0-9_.$/-]{2,80}|[\p{Script=Han}]+/gu)) {
    const word = match[0]
    if (/\p{Script=Han}/u.test(word)) {
      for (let i = 0; i < word.length - 1; i++) result.add(word.slice(i, i + 2))
      if (word.length === 1) result.add(word)
    } else result.add(word)
    if (result.size >= 256) break
  }
  return [...result]
}
export const candidateSchema = z.object({
  scope: z.enum(['global', 'project']), kind: z.enum(['preference', 'decision', 'experience', 'skill']),
  title: z.string().min(1).max(160), content: z.string().min(1).max(4000),
  status: z.enum(['suggested', 'planned', 'observed', 'completed', 'verified', 'rejected', 'expired']),
  source_refs: z.array(z.number().int().nonnegative()).min(1).max(16),
}).strict()
export const extractionSchema = z.object({
  raw_memory: z.string().max(8000).optional(), rollout_summary: z.string().max(4000),
  rollout_slug: z.string().regex(/^[a-z0-9-]{1,80}$/), items: z.array(candidateSchema).max(12),
}).strict()
export const proposalSchema = z.object({
  changes: z.array(z.object({
    op: z.enum(['add', 'update', 'revoke']), id: z.string().optional(), revision: z.number().int().positive().optional(),
    title: z.string().min(1).max(160), content: z.string().max(4000),
    kind: z.enum(['preference', 'decision', 'experience', 'skill']),
    status: z.enum(['suggested', 'planned', 'observed', 'completed', 'verified', 'rejected', 'expired']),
    sources: z.array(z.string()).min(1).max(16),
  }).strict()).max(24),
}).strict()
export type Extraction = z.infer<typeof extractionSchema>
export type Proposal = z.infer<typeof proposalSchema>
