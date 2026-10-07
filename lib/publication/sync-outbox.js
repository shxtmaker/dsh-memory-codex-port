// src/weknora/client.ts
import { z } from "zod";
var WeKnoraError = class extends Error {
  constructor(code, status = 0, remoteCode = "") {
    super(code);
    this.code = code;
    this.status = status;
    this.remoteCode = remoteCode;
  }
  code;
  status;
  remoteCode;
};
var ERROR_CODES = /* @__PURE__ */ new Set([
  "UNAUTHORIZED",
  "KB_DENIED",
  "NOT_FOUND",
  "BAD_REQUEST",
  "CONFLICT",
  "RATE_LIMITED",
  "UPSTREAM",
  "DEADLINE",
  "CANCELLED",
  "MALFORMED",
  "NETWORK",
  "CONFIG",
  "LIMIT"
]);
function isWeKnoraError(error) {
  if (error instanceof WeKnoraError) return true;
  if (typeof error !== "object" || error === null) return false;
  const code = error.code;
  const status = error.status;
  return typeof code === "string" && ERROR_CODES.has(code) && typeof status === "number";
}
function weknoraCode(error) {
  return isWeKnoraError(error) ? error.code : null;
}
var envelope = z.object({ success: z.boolean().optional(), code: z.union([z.number(), z.string()]).optional(), msg: z.string().optional(), data: z.unknown().optional() });
var errorEnvelope = z.object({
  error: z.union([z.string(), z.object({ code: z.union([z.number(), z.string()]).optional(), message: z.string().optional() }).partial()]).optional(),
  // 平台 key 缺少工作空间时把业务码放在顶层，且是字符串。
  code: z.union([z.number(), z.string()]).optional(),
  message: z.string().optional()
}).partial();
var kbSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  type: z.string().optional(),
  embedding_model_id: z.string().optional(),
  tenant_id: z.number().optional()
}).passthrough();
var hitSchema = z.object({
  id: z.string(),
  content: z.string().optional(),
  knowledge_id: z.string().optional(),
  chunk_index: z.number().optional(),
  knowledge_title: z.string().optional(),
  score: z.number().optional(),
  match_type: z.number().optional(),
  start_at: z.number().optional(),
  end_at: z.number().optional(),
  knowledge_base_id: z.string().optional(),
  knowledge_custom_metadata: z.string().optional()
}).passthrough();
var chunkSchema = z.object({
  id: z.string(),
  chunk_index: z.number().optional(),
  content: z.string().optional(),
  index_status: z.string().optional(),
  content_revision: z.number().optional(),
  is_enabled: z.boolean().optional()
}).passthrough();
var knowledgeSchema = z.object({
  id: z.string(),
  knowledge_base_id: z.string().optional(),
  title: z.string().optional(),
  parse_status: z.string().optional(),
  metadata: z.unknown().optional(),
  custom_metadata: z.unknown().optional()
}).passthrough();

// src/publication/render.ts
var PUBLISH_MARKER_PREFIX = "dsh-memory-publish";
function markerOf(publishId) {
  const id = publishId.trim();
  if (!id) throw new Error("PUBLISH_ID_EMPTY");
  return `<!-- ${PUBLISH_MARKER_PREFIX}:${id} -->`;
}
function extractMarker(text) {
  if (typeof text !== "string" || !text) return null;
  const found = /* @__PURE__ */ new Set();
  const canonical = new RegExp(`<!--\\s*${PUBLISH_MARKER_PREFIX}\\s*[:=]\\s*([^\\s<>-][^\\s<>]*?)\\s*-->`, "gi");
  const inline = new RegExp(`${PUBLISH_MARKER_PREFIX}\\s*[:=]\\s*([A-Za-z0-9][A-Za-z0-9._:-]*)`, "gi");
  const bare = new RegExp(`${PUBLISH_MARKER_PREFIX}-([A-Za-z0-9][A-Za-z0-9._:-]*)`, "gi");
  for (const re of [canonical, inline, bare]) {
    for (const match of text.matchAll(re)) {
      const id = (match[1] ?? "").trim();
      if (id) found.add(id);
    }
    if (found.size > 0) break;
  }
  return found.size === 1 ? [...found][0] : null;
}

// src/publication/sync-outbox.ts
var MAX_ATTEMPTS = 4;
var INDEX_DEADLINE_MS = 12e4;
function backoffMs(attempts) {
  return Math.min(36e5, 6e4 * 2 ** Math.max(0, attempts - 1));
}
var SyncRunner = class {
  constructor(port) {
    this.port = port;
  }
  port;
  /** 处理待办队列与待撤回墓碑；单次调用有界。 */
  async run(signal) {
    const result = { processed: 0, states: [], errors: [] };
    const pending = await this.port.pending();
    const busy = /* @__PURE__ */ new Set();
    for (const operation of pending) {
      if (signal.aborted) break;
      if (busy.has(operation.publishId)) continue;
      busy.add(operation.publishId);
      try {
        const state = await this.advance(operation, signal);
        result.processed++;
        result.states.push(`${operation.op}:${state}`);
      } catch (error) {
        const code = weknoraCode(error) ?? "UPSTREAM";
        const fallback = error instanceof Error && /^[A-Z][A-Z0-9_]*$/.test(error.message) ? error.message : error instanceof Error ? error.constructor.name : "UNKNOWN";
        const detail = isWeKnoraError(error) ? error.remoteCode ? `${code}/${error.remoteCode}` : code : `${code}(${fallback})`;
        result.errors.push(`${operation.op}:${detail}`);
        await this.fail(operation, detail.slice(0, 64), signal);
      }
    }
    const tombstones = await this.port.tombstonePending();
    for (const tombstone of tombstones) {
      if (signal.aborted) break;
      try {
        await this.withdraw(tombstone, signal);
        result.processed++;
        result.states.push(`withdraw:done`);
      } catch (error) {
        const code = weknoraCode(error) ?? "UPSTREAM";
        result.errors.push(`withdraw:${code}`);
        await this.port.updateTombstone(tombstone, "failed", tombstone.attempts + 1).catch(() => {
        });
      }
    }
    return result;
  }
  /** 单条队列操作的推进；每一步都先落库再继续，崩溃后可从任意中间态恢复。 */
  async advance(operation, signal) {
    const publication = await this.port.publication(operation.publishId);
    if (!publication) throw new Error("PUBLICATION_MISSING");
    if (await this.port.isBlocked(publication.memoryId, publication.publishId)) {
      await this.port.updateOperation(operation.operationId, { state: "cancelled", lastErrorCode: "TOMBSTONED" });
      return "cancelled";
    }
    const snapshot = operation.approvedSnapshot ?? publication.approved;
    if (!snapshot) throw new Error("APPROVAL_MISSING");
    const access = await this.port.access(publication.connectionId, "publish");
    const settings = await this.port.settings(publication.connectionId);
    const client = this.port.client(access, settings.requestDeadlineMs);
    await this.port.updateOperation(operation.operationId, { state: "running" });
    switch (publication.state) {
      case "approved":
        return this.create(publication, snapshot, client, signal);
      case "created":
        return this.writeMetadata(publication, snapshot, client, signal);
      case "metadata":
        return this.publish(publication, snapshot, client, signal);
      case "publishing":
      case "verifying":
        return this.verify(publication, snapshot, client, signal);
      // 已到终态或需人工介入的操作不再自动推进。
      case "published":
        await this.port.updateOperation(operation.operationId, { state: "done" });
        return "done";
      case "conflict":
      case "reconcile_required":
        return publication.state;
      case "withdraw_queued":
      case "withdrawing":
      case "withdrawn":
        await this.port.updateOperation(operation.operationId, { state: "cancelled" });
        return "cancelled";
      default:
        throw new Error("UNEXPECTED_STATE");
    }
  }
  /**
   * 第二步：创建草稿。响应丢失时按稳定标记对账，绝不盲目重发。
   */
  async create(publication, snapshot, client, signal) {
    const titleMarker = `${PUBLISH_MARKER_PREFIX}:${publication.publishId}`;
    const existing = await this.findByMarker(client, publication.targetKbId, publication.publishId, signal);
    if (existing === "ambiguous") {
      await this.port.savePublication({ ...publication, state: "reconcile_required", error: "MULTIPLE_MARKER_MATCHES" });
      return "reconcile_required";
    }
    let detail;
    if (existing) detail = existing;
    else {
      detail = await client.createManual(publication.targetKbId, { title: `${snapshot.title} ${titleMarker}`, content: snapshot.body }, signal);
      await this.port.savePublication({ ...publication, remoteId: detail.id, state: "created", remoteVersion: String(detail.manualVersion) });
      return "created";
    }
    await this.port.savePublication({ ...publication, remoteId: detail.id, state: "created", remoteVersion: String(detail.manualVersion) });
    return "created";
  }
  /**
   * 在目标库中按标记查找唯一匹配。多匹配或读取失败都不算确认。
   * 标题与正文分别提取标记：合并提取会让一种形态遮蔽另一种，导致漏配。
   */
  async findByMarker(client, kbId, publishId, signal) {
    const page = await client.listKnowledge(kbId, 1, 100, signal);
    const candidates = page.items.filter((item) => {
      const titleMarker = extractMarker(item.title);
      const bodyMarker = item.manualContent ? extractMarker(item.manualContent) : null;
      return titleMarker === publishId || bodyMarker === publishId;
    });
    if (!candidates.length) return null;
    if (candidates.length > 1) return "ambiguous";
    const detail = await client.getKnowledge(candidates[0].id, signal);
    if (!detail.manualContent) return null;
    return detail;
  }
  /** 第三步：写扁平 custom_metadata，合并保留现有非插件字段。 */
  async writeMetadata(publication, snapshot, client, signal) {
    if (!publication.remoteId) throw new Error("REMOTE_ID_MISSING");
    const current = await client.getKnowledge(publication.remoteId, signal);
    const merged = mergePluginMetadata(current.customMetadata, publication, snapshot);
    await client.updateMetadata(publication.remoteId, merged, signal);
    await this.port.savePublication({ ...publication, state: "metadata" });
    return "metadata";
  }
  /** 第四步：提交完整非空正文、status=publish 与低成本 process_config。 */
  async publish(publication, snapshot, client, signal) {
    if (!publication.remoteId) throw new Error("REMOTE_ID_MISSING");
    const detail = await client.publishManual(publication.remoteId, snapshot.body, void 0, signal);
    await this.port.savePublication({ ...publication, state: "publishing", remoteVersion: String(detail.manualVersion), lastIndexPollAt: Date.now(), indexDeadline: Date.now() + INDEX_DEADLINE_MS });
    return "publishing";
  }
  /**
   * 第五步：轮询索引状态。无法证明片段版本就不宣称它是新版本。
   * 元数据与正文更新不是原子事务，因此必须同时核对正文 hash 与发布状态。
   */
  async verify(publication, snapshot, client, signal) {
    if (!publication.remoteId) throw new Error("REMOTE_ID_MISSING");
    const detail = await client.getKnowledge(publication.remoteId, signal);
    const now = Date.now();
    const bodyMatches = detail.manualContent !== null && manualBodyHashOf(detail) === snapshot.bodyHash;
    const published = detail.manualStatus === "publish";
    const indexed = detail.parseStatus === "completed";
    if (indexed && published && bodyMatches) {
      await this.port.savePublication({
        ...publication,
        state: "published",
        publishedSourceRevision: snapshot.sourceRevision,
        publishedBodyHash: snapshot.bodyHash,
        candidateSourceRevision: snapshot.sourceRevision,
        candidateBodyHash: snapshot.bodyHash,
        remoteVersion: String(detail.manualVersion),
        error: "",
        lastIndexPollAt: now
      });
      return "published";
    }
    if (published && !bodyMatches) {
      await this.port.savePublication({ ...publication, state: "conflict", error: "REMOTE_BODY_MISMATCH", lastIndexPollAt: now });
      return "conflict";
    }
    if (now > publication.indexDeadline) {
      await this.port.savePublication({ ...publication, state: "verifying", error: "INDEX_TIMEOUT", lastIndexPollAt: now });
      return "index-timeout";
    }
    await this.port.savePublication({ ...publication, state: "verifying", lastIndexPollAt: now });
    return "verifying";
  }
  /** 撤回：删除远端副本并轮询确认 404；401/403 记为权限错误而不是成功删除。 */
  async withdraw(tombstone, signal) {
    if (!tombstone.remoteId) {
      await this.port.updateTombstone(tombstone, "done", tombstone.attempts + 1);
      return;
    }
    const access = await this.port.access(tombstone.connectionId, "publish");
    const settings = await this.port.settings(tombstone.connectionId);
    const client = this.port.client(access, settings.requestDeadlineMs);
    try {
      await client.deleteKnowledge(tombstone.remoteId, signal);
    } catch (error) {
      if (weknoraCode(error) !== "NOT_FOUND") throw error;
    }
    try {
      await client.getKnowledge(tombstone.remoteId, signal);
      await this.port.updateTombstone(tombstone, "pending", tombstone.attempts + 1);
    } catch (error) {
      if (weknoraCode(error) === "NOT_FOUND") {
        await this.port.updateTombstone(tombstone, "done", tombstone.attempts + 1);
        return;
      }
      if (["UNAUTHORIZED", "KB_DENIED"].includes(weknoraCode(error) ?? "")) {
        await this.port.updateTombstone(tombstone, "failed", tombstone.attempts + 1);
        return;
      }
      await this.port.updateTombstone(tombstone, "pending", tombstone.attempts + 1);
    }
  }
  /** 失败按退避重试；达到上限后保留为可手动重试的失败项。 */
  async fail(operation, code, signal) {
    const attempts = operation.attempts + 1;
    const terminal = attempts >= MAX_ATTEMPTS || !retryable(code);
    await this.port.updateOperation(operation.operationId, {
      state: terminal ? "failed" : "pending",
      attempts,
      lastErrorCode: code,
      nextRetryAt: terminal ? operation.nextRetryAt : Date.now() + backoffMs(attempts)
    }).catch(() => {
    });
    void signal;
  }
};
function retryable(code) {
  return ["UPSTREAM", "NETWORK", "RATE_LIMITED", "DEADLINE", "INDEX_TIMEOUT"].includes(code);
}
function operationMarker(publishId) {
  return markerOf(publishId);
}
function mergePluginMetadata(existing, publication, snapshot) {
  return {
    ...existing,
    "dsh-memory-publish-id": publication.publishId,
    "dsh-memory-memory-id": publication.memoryId,
    "dsh-memory-source-revision": snapshot.sourceRevision,
    "dsh-memory-body-hash": snapshot.bodyHash,
    "dsh-memory-source-hash": snapshot.sourceHash,
    "dsh-memory-approved-at": snapshot.approvedAt
  };
}
function manualBodyHashOf(detail) {
  return detail.bodyHash;
}
export {
  INDEX_DEADLINE_MS,
  MAX_ATTEMPTS,
  SyncRunner,
  backoffMs,
  mergePluginMetadata,
  operationMarker,
  retryable
};
//# sourceMappingURL=sync-outbox.js.map
