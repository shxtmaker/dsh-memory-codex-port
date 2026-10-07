# 验收记录：0.3.0（方案 B — 本地经验记忆与 WeKnora 共享知识）

日期：2026-10-08
分支：`feat/weknora-plan-b`
基线：`ced6134`（0.2.1）
宿主：DeepSeek Harness `0.2.0-rc.2`；Node.js v26.10.0；WeKnora 接口基线固定 `3e8b0bf`（tag v0.8.2）

本文件按方案第七节只保留三组必要验收。每组分别标明**通过 / 失败 / 受阻 / 未执行**，
并附实际命令、环境版本与结果。

**结论**：T1 **通过**（真实 Host 安装）；T2 **通过**（真实 WeKnora + 真实 embedding）；
T3 **通过**（真实知识库中的纯合成内容闭环，验收后库状态与验收前逐项一致）。
唯一**未执行**项为成本对照，原因与缺口见文末。

---

## 环境

| 条件 | 值 |
|---|---|
| WeKnora 实例 | `http://192.168.3.100:18080/api/v1`（nginx 前端，`/health` 200） |
| 版本探测 | `/api/v1/system/info` 需 `manage_vector_stores`，本凭据 403；`version` 记为 **unknown** |
| 知识库 | `4f4ff687-7b56-4f6c-ad83-fd5aaa627731`（document，`embedding_model_id=389e4c5a-…`，验收前 99 篇真实文档） |
| T3 授权 | 允许在该库创建、更新、删除**仅含合成内容**的测试文档；不修改任何既有文档 |
| 读取与发布凭据 | 同一 API key（`retrieve` + `ingest`）；生产建议按方案拆分为两个独立引用 |

T2 与 T3 的真实服务闭环已执行：**20/20 通过**（`node tests/weknora-real.mjs`，
证据 `evidence/weknora-real-1791395135833.json`）。

---

## T1 安装和原有记忆保持可用

| 项目 | 结果 | 证据 |
|---|---|---|
| 构建 | 通过 | `npm run build`：`Built Host, SQLite Worker, lazy-CJS Client and strict Typert Remote for 0.2.0-rc.2` |
| 类型检查（Host） | 通过 | `npx tsc -p tsconfig.host.json --noEmit`，退出码 0 |
| 类型检查（Client） | 通过 | `npx tsc -p tsconfig.client.json --noEmit`，退出码 0 |
| 自动化检查 | 通过 | `npm test` 89/89，0 失败 |
| 既有记忆契约 | 通过 | `tests/acceptance.test.mjs` A2–A5：全局/项目隔离、人工更正保护、revision 冲突、1024 字节共用账本、一次 turn、150ms 截止、SQLite 竞争与晚到回收 |
| 原有后台链路 | 通过 | `tests/production-source.mjs`：真实插件上下文、默认 zstd 日志、一次提炼 + 一次整理闭环 |
| 旧库升级到 schema 2 | 通过 | `tests/weknora-storage.test.mjs`「真实 v1 库升级到 schema 2」：既有 `memory_items`、来源、墓碑、用量与 epoch 全部保持；新表按需可用 |
| 升级后默认不扩大权限 | 通过 | 同上：连接列表为空、发布为空、墓碑为空；连接 `readEnabled`/`publishEnabled` 默认 false |
| 更新结构拒绝启动 | 通过 | 同文件「结构版本高于本版本时拒绝启动」：`STORAGE_UNAVAILABLE`，不误读更新结构 |
| 打包一致性 | 通过 | `node scripts/release.mjs`：根/子包 name、version、`dsh.bundle`、`dsh.engines.dsh`、client inject 与补丁字节一致；tgz 内 99 个文件与工作区逐字节一致 |
| 设置页可用（真实 Host） | 通过 | `node tests/t1-install.mjs`：隔离 profile 安装 tgz → loopback Host → 「设置 → 记忆」渲染，知识库区块可见，页面未捕获错误 0 |
| 重启后数据与模型配置保留 | 通过 | 同上：重启后人工记忆与连接设置均保留 |
| 连接列表与开关 | 通过 | 同上：保存连接后列表可见（不含密钥正文字段）；读取与发布开关互相独立 |
| 默认权限不扩大（运行态） | 通过 | 同上：知识读取与发布默认关闭；预算 1024/3072/256/4096 字节 |

通过条件核对：**可安装**（打包与逐文件一致性通过）、**原有记录不丢失**（升级用例通过）、
**默认权限不扩大**（新表默认关闭）、**项目记录不串用**（A2 隔离用例通过）、
**迁移与回滚步骤可执行**（见 README 的升级与回滚章节；回滚需恢复备份，因为旧版拒绝 schema 2）。

---

## T2 真实知识检索和前台边界

### T2-a 协议与状态机（本机可验证部分）：通过

| 项目 | 结果 | 证据 |
|---|---|---|
| 稳定版 hybrid-search 契约 | 通过 | `tests/weknora-contract.test.mjs`（7/7）：请求字段完整、`skip_context_enrichment` 与两个阈值显式传递、不调用 ask |
| 三种响应信封 | 通过 | 同上：`success/data`、`code/msg/data`、裸 `error`；200 但 `success=false` 判为 MALFORMED |
| 错误码映射 | 通过 | 同上：401→UNAUTHORIZED、403→KB_DENIED、404→NOT_FOUND、429/5xx 退避重试、409→CONFIG |
| 总截止 | 通过 | 同上：`deadlineMs=120` 时约 120ms 以 DEADLINE 结束 |
| 手工文档五步形状 | 通过 | 同上：草稿不发送 process_config；发布必带完整正文 + `status=publish` + 低成本 process_config；`custom_metadata` 先读后写保留非插件字段 |
| 删除入队语义 | 通过 | 同上：DELETE 200 后仍需 GET 404 才算完成 |
| 分块分页与原序 | 通过 | 同上：`chunk_index` 原序、`content_revision`、`is_enabled=false` 仍返回，由调用方判断 |
| 单活动槽位 | 通过 | `tests/weknora-lifecycle.test.mjs`（8/8）：同会话同时只有一份活动结果，第二次提交前旧正文已退役 |
| 下一用户轮退役 | 通过 | 同上：`retireOnNewTurn` 后 `activeSlot` 为空，退役短引用合计 ≤ 256 字节 |
| 未绑定库不可读 | 通过 | 同上：返回 NO_BINDING 且**不发任何远端请求** |
| 每轮调用上限 | 通过 | 同上：第 3 次调用在 HTTP 之前以 TURN_LIMIT 拒绝 |
| 取消不注入 | 通过 | 同上：已中止的调用不留活动槽位 |
| 关闭读取即时失效 | 通过 | 同上：撤下相关正文，之后检索返回 READ_DISABLED |
| 重启对账 | 通过 | 同上：孤儿槽位被清理，`activeSlot` 为空后才允许新预留 |
| 跨库融合与字节裁剪 | 通过 | `tests/retrieval-router.test.mjs`（22/22）：不同库分数不直接比较、来源配额、bodyHash 去重、确定性排序、3072 字节裁剪 |
| 工具输出契约 | 通过 | `tests/weknora-host.test.mjs`：`source='knowledge'` 成功时返回 `<knowledge-evidence>` 与 `knowledgeEvidence.slotId`；未开启时给出明确文案且不发 HTTP |
| 凭据不外泄 | 通过 | 同上：连接只存引用名，HTTP 头使用解析后的密钥，存储与页面均无密钥正文 |

### T2-b 真实 WeKnora 与真实 embedding：通过

真实实例上的实测（同一知识库、真实 embedding 模型 `389e4c5a-…`）：

| 项目 | 结果 | 实测证据 |
|---|---|---|
| 真实 search | 通过 | `hybrid-search` 返回 6 条，首条 `score=0.0164`、`match_type=0`（embedding 通道），耗时 403ms |
| 来源与原文核对 | 通过 | 命中文档 `a2fd9bb4-…`（「DSH 官方文档｜集成｜连接第三方记忆 MCP 服务」），chunk `2d461532-…`；标题、文档 ID、chunk ID、正文 hash、获取时间齐全 |
| 已知答案命中 | 通过 | 查询「连接第三方记忆 MCP 服务」的命中正文中包含 `MEMORIX_DATA_DIR`，与 `/chunks` 读到的原文一致 |
| 按需 read | 通过 | `GET /chunks/:id` 返回 17/17 块，`chunk_index` 单调递增（原序） |
| 未绑定/不存在 | 通过 | 不存在的文档返回 `NOT_FOUND`，不冒充空结果；未授权凭据返回 `UNAUTHORIZED` |
| 超时与取消 | 通过 | 1ms 截止返回 `DEADLINE`；已中止的调用返回 `DEADLINE` 且不注入 |
| 凭据边界 | 通过 | 无效 key 返回 401，未被当作成功 |

**真实耗时**（首次真实样本，非容量基准）：检索 403ms、分页读取 24ms。
知识工具目标 1500ms 内结束：**满足**（403ms + 格式化为单次调用）。

**未执行**：成本对照（普通任务不发 WeKnora、本地新增耗时 p95 ≤ 10ms、普通任务输入
tokens 增幅 ≤ 5%）需要同模型同起始上下文的真实模型样本，本轮未采集；标注为**未执行**。
`/api/v1/system/info` 因凭据无 `manage_vector_stores` 返回 403，实例版本号记为 **unknown**。

---

## T3 共享经验的确认、发布和撤回闭环

### T3-a 合成经验的状态机闭环（本机可验证部分）：通过

使用 `tests/weknora-lifecycle.test.mjs` 的真实 SQLite Worker + 真实本机 HTTP 夹具，
以**合成经验**（非用户真实记忆）执行：

| 步骤 | 结果 | 证据 |
|---|---|---|
| 预览并确认 | 通过 | `confirmPreview` 在同一事务内持久化批准快照与 outbox；源 revision 变化返回 REVISION_CONFLICT，正文被替换返回 PREVIEW_HASH_MISMATCH |
| 发布五步 | 通过 | 草稿 → 元数据（保留非插件字段）→ 发布（必带 status=publish）→ 索引轮询 → completed 后标记 published |
| 重复操作不产生可用重复副本 | 通过 | 目标库已存在唯一同标记文档时走对账分支，**不发出第二次 POST**，映射被恢复 |
| 创建响应丢失进对账而非盲重发 | 通过 | 同上；多匹配进入 `reconcile_required`，状态不明不恢复映射 |
| 本地修改后先待复核再确认新版本 | 通过 | `versionDiff` 区分 `updated`/`body-changed`；已发布版本与待复核候选分别保存 |
| 离线删除本地经验后立即屏蔽 | 通过 | 写墓碑后 `tombstoneFor` 生效，队列不再外发（`TOMBSTONED` 取消） |
| 恢复网络后完成远端删除 | 通过 | DELETE 后轮询 GET 404 才标记 done；仍可读到则保持 pending |
| 权限错误不算成功删除 | 通过 | 403 → KB_DENIED，墓碑标记 failed 而不是 done |
| 墓碑阻止重生 | 通过 | 完成后墓碑仍保留（`tombstones` 非空），阻止重新发布与召回 |
| 远端外部编辑显示冲突 | 通过 | 远端正文与批准快照不一致 → `conflict` + `REMOTE_BODY_MISMATCH`，**不自动覆盖** |
| 重启后状态一致 | 通过 | 重启对账用例；墓碑与发布映射持久 |

### T3-b 在已授权知识库中的真实闭环（仅合成内容）：通过

在同一真实知识库中，仅使用本工具创建的合成文档（标题含「合成验收经验」与稳定发布标记）：

| 步骤 | 结果 | 实测证据 |
|---|---|---|
| 创建合成草稿 | 通过 | 建后 `parse_status=draft`、`manualStatus` 为空、`version=1` |
| 按标记唯一对账 | 通过 | 目标库中按稳定标记唯一匹配到该文档，确认响应丢失后可恢复映射而不是重发 |
| 元数据整体替换 | 通过 | 先写非插件键再写插件键，回读两者并存（`acceptance-note` + `dsh-memory-publish-id`） |
| 发布并等索引 | 通过 | `pending` → `finalizing` → `completed`，实测 **48s**；完成后正文 hash 与批准快照一致，`version=2` |
| 新会话检索验证 | 通过 | 按发布标记检索到该文档，正文与来源版本一致 |
| 重复不产生副本 | 通过 | 再次操作后标记仍唯一匹配 1 条 |
| 更新递增版本 | 通过 | 改正文后重新发布，`version=3`，正文 hash 对应第二版（72s 完成索引） |
| 外部改写可检出 | 通过 | 直接改写远端正文后，hash 与批准快照不一致，可被识别为冲突，**不误判为新版本** |
| 重启后可对账 | 通过 | 新建客户端重读同一文档，`parse_status=completed`，满足重启对账前提 |
| 撤回并确认 | 通过 | `DELETE` 后轮询到 `GET 404`，确认删除完成 |
| 删除后不复现 | 通过 | 删除后按标记检索为 0 条 |

**授权边界执行结果**：验收前后对比 —— 知识库 `total` 均为 **99**，
新增 **0**、删除 **0**、既有文档身份与终态被改动 **0**。
所有合成文档在验收结束时已清理，未触碰任何既有文档。

真实经验向知识库发布仍须经管理页预览确认；本轮自动化**不**代替人工批准，
也**未**上传任何真实聊天或个人记忆。

---

## 未验证范围汇总

- 真实模型下的 T2 成本对照与耗时 p95（未采集同模型同起始上下文的样本）。
- WeKnora 实例版本号（`/api/v1/system/info` 需要 `manage_vector_stores`，本凭据 403 → unknown）。
- 真实 Host 重启后的设置页交互（T1 的人工部分）。
- 跨客户端一致性：其他客户端不具备本插件的屏蔽逻辑，方案不承诺跨客户端强一致。
- 自动升级与自动回滚：仍为方案研究，未实现。
- 同标记文档超过 100 篇时的对账分页边界（需人工介入）。
- 真实索引富化阶段耗时 12–73 秒：已把轮询期限放宽到 300s（`WEKNORA_INDEX_TIMEOUT_MS` 可调），
  但这意味着发布完成不是秒级操作，管理页需要容忍较长的 `verifying` 状态。

## 已知限制（实现层面）

- 发布正文不含自身 hash：`bodyHash` 是对最终正文的可复算摘要，正文不内嵌该值，避免自引用。
- `match_type` 是服务端整数枚举；`custom_metadata` 是整体替换语义，插件必须先读后写。
- 索引完成判定要求 `parse_status=completed` 且手工正文与批准快照 hash 一致；无法证明片段版本时不宣称新版本。
- 回滚不能仅替换回旧 tgz：旧版拒绝 `user_version>1` 的数据库，必须恢复备份。

---

## 历史记录（0.2.1 及更早）

以下为 0.3.0 之前的版本记录，保留作为历史证据，不适用于 0.3.0。

### V0.2.1 版本号更正（2026-10-04）

按用户要求将正式版本由 2.0.1 更正为 0.2.1，发布标签使用 V0.2.1。根清单、插件清单、锁文件根记录、两份 README 和重新生成的附件统一使用更正版本；第三方依赖版本保持不变。生产源码和功能未修改，既有 16 项功能检查及类型检查继续有效。本次重新构建，并验证入口版本一致性和最终包实际安装；远端提交、标签和附件哈希单独核对。原 V2.0.1 标签及历史记录保留，旧 Release 转为草稿，防止作为当前稳定版本展示。

### V2.0.1（2026-10-04）

按用户指定的 V2.0.1 发布，根清单、插件清单及锁文件版本统一为 2.0.1。两份 README 删除升级与回滚部分，保留必要的安装重启说明；此前本地 0.2.1 安装入口修复纳入本版本，自动升级与自动回滚仍未实现。

构建、类型检查、16 项自动化检查及实际隔离 Git 安装通过，设置页和 memory/invoke 正常加载。新增安装文件字节一致性检查发现隔离 Git 夹具未复制仓库已有 .gitattributes，导致 Windows Git 换行转换；夹具补齐该文件，并保留原有规则、增加安装文件字节约束后检查通过。该失败保留为测试前提遗漏记录，不降低一致性断言。最终 tgz 实际安装、设置页和 RPC 同样通过，公开摘录见 docs/verification/release-2.0.1.json。远端 Git 安装与附件下载在推送后另行验证，真实用户 Desktop 及跨机器远程不在本次操作范围。

### 0.2.1 安装入口修复（2026-10-04）

公开 Git 地址的旧版安装已在隔离配置档复现：仓库根目录没有 package.json，pnpm 生成占位清单，官方 CLI 提示 `declares no dsh.bundle`，按普通依赖安装。修复在根目录提供组合包声明、补丁及与插件构建一致的运行文件，不要求执行安装构建脚本。

构建、类型检查及 16 项自动化检查通过。另从修复内容创建隔离 Git 仓库，使用官方 CLI 安装指定提交；配置档包含正确组合包、安装版本为 0.2.1，实际 loopback Host 的记忆页面加载成功，memory/invoke 返回 200 及可写概览，无浏览器错误。记录见 docs/verification/git-install-0.2.1.json。
