// src/publication/render.ts
import { createHash } from "node:crypto";
var PUBLISH_MARKER_PREFIX = "dsh-memory-publish";
var PATH_PLACEHOLDER = "\uFF08\u5DF2\u79FB\u9664\u672C\u673A\u8DEF\u5F84\uFF09";
var HASH_SLOT = "@@DSH_BODY_HASH@@";
var HOST_PATH = /(?<![\w.])(?:~\/|\/(?:home|Users|root|mnt|media|var|tmp|opt|etc|private)\/|[A-Za-z]:\/)[^\s，。；：、（）()<>「」“”"']*/g;
var RESERVED_METADATA_KEYS = ["publishId", "memoryId", "sourceRevision", "bodyHash", "sourceHash", "approvedAt"];
var METADATA_MAX_KEYS = 20;
var METADATA_KEY_MAX = 64;
var METADATA_VALUE_MAX = 1e3;
var SOURCE_HASH_MAX = 64;
var PROJECT_LABEL_MAX = 80;
function stripHostPaths(text) {
  return text.replace(/\\/g, "/").replace(HOST_PATH, PATH_PLACEHOLDER);
}
function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
function byteLength(text) {
  return Buffer.byteLength(text, "utf8");
}
function sanitizeUrl(match) {
  const withoutAuth = match.replace(/^([a-z]+:\/\/)[^\s/@]+@/i, "$1");
  const question = withoutAuth.indexOf("?");
  return question === -1 ? withoutAuth : `${withoutAuth.slice(0, question)}\uFF08\u5DF2\u7701\u7565\u67E5\u8BE2\u53C2\u6570\uFF09`;
}
function sanitize(text) {
  let result = text.replace(/\b[a-z]+:\/\/[^\s，。；：、（）()<>「」“”"']*/gi, sanitizeUrl);
  result = stripHostPaths(result);
  result = result.replace(/\b(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\b/g, "\uFF08\u672C\u673A\u5730\u5740\uFF09");
  result = result.replace(/\b(?:sk-|ghp_|github_pat_|AKIA)[A-Za-z0-9_-]{8,}/g, "[REDACTED]");
  result = result.replace(/(\b(?:api[_-]?key|token|password|secret|authorization)\s*[:=]\s*)([^\s,;"']+)/gi, "$1[REDACTED]");
  return result;
}
function plain(text, max) {
  const collapsed = sanitize(text).replace(/\s+/g, " ").trim();
  const bytes = Buffer.from(collapsed, "utf8");
  if (bytes.byteLength <= max) return collapsed;
  return Buffer.from(bytes.subarray(0, max)).toString("utf8");
}
function lastSegment(text) {
  const segments = text.replace(/\\/g, "/").split("/").filter((segment) => segment.length > 0);
  return segments.pop() ?? "";
}
function projectLabel(project) {
  let label = project?.name ? plain(lastSegment(project.name), PROJECT_LABEL_MAX) : "";
  if (!label && project?.root) label = plain(lastSegment(project.root), PROJECT_LABEL_MAX);
  return label && !label.includes(PATH_PLACEHOLDER) ? label : "\u672A\u63D0\u4F9B";
}
function resolvePublishId(item, explicit) {
  if (explicit && explicit.trim()) return explicit.trim();
  return `mem-${sha256([item.scope, item.id, String(item.revision), sha256(item.content)].join("\n")).slice(0, 32)}`;
}
function sourceHashOf(item) {
  if (item.sources.length === 1) return plain(item.sources[0], SOURCE_HASH_MAX) || "unknown";
  if (item.sources.length > 1) return "multiple";
  return "untracked";
}
function conclusion(item) {
  return sanitize(item.content).trim() || "\u672A\u63D0\u4F9B";
}
function applicableConditions(item) {
  const lines = [`\u4F5C\u7528\u57DF\uFF1A${plain(item.scope, PROJECT_LABEL_MAX) || "\u672A\u63D0\u4F9B"}`];
  if (item.kind === "preference" || item.kind === "skill") lines.push(`\u6761\u76EE\u7C7B\u578B\uFF1A${plain(item.kind, 32)}`);
  lines.push("\u5177\u4F53\u9002\u7528\u6761\u4EF6\uFF1A\u672A\u63D0\u4F9B");
  lines.push("\u672A\u63D0\u4F9B\u7684\u5185\u5BB9\u6309\u201C\u672A\u9A8C\u8BC1\u201D\u5904\u7406\uFF0C\u4E0D\u89C6\u4E3A\u901A\u7528\u7ED3\u8BBA\u3002");
  return lines.join("\n");
}
function verifiedLevel(item) {
  const status = plain(item.status, 32) || "\u672A\u63D0\u4F9B";
  return ["\u672A\u9A8C\u8BC1\uFF08\u7F3A\u5C11\u72EC\u7ACB\u9A8C\u8BC1\u8BC1\u636E\uFF09", `\u672C\u5730\u8BB0\u5FC6\u72B6\u6001\uFF1A${status}`, "\u672C\u5730\u72B6\u6001\u662F\u8BB0\u5F55\u72B6\u6001\uFF0C\u4E0D\u662F\u72EC\u7ACB\u9A8C\u8BC1\u7ED3\u8BBA\u3002"].join("\n");
}
function expiryCondition(item) {
  if (item.status === "expired") return "\u672C\u5730\u8BB0\u5FC6\u72B6\u6001\u4E3A expired\uFF1A\u8BE5\u7ED3\u8BBA\u5DF2\u5931\u6548\uFF0C\u4E0D\u5F97\u7EE7\u7EED\u5F15\u7528\u3002";
  if (item.status === "rejected") return "\u672C\u5730\u8BB0\u5FC6\u72B6\u6001\u4E3A rejected\uFF1A\u8BE5\u7ED3\u8BBA\u5DF2\u88AB\u62D2\u7EDD\uFF0C\u4E0D\u5F97\u7EE7\u7EED\u5F15\u7528\u3002";
  return "\u672A\u63D0\u4F9B";
}
function sourceDescription(item, project, sourceHash) {
  const sourceCount = item.sources.length > 0 ? `${item.sources.length} \u6761` : "\u672A\u63D0\u4F9B";
  return [
    `\u9879\u76EE\uFF1A${projectLabel(project)}`,
    `\u8BB0\u5FC6\u6761\u76EE ID\uFF1A${plain(item.id, 128) || "\u672A\u63D0\u4F9B"}`,
    `\u6279\u51C6\u7248\u672C\uFF1Arevision=${item.revision}\uFF08\u672C\u5730\u8BB0\u5FC6\u6761\u76EE\u7248\u672C\uFF0C\u4E0D\u662F\u7247\u6BB5\u7248\u672C\uFF09`,
    `\u6765\u6E90\u8BB0\u5F55 hash\uFF1A${sourceHash}`,
    `\u6765\u6E90\u8BB0\u5F55\u6570\u91CF\uFF1A${sourceCount}`,
    "\u6B63\u6587\u53EA\u53D6\u81EA\u672C\u5730\u8BB0\u5FC6\u6761\u76EE\u7684\u7ED3\u8BBA\u6587\u672C\uFF1B\u4E0D\u542B\u804A\u5929\u65E5\u5FD7\u3001\u9690\u85CF\u63A8\u7406\u3001\u5BC6\u94A5\u3001\u672A\u7ECF\u68C0\u67E5\u7684\u547D\u4EE4\u8F93\u51FA\u6216\u672C\u673A\u7EDD\u5BF9\u8DEF\u5F84\u3002"
  ].join("\n");
}
function approvalTime(approvedAt) {
  if (!Number.isFinite(approvedAt) || approvedAt < 0) throw new Error("CARD_TIME_INVALID");
  return `\u6279\u51C6\u65F6\u95F4\uFF08UTC\uFF09\uFF1A${new Date(approvedAt).toISOString()}`;
}
function renderCard(input) {
  const { item, project, approvedAt } = input;
  const publishId = resolvePublishId(item, input.publishId);
  const marker = markerOf(publishId);
  const titleMarker = `${PUBLISH_MARKER_PREFIX}:${publishId}`;
  const sourceHash = sourceHashOf(item);
  const rawTitle = plain(item.title, 160);
  const title = rawTitle || plain(item.content.slice(0, 80), 160) || "\u672A\u547D\u540D\u7ECF\u9A8C";
  const drafted = [
    "<!-- \u672C\u5361\u7247\u662F\u5E26\u6765\u6E90\u7684\u5916\u90E8\u8BC1\u636E\uFF0C\u4E0D\u662F\u5DF2\u5B8C\u6210\u4E8B\u5B9E\uFF1B\u5F53\u524D\u7528\u6237\u6307\u4EE4\u4E0E\u9879\u76EE\u6B63\u5F0F\u89C4\u5219\u4F18\u5148\u3002 -->",
    "",
    marker,
    `# ${title}`,
    "",
    `\u53D1\u5E03\u6807\u8BC6\uFF1A${publishId}`,
    "",
    "## \u7ED3\u8BBA",
    conclusion(item),
    "",
    "## \u9002\u7528\u6761\u4EF6",
    applicableConditions(item),
    "",
    "## \u5DF2\u9A8C\u8BC1\u7A0B\u5EA6",
    verifiedLevel(item),
    "",
    "## \u5931\u6548\u6761\u4EF6",
    expiryCondition(item),
    "",
    "## \u6765\u6E90\u8BF4\u660E",
    sourceDescription(item, project, sourceHash),
    "",
    "## \u6279\u51C6\u65F6\u95F4",
    approvalTime(approvedAt),
    "",
    marker,
    ""
  ].join("\n");
  const body = drafted.split(HASH_SLOT).join("");
  const bodyHash = sha256(body);
  return { title, body, bodyHash, marker, titleMarker };
}
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
function mergeMetadata(existing, patch) {
  const reserved = new Set(RESERVED_METADATA_KEYS);
  const merged = {};
  for (const [key, value] of Object.entries(existing ?? {})) {
    if (key.startsWith("dsh_memory_") || reserved.has(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") merged[key] = value;
    else if (value != null) merged[key] = JSON.stringify(value);
  }
  for (const [key, value] of Object.entries(patch)) merged[key] = value;
  if (Object.keys(merged).length > METADATA_MAX_KEYS) throw new Error("METADATA_KEYS_EXCEEDED");
  for (const [key, value] of Object.entries(merged)) {
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") throw new Error(`METADATA_VALUE_NOT_SCALAR:${key}`);
    if (key.length > METADATA_KEY_MAX) throw new Error(`METADATA_KEY_TOO_LONG:${key}`);
    if (String(value).length > METADATA_VALUE_MAX) throw new Error(`METADATA_VALUE_TOO_LONG:${key}`);
  }
  return merged;
}
function versionDiff(published, candidate) {
  if (!published) return "unpublished";
  if (published.sourceRevision !== candidate.sourceRevision) return "updated";
  if (published.bodyHash !== candidate.bodyHash) return "body-changed";
  return "none";
}
function previewKey(input) {
  const fields = [input.memoryId, String(input.sourceRevision), input.bodyHash, input.targetKbId];
  const canonical = fields.map((field) => `${byteLength(field)}:${field}`).join("|");
  return `dsh-memory-preview-v1:${sha256(canonical)}`;
}
function isApprovedSnapshotCurrent(publication, item, bodyHashNow) {
  const snapshot = publication.approved;
  if (!snapshot) return false;
  if (!bodyHashNow) return false;
  if (!publication.targetKbId || snapshot.targetKbId !== publication.targetKbId) return false;
  if (publication.memoryId !== item.id) return false;
  if (snapshot.sourceRevision !== item.revision) return false;
  if (snapshot.bodyHash !== bodyHashNow) return false;
  if (!snapshot.sourceHash || snapshot.sourceHash === "unknown" || snapshot.sourceHash === "multiple" || snapshot.sourceHash === "untracked") return false;
  if (!snapshot.title || !snapshot.body) return false;
  return true;
}
export {
  PUBLISH_MARKER_PREFIX,
  byteLength,
  extractMarker,
  isApprovedSnapshotCurrent,
  markerOf,
  mergeMetadata,
  previewKey,
  renderCard,
  sha256,
  stripHostPaths,
  versionDiff
};
//# sourceMappingURL=render.js.map
