/** 浏览器与 Host 之间的管理请求。作用域由 Host 解析。 */
export interface ManageRequest {
  action: 'overview' | 'list' | 'read' | 'save' | 'remove' | 'clear' | 'files' | 'file' | 'export' | 'rebuild' | 'job' | 'projectPolicy' | 'sources' | 'removeSource' | 'topUpCredit'
  scope?: string
  id?: string
  title?: string
  content?: string
  revision?: number
  epoch?: number
  confirmation?: string
  cursor?: number
  limit?: number
  use?: boolean
  generate?: boolean
  sessionId?: string
  requestId?: string
}
/** JSON 正文经过请求操作所属的校验器解析。 */
export interface ManageResult { json: string }
/** SQLite 中一条可追溯的记忆。 */
export interface MemoryItem {
  id: string; scope: string; title: string; content: string; kind: string
  status: string; pinned: boolean; manual: boolean; revision: number
  createdAt: number; updatedAt: number; sources: string[]
}
/** 已提交会话中的逻辑来源范围；不保存聊天正文。 */
export interface Source {
  id: string; sessionId: string; project: string; start: number; end: number
  hash: string; updatedAt: number; excluded: boolean
}
/** 主机上的持久项目身份，严格按工作树隔离。 */
export interface Project { id: string; root: string; target: string; name: string; use: boolean | null; generate: boolean | null }
/** 后台任务的持久租约和计费预留。 */
export interface Job {
  id: string; key: string; scope: string; kind: 'extract' | 'consolidate'; source: string
  epoch: number; fence: number; leaseUntil: number; attempts: number; retryAt: number
  state: string; reserved: number; error: string; createdAt: number
  intervalMs?: number; settledAt?: number
  attemptUsage?: number | null; diagnostic?: string; modelFinish?: string
}
