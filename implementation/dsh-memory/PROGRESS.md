# 实施进度：方案 B（WeKnora 只读检索 + 共享经验发布）

最后更新：2026-10-08
分支：`feat/weknora-plan-b`（基线 `ced6134`，修正提交 `b3a591a`）
方案依据：`TECHNICAL_PLAN_B.txt`（工作区 `_package/`，与 DOCX 同一正文）

## 基线核查（P01）

| 对象 | 方案记载 | 本次实测 | 处理 |
|---|---|---|---|
| 记忆插件 | dsh-memory-local 0.2.1 / `ced6134` | 远端 HEAD 即 `ced6134`，本地克隆一致 | 作为迭代起点 |
| Harness | 锁定 0.2.0-rc.2 / Node 24 | 本机 Node v26.10.0；`node_modules/@deepseek-ai/dsh` 为 0.2.0-rc.2 | 沿用 rc.2 契约；Node 26 运行通过 |
| WeKnora | v0.8.2 / `3e8b0bf` | 已按该提交逐文件核查接口 | 见 `docs/weknora-v0.8.2-contract.md` |
| 安装方式 | Git 安装以根 `package.json`+`lib/` 为入口 | 实测 profile `web` 以 `github:shxtmaker/dsh-memory-codex-port` 安装并运行 | 打包必须同步根 `lib/` |

环境：`DSH_HOME=/home/lqy/.dsh`，profile `web`，已装插件 0.2.1。
npm 公共缓存在沙箱下只读，安装改用工作区缓存：
`npm install --cache <workspace>/.npm-cache --logs-dir <workspace>/.npm-logs`。

### 基线门禁结果

- `npm run build` 通过。
- `npm run typecheck` 通过。
- `npm test` 16/16 通过（修复后）。
- 基线原有 3 项失败（`production-source` 及其两个包装）根因单一：
  测试断言 `p.root === cwd.toLowerCase()`，在 POSIX 上因路径分隔符差异恒不匹配。
  仅修正测试侧分隔符归一化，未改动插件行为。已提交 `b3a591a`。

## P01–P13 状态

| 编号 | 任务 | 状态 | 证据 / 产物 |
|---|---|---|---|
| P01 | 冻结基线并验证插件契约 | 已实现 | `docs/weknora-v0.8.2-contract.md`；本文件基线表；build/typecheck/test 16-16 |
| P02 | 新增表与事务迁移 | 待办 | schema v2 |
| P03 | WeKnora REST adapter | 待办 | `src/weknora/client.ts` |
| P04 | 连接与 project_binding | 待办 | `src/config.ts` + 管理协议 |
| P05 | memory 工具 source/cursor | 待办 | `src/retrieval/router.ts` |
| P06 | 单活动槽位证据生命周期 | 待办 | `src/retrieval/evidence.ts`、`retire.ts` |
| P07 | 经验卡片与发布预览 | 待办 | `src/publication/render.ts` |
| P08 | 发布执行器与 outbox | 待办 | `src/weknora/publisher.ts` |
| P09 | 撤回与墓碑 | 待办 | `src/publication/withdraw.ts` |
| P10 | 设置页扩展 | 待办 | `src/client/MemorySettingsSection.tsx` |
| P11 | 整理分批与用量文案 | 待办 | `src/engine.ts` |
| P12 | 打包与回滚步骤 | 待办 | tgz + SHA256 |
| P13 | T1/T2/T3 验收 | 待办 | `ACCEPTANCE.md` |

## 环境阻塞

- 未提供 WeKnora 实例地址、租户、读取/发布凭据引用、隔离测试库 ID。
- 因此 T2、T3 的真实验收入口保留，先完成全部不依赖外部服务的实现与打包。

## 下一步

1. P02：schema v2 迁移与新表。
2. P03：REST adapter（可按契约并行推进）。
