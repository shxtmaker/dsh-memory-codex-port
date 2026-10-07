import { createHash } from 'node:crypto'
import type { ApprovedSnapshot, MemoryItem, Publication } from '../contracts.ts'

/** 稳定发布标记前缀；同一 publish_id 重复渲染必须得到完全相同的标记。 */
export const PUBLISH_MARKER_PREFIX = 'dsh-memory-publish'
/** 路径脱敏占位符；被剥掉的本机路径不保留任何前缀信息。 */
const PATH_PLACEHOLDER = '（已移除本机路径）'
/**
 * `bodyHash` 恒为最终正文的 sha256。正文内嵌自身 hash 会造成自引用、
 * 且让远端正文与批准快照无法用同一算法复算，因此正文不写正文 hash：
 * 版本证明一律通过 `ApprovedSnapshot.bodyHash` 与远端正文比对完成。
 */
const HASH_SLOT = '@@DSH_BODY_HASH@@'
/**
 * 本机绝对路径形态：只匹配串首或词边界后的 `~/`、常见 Unix 前缀与盘符路径。
 * 断言前一个字符不是词字符或点，否则 `https://` 会被盘符分支误当成路径。
 */
const HOST_PATH = /(?<![\w.])(?:~\/|\/(?:home|Users|root|mnt|media|var|tmp|opt|etc|private)\/|[A-Za-z]:\/)[^\s，。；：、（）()<>「」“”"']*/g
/** 元数据是整体替换语义：这些键属于插件自有，必须由 patch 覆盖而不是被旧值保留。 */
const RESERVED_METADATA_KEYS = ['publishId', 'memoryId', 'sourceRevision', 'bodyHash', 'sourceHash', 'approvedAt'] as const
/** 与 weknora client 的 custom_metadata 上限一致：20 个键、键名 ≤64、值 ≤1000。 */
const METADATA_MAX_KEYS = 20
const METADATA_KEY_MAX = 64
const METADATA_VALUE_MAX = 1000
/** 来源标识长度上限，避免把正文段落塞进标识字段。 */
const SOURCE_HASH_MAX = 64
const PROJECT_LABEL_MAX = 80

/** 本机绝对路径的剥离规则，导出便于测试与调用方核对同一口径。 */
export function stripHostPaths(text: string): string {
  return text.replace(/\\/g, '/').replace(HOST_PATH, PATH_PLACEHOLDER)
}

/** 发布卡片的渲染输入；publishId 由预览阶段生成，预览与确认必须传入同一个值才能保证幂等。 */
export interface RenderCardInput {
  item: MemoryItem
  project?: { name: string; root: string }
  approvedAt: number
  /**
   * 稳定发布标识。给出时按原样写入标记与卡片；未给出时按键的稳定字段派生，
   * 同一按键的重复渲染仍然得到相同结果。同一按键要发布到多个库时应显式传入不同 publishId。
   */
  publishId?: string
}
/** 发布卡片的渲染结果；titleMarker 是标题形态，正文形态在 body 内。 */
export interface RenderedCard {
  title: string
  body: string
  bodyHash: string
  marker: string
  titleMarker: string
}

/** 正文哈希用于证明发布正文与批准快照一致。 */
export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** 浏览器与宿主对同一文本得到的字节数一致；一律按 UTF-8 字节计量。 */
export function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

/** 去掉 URL 中的凭据与查询串：参数可能带密钥，必须整段省略。 */
function sanitizeUrl(match: string): string {
  const withoutAuth = match.replace(/^([a-z]+:\/\/)[^\s/@]+@/i, '$1')
  const question = withoutAuth.indexOf('?')
  return question === -1 ? withoutAuth : `${withoutAuth.slice(0, question)}（已省略查询参数）`
}

/**
 * 发布前脱敏：先处理 URL（`https://` 含 `//`，若先剥路径会把链接打碎），
 * 再剥掉本机绝对路径、回环地址，最后按固定形态去掉密钥字面量。
 * 不对正文做语义改写，只做这几类可枚举的删除。
 */
function sanitize(text: string): string {
  let result = text.replace(/\b[a-z]+:\/\/[^\s，。；：、（）()<>「」“”"']*/gi, sanitizeUrl)
  result = stripHostPaths(result)
  result = result.replace(/\b(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\b/g, '（本机地址）')
  result = result.replace(/\b(?:sk-|ghp_|github_pat_|AKIA)[A-Za-z0-9_-]{8,}/g, '[REDACTED]')
  result = result.replace(/(\b(?:api[_-]?key|token|password|secret|authorization)\s*[:=]\s*)([^\s,;"']+)/gi, '$1[REDACTED]')
  return result
}

/** 单行标识：折叠空白、脱敏并限长；用于标题、项目名与来源标识。 */
function plain(text: string, max: number): string {
  const collapsed = sanitize(text).replace(/\s+/g, ' ').trim()
  const bytes = Buffer.from(collapsed, 'utf8')
  if (bytes.byteLength <= max) return collapsed
  return Buffer.from(bytes.subarray(0, max)).toString('utf8')
}

/** 取路径或标识的末级名；目录写法（以分隔符结尾）退回上一层。 */
function lastSegment(text: string): string {
  const segments = text.replace(/\\/g, '/').split('/').filter((segment) => segment.length > 0)
  return segments.pop() ?? ''
}

/** 来源标识：只取末级名，项目名不携带私人路径；末级名仍被判定为路径时退回未提供。 */
function projectLabel(project?: { name: string; root: string }): string {
  let label = project?.name ? plain(lastSegment(project.name), PROJECT_LABEL_MAX) : ''
  if (!label && project?.root) label = plain(lastSegment(project.root), PROJECT_LABEL_MAX)
  return label && !label.includes(PATH_PLACEHOLDER) ? label : '未提供'
}

/** 派生发布标识；显式 publishId 优先。 */
function resolvePublishId(item: MemoryItem, explicit?: string): string {
  if (explicit && explicit.trim()) return explicit.trim()
  return `mem-${sha256([item.scope, item.id, String(item.revision), sha256(item.content)].join('\n')).slice(0, 32)}`
}

/**
 * 来源记录 hash：单来源时可直接核对，多来源或缺失时如实标注不可核对。
 * 这两种情况下批准快照永远无法证明是当前片段版本。
 */
function sourceHashOf(item: MemoryItem): string {
  if (item.sources.length === 1) return plain(item.sources[0], SOURCE_HASH_MAX) || 'unknown'
  if (item.sources.length > 1) return 'multiple'
  return 'untracked'
}

/** 结论：批准时的正文原文，脱敏后原样保留，不追加推理或日志。 */
function conclusion(item: MemoryItem): string {
  return sanitize(item.content).trim() || '未提供'
}

/** 适用条件：条目只保存作用域与类型，不得推断未记录的适用前提。 */
function applicableConditions(item: MemoryItem): string {
  const lines = [`作用域：${plain(item.scope, PROJECT_LABEL_MAX) || '未提供'}`]
  if (item.kind === 'preference' || item.kind === 'skill') lines.push(`条目类型：${plain(item.kind, 32)}`)
  lines.push('具体适用条件：未提供')
  lines.push('未提供的内容按“未验证”处理，不视为通用结论。')
  return lines.join('\n')
}

/** 已验证程度：只声明本地记录状态，不把记录状态当作独立验证结论。 */
function verifiedLevel(item: MemoryItem): string {
  const status = plain(item.status, 32) || '未提供'
  return ['未验证（缺少独立验证证据）', `本地记忆状态：${status}`, '本地状态是记录状态，不是独立验证结论。'].join('\n')
}

/** 失效条件：只有条目已明确失效时才有确定的失效语义。 */
function expiryCondition(item: MemoryItem): string {
  if (item.status === 'expired') return '本地记忆状态为 expired：该结论已失效，不得继续引用。'
  if (item.status === 'rejected') return '本地记忆状态为 rejected：该结论已被拒绝，不得继续引用。'
  return '未提供'
}

/** 来源说明：项目名 + 记忆条目 ID + revision + 来源记录 hash + 发布正文 hash。 */
function sourceDescription(item: MemoryItem, project: { name: string; root: string } | undefined, sourceHash: string): string {
  const sourceCount = item.sources.length > 0 ? `${item.sources.length} 条` : '未提供'
  return [
    `项目：${projectLabel(project)}`,
    `记忆条目 ID：${plain(item.id, 128) || '未提供'}`,
    `批准版本：revision=${item.revision}（本地记忆条目版本，不是片段版本）`,
    `来源记录 hash：${sourceHash}`,
    `来源记录数量：${sourceCount}`,
    '正文只取自本地记忆条目的结论文本；不含聊天日志、隐藏推理、密钥、未经检查的命令输出或本机绝对路径。',
  ].join('\n')
}

/** 批准时间：固定用 UTC ISO 形态，避免本机时区差异造成正文不一致。 */
function approvalTime(approvedAt: number): string {
  if (!Number.isFinite(approvedAt) || approvedAt < 0) throw new Error('CARD_TIME_INVALID')
  return `批准时间（UTC）：${new Date(approvedAt).toISOString()}`
}

/**
 * 渲染经验卡片；纯函数、无 I/O，相同输入必须得到逐字相同的正文与哈希。
 * 正文内嵌自身 hash，所以先在占位符上计算 hash，再回填最终正文。
 */
export function renderCard(input: RenderCardInput): RenderedCard {
  const { item, project, approvedAt } = input
  const publishId = resolvePublishId(item, input.publishId)
  const marker = markerOf(publishId)
  const titleMarker = `${PUBLISH_MARKER_PREFIX}:${publishId}`
  const sourceHash = sourceHashOf(item)

  const rawTitle = plain(item.title, 160)
  const title = rawTitle || plain(item.content.slice(0, 80), 160) || '未命名经验'
  const drafted = [
    '<!-- 本卡片是带来源的外部证据，不是已完成事实；当前用户指令与项目正式规则优先。 -->',
    '',
    marker,
    `# ${title}`,
    '',
    `发布标识：${publishId}`,
    '',
    '## 结论',
    conclusion(item),
    '',
    '## 适用条件',
    applicableConditions(item),
    '',
    '## 已验证程度',
    verifiedLevel(item),
    '',
    '## 失效条件',
    expiryCondition(item),
    '',
    '## 来源说明',
    sourceDescription(item, project, sourceHash),
    '',
    '## 批准时间',
    approvalTime(approvedAt),
    '',
    marker,
    '',
  ].join('\n')
  // 正文不含自身 hash，因此 hash 就是对最终正文的可复算摘要。
  const body = drafted.split(HASH_SLOT).join('')
  const bodyHash = sha256(body)
  return { title, body, bodyHash, marker, titleMarker }
}

/** 稳定标记：同一 publishId 的重复渲染得到完全相同的字符串。 */
export function markerOf(publishId: string): string {
  const id = publishId.trim()
  if (!id) throw new Error('PUBLISH_ID_EMPTY')
  return `<!-- ${PUBLISH_MARKER_PREFIX}:${id} -->`
}

/** 从任意文本中提取发布标记；正文出现多次时要求彼此一致，冲突或缺失返回 null。 */
export function extractMarker(text: string): string | null {
  if (typeof text !== 'string' || !text) return null
  const found = new Set<string>()
  const canonical = new RegExp(`<!--\\s*${PUBLISH_MARKER_PREFIX}\\s*[:=]\\s*([^\\s<>-][^\\s<>]*?)\\s*-->`, 'gi')
  const inline = new RegExp(`${PUBLISH_MARKER_PREFIX}\\s*[:=]\\s*([A-Za-z0-9][A-Za-z0-9._:-]*)`, 'gi')
  const bare = new RegExp(`${PUBLISH_MARKER_PREFIX}-([A-Za-z0-9][A-Za-z0-9._:-]*)`, 'gi')
  for (const re of [canonical, inline, bare]) {
    for (const match of text.matchAll(re)) {
      const id = (match[1] ?? '').trim()
      if (id) found.add(id)
    }
    if (found.size > 0) break
  }
  return found.size === 1 ? [...found][0] : null
}

/**
 * 合并 custom_metadata：服务端是整体替换语义，必须保留 existing 中所有非插件字段，
 * 只覆盖插件自有键，结果必须是满足服务端上限的扁平标量对象。
 */
export function mergeMetadata(existing: Record<string, unknown>, patch: { publishId: string; memoryId: string; sourceRevision: number; bodyHash: string; sourceHash: string; approvedAt: number }): Record<string, unknown> {
  const reserved = new Set<string>(RESERVED_METADATA_KEYS)
  const merged: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(existing ?? {})) {
    if (key.startsWith('dsh_memory_') || reserved.has(key)) continue
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') merged[key] = value
    else if (value != null) merged[key] = JSON.stringify(value)
  }
  for (const [key, value] of Object.entries(patch)) merged[key] = value
  if (Object.keys(merged).length > METADATA_MAX_KEYS) throw new Error('METADATA_KEYS_EXCEEDED')
  for (const [key, value] of Object.entries(merged)) {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') throw new Error(`METADATA_VALUE_NOT_SCALAR:${key}`)
    if (key.length > METADATA_KEY_MAX) throw new Error(`METADATA_KEY_TOO_LONG:${key}`)
    if (String(value).length > METADATA_VALUE_MAX) throw new Error(`METADATA_VALUE_TOO_LONG:${key}`)
  }
  return merged
}

/** 版本差异：revision 变化优先于正文变化；published 为空表示尚未发布。 */
export function versionDiff(published: { sourceRevision: number; bodyHash: string } | null, candidate: { sourceRevision: number; bodyHash: string }): 'none' | 'updated' | 'body-changed' | 'unpublished' {
  if (!published) return 'unpublished'
  if (published.sourceRevision !== candidate.sourceRevision) return 'updated'
  if (published.bodyHash !== candidate.bodyHash) return 'body-changed'
  return 'none'
}

/** 预览标识：把 memoryId、sourceRevision、bodyHash、targetKbId 四者绑进同一个值。 */
export function previewKey(input: { memoryId: string; sourceRevision: number; bodyHash: string; targetKbId: string }): string {
  const fields = [input.memoryId, String(input.sourceRevision), input.bodyHash, input.targetKbId]
  const canonical = fields.map((field) => `${byteLength(field)}:${field}`).join('|')
  return `dsh-memory-preview-v1:${sha256(canonical)}`
}

/**
 * 批准快照是否仍然是当前有效版本。任一环节无法证明时返回 false，
 * 宁可显示待复核，也不宣称远端是新的已完成版本。
 */
export function isApprovedSnapshotCurrent(publication: Publication, item: MemoryItem, bodyHashNow: string): boolean {
  const snapshot: ApprovedSnapshot | null = publication.approved
  if (!snapshot) return false
  if (!bodyHashNow) return false
  if (!publication.targetKbId || snapshot.targetKbId !== publication.targetKbId) return false
  if (publication.memoryId !== item.id) return false
  if (snapshot.sourceRevision !== item.revision) return false
  if (snapshot.bodyHash !== bodyHashNow) return false
  // 空、multiple、untracked 都表示无法证明片段版本，不能当作新版本。
  if (!snapshot.sourceHash || snapshot.sourceHash === 'unknown' || snapshot.sourceHash === 'multiple' || snapshot.sourceHash === 'untracked') return false
  if (!snapshot.title || !snapshot.body) return false
  return true
}
