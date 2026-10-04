# DeepSeek Harness 记忆插件

为 DeepSeek Harness 提供 Codex 式双阶段后台记忆：先从原生会话日志提炼，再按差异整理为可检索记忆。提供全局与项目范围、SQLite 存储、Markdown 快照和「设置 → 记忆」管理页面。

**当前版本：0.1.7。验收状态：待完成验收。** 新配置档初始后台额度为 10000 tokens，已有配置档可手动补充至 10000；每日后台上限默认 100000 tokens。保留原生日志依赖修复，并新增模型格式、schema、输出截断和实际失败用量诊断。用户的真实提炼调用已发生，但返回校验失败；真实提炼、整理闭环仍待完成，不能以固定模型测试替代。

- GitHub：[shxtmaker/dsh-memory-codex-port](https://github.com/shxtmaker/dsh-memory-codex-port)
- Gitea：[lqy/dsh-memory-codex-port](http://192.168.3.100:3300/lqy/dsh-memory-codex-port)
- 安装包：[dist/dsh-memory-local-0.1.7.tgz](https://github.com/shxtmaker/dsh-memory-codex-port/blob/main/dist/dsh-memory-local-0.1.7.tgz)
- 完整源码包：[dist/dsh-memory-codex-port-0.1.7-source.zip](https://github.com/shxtmaker/dsh-memory-codex-port/blob/main/dist/dsh-memory-codex-port-0.1.7-source.zip)
- 校验值：[dist/SHA256SUMS.txt](https://github.com/shxtmaker/dsh-memory-codex-port/blob/main/dist/SHA256SUMS.txt)
- [验收记录](https://github.com/shxtmaker/dsh-memory-codex-port/blob/main/implementation/dsh-memory/ACCEPTANCE.md) · [实施状态](https://github.com/shxtmaker/dsh-memory-codex-port/blob/main/implementation/dsh-memory/IMPLEMENTATION_STATUS.md)

![记忆设置页，实际隔离 Web 环境](https://raw.githubusercontent.com/shxtmaker/dsh-memory-codex-port/main/docs/screenshots/web-settings.png)

## 功能

- 全局记忆与项目记忆双开关；高级设置可分别控制读取和生成，项目可设置覆盖策略。
- 后台 Phase 1 提炼、Phase 2 增量整理；保留来源、时间和状态，保护人工编辑与置顶内容。
- SQLite 为事实来源；按代生成 MEMORY.md、memory_summary.md、原始提炼、会话摘要和待审阅技能快照。
- 中文 n-gram、英文和代码符号词法检索；检索前限制作用域。
- 列表、分页、详情、来源、编辑、冲突保留草稿、删除、清空、页内文件浏览、复制路径和 Markdown 导出。
- 原生 `memory` search/read 工具，以及 `/memory`、`/memory note 文本`、`/memory off`。

页内浏览已实际验证。未确认宿主可授权的系统目录打开能力时，使用页内浏览、路径复制和导出；当前不提供 Explorer 打开按钮。技能文件仅为待审阅候选，不注册执行。

## 兼容性

| 项目 | 当前要求或状态 |
|---|---|
| DeepSeek Harness Host | 严格匹配 `0.2.0-rc.2` |
| Node.js | 24 或更高，需支持 `node:sqlite` 与 Worker |
| 已实测环境 | Windows；匹配版本 npm Web/原生内核；已装 Desktop 0.2.0-rc.2 的独立 profile |
| Desktop 可见页面 | PASS：用户提供隔离 Desktop 页面截图；完整管理交互、0.1.7 升级待验收 |
| 真实模型 | FAIL：已调用实际路由，返回校验失败；0.1.7诊断与闭环待重验 |
| 非 loopback Host | BLOCKED：该版本 CLI 拒绝非 loopback 监听 |

不要在其他 Host 版本使用兼容豁免强装。当前包不声明支持 `0.2.1-alpha.1`。不要求修改 agent-loop、Desktop 主进程、preload 或内置 settings shell；不启动独立服务，不运行 Codex，也不访问 Codex 数据库。

## 安装

### Desktop

确认应用和 Host 均为 `0.2.0-rc.2`，登录后通过应用自己的插件管理入口安装 `dsh-memory-local-0.1.7.tgz`。Desktop 使用自己的 bundled runtime、pnpm 和 desktop profile；不要用系统 npm 代替它的包管理器。

安装后进入「设置 → 记忆」。开关和发送许可默认关闭。人工记忆、编辑和浏览不依赖模型；自动生成需要先配置宿主模型路由，并在记忆高级设置中填写 provider/model、确认发送许可。`fixture` 仅是测试适配器，不能作为正式路由。

### 隔离 Web 审阅

以下 PowerShell 命令在仓库根目录执行。首次使用先克隆并安装匹配运行时；不进行全局升级。

```powershell
git clone https://github.com/shxtmaker/dsh-memory-codex-port.git
Set-Location dsh-memory-codex-port
npm ci --prefix runtime-v0.2.0-rc.2

$repoRoot = (Get-Location).Path
$bundlePath = (Resolve-Path 'dist/dsh-memory-local-0.1.7.tgz').Path
$env:DSH_HOME = Join-Path $repoRoot '.review-home'
Set-Location runtime-v0.2.0-rc.2
node node_modules/@deepseek-ai/dsh/lib/bin.js --profile memory-review --from-default-profile web --dump-config
node node_modules/@deepseek-ai/dsh/lib/bin.js plugin --profile memory-review add $bundlePath
```

首次初始化只执行一次；已有 profile 省略 `--from-default-profile web`。首次启动前，把默认工作区也放到测试目录：

```powershell
$reviewDocuments = Join-Path $env:DSH_HOME 'documents'
New-Item -ItemType Directory -Path $reviewDocuments -Force | Out-Null
$reviewPatch = Join-Path $env:DSH_HOME 'profiles/memory-review/cordis.patch.yml'
$reviewConfig = (Get-Content -LiteralPath $reviewPatch -Raw) -replace '(?m)^\[\]\s*$', ''
$reviewConfig += "`n- id: workspace-controller`n  config:`n    documentsDirectory: '$reviewDocuments'`n"
Set-Content -LiteralPath $reviewPatch -Value $reviewConfig -Encoding utf8
node node_modules/@deepseek-ai/dsh/lib/bin.js --profile memory-review --no-open --host 127.0.0.1 --port 18437
```

打开终端显示的临时本机链接，可选择「稍后配置」模型。访问令牌不应写入共享文档。建立自己的测试会话，不使用日常项目。

## 生成、召回与费用

默认空闲 10 分钟后提炼，后续成功整理最短间隔 30 分钟；新范围首次整理可以立即排队。空闲时间到达仍需 credit 足够，等待本身不会增加 credit。新活动会推迟待执行提炼。只采集启用后新完成的根会话；提炼时读取并等待原生日志 flush，排除隐藏推理、高优先级指令、记忆注入和记忆工具结果。不自动扫描历史。

自动召回不增加提炼或重排序模型调用。项目识别、策略核对、证据撤回和所有召回共用 150ms 截止；超时继续前台，晚到结果不注入。定时器存在调度误差，150ms 不代表整个模型请求或首 token 的延迟保证。

全局和当前项目共享每会话预算周期累计 1024 的直接证据额度。正文、引用和封装按 UTF-8 字节保守扣额；相同 revision 去重，重启和自然压缩不重置。当前没有自动重置周期功能。稳定策略和工具 schema 成本另外记录；1024 不是全部 token 成本。模型主动读记忆仍可能增加工具轮次及后续请求成本。

后台并发固定为 1，默认每日上限 100000 tokens。首次绑定的新记忆配置档获得一次 10000 tokens 初始额度，已有配置档升级不自动授予；高级设置可确认“补充至10000 tokens”。初始授予、人工补充和前台实际 usage 的 3% 累计分别记账，刷新或重启不会补满。

这些额度是插件调用预算，实际模型调用仍消耗供应商额度。调用前预留输入和最大输出；失败和一次格式重试分别计费，并纳入每日上限。处理中显示的日用量包含预留，完成后按实际 usage 结算。运行中或未知用量暂停时不能手动补充；补充不会清除已用日额度、历史失败、重试次数或暂停状态。缺可用额度时等待，不默认透支。

## 存储与隔离

数据位于 `$DSH_HOME/memory/<memoryProfileId>/`，默认 id 为 `local-default`。记忆配置档绑定 OS 用户、执行主机、home 和 id。多个 Host profile 需要配置不同的 `memoryProfileId` 才能使用不同目录；显式选择相同 id 会共用该 home 下的记忆配置档。

项目按 Host realpath 与执行目标绑定持久 UUID，严格区分工作树；不按名称或 Git remote 合并。路径迁移视为新项目，暂无自动别名迁移；同一工作树切换分支不建立新 UUID，应结合来源时间判断适用性。

Capture 保存有界来源元数据，不建立第二套完整聊天日志。模型输入和输出均脱敏，但后台仍需发送给用户已确认的供应商。SQLite schema 当前为 1，未来 schema 拒绝加载。当前代快照可从数据库重建，保留一个旧代；raw_memories.md 不计入卡片的可读文件数。

清空使用 scope epoch、确认和来源水位线，撤销有效条目并拒绝旧任务回填。删除来源或单条记忆保留 tombstone；自动提案不能覆盖人工更正。关闭或删除的直接证据通过原生 SurfaceOp 撤回。

清空不删除原始会话、供应商已接收数据、导出文件，也不承诺物理安全擦除。模型已经复述或写入压缩摘要的内容不能保证逐字撤销；需要严格隔离时新建会话。

## 升级、卸载与回滚

升级前退出 Host，备份对应记忆目录和 profile 配置/锁文件。不要在运行时只复制 state.sqlite 而漏掉 WAL。

从旧版升级后，记忆、已用日额度和失败记录保留，不扫描旧历史。原 SOURCE_UNAVAILABLE 失败任务不自动重试；已处于等待额度的格式重试任务仍受最多两次尝试限制。已有配置档可在高级设置手动补充额度；默认每日上限变为100000，已明确保存的旧上限保留，可用“保存每日上限”调整。

本轮预算变化由用户明确要求；不以补充额度作为真实模型通过证据。旧 MODEL_OR_SCHEMA_FAILURE 记录没有模型正文，无法追溯具体字段错误。升级后新尝试显示 MODEL_INVALID_JSON、MODEL_SCHEMA_FAILURE、MODEL_OUTPUT_TRUNCATED、MODEL_CALL_FAILURE 或 INVALID_SOURCE_REF，以及不含正文的校验路径和最近一次实际用量。保持同一隔离 home/profile，先完成一次可核验提炼与整理，再测试新会话读取。

- Web：在匹配运行时目录使用 `node node_modules/@deepseek-ai/dsh/lib/bin.js plugin --profile memory-review add <新包实际路径>`，随后重启同 home/profile。
- Desktop：使用应用自己的插件管理路径升级。安装后必须完全退出对应应用和Desktop Host，再以原DSH_HOME及原Electron user-data-dir启动。仅刷新记忆页面、关闭设置窗口或重新安装包不更新已加载的严格Remote接口。宿主返回 `restart-required` 时，不应把磁盘版本变更当作运行版本已更新。
- 不覆盖同版本同路径 tarball，避免包管理器复用缓存。

Web 卸载：

```powershell
node node_modules/@deepseek-ai/dsh/lib/bin.js plugin --profile memory-review remove dsh-memory-local
```

移除自己添加的 `id: dsh-memory` 配置覆盖行，保留其他配置。卸载默认保留数据库、快照和导出；同 home/id 重装可继续读取数据。需要逻辑清空时先在页面确认，再卸载。回滚应恢复兼容包和停机取得的完整备份；不对未来 schema 强制降级。

## 源码与构建

```text
implementation/dsh-memory/   TypeScript 源码、锁文件、构建和必要测试
runtime-v0.2.0-rc.2/          匹配隔离运行时的 manifest 与锁文件
docs/                        页面截图和验证说明
dist/                        可安装 tgz、完整源码 zip 和 SHA-256
```

在仓库根目录执行：

```powershell
npm ci --prefix implementation/dsh-memory
Set-Location implementation/dsh-memory
npm run build
npm run typecheck
npm test
npm run test:host
npm run pack:local
```

build 生成声明、使用官方 Typert 生成器构建严格 Remote，再构建 Host、SQLite Worker 和 lazy-CJS Client。插件实际实现 `memory/invoke` 管理 API，不假定宿主已经提供 memory 接口。

Web 必要验收还需在仓库根目录执行 `npm ci --prefix runtime-v0.2.0-rc.2`，并在插件目录执行 `npx playwright install chromium` 后运行 `npm run test:web`。测试创建隔离 home，并使用固定模型；不会购买额度、读取其他项目密钥或扫描真实历史。

可选 Desktop 探针需要先设置 `DSH_MEMORY_DESKTOP_EXECUTABLE` 为真实应用 exe 的绝对路径，再执行 `node tests/desktop.mjs` 和 `node tests/desktop-acceptance.mjs`。不提供该路径时不会猜测目标实例。

验收仅覆盖构建/类型检查及 A1–A5。详细 PASS/BLOCKED/NOT_RUN 见验收记录。源码包包含项目源码、锁文件、构建和测试、文档、匹配运行时 manifest/锁文件；不包含 node_modules、真实记忆数据库、测试 home、访问令牌或第三方参考仓库。

## 许可证

项目采用 MIT，见 [LICENSE](https://github.com/shxtmaker/dsh-memory-codex-port/blob/main/LICENSE)。第三方依赖的许可见 [THIRD_PARTY_NOTICES.md](https://github.com/shxtmaker/dsh-memory-codex-port/blob/main/THIRD_PARTY_NOTICES.md)。本项目是独立插件，不代表 DeepSeek 或 OpenAI 官方产品。
