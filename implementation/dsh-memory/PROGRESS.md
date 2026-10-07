# 实施进度：方案 B（WeKnora 只读检索 + 共享经验发布）

最后更新：2026-10-08
分支：`feat/weknora-plan-b`
基线：`ced6134`（0.2.1）→ 本次发布 0.3.0
方案依据：`TECHNICAL_PLAN_B.txt`（工作区 `_package/`，与 DOCX 同一正文）

## 基线核查（P01）

| 对象 | 方案记载 | 本次实测 | 处理 |
|---|---|---|---|
| 记忆插件 | dsh-memory-local 0.2.1 / `ced6134` | 远端 HEAD 即 `ced6134` | 作为迭代起点，未覆盖用户工作 |
| Harness | 锁定 0.2.0-rc.2 / Node 24 | 本机 Node v26.10.0；`@deepseek-ai/dsh` 为 0.2.0-rc.2 | 沿用 rc.2 契约；Node 26 运行通过 |
| WeKnora | v0.8.2 / `3e8b0bf` | 按该提交逐文件核查接口与权限模型 | 见 `docs/weknora-v0.8.2-contract.md` |
| 安装方式 | Git 安装以根 `package.json` + `lib/` 为入口 | 实测 profile `web` 以 Git 地址安装并运行 | 打包同步根 `lib/` 并逐文件核对 |

环境：`DSH_HOME=/home/lqy/.dsh`，profile `web`。
npm 公共缓存在沙箱下只读，安装改用工作区缓存：
`npm install --cache <workspace>/.npm-cache --logs-dir <workspace>/.npm-logs`。

## P01–P13 状态

| 编号 | 任务 | 状态 | 产物 / 证据 |
|---|---|---|---|
| P01 | 冻结基线并验证插件契约 | 已实现并验证 | `docs/weknora-v0.8.2-contract.md`；基线 16/16 |
| P02 | 新增表与事务迁移 | 已实现并验证 | `src/storage/migrations.ts`；`tests/weknora-storage.test.mjs` 8/8 |
| P03 | WeKnora REST adapter | 已实现并验证 | `src/weknora/client.ts`；`tests/weknora-contract.test.mjs` 7/7 |
| P04 | 连接与 project_binding | 已实现并验证 | 连接单一权威存储、凭据引用分离、KB 上限、发布库须可读 |
| P05 | memory 工具 source/cursor | 已实现并验证 | `src/retrieval/router.ts`；`tests/retrieval-router.test.mjs` 22/22；`tests/weknora-host.test.mjs` 6/6 |
| P06 | 单活动槽位证据生命周期 | 已实现并验证 | `src/retrieval/evidence.ts`；`tests/weknora-lifecycle.test.mjs` 8/8 |
| P07 | 经验卡片与发布预览 | 已实现并验证 | `src/publication/render.ts`；`tests/publication-render.test.mjs` 17/17 |
| P08 | 发布执行器与 outbox | 已实现并验证 | `src/publication/sync-outbox.ts`；五步协议 + 对账 + 退避 |
| P09 | 撤回与墓碑 | 已实现并验证 | 离线墓碑、GET 404 确认、权限错误不算成功、防重生 |
| P10 | 设置页扩展 | 已实现并验证（类型与构建） | `src/client/MemorySettingsSection.tsx`、`locales.ts`、`style.ts` |
| P11 | 整理分批与用量文案 | 已实现并验证 | `tests/weknora-batching.test.mjs` 5/5；1024 明确标为字节额度 |
| P12 | 打包与回滚步骤 | 已实现并验证 | `scripts/release.mjs`；`dist/dsh-memory-local-0.3.0.tgz` + SHA256 |
| P13 | T1/T2/T3 验收 | T1、T2、T3 真实环境全部通过（T3 20/20）；仅成本对照未执行 | `ACCEPTANCE.md`；`evidence/weknora-real-1791395135833.json`；`tests/t1-install.mjs`；`tests/weknora-real.mjs` |

合计自动化检查：**90/90 通过**（`npm test`），构建与两份类型检查通过。
T1 真实验收经 `node tests/t1-install.mjs` 通过；T2/T3 真实验收经
`node tests/weknora-real.mjs` 通过（20/20）。

安全备份：工作区根 `_package/` 与 `_ref/` 为方案包与 WeKnora 参考源码，不属于交付物；
交付物为 `dist/dsh-memory-local-0.3.0.tgz`（SHA256 见 `dist/SHA256SUMS.txt`）。

## 本轮修复的真实缺陷

按发现顺序，均为本轮引入或原有但被掩盖、且会导致功能不可用的问题：

1. **跨模块 `instanceof` 恒为 false**：各入口由 esbuild 独立打包，`client.ts` 被内联进
   index/evidence/sync-outbox。撤回完成后墓碑永远不会被标记完成。改为按固定代码集合结构化判定。
2. **工具输出契约**：`memory` 工具 `output.schema` 漏声明 `knowledgeEvidence`，
   `additionalProperties:false` 下知识检索的成功返回值整体被严格校验拒绝（写侧成功、模型侧全失败）；
   另有值为 `undefined` 的键触发 "not lossless JSON"。
3. **`connections` 二次 JSON 解析**：`all()` 已解析数据，再交给 `connectionView` 会在表非空时
   必定 `STORAGE_ERROR`，设置页连接列表永远打不开。空表返回 `[]` 使既有测试未能发现。
4. **`bindings` 按不存在的 `data` 列读取**：同一根因。
5. **正文 hash 自引用**：正文内嵌自身 hash 导致远端正文无法用同一算法复算，改为 hash 覆盖最终正文。
6. **同轮替换缺少“先退役旧槽位”步骤**：单槽位唯一约束会直接拒绝新结果。
7. **`publicationUpsert` 拒绝读回对象**：生命周期时间戳未在结构内声明，队列每次推进都失败。
8. **`previewStore`/`confirmPreview` 结构不完整**：不接受批准时间与项目信息，预览无法落库。
9. **ZodError 被错误码掩码吞掉**：所有校验错误都折成 `STORAGE_ERROR`，无法诊断。
10. **测试断言在 POSIX 上恒不匹配**：`p.root === cwd.toLowerCase()` 忽略路径分隔符差异（基线问题）。
11. **`ConnectionInput.baseUrl` 必填**：导致「引用已有连接」（切换开关、删除）在 Typert 边界校验即被拒。
12. **设置页按扁平数组读 `publications`**：Host 返回 `{publications,outbox,tombstones}`，
    触发 `filter is not a function`，整个记忆设置页崩溃、记忆页面完全不可见。
13. **队列失败项判定错误**：发布记录不代表队列健康，改为按 outbox 的 `state='failed'` 渲染。

## 真实验收结果（2026-10-08）

环境：WeKnora `http://192.168.3.100:18080/api/v1`，知识库
`4f4ff687-7b56-4f6c-ad83-fd5aaa627731`（验收前 99 篇真实文档）。

| 组 | 结果 |
|---|---|
| T1 真实 Host 安装 | **通过**：隔离 profile 安装 tgz → loopback Host → 设置页渲染，重启保留 |
| T2 真实检索 | **通过**：search 403ms 命中 6 条（首条 match_type=0 embedding 通道）；已知答案命中；分页读取 17/17 块原序；超时/取消/401 均按预期失败 |
| T3 真实发布闭环 | **通过 20/20**：创建→对账→元数据→发布（索引 48s）→检索验证→重复不产生副本→更新（version 3）→外部改写可检出→撤回 GET 404→删除后不复现 |

授权边界核对：验收前后知识库 `total` 均为 99，新增 0、删除 0、既有文档被改动 0；
所有合成文档已清理。证据：`evidence/weknora-real-1791395135833.json`。

### 真实验收发现并修复的缺陷

**手工 metadata 是扁平结构，不是嵌套**（阻塞级）：
真实实例返回 `metadata.content/format/status/version/updated_at`，
而实现按 `metadata.manual.*` 读取，导致 `manualContent`/`manualVersion`/`bodyHash`
**恒为 null** —— 发布校验无法证明正文一致，索引完成判定永远不成立，
T3 整条链路实际不可用。已在 `client.ts` 修正并加回归用例
（`tests/weknora-contract.test.mjs`「手工 metadata 为扁平结构」）。

**索引富化耗时远超预期**：`pending → finalizing → completed` 实测 48–73 秒。
原 120s 期限在首次运行被 `finalizing` 耗尽；轮询期限放宽到 300s
（`WEKNORA_INDEX_TIMEOUT_MS` 可配置），并在超时信息中区分“仍在推进”与“真的卡住”。

**既有文档 metadata 形状与手工文档相同**：不能靠键名区分文档类型。

## 当前阻塞

无。唯一未执行项为 T2 成本对照（普通任务不发 WeKnora、本地新增耗时 p95 ≤ 10ms、
普通任务输入 tokens 增幅 ≤ 5%），需同模型同起始上下文的真实模型样本，
本轮未采集，标注为**未执行**而不是通过。

## 下一步可执行动作

1. 采集 T2 成本对照样本（同模型、同起始上下文），补齐唯一未执行项。
2. 用真实样本校准 `matchCount`/`vectorThreshold`/`keywordThreshold` 与
   `consolidateBatchSources`/`consolidateBatchBytes` 初值（当前为方案初值）。
3. 在用户日常 profile 安装 `dist/dsh-memory-local-0.3.0.tgz` 并完整重启 Host，
   由用户本人确认「设置 → 记忆」的知识库配置与发布预览交互。
4. 按用户授权决定是否推送远端与发布标签。
