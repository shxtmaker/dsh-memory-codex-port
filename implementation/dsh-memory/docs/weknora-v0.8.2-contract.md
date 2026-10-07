# WeKnora v0.8.2 接口契约核查（P01 产物）

核查对象：`Tencent/WeKnora` 固定提交 `3e8b0bfc80b845b2d4b2ed683994748741450a97`（稳定 tag v0.8.2）。
所有结论均取自该提交源码；引用文件路径相对仓库根。

## 1 认证与通用约定

- `X-API-Key: <key>`：`internal/middleware/auth.go` 第 161 行附近，在 `Authorization` 之后作为兼容路径尝试。
- `Authorization: Bearer <token>`：`auth.go` 第 183-185 行。
- `X-Tenant-ID: <正整数>`：`auth.go` 第 301 行、第 389 行。用户 JWT 路径与平台 API key 路径都会读取；
  平台 key 未带该头会得到 `Workspace required: platform API keys must send X-Tenant-ID`。
- 成功响应统一为 `{"success": true, "data": ...}`，部分接口另有 `total` / `page` / `page_size` / `message`。
- 失败响应由 `internal/middleware/error_handler.go` 统一产出：

  ```json
  {"success": false, "error": {"code": "...", "message": "...", "details": "..."}}
  ```

  非 AppError 一律 `500` + `{"code":"...ErrInternalServer","message":"Internal server error"}`。

## 2 检索：POST /api/v1/knowledge-bases/:id/hybrid-search

处理器：`internal/handler/knowledgebase.go` `KnowledgeBaseHandler.HybridSearch`（第 321 行起）。
请求体绑定 `types.SearchParams`（`internal/types/search.go` 第 230-252 行），本提交**确实存在**以下字段：

| JSON 字段 | Go 类型 | 说明 |
|---|---|---|
| `query_text` | string | 必填（除非只给 `query_embedding` 且禁用关键词匹配）。空值返回 400 `query_text is required` |
| `query_embedding` | []float32 | 可选 |
| `vector_threshold` | float64 | 向量召回阈值 |
| `keyword_threshold` | float64 | 关键词召回阈值 |
| `match_count` | int | 召回条数 |
| `disable_keywords_match` | bool | 关闭关键词通道 |
| `disable_vector_match` | bool | 关闭向量通道 |
| `knowledge_ids` | []string | 限定文档 |
| `tag_ids` / `scope_tag_ids` | []string | 标签过滤 |
| `only_recommended` | bool | 仅推荐 |
| `knowledge_base_ids` | []string | 覆盖 URL 中的单库，用于同 embedding 模型的多库 fan-out |
| `skip_context_enrichment` | bool | **本提交存在**，跳过父块/邻近块/关系块扩展 |

响应：`c.JSON(200, {"success": true, "data": rewriter.CopyReferences(ctx, results)})`，
`data` 为 `[]types.SearchResult`（`internal/types/search.go` 第 151 行起）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | chunk id |
| `content` | string | chunk 正文 |
| `knowledge_id` | string | 文档 id |
| `chunk_index` | int | 原始顺序 |
| `knowledge_title` | string | 文档标题 |
| `start_at` / `end_at` | int | 原文位置 |
| `seq` | int | 序号 |
| `score` | float64 | 融合分数 |
| `match_type` | string | 命中通道 |
| `sub_chunk_id` | []string | 子块 |
| `metadata` | map[string]string | chunk 元数据 |
| `chunk_type` | string | 块类型 |
| `parent_chunk_id` | string | 父块 |
| `knowledge_filename` / `knowledge_source` / `knowledge_channel` | string | 来源信息 |
| `knowledge_custom_metadata` | string | 文档自定义元数据（JSON 字符串） |
| `knowledge_base_id` | string | 所属库 |

注意：路由同时接受 `GET /:id/hybrid-search`（正文内 JSON），本插件只用 POST。
`KnowledgeBaseIDs` 只在“同一 embedding 模型”时可用；本插件每个绑定库各发一次请求，不使用该字段跨库合并。

## 3 知识库列表：GET /api/v1/knowledge-bases

处理器 `ListKnowledgeBases`（`internal/handler/knowledgebase.go` 第 514 行起）。
响应 `{"success": true, "data": [buildKBResponse(...)]}`。
`types.KnowledgeBase`（`internal/types/knowledgebase.go` 第 59 行起）关键字段：
`id`、`name`、`type`（默认 `document`）、`is_temporary`、`description`、`tenant_id`、
`creator_id`、`embedding_model_id`、`summary_model_id`。
仅用于管理页选择与配置校验；不默认遍历全部可见库。

## 4 文档读取：GET /api/v1/knowledge/:id

处理器 `GetKnowledge`（`internal/handler/knowledge.go` 第 600 行起）→
`{"success": true, "data": knowledge}`。
`types.Knowledge`（`internal/types/knowledge.go` 第 166 行起）关键字段：

- `id`、`knowledge_base_id`、`title`、`parse_status`
- `parse_status` 取值（同文件第 44-71 行）：
  `pending`、`processing`、`finalizing`、`completed`、`failed`、`deleting`、`cancelled`
- `pending_subtasks_count`：仅 `finalizing` 时有意义
- `metadata`：内部摄取状态（JSON）
- `custom_metadata`：用户自定义元数据（JSON，扁平对象）
- 手工文档的正文与版本存放在 `metadata` 内的 `ManualKnowledgeMetadata`（见第 6 节）

## 5 分块分页：GET /api/v1/chunks/:knowledge_id

处理器 `ChunkHandler.ListKnowledgeChunks`（`internal/handler/chunk.go` 第 99 行起）。
查询参数 `types.Pagination`（`internal/types/search.go` 第 272 行）：
`page`（>=1，默认 1）、`page_size`（默认 10，上限 100）、可选 `chunk_type`（默认 `text`）。

响应：

```json
{"success": true, "data": [Chunk], "total": N, "page": P, "page_size": S}
```

`types.Chunk`（`internal/types/chunk.go` 第 113 行起）关键字段：
`id`、`knowledge_id`、`knowledge_base_id`、`content`、`content_revision`、
`index_status`（`ready` / `processing` / `failed`）、`chunk_index`、`is_enabled`、
`start_at`、`end_at`、`pre_chunk_id`、`next_chunk_id`、`chunk_type`、`parent_chunk_id`。
按 `chunk_index` 原序分页。

## 6 手工文档

请求体 `types.ManualKnowledgePayload`（`internal/types/knowledge.go` 第 327-334 行）：

```go
type ManualKnowledgePayload struct {
    Title         string                     `json:"title"`
    Content       string                     `json:"content"`
    Status        string                     `json:"status"`
    TagIDs        []string                   `json:"tag_ids"`
    Channel       string                     `json:"channel"`
    ProcessConfig *KnowledgeProcessOverrides `json:"process_config,omitempty"`
}
```

状态常量（同文件第 90-92 行）：`draft`、`publish`。

- 创建：`POST /api/v1/knowledge-bases/:id/knowledge/manual`
  → `KnowledgeHandler.CreateManualKnowledge`（第 541 行）→ `CreateKnowledgeFromManual`。
  服务端在 `internal/application/service/knowledge_create.go` 第 759 行把空 `status` 归为 `draft`，
  第 761 行拒绝非 `draft`/`publish` 的取值。正文写入 `NewManualKnowledgeMetadata(content, status, 1)`。
  **每次创建产生新 ID，无服务端幂等键，且初次 POST 不接受 `custom_metadata`。**
- 更新正文：`PUT /api/v1/knowledge/manual/:id` → `UpdateManualKnowledge`（服务同文件第 996 行起）。
  第 1022 行同样把空 `status` 归为 `draft`；第 1067 行 `status == draft` 时把 `ParseStatus` 置为 `draft`。
  即**省略 status 会退回草稿**，所以最终发布必须显式带 `status: "publish"` 且携带完整非空正文。
- 元数据：`PUT /api/v1/knowledge/:id`，请求体 `UpdateKnowledgeRequest`
  （`internal/handler/knowledge.go` 第 1903-1907 行）：

  ```go
  type UpdateKnowledgeRequest struct {
      Title          *string         `json:"title"`
      Description    *string         `json:"description"`
      CustomMetadata json.RawMessage `json:"custom_metadata"`
  }
  ```

  `custom_metadata` 是**整体替换**的 JSON 值，不是字段级合并；因此写元数据前必须读取现有值并合并保留非插件字段。
  省略 `custom_metadata`（nil RawMessage）时不会覆盖现有值。

- 删除：`DELETE /api/v1/knowledge/:id` → `DeleteKnowledge`（第 1365 行起），
  复用批量异步管线，**200 仅表示任务入队**；完成需以 `GET /api/v1/knowledge/:id` 返回 404 确认。

## 7 process_config

`types.KnowledgeProcessOverrides`（`internal/types/knowledge_process.go`）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `summary_enabled` | *bool | 省略时默认 true（向后兼容） |
| `parser_engine_rules` | []ParserEngineRule | 解析引擎规则 |
| `chunking_config` | *ChunkingConfig | 分块配置 |
| `enable_multimodel` | *bool | 多模态 |
| `vlm_config` | *VLMConfig | 视觉模型 |
| `asr_config` | *ASRConfig | 语音识别 |
| `question_generation_config` | *QuestionGenerationConfig | 问题生成 |
| `graph_enabled` | *bool | 图谱 |
| `extract_config` | *ExtractConfig | 抽取 |
| `parser_engine_overrides` | map[string]string | 传给 docreader 的键值 |

方案中的 `process_config` 示例与本提交结构一致。自动打标签、profile 生成与 Wiki
不是本结构字段，不能猜测键名发送。

## 8 版本适配决定

- 稳定版走底层 `hybrid-search`，不调用 `ask`。
- `skip_context_enrichment`、`vector_threshold`、`keyword_threshold` 在本提交均可用，
  因此“200 不代表参数生效”的担忧在本提交下不成立；仍以响应体 `success` 与 `data` 结构校验为准。
- 未在本提交核查到的接口（health/version 探测）不做假设，探针改用 `GET /api/v1/knowledge-bases` 的有界调用。
