// src/storage/storage-worker.ts
import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync, readFileSync, lstatSync, realpathSync, readdirSync, rmSync, existsSync } from "node:fs";
import { join, relative, isAbsolute, resolve, parse } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z as z2 } from "zod";

// src/shared.ts
import { z } from "zod";
function tokens(text) {
  return Buffer.byteLength(text, "utf8");
}
function redact(text) {
  return text.replace(/\b(?:sk-|ghp_|github_pat_|AKIA)[A-Za-z0-9_-]{8,}/g, "[REDACTED]").replace(/(\b(?:api[_-]?key|token|password|secret|authorization)\s*[:=]\s*)([^\s,;"']+)/gi, "$1[REDACTED]").replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@").replace(/([?&](?:token|key|api_key|secret|password)=)[^&\s]+/gi, "$1[REDACTED]");
}
function terms(text) {
  const result = /* @__PURE__ */ new Set();
  for (const match of text.toLowerCase().matchAll(/[a-z0-9_.$/-]{2,80}|[\p{Script=Han}]+/gu)) {
    const word = match[0];
    if (/\p{Script=Han}/u.test(word)) {
      for (let i = 0; i < word.length - 1; i++) result.add(word.slice(i, i + 2));
      if (word.length === 1) result.add(word);
    } else result.add(word);
    if (result.size >= 256) break;
  }
  return [...result];
}
var candidateSchema = z.object({
  scope: z.enum(["global", "project"]),
  kind: z.enum(["preference", "decision", "experience", "skill"]),
  title: z.string().min(1).max(160),
  content: z.string().min(1).max(4e3),
  status: z.enum(["suggested", "planned", "observed", "completed", "verified", "rejected", "expired"]),
  source_refs: z.array(z.number().int().nonnegative()).min(1).max(16)
}).strict();
var extractionSchema = z.object({
  raw_memory: z.string().max(8e3).optional(),
  rollout_summary: z.string().max(4e3),
  rollout_slug: z.string().regex(/^[a-z0-9-]{1,80}$/),
  items: z.array(candidateSchema).max(12)
}).strict();
var proposalSchema = z.object({
  changes: z.array(z.object({
    op: z.enum(["add", "update", "revoke"]),
    id: z.string().optional(),
    revision: z.number().int().positive().optional(),
    title: z.string().min(1).max(160),
    content: z.string().max(4e3),
    kind: z.enum(["preference", "decision", "experience", "skill"]),
    status: z.enum(["suggested", "planned", "observed", "completed", "verified", "rejected", "expired"]),
    sources: z.array(z.string()).min(1).max(16)
  }).strict()).max(24)
}).strict();

// src/usage-statistics.ts
function localUsageDay(now = Date.now()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const day2 = [start.getFullYear(), String(start.getMonth() + 1).padStart(2, "0"), String(start.getDate()).padStart(2, "0")].join("-");
  return { day: day2, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, start: start.getTime(), end: end.getTime() };
}

// src/storage/storage-worker.ts
var boot = z2.object({ root: z2.string(), owner: z2.string(), trust: z2.string(), profile: z2.string() }).parse(workerData);
var ancestor = resolve(boot.root);
while (ancestor !== parse(ancestor).root) {
  if (existsSync(ancestor) && lstatSync(ancestor).isSymbolicLink()) throw new Error("PATH_DENIED");
  ancestor = resolve(ancestor, "..");
}
mkdirSync(boot.root, { recursive: true });
var root = realpathSync(boot.root);
try {
  if (lstatSync(join(root, "state.sqlite")).isSymbolicLink()) throw new Error("PATH_DENIED");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
var db = new DatabaseSync(join(root, "state.sqlite"));
var version = Number(db.prepare("PRAGMA user_version").get()?.user_version);
if (version > 1) throw new Error("FUTURE_SCHEMA");
if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_profiles'").get()) {
  const existing = db.prepare("SELECT * FROM memory_profiles").get();
  if (existing && (existing.id !== boot.profile || existing.owner !== boot.owner || existing.trust !== boot.trust)) throw new Error("PROFILE_IDENTITY_MISMATCH");
}
db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000");
db.exec(`
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
PRAGMA user_version=1;
`);
if (!db.prepare("PRAGMA table_info(budget_ledger)").all().some((column) => column.name === "updatedAt")) db.exec("ALTER TABLE budget_ledger ADD COLUMN updatedAt INTEGER NOT NULL DEFAULT 0");
var bound = db.prepare("SELECT * FROM memory_profiles").get();
if (bound && (bound.id !== boot.profile || bound.owner !== boot.owner || bound.trust !== boot.trust)) throw new Error("PROFILE_IDENTITY_MISMATCH");
transaction(() => {
  db.prepare("INSERT OR IGNORE INTO memory_profiles VALUES(?,?,?)").run(boot.profile, boot.owner, boot.trust);
  db.prepare("INSERT OR IGNORE INTO background_ledger(id,day) VALUES(1,?)").run(day());
});
function day() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function transaction(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = fn();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
function get(table, id) {
  const row = db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id);
  return row ? JSON.parse(String(row.data)) : void 0;
}
function all(table, clause = "", params = []) {
  return db.prepare(`SELECT data FROM ${table} ${clause}`).all(...params).map((row) => JSON.parse(String(row.data)));
}
function audit(action, target) {
  db.prepare("INSERT INTO audit_events VALUES(?,?,?,?)").run(randomUUID(), action, target, Date.now());
}
function scope(id) {
  if (id !== "global" && !get("projects", id)) throw new Error("SCOPE_DENIED");
  db.prepare("INSERT OR IGNORE INTO scope_epochs(scope) VALUES(?)").run(id);
  const row = db.prepare("SELECT * FROM scope_epochs WHERE scope=?").get(id);
  return { epoch: Number(row.epoch), data: JSON.parse(String(row.data)) };
}
function enabled(id, mode) {
  const current = scope(id);
  const defaults = scopeDefaults();
  return current.data[mode] ?? defaults[id === "global" ? "global" : "projects"][mode];
}
function scopeDefaults() {
  const row = db.prepare("SELECT data FROM scope_epochs WHERE scope='@defaults'").get();
  return row ? JSON.parse(String(row.data)) : { global: { use: false, generate: false }, projects: { use: false, generate: false } };
}
function allowedSource(s, target) {
  if (s.excluded || target !== "global" && s.project !== target) return false;
  const excluded = db.prepare("SELECT watermark FROM source_exclusions WHERE scope=? AND session=?").get(target, s.sessionId);
  if (excluded && s.start <= Number(excluded.watermark)) return false;
  return !db.prepare("SELECT id FROM tombstones WHERE scope=? AND source=?").get(target, s.id);
}
function itemWrite(item) {
  db.prepare("INSERT INTO memory_items VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").run(item.id, item.scope, JSON.stringify(item));
  db.prepare("DELETE FROM memory_sources WHERE memory=?").run(item.id);
  for (const src of item.sources) db.prepare("INSERT INTO memory_sources VALUES(?,?)").run(item.id, src);
  db.prepare("DELETE FROM search_terms WHERE memory=?").run(item.id);
  if (item.status !== "expired") for (const term of terms(item.title + "\n" + item.content)) db.prepare("INSERT OR IGNORE INTO search_terms VALUES(?,?)").run(term, item.id);
}
function items(id) {
  scope(id);
  return all("memory_items", "WHERE scope=?", [id]).filter((i) => i.status !== "expired").sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}
function selected(id) {
  return db.prepare("SELECT * FROM extractions WHERE scope=? ORDER BY id").all(id).filter((row) => {
    const source = get("source_segments", String(row.source));
    return source && allowedSource(source, id);
  }).map((row) => ({ id: String(row.id), source: String(row.source), hash: String(row.hash), output: JSON.parse(String(row.data)) }));
}
function consolidationInput(id) {
  scope(id);
  const inputs = selected(id), current = items(id), inputHash = hash(inputs);
  const row = db.prepare("SELECT data FROM consolidation_baselines WHERE scope=?").get(id);
  const previous = row ? JSON.parse(String(row.data)) : {};
  const next = Object.fromEntries(inputs.map((i) => [i.source, hash(i)]));
  const changed = inputs.filter((i) => previous[i.source] !== next[i.source]), removed = Object.keys(previous).filter((s) => !(s in next));
  const touched = /* @__PURE__ */ new Set([...changed.map((i) => i.source), ...removed]);
  const concepts = changed.flatMap((i) => i.output.items.map((f) => f.title));
  return { hash: inputHash, unchanged: !changed.length && !removed.length, inputs: changed, removed, items: current.filter((i) => i.sources.some((s) => touched.has(s)) || concepts.includes(i.title)), next };
}
function safeFile(file) {
  if (isAbsolute(file) || file.split(/[\\/]/).includes("..")) throw new Error("PATH_DENIED");
  const path = join(root, file);
  let current = root;
  for (const part of file.split(/[\\/]/)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error("PATH_DENIED");
  }
  if (relative(root, realpathSync(path)).startsWith("..")) throw new Error("PATH_DENIED");
  return path;
}
function safeDirectory(name) {
  if (isAbsolute(name) || name.split(/[\\/]/).includes("..")) throw new Error("PATH_DENIED");
  let current = root;
  for (const part of name.split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    if (existsSync(current)) {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("PATH_DENIED");
    } else mkdirSync(current);
  }
  return current;
}
function materialize(id, sourceHash) {
  const list = items(id);
  const inputs = selected(id);
  const generation = `${Date.now()}-${randomUUID()}`;
  const directory = join("materialized", id === "global" ? "global" : `projects/${id}`, generation);
  safeDirectory(directory);
  const files = {
    "memory_summary.md": list.map((i) => `- ${i.title} [${i.id}@${i.revision}]`).join("\n"),
    "MEMORY.md": list.map((i) => `## ${i.title}

${i.content}

\u72B6\u6001\uFF1A${i.status}\uFF1B\u6765\u6E90\uFF1A${i.sources.join(", ") || "\u4EBA\u5DE5\u4FDD\u5B58"}\uFF1Brevision\uFF1A${i.revision}`).join("\n\n"),
    "raw_memories.md": inputs.map((i) => String(i.output.raw_memory ?? "")).join("\n\n")
  };
  for (const input of inputs) files[`rollout_summaries/${input.source}.md`] = String(input.output.rollout_summary);
  for (const item of list.filter((i) => i.kind === "skill")) files[`skills/${item.id}/SKILL.md`] = `# ${item.title}

\u5F85\u5BA1\u9605\u7684\u6280\u80FD\u5019\u9009

${item.content}

\u6765\u6E90\uFF1A${item.sources.join(", ")}`;
  for (const [name, content] of Object.entries(files)) {
    safeDirectory(join(directory, name, ".."));
    writeFileSync(join(root, directory, name), content + "\n", { encoding: "utf8", flag: "wx" });
    if (readFileSync(join(root, directory, name), "utf8") !== content + "\n") throw new Error("SNAPSHOT_VERIFY_FAILED");
  }
  const previous = db.prepare("SELECT hash FROM snapshots WHERE scope=?").get(id);
  const snapshot2 = { files: Object.keys(files), generation: directory, time: Math.max(0, ...list.map((i) => i.updatedAt), ...inputs.map((i) => get("source_segments", i.source)?.updatedAt ?? 0)), hash: sourceHash ?? String(previous?.hash ?? hash([])) };
  db.prepare("INSERT INTO snapshots VALUES(?,?,?,?) ON CONFLICT(scope) DO UPDATE SET generation=excluded.generation,hash=excluded.hash,data=excluded.data").run(id, directory, snapshot2.hash, JSON.stringify(snapshot2));
  const parent = join(root, directory, "..");
  for (const old of readdirSync(parent).filter((n) => n !== generation && /^\d+-[a-f0-9-]+$/.test(n)).sort().slice(0, -1)) {
    const path = join(parent, old);
    if (relative(root, path).startsWith("..") || lstatSync(path).isSymbolicLink()) continue;
    rmSync(path, { recursive: true });
  }
  return snapshot2;
}
function snapshot(id) {
  scope(id);
  const row = db.prepare("SELECT data FROM snapshots WHERE scope=?").get(id);
  if (row) {
    const value = JSON.parse(String(row.data));
    try {
      for (const file of value.files) safeFile(join(value.generation, file));
      return value;
    } catch {
    }
  }
  return materialize(id);
}
function storeJob(job) {
  db.prepare("INSERT INTO jobs VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").run(job.id, job.key, job.scope, JSON.stringify({ ...job, updatedAt: Date.now() }));
}
function recordUsage(job, usage) {
  db.prepare("INSERT OR IGNORE INTO usage_attempts VALUES(?,?,?,?,?)").run(`${job.id}:${job.fence}`, job.scope, job.kind, usage, Date.now());
}
function dailyUsage(scopes) {
  const { day: day2, timezone, start, end } = localUsageDay();
  const filter = scopes ? " AND scope IN (" + scopes.map(() => "?").join(",") + ")" : "";
  const row = db.prepare("SELECT COALESCE(SUM(usage),0) AS tokens,COUNT(*) AS calls,COUNT(*)-COUNT(usage) AS unknownCalls FROM usage_attempts WHERE time>=? AND time<?" + filter).get(start, end, ...scopes ?? []);
  return { day: day2, timezone, tokens: Number(row.tokens), calls: Number(row.calls), unknownCalls: Number(row.unknownCalls) };
}
function fence(job) {
  const live = get("jobs", job.id);
  if (!live || live.fence !== job.fence || live.state !== "running" || live.leaseUntil < Date.now()) throw new Error("STALE_LEASE");
  for (const [id, epoch] of Object.entries(job.epochs ?? { [job.scope]: job.epoch })) if (scope(id).epoch !== epoch || !enabled(id, "generate")) throw new Error("STALE_EPOCH");
}
var argsSchema = z2.record(z2.string(), z2.unknown());
function execute(op, input) {
  const a = argsSchema.parse(input);
  const str = (key) => z2.string().parse(a[key]);
  const num = (key) => z2.number().parse(a[key]);
  switch (op) {
    case "sessionOff":
      db.prepare("INSERT INTO session_policy VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").run(str("session"), JSON.stringify({ off: true }));
      return true;
    case "sessionAllowed":
      return !get("session_policy", str("session"))?.off;
    case "probe": {
      let fts = false;
      try {
        db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS fts_probe USING fts5(content)");
        fts = true;
      } catch {
      }
      return { sqlite: true, fts, version: 1 };
    }
    case "project": {
      const path = str("root"), target = str("target");
      const row = db.prepare("SELECT data FROM projects WHERE root=? AND target=?").get(path, target);
      if (row) return JSON.parse(String(row.data));
      const project = { id: randomUUID(), root: path, target, name: str("name"), use: null, generate: null };
      db.prepare("INSERT INTO projects VALUES(?,?,?,?)").run(project.id, path, target, JSON.stringify(project));
      scope(project.id);
      return project;
    }
    case "policy":
      return transaction(() => {
        const next = z2.object({ global: z2.object({ use: z2.boolean(), generate: z2.boolean() }), projects: z2.object({ use: z2.boolean(), generate: z2.boolean() }) }).parse(a);
        const old = scopeDefaults();
        db.prepare("INSERT INTO scope_epochs(scope,data) VALUES('@defaults',?) ON CONFLICT(scope) DO UPDATE SET data=excluded.data").run(JSON.stringify(next));
        for (const row of db.prepare("SELECT scope FROM scope_epochs WHERE scope!='@defaults'").all()) {
          const id = String(row.scope), kind = id === "global" ? "global" : "projects";
          if (old[kind].use && !next[kind].use || old[kind].generate && !next[kind].generate) db.prepare("UPDATE scope_epochs SET epoch=epoch+1 WHERE scope=?").run(id);
        }
        return next;
      });
    case "projectPolicy":
      return transaction(() => {
        const id = str("scope");
        scope(id);
        if (id === "global") throw new Error("SCOPE_DENIED");
        const data = { use: z2.boolean().parse(a.use), generate: z2.boolean().parse(a.generate) };
        db.prepare("UPDATE scope_epochs SET epoch=epoch+1,data=? WHERE scope=?").run(JSON.stringify(data), id);
        const project = get("projects", id);
        Object.assign(project, data);
        db.prepare("UPDATE projects SET data=? WHERE id=?").run(JSON.stringify(project), id);
        audit("project-policy", id);
        return data;
      });
    case "overview": {
      const scopes = ["global", ...all("projects").map((p) => p.id)];
      return { root, profile: boot.profile, defaults: scopeDefaults(), projects: all("projects"), scopes: scopes.map((id) => {
        const snap = snapshot(id);
        return { id, epoch: scope(id).epoch, use: enabled(id, "use"), generate: enabled(id, "generate"), count: items(id).length, fileCount: snap.files.filter((f) => f !== "raw_memories.md").length, updatedAt: snap.time };
      }), jobs: all("jobs").sort((a2, b) => (b.updatedAt ?? b.settledAt ?? b.createdAt) - (a2.updatedAt ?? a2.settledAt ?? a2.createdAt)).slice(0, 30), dailyUsage: dailyUsage(a.usageScopes === void 0 ? void 0 : z2.array(z2.string()).min(1).parse(a.usageScopes)), evidence: db.prepare("SELECT * FROM budget_ledger ORDER BY updatedAt DESC,rowid DESC").all() };
    }
    case "list":
      return items(str("scope")).slice(z2.number().int().min(0).parse(a.cursor ?? 0), z2.number().int().min(0).parse(a.cursor ?? 0) + z2.number().int().min(1).max(100).parse(a.limit ?? 50));
    case "read": {
      const item = get("memory_items", str("id"));
      if (!item || item.status === "expired") throw new Error("NOT_FOUND");
      scope(item.scope);
      return { ...item, sourceDetails: item.sources.map((id) => get("source_segments", id)) };
    }
    case "save": {
      const id = str("scope");
      scope(id);
      const title = z2.string().min(1).max(160).parse(a.title), content = redact(z2.string().min(1).max(8e3).parse(a.content));
      const result = transaction(() => {
        const old = typeof a.id === "string" ? get("memory_items", a.id) : void 0;
        if (a.id && (!old || old.scope !== id)) throw new Error("NOT_FOUND");
        if (old && old.revision !== a.revision) throw new Error("REVISION_CONFLICT");
        const item = { id: old?.id ?? randomUUID(), scope: id, title: redact(title), content, kind: old?.kind ?? "preference", status: "observed", pinned: true, manual: true, revision: (old?.revision ?? 0) + 1, createdAt: old?.createdAt ?? Date.now(), updatedAt: Date.now(), sources: old?.sources ?? [] };
        itemWrite(item);
        audit("save", item.id);
        return item;
      });
      materialize(id);
      return result;
    }
    case "remove": {
      const item = get("memory_items", str("id"));
      if (!item) throw new Error("NOT_FOUND");
      transaction(() => {
        if (item.revision !== a.revision) throw new Error("REVISION_CONFLICT");
        scope(item.scope);
        for (const src of item.sources) db.prepare("INSERT OR IGNORE INTO tombstones VALUES(?,?,?,?)").run(`${item.id}:${src}`, item.scope, src, Date.now());
        itemWrite({ ...item, status: "expired", revision: item.revision + 1, updatedAt: Date.now() });
        audit("remove", item.id);
      });
      materialize(item.scope);
      return { removed: true };
    }
    case "clear": {
      const id = str("scope");
      if (a.confirmation !== `CLEAR:${id}:${a.epoch}`) throw new Error("CONFIRMATION_REQUIRED");
      transaction(() => {
        if (scope(id).epoch !== num("epoch")) throw new Error("EPOCH_CONFLICT");
        db.prepare("UPDATE scope_epochs SET epoch=epoch+1 WHERE scope=?").run(id);
        for (const src of all("source_segments")) if (id === "global" || src.project === id) db.prepare("INSERT INTO source_exclusions VALUES(?,?,?) ON CONFLICT(scope,session) DO UPDATE SET watermark=max(watermark,excluded.watermark)").run(id, src.sessionId, src.end);
        for (const item of items(id)) itemWrite({ ...item, status: "expired", revision: item.revision + 1, updatedAt: Date.now() });
        db.prepare("DELETE FROM extractions WHERE scope=?").run(id);
        audit("clear", id);
      });
      materialize(id);
      return { epoch: scope(id).epoch };
    }
    case "sources": {
      const id = str("scope");
      scope(id);
      return all("source_segments").filter((s) => id === "global" || s.project === id).map((s) => ({ ...s, excluded: !allowedSource(s, id) }));
    }
    case "removeSource": {
      const id = str("scope");
      scope(id);
      const src = get("source_segments", str("id"));
      if (!src || id !== "global" && src.project !== id) throw new Error("SCOPE_DENIED");
      transaction(() => {
        db.prepare("INSERT OR IGNORE INTO tombstones VALUES(?,?,?,?)").run(`${id}:${src.id}`, id, src.id, Date.now());
        db.prepare("UPDATE scope_epochs SET epoch=epoch+1 WHERE scope=?").run(id);
        db.prepare("DELETE FROM extractions WHERE scope=? AND source=?").run(id, src.id);
        for (const item of items(id).filter((i) => i.sources.includes(src.id))) {
          const sources = item.sources.filter((s) => s !== src.id);
          itemWrite({ ...item, sources, status: sources.length || item.manual ? item.status : "expired", revision: item.revision + 1, updatedAt: Date.now() });
        }
        audit("remove-source", src.id);
      });
      materialize(id);
      return { removed: true };
    }
    case "files": {
      const id = str("scope");
      const snap = snapshot(id);
      return { ...snap, path: join(root, snap.generation) };
    }
    case "file": {
      const snap = snapshot(str("scope")), file = str("id");
      if (!snap.files.includes(file)) throw new Error("PATH_DENIED");
      return { content: readFileSync(safeFile(join(snap.generation, file)), "utf8") };
    }
    case "export": {
      const id = str("scope");
      scope(id);
      const directory = safeDirectory("exports");
      const path = join(directory, `${id}-${randomUUID()}.md`);
      const snap = snapshot(id);
      writeFileSync(path, readFileSync(safeFile(join(snap.generation, "MEMORY.md"))), { flag: "wx" });
      audit("export", id);
      return { path };
    }
    case "capture": {
      const source = z2.object({ id: z2.string(), sessionId: z2.string(), project: z2.string(), start: z2.number().int().nonnegative(), end: z2.number().int().nonnegative(), hash: z2.string(), updatedAt: z2.number(), excluded: z2.boolean() }).parse(a.source);
      scope(source.project);
      if (get("session_policy", source.sessionId)?.off) return null;
      db.prepare("INSERT OR IGNORE INTO source_segments VALUES(?,?,?,?,?)").run(source.id, source.sessionId, source.start, source.end, JSON.stringify(source));
      const eligible = ["global", source.project].filter((id) => enabled(id, "generate") && allowedSource(source, id));
      if (!eligible.length) return null;
      for (const old of all("jobs").filter((j) => j.kind === "extract" && ["queued", "waiting-credit", "retry"].includes(j.state))) {
        if (get("source_segments", old.source)?.sessionId === source.sessionId) storeJob({ ...old, retryAt: Math.max(old.retryAt, source.updatedAt + num("idleMs")) });
      }
      const key = hash([source.project, source.id, source.hash, source.end, "v1"]);
      const exists = db.prepare("SELECT data FROM jobs WHERE key=?").get(key);
      if (exists) return JSON.parse(String(exists.data));
      const job = { id: randomUUID(), key, scope: source.project, kind: "extract", source: source.id, epoch: scope(source.project).epoch, epochs: Object.fromEntries(eligible.map((id) => [id, scope(id).epoch])), fence: 0, leaseUntil: 0, attempts: 0, retryAt: source.updatedAt + num("idleMs"), state: "queued", reserved: 0, error: "", createdAt: Date.now() };
      storeJob(job);
      return job;
    }
    case "pending":
      return all("jobs").filter((j) => ["queued", "waiting-credit", "retry", "running"].includes(j.state) && j.retryAt <= Date.now()).sort((a2, b) => a2.createdAt - b.createdAt).slice(0, 8);
    case "failSource": {
      const job = get("jobs", str("id"));
      if (job && ["queued", "waiting-credit", "retry"].includes(job.state)) {
        storeJob({ ...job, state: "failed", error: "SOURCE_UNAVAILABLE" });
        audit("source-unavailable", job.id);
      }
      return true;
    }
    case "job":
      return get("jobs", str("id"));
    case "lease":
      return transaction(() => {
        const job = get("jobs", str("id"));
        if (!job) throw new Error("NOT_FOUND");
        if (job.retryAt > Date.now() || job.state === "running" && job.leaseUntil > Date.now() || !["queued", "waiting-credit", "retry", "running"].includes(job.state)) return null;
        if (job.state === "running") {
          recordUsage(job, null);
          storeJob({ ...job, state: "failed", error: "LEASE_EXPIRED_USAGE_UNKNOWN", attemptUsage: null, leaseUntil: 0 });
          audit("lease-expired-unknown", job.id);
          return null;
        }
        if (job.kind === "consolidate" && all("jobs", "WHERE scope=?", [job.scope]).some((other) => other.id !== job.id && other.kind === "consolidate" && other.state === "succeeded" && (other.settledAt ?? other.createdAt) + (job.intervalMs ?? 0) > Date.now())) return null;
        if (Object.entries(job.epochs ?? { [job.scope]: job.epoch }).some(([id, epoch]) => scope(id).epoch !== epoch || !enabled(id, "generate"))) {
          storeJob({ ...job, state: "cancelled" });
          return null;
        }
        const reserve = z2.number().int().positive().parse(a.reserve);
        if (all("jobs").some((j) => j.id !== job.id && j.state === "running" && j.leaseUntil > Date.now())) return null;
        const leased = { ...job, state: "running", reserved: reserve, fence: job.fence + 1, attempts: job.attempts + 1, leaseUntil: Date.now() + 12e4 };
        storeJob(leased);
        return leased;
      });
    case "settleJob":
      return transaction(() => {
        const job = get("jobs", str("id"));
        if (!job || job.fence !== num("fence") || job.state !== "running") throw new Error("STALE_LEASE");
        const usage = typeof a.usage === "number" ? z2.number().int().nonnegative().parse(a.usage) : null;
        recordUsage(job, usage);
        const diagnostic = typeof a.diagnostic === "string" && /^[a-zA-Z0-9_.:, ?-]{0,300}$/.test(a.diagnostic) ? a.diagnostic : "";
        const modelFinish = ["stop", "max-tokens", "error", "aborted", "tool-calls", "other"].includes(String(a.modelFinish)) ? String(a.modelFinish) : "";
        storeJob({ ...job, state: str("state"), error: typeof a.error === "string" ? a.error : "", diagnostic, modelFinish, attemptUsage: usage, retryAt: Date.now() + Math.min(864e5, 6e4 * 2 ** job.attempts), leaseUntil: 0, settledAt: Date.now() });
        audit("job-" + str("state"), job.id);
        return true;
      });
    case "commitExtraction":
      return transaction(() => {
        const job = get("jobs", str("id"));
        if (!job) throw new Error("NOT_FOUND");
        if (job.fence !== num("fence")) throw new Error("STALE_LEASE");
        fence(job);
        const source = get("source_segments", job.source);
        if (source.hash !== str("hash")) throw new Error("SOURCE_CHANGED");
        const output = extractionSchema.parse(a.output);
        for (const item of output.items) if (item.source_refs.some((seq) => seq < source.start || seq > source.end)) throw new Error("INVALID_SOURCE_REF");
        for (const id of Object.keys(job.epochs)) {
          if (!allowedSource(source, id)) throw new Error("SOURCE_EXCLUDED");
          const filtered = { ...output, items: output.items.filter((i) => i.scope === (id === "global" ? "global" : "project") && (id !== "global" || i.kind === "preference" && !/[A-Za-z]:[\\/]|\/(?:home|Users|workspace)\//.test(i.content))) };
          if (id === "global") {
            filtered.raw_memory = filtered.items.map((i) => i.content).join("\n");
            filtered.rollout_summary = filtered.items.map((i) => i.title + ": " + i.content).join("\n");
          }
          if (id !== "global" || filtered.items.length) db.prepare("INSERT INTO extractions VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,hash=excluded.hash").run(`${source.id}:${id}`, id, source.id, source.hash, JSON.stringify({ ...filtered, metadata: { route: a.route ?? null, usage: a.usage ?? null, generatedAt: Date.now(), promptVersion: "extract-v1", outcome: filtered.items.length ? "succeeded" : "succeeded_no_output" } }));
          enqueueConsolidate(id, num("intervalMs"));
        }
        return true;
      });
    case "consolidationInput":
      return consolidationInput(str("scope"));
    case "completeNoop": {
      const job = get("jobs", str("id"));
      if (!job || !["queued", "waiting-credit", "retry"].includes(job.state)) return false;
      const input2 = consolidationInput(job.scope);
      if (input2.hash !== str("hash")) throw new Error("SOURCE_CHANGED");
      transaction(() => {
        db.prepare("INSERT INTO consolidation_baselines VALUES(?,?) ON CONFLICT(scope) DO UPDATE SET data=excluded.data").run(job.scope, JSON.stringify(input2.next));
        storeJob({ ...job, state: "succeeded_no_output" });
        audit("job-noop", job.id);
      });
      materialize(job.scope, input2.hash);
      return true;
    }
    case "commitProposal": {
      const job = get("jobs", str("id"));
      if (!job) throw new Error("NOT_FOUND");
      transaction(() => {
        if (job.fence !== num("fence")) throw new Error("STALE_LEASE");
        fence(job);
        const inputs = selected(job.scope);
        if (hash(inputs) !== str("hash")) throw new Error("SOURCE_CHANGED");
        const proposal = proposalSchema.parse(a.output);
        for (const change of proposal.changes) {
          if (change.sources.some((id) => !inputs.some((i) => i.source === id))) throw new Error("INVALID_SOURCE_REF");
          const old = change.id ? get("memory_items", change.id) : void 0;
          if (change.op === "add" && items(job.scope).some((i) => i.title === change.title && i.content === change.content)) continue;
          if (job.scope === "global" && change.kind !== "preference") throw new Error("GLOBAL_SCOPE_VIOLATION");
          if (change.op !== "add" && (!old || old.scope !== job.scope || old.revision !== change.revision)) throw new Error("REVISION_CONFLICT");
          if (old?.manual || old?.pinned) throw new Error("HUMAN_CORRECTION_PROTECTED");
          for (const src of change.sources) if (db.prepare("SELECT id FROM tombstones WHERE scope=? AND source=?").get(job.scope, src)) throw new Error("SOURCE_EXCLUDED");
          const facts = inputs.filter((i) => change.sources.includes(i.source)).flatMap((i) => i.output.items);
          const backed = facts.some((i) => i.content === change.content && i.title === change.title && i.status === change.status);
          const item = { id: old?.id ?? randomUUID(), scope: job.scope, title: redact(change.title), content: redact(change.content), kind: change.kind, status: change.op === "revoke" ? "expired" : backed ? change.status : "suggested", pinned: false, manual: false, revision: (old?.revision ?? 0) + 1, createdAt: old?.createdAt ?? Date.now(), updatedAt: Date.now(), sources: change.sources };
          itemWrite(item);
        }
        db.prepare("INSERT INTO consolidation_baselines VALUES(?,?) ON CONFLICT(scope) DO UPDATE SET data=excluded.data").run(job.scope, JSON.stringify(Object.fromEntries(inputs.map((i) => [i.source, hash(i)]))));
        audit("consolidate", job.scope);
      });
      materialize(job.scope, str("hash"));
      return true;
    }
    case "rebuild": {
      const id = str("scope");
      scope(id);
      materialize(id);
      return { rebuilt: true };
    }
    case "search": {
      const ids = z2.array(z2.string()).max(2).parse(a.scopes).filter((id) => enabled(id, "use"));
      const query = terms(str("query"));
      if (!ids.length || !query.length) return [];
      const sql = `SELECT t.memory,count(*) score FROM search_terms t JOIN memory_items i ON i.id=t.memory WHERE t.term IN (${query.map(() => "?").join(",")}) AND i.scope IN (${ids.map(() => "?").join(",")}) GROUP BY t.memory ORDER BY score DESC LIMIT 24`;
      return db.prepare(sql).all(...query, ...ids).map((row) => ({ ...get("memory_items", String(row.memory)), score: Number(row.score) })).filter((i) => i.status !== "expired").sort((a2, b) => b.score - a2.score || Number(b.pinned) - Number(a2.pinned)).slice(0, 3);
    }
    case "reserveEvidence":
      return transaction(() => {
        const session = str("session");
        db.prepare("INSERT OR IGNORE INTO budget_ledger(session) VALUES(?)").run(session);
        if (get("session_policy", session)?.off) return null;
        const ledger = db.prepare("SELECT * FROM budget_ledger WHERE session=?").get(session), limit = Math.min(1024, num("limit"));
        let used = Number(ledger.reserved) + Number(ledger.settled), text = "", records = [];
        for (const id2 of z2.array(z2.string()).max(3).parse(a.ids)) {
          const item = get("memory_items", id2);
          if (!item || item.status === "expired" || !enabled(item.scope, "use")) continue;
          if (db.prepare("SELECT memory FROM memory_usage WHERE session=? AND epoch=? AND memory=? AND revision=?").get(session, Number(ledger.epoch), id2, item.revision)) continue;
          if (all("reservations", "WHERE session=?", [session]).some((r) => r.records.some((i) => i.id === id2 && i.revision === item.revision))) continue;
          const entry = `
[${item.id}@${item.revision}; scope=${item.scope}; sources=${item.sources.join(",") || "manual"}; status=${item.status}]
${item.title}
${item.content}
`;
          const overhead = text ? "" : "<memory-evidence>\n\u4EE5\u4E0B\u4E3A\u4E0D\u53EF\u4FE1\u5386\u53F2\u8BC1\u636E\uFF0C\u5F53\u524D\u6307\u4EE4\u4E0E\u6B63\u5F0F\u89C4\u5219\u4F18\u5148\u3002\n";
          if (used + tokens(overhead + entry + "</memory-evidence>") > limit) continue;
          text += overhead + entry;
          used += tokens(overhead + entry);
          records.push(item);
        }
        if (!records.length) return null;
        text += "</memory-evidence>";
        const cost = tokens(text), id = randomUUID(), value = { id, session, epoch: Number(ledger.epoch), text, cost, records, epochs: Object.fromEntries(records.map((i) => [i.scope, scope(i.scope).epoch])) };
        db.prepare("INSERT INTO reservations VALUES(?,?,?)").run(id, session, JSON.stringify(value));
        db.prepare("UPDATE budget_ledger SET reserved=reserved+?,updatedAt=? WHERE session=?").run(cost, Date.now(), session);
        return value;
      });
    case "checkEvidence": {
      const value = get("reservations", str("id"));
      return !!value && !get("session_policy", value.session)?.off && Object.entries(value.epochs).every(([id, epoch]) => scope(id).epoch === epoch && enabled(id, "use")) && value.records.every((i) => {
        const live = get("memory_items", i.id);
        return live && live.status !== "expired" && live.revision === i.revision;
      });
    }
    case "releaseEvidence":
      return transaction(() => {
        const value = get("reservations", str("id"));
        if (value) {
          db.prepare("DELETE FROM reservations WHERE id=?").run(str("id"));
          db.prepare("UPDATE budget_ledger SET reserved=max(0,reserved-?),updatedAt=? WHERE session=?").run(value.cost, Date.now(), value.session);
        }
        return true;
      });
    case "settleEvidence":
      return transaction(() => {
        const value = get("reservations", str("id"));
        if (!value) return false;
        db.prepare("DELETE FROM reservations WHERE id=?").run(str("id"));
        db.prepare("UPDATE budget_ledger SET reserved=max(0,reserved-?),settled=settled+?,updatedAt=? WHERE session=?").run(value.cost, value.cost, Date.now(), value.session);
        for (const item of value.records) db.prepare("INSERT OR IGNORE INTO memory_usage VALUES(?,?,?,?,?)").run(value.session, value.epoch, item.id, item.revision, JSON.stringify({ request: str("request"), time: Date.now(), scope: item.scope }));
        return true;
      });
    case "close":
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      db.close();
      return true;
    default:
      throw new Error("UNKNOWN_OPERATION");
  }
}
function enqueueConsolidate(id, interval) {
  const inputs = selected(id), key = hash([id, hash(inputs), "consolidate-v1"]);
  if (db.prepare("SELECT id FROM jobs WHERE key=?").get(key)) return;
  const last = all("jobs", "WHERE scope=?", [id]).filter((j) => j.kind === "consolidate" && j.state === "succeeded").sort((a, b) => b.createdAt - a.createdAt)[0];
  storeJob({ id: randomUUID(), key, scope: id, kind: "consolidate", source: "", epoch: scope(id).epoch, epochs: { [id]: scope(id).epoch }, fence: 0, leaseUntil: 0, attempts: 0, retryAt: last ? (last.settledAt ?? last.createdAt) + interval : Date.now(), state: "queued", reserved: 0, error: "", createdAt: Date.now(), intervalMs: interval });
}
parentPort.on("message", (m) => {
  if (m.cancel !== void 0) return;
  try {
    parentPort.postMessage({ id: m.id, value: execute(m.op, m.args) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "STORAGE_ERROR";
    parentPort.postMessage({ id: m.id, error: /^[A-Z_]+$/.test(message) ? message : "STORAGE_ERROR" });
  }
});
//# sourceMappingURL=storage-worker.js.map
