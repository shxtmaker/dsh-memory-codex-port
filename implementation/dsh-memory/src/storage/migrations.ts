/**
 * 数据库结构升级。旧版本拒绝读取更新结构；结构版本与身份绑定检查在 Worker 内统一执行。
 *
 * 现行版本：
 *   1  0.1.x：本地记忆、来源、租约、账本与用量。
 *   2  0.3.0：WeKnora 连接、项目绑定、远端证据槽位、发布映射、出站队列与远端墓碑。
 */
import type { DatabaseSync } from 'node:sqlite'

export const SCHEMA_VERSION = 2

/**
 * 按 user_version 逐级升级；每一步在同一事务内完成，`memory_items`、来源、
 * 墓碑与模型选择等既有数据保持原样。
 *
 * @param db 已打开并设置 WAL 的数据库句柄
 * @param from 当前 user_version
 * @returns 升级后的版本号
 */
export function migrate(db: DatabaseSync, from: number): number {
  if (from > SCHEMA_VERSION) throw new Error('FUTURE_SCHEMA')
  let version = from
  if (version < 1) { db.exec(V1); version = 1 }
  if (version < 2) { db.exec(V2); version = 2 }
  db.exec(`PRAGMA user_version=${version}`)
  return version
}

/** 0.1.x 既有结构；沿用幂等建表语句以兼容早期手工创建的库。 */
export const V1 = `
CREATE TABLE IF NOT EXISTS memory_profiles(id TEXT PRIMARY KEY, owner TEXT NOT NULL, trust TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, root TEXT NOT NULL, target TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(root,target));
CREATE TABLE IF NOT EXISTS scope_epochs(scope TEXT PRIMARY KEY, epoch INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS source_segments(id TEXT PRIMARY KEY, session TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS source_exclusions(scope TEXT NOT NULL, session TEXT NOT NULL, watermark INTEGER NOT NULL, PRIMARY KEY(scope,session));
CREATE TABLE IF NOT EXISTS extractions(id TEXT PRIMARY KEY, scope TEXT NOT NULL, source TEXT NOT NULL, hash TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memory_items(id TEXT PRIMARY KEY, scope TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memory_sources(memory TEXT NOT NULL, source TEXT NOT NULL, PRIMARY KEY(memory,source));
CREATE TABLE IF NOT EXISTS search_terms(term TEXT NOT NULL, memory TEXT NOT NULL, PRIMARY KEY(term,memory));
CREATE INDEX IF NOT EXISTS search_memory ON search_terms(memory);
CREATE TABLE IF NOT EXISTS memory_usage(session TEXT NOT NULL, epoch INTEGER NOT NULL, memory TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(session,epoch,memory,revision));
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, scope TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tombstones(id TEXT PRIMARY KEY, scope TEXT NOT NULL, source TEXT, time INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS snapshots(scope TEXT PRIMARY KEY, generation TEXT NOT NULL, hash TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS consolidation_baselines(scope TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS budget_ledger(session TEXT PRIMARY KEY, epoch INTEGER NOT NULL DEFAULT 0, reserved INTEGER NOT NULL DEFAULT 0, settled INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS reservations(id TEXT PRIMARY KEY, session TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS background_ledger(id INTEGER PRIMARY KEY CHECK(id=1), credit REAL NOT NULL DEFAULT 0, day TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, paused INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS foreground_usage(id TEXT PRIMARY KEY, tokens INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS credit_grants(id TEXT PRIMARY KEY, kind TEXT NOT NULL, amount REAL NOT NULL, time INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit_events(id TEXT PRIMARY KEY, action TEXT NOT NULL, target TEXT NOT NULL, time INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS session_policy(id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS usage_attempts(id TEXT PRIMARY KEY, scope TEXT NOT NULL, kind TEXT NOT NULL, usage INTEGER, time INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS usage_attempts_time_scope ON usage_attempts(time,scope);
`

/**
 * schema 2：连接设置的单一权威存储、项目绑定、远端证据槽位、发布映射、
 * 出站队列与远端墓碑。连接与发布默认关闭。
 */
export const V2 = `
CREATE TABLE IF NOT EXISTS weknora_connections(connection_id TEXT PRIMARY KEY, data TEXT NOT NULL, config_revision INTEGER NOT NULL DEFAULT 1);
-- 只保存凭据引用名；API key 与 X-Tenant-ID 仅在 Host 内解析，绝不入库。
CREATE TABLE IF NOT EXISTS project_bindings(local_project_id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, read_kb_ids TEXT NOT NULL, publish_kb_id TEXT NOT NULL DEFAULT '', binding_revision INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS external_evidence(slot_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, generation INTEGER NOT NULL, state TEXT NOT NULL, created_seq INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS external_evidence_session ON external_evidence(session_id,state);
-- 每会话同时只有一份活动远端结果；部分唯一索引把该约束落到存储层。
CREATE UNIQUE INDEX IF NOT EXISTS external_evidence_one_active ON external_evidence(session_id) WHERE state='active';
CREATE UNIQUE INDEX IF NOT EXISTS external_evidence_one_reserved ON external_evidence(session_id) WHERE state='reserved';
CREATE TABLE IF NOT EXISTS retired_references(slot_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, bytes INTEGER NOT NULL, retired_at INTEGER NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS retired_references_session ON retired_references(session_id);
CREATE TABLE IF NOT EXISTS memory_publications(publish_id TEXT PRIMARY KEY, memory_id TEXT NOT NULL UNIQUE, target_kb_id TEXT NOT NULL, connection_id TEXT NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS memory_publications_state ON memory_publications(state);
CREATE TABLE IF NOT EXISTS sync_outbox(operation_id TEXT PRIMARY KEY, publish_id TEXT NOT NULL, op TEXT NOT NULL, state TEXT NOT NULL, generation INTEGER NOT NULL, next_retry_at INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS sync_outbox_unique ON sync_outbox(publish_id,op,generation);
CREATE INDEX IF NOT EXISTS sync_outbox_pending ON sync_outbox(state,next_retry_at);
CREATE TABLE IF NOT EXISTS remote_tombstones(id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, kb_id TEXT NOT NULL, remote_id TEXT NOT NULL DEFAULT '', publish_id TEXT NOT NULL DEFAULT '', memory_id TEXT NOT NULL DEFAULT '', state TEXT NOT NULL, next_retry_at INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS remote_tombstones_pending ON remote_tombstones(state,next_retry_at);
CREATE INDEX IF NOT EXISTS remote_tombstones_memory ON remote_tombstones(memory_id);
CREATE TABLE IF NOT EXISTS remote_evidence_slots(session_id TEXT PRIMARY KEY, generation INTEGER NOT NULL DEFAULT 0, active_slot TEXT NOT NULL DEFAULT '', retired_bytes INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS publish_previews(preview_id TEXT PRIMARY KEY, memory_id TEXT NOT NULL, publish_id TEXT NOT NULL, body_hash TEXT NOT NULL, created_at INTEGER NOT NULL, data TEXT NOT NULL);
-- 连接设置变更必须让在途请求与已提交槽位失效，与作用域 epoch 同理。
CREATE TABLE IF NOT EXISTS connection_generations(connection_id TEXT PRIMARY KEY, generation INTEGER NOT NULL DEFAULT 0);
`
