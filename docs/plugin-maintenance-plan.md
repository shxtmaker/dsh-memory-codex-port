# 插件安装、自动升级与回滚方案

调查日期：2026-10-04。本文是方案与官方依据，自动升级和回滚尚未实现。

后续发布说明：安装入口修复按用户指定的版本号纳入V2.0.1；下文0.2.1为研究时的本地候选编号。自动维护方案保留，不属于V2.0.1已实现功能。

## 结论

DeepSeek Harness 使用组合包声明和当前配置档的包管理器安装插件。更新已有插件，应以相同包名重新安装指定版本；回滚应重新安装已保留的旧版包。官方目前没有专用的插件自动更新或版本回滚接口。已有包被替换后返回 `restart-required`，不能把下载、安装或页面刷新当作新版已运行。上述结论来自官方 `PluginManager` 的完整公开接口及替换分支，而非第三方教程。[公开接口](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/boot/plugin-manager/src/index.ts#L231-L645)、[替换分支](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/boot/plugin-manager/src/index.ts#L568-L581)

自动检查、下载、安装和安装失败补偿可以在官方接口之上编排；新版在下一次启动时导致整个 Host 无法启动的情况，不能由同一个故障插件独立完成自动回滚。若必须覆盖这种故障，需要独立于目标插件和 Host 启动结果的维护进程，或官方未来提供相应恢复能力。当前 Desktop 的原生故障恢复是禁用第三方组合包、备份配置补丁并重启，并不恢复旧版包。[Desktop 恢复](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/apps/desktop/README.md#L129-L137)

## 依据和版本边界

本次仅使用官方仓库、官方发布标签和本地已安装的官方包。固定版本如下：

| 对照对象 | 官方提交 | 用途 |
|---|---|---|
| `dsh-v0.2.0-rc.2` | `639ed015397290b3745d163aafe02ffee4aa3f84` | 当前插件测试目录 `runtime-v0.2.0-rc.2` 的兼容基线 |
| 调查时的 `master` / `dsh-v0.2.1-alpha.1` | `5badb15009ae1756c3afe0ae0cef1faafc290ccc` | 最新官方实现对照 |

版本映射来自[官方标签](https://github.com/deepseek-ai/deepseek-harness/tags)。本文所有功能结论以固定提交链接为准。执行基线为当前插件支持的 `0.2.0-rc.2`；最新实现用于识别差异，不作为强制升级用户 Host 的前提。用户正在运行的 Desktop 内嵌运行时版本未在本研究中认定；不能用测试目录版本替代真实 Desktop 版本。

### 组合包入口

安装对象的 `package.json` 必须声明 `dsh.bundle.patch`，并包含对应补丁及可加载的运行文件。Git 仓库安装读取仓库中的安装包入口；子目录有合法包，不代表仓库根目录就是合法组合包。官方教程说明缺少声明时只会安装普通依赖，不激活组合包层。[组合包声明](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/docs/user/develop/basic/publish.md#L11-L64)

截图中的 `这个包没有声明组合包，不能作为插件管理` 与上述入口问题一致。本仓库旧版公开 Git 入口缺少根 `package.json`，已在本地 `0.2.1` 补齐根入口、补丁及预构建文件。本地隔离 Git 安装、实际 loopback Host 设置页及页面 RPC 已通过，公开摘录见 [安装验证](verification/git-install-0.2.1.json)。公开 Git 修复后的安装和已安装 Desktop 均为 `NOT_RUN`。修复尚未推送，公开 Git 安装地址仍不能标为已修复。该修复解决 Git 安装入口，不代表自动升级已完成。

官方说明 Git 安装需要可用的构建产物；若依赖安装期 `prepare` 构建，用户必须显式批准脚本。预构建的 npm 包或 `pnpm pack` 产出的 tarball 不需要构建许可。本仓库拟保留可直接加载的预构建文件，自动维护优先使用已构建的固定版本 `.tgz`，避免引入安装期构建授权。[Git 构建与预构建包](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/docs/user/develop/basic/publish.md#L159-L184)

### 官方安装和管理方式

| 场景 | 官方方式 | 需要区分的状态 |
|---|---|---|
| CLI 安装或更新 | `dsh plugin --profile <name> add <spec>`，或 pnpm 的 `update` 等命令 | 成功后重整配置档的组合包选择；不保证当前进程加载新版 |
| Web / Desktop 插件页首次安装 | `remote.pluginManager.installBundle(spec, options)` | 当前页面没有已有包升级或回滚按钮；`ChangeResult.application` 与 `packageResult.exitCode` 分别表示应用结果和包操作结果 |
| 启用或禁用 | `setBundleEnabled(name, enabled)`、`setPluginEnabled(id, enabled)` | 配置保存、Host 激活和浏览器同步是独立结果 |
| 卸载 | `removeBundle(name)` | 启动中使用且没有 HMR 的包可能要求先停止配置档；升级不应先卸载 |
| 取消或恢复未收到的结果 | `cancelInstall(requestId)`、`waitForInstall(requestId)` | `waitForInstall` 返回 `null` 只表示没有活动请求，不能认定成功或取消 |

依据：[CLI 包管理](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/apps/cli/reference/README.md#L79-L99)、[管理方法及结果](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/boot/plugin-manager/src/index.ts#L433-L645)、[结果定义](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/boot/plugin-manager/src/types.ts#L115-L168)。

页面的安装流程会拒绝已识别的已安装包名，没有直接提供升级入口。拟实现的自动升级和回滚由维护控制器直接调用同名覆盖的 `installBundle`，而不是宣称官方插件页已有升级按钮或通过页面点击实现更新。Git/tarball 在检查时可能无法预先知道包名，最终仍由安装器确认包名和组合包声明。[页面拒绝已有包](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-plugin-manager/src/client/manager-store.ts#L838-L858)、[Git/tarball 检查](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/boot/plugin-manager/src/index.ts#L366-L372)

`installBundle` 默认启用；官方插件页实际先用 `enabled: false` 安装，再让用户启用。自更新方案需要保留此前的启用选择，不能照搬首次安装流程导致已有插件被停用。管理操作与 CLI 共用配置档写锁，避免自行并发修改配置档或直接复制运行文件。[默认选项](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/boot/plugin-manager/src/types.ts#L152-L166)、[插件页安装](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-plugin-manager/src/client/manager-store.ts#L902-L923)、[管理写锁](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/boot/plugin-manager/src/index.ts#L795-L819)。

### Desktop 边界

当前 Desktop 插件管理由共享 Web 插件页通过认证 Host API 调用共享管理器；Desktop 提供内置 pnpm 的启动事实，不要求用户安装全局 pnpm。Electron 没有插件管理 IPC 或独立管理页面。[Desktop 架构](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/apps/desktop/README.md#L101-L129)

Desktop 产品预加载接口仅提供自身更新的 `updates.status()`、`updates.open()`、`updates.subscribe()`，没有供第三方插件调用的通用进程重启、指定包升级或插件回滚方法。`updates.open()` 打开 Desktop 自身更新的原生确认流程，不能用它重启某个插件或安装本插件指定的版本。[产品 API](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/apps/desktop/src/ipc.ts#L71-L87)、[预加载实现](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/apps/desktop/src/preload-app.ts#L13-L59)

官方 `plugin-manager/README.md` 的限制段仍写有 Desktop 包操作归属 shell，措辞与当前 Desktop 文档存在差异。此处以当前 Desktop 文档、预加载源码及插件页的 `remote.pluginManager` 调用交叉核验后的事实为准，不据旧措辞设计不存在的 shell 插件升级 RPC。[该限制段](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/boot/plugin-manager/README.md#L129-L139)

### 官方失败恢复不等于版本回滚

| 失败位置 | 官方实际处理 | 本插件维护层需要补足 |
|---|---|---|
| pnpm 失败、取消或组合包验证失败 | 恢复安装前 `package.json` 和 `pnpm-lock.yaml`；下载文件可能残留 | 检查磁盘实际版本，必要时重装已缓存的旧包；不能仅凭配置恢复宣布回滚成功 |
| Git/tarball 安装后发现版本不兼容 | 恢复 manifest/lock，尝试按照原 lock 重新安装；恢复失败提供诊断 | 区分成功恢复和恢复失败，保留具体失败步骤 |
| 安装成功后启用或运行解析发布失败 | 保留已完成的磁盘和配置修改，返回失败 | 显式旧包重装、旧启用选择恢复与健康检查 |
| 新版导致下一次 Host 启动失败 | Desktop 原生恢复可以禁用第三方包并备份补丁 | 插件自身无法执行恢复；完整自动恢复需要 Host 外的维护执行者 |

依据：[失败语义](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/boot/plugin-manager/README.md#L143-L155)、[不兼容安装恢复](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/boot/plugin-manager/src/operations.ts#L496-L517)、[Desktop 原生恢复](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/apps/desktop/README.md#L129-L137)。

### `0.2.0-rc.2` 与最新实现差异

已读取本地 `@deepseek-ai/dsh-plugin-manager@0.2.0-rc.2` 的编译源码及类型定义，并逐段对照官方两个固定提交。`installBundle`、`waitForInstall`、`cancelInstall` 在 `rc.2` 已存在；同包替换要求重启的分支保持一致。最新实现新增 `BundleInfo.source`、安装结果 `ChangeResult.version`，以及新装、启用、停用和删除后的运行包解析刷新。因此不能在 `rc.2` 中依赖最新字段；需要读安装清单获取版本、自己保存已确认的旧包来源。两个版本的 `apps/desktop/src/preload-app.ts` 没有差异。[rc.2 管理器](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/boot/plugin-manager/src/index.ts)、[最新管理器](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/boot/plugin-manager/src/index.ts)、[rc.2 类型](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/boot/plugin-manager/src/types.ts)、[最新类型](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/boot/plugin-manager/src/types.ts)

## 推荐实施路线

以下是根据官方机制提出的本仓库设计，不是官方已有能力。

### 实现路径、依赖和工作量

以下工期按一个开发者连续工作估算，包含必要的隔离测试，不包含真实 Desktop 操作等待、发布授权等待和对官方未来接口的等待。路径为建议新增或修改的位置，不表示文件已经实现。

| 顺序 | 代码或交付路径 | 内容与依赖 | 估算 |
|---|---|---|---|
| A | 根 `package.json`、`cordis.patch.yml`、`lib/`、两个 README | 完成根 Git 安装入口与说明精简；其余阶段依赖合法安装包 | 0.5–1 天 |
| B | 建议新增 `implementation/dsh-memory-maintenance/src/release-source.ts`、`package-cache.ts`、`state.ts` | 发布源、固定版本缓存、校验及可恢复维护记录；基于 `rc.2`，不依赖 `BundleInfo.source` 或 `ChangeResult.version` | 1–1.5 天 |
| C | 建议新增独立维护包的 `src/index.ts`、`src/installer.ts`、`src/health.ts`、`src/client/`、`cordis.patch.yml` | 注册稳定维护控制器及其管理页，调用官方管理器，观察记忆插件健康状态；依赖 B | 1.5–2 天 |
| D | 维护包的 `src/scheduler.ts`、`rollback.ts`；记忆包 `src/index.ts`、`src/engine.ts`、`src/storage/` | 自动检查与安装、上一版本重装、安装失败补偿、提炼任务排空及数据一致性保护；依赖 C | 1.5–2 天 |
| E | 建议新增隔离维护链路测试与 `docs/verification/` 记录 | rc.2 与最新实现兼容对照、故障注入、离线旧包重装、重启前后版本确认；依赖 D | 1–1.5 天 |
| F | 待单独确定的外部 supervisor、启动入口及其测试 | 在 Host 无法启动时执行旧包重装，并管理进程重启；依赖 B–E 与独立部署方式确定 | 另加 2–4 天 |

不含外部 supervisor 的 A–E 合计约 6–8 天。维护控制器应使用与 `dsh-memory-local` 不同的包名、独立组合包和独立升级周期，避免记忆插件失败导致回滚界面和执行者一并消失。首次安装流程需要让用户安装或启用这个维护组合包；不能依赖目标记忆插件已成功加载才提供它。

### 第一阶段：修复安装入口

保持包名 `dsh-memory-local` 不变。仓库根目录和发布 tarball 均提供合法组合包入口与同一组预构建运行文件。根目录安装、首次启用及旧版到 `0.2.1` 的安装结果分别验证。精简 README，只保留用途、安装、使用、配置与数据说明；删除独立的下载与验证栏目。研究、兼容性和验收细节保存在本文件及验证记录中。

### 第二阶段：自动检查和安装编排

1. 提供可保存的自动升级开关，默认关闭；开启后每6小时检查稳定发布版本，单进程只运行一个维护任务。前台会话运行时延后安装。安装或回滚时暂停记忆提炼新任务，等待已经开始的记忆写入完成；排空超时则推迟本次维护，不强制终止任务。
2. 从配置的发布源获取精确版本及预构建包，缓存新旧两个版本，校验 SHA-256、包名、`dsh.bundle`、入口文件及 DSH 兼容性。GitHub 与 Gitea 的同版本产物必须一致，镜像切换不能换成同版本不同内容。首次没有可信旧包时，先建立旧版缓存，不能假称具备回滚保障。
3. 持久化维护记录：运行版本、磁盘安装版本、候选版本、旧包校验值、启用选择、请求 ID、当前步骤、最后错误和等待重启状态。写入成功后，调用官方 `ctx.pluginManager.installBundle()`；不直接写 `node_modules`，不先卸载。
4. 同包替换返回 `restart-required` 时显示“新版已安装，重启后生效”，保持旧运行版本记录。完整退出并重新打开后，验证新代码、配置、存储和页面 RPC；通过后才标记升级完成。记忆包需要新增只读健康协议，返回构建时嵌入的代码版本、进程代次及Worker就绪状态；不能仅读取已被替换的磁盘package.json判断运行版本，否则可能把旧进程误认为新版。
5. 没收到安装结果时先用 `waitForInstall` 查询，再核对实际磁盘状态；`null` 进入待核对状态，不盲目重试安装。

### 第三阶段：旧版重装与自动补偿

“回滚上一版本”使用校验通过的旧包调用同一 `installBundle`，恢复此前启用选择，必要时提示重启，重启后的健康检查通过才标记回滚完成。安装失败时在当前 Host 尚可执行的条件下启动同一补偿流程；失败后保留日志和可重试状态，避免无限循环。已失败的版本及校验值进入阻止再次自动安装的列表，防止检查器反复升级到同一个故障包；重启前不允许第二次包替换。

记忆数据库和用户配置与代码版本分开维护。默认代码回滚不清空记忆，不覆盖升级后新增内容。升级前用存储自身提供的一致性备份方法保存快照，不能对正在写入的数据库仅复制主文件。若未来引入不能向后兼容的数据迁移，必须先确定可逆迁移或恢复策略，再允许该版本自动升级；数据库快照恢复会丢失快照后的修改，应作为单独的恢复操作处理。

目前存储Worker只有关闭时checkpoint，没有备份或维护排空接口。因此实施D需要在 `src/storage/storage-worker.ts`、`src/storage/worker-client.ts` 及独立维护协议中增加一致性备份和任务排空能力；不把普通文件复制描述为已具备的在线备份。配置备份与维护记录仅保存到当前Host本地目录，不进入发布包。

### 第四阶段：完整启动失败恢复

稳定独立控制器可以覆盖“Host 正常，但记忆插件加载失败”的情况，前提是它使用独立组合包并且不随目标插件替换而失效。整个 Host 无法启动时，控制器也不能运行，必须由 Host 外的 supervisor 执行自动恢复，或由用户使用官方原生恢复。两者是不同层次，不把独立 Host 插件误称为 Host 外恢复服务。当前官方没有开放插件可调用的通用重启接口，因此不承诺第三方插件能无干预关闭并重启 Desktop。是否引入外部 supervisor 及其生命周期应另行确定，不能偷偷扩大为修改 Desktop 安装文件或后台常驻服务。

若交付目标要求包含Host无法启动时的自动回滚，应将F纳入完整版本。建议使用独立维护启动器：在受控入口保存准确的Desktop路径、home/profile和启动参数，以官方CLI及内置pnpm重装已缓存旧包，重新启动后等待健康确认。启动器需要单实例锁、重启次数上限和失败停止状态；不修改Desktop安装文件，也不终止并非由它启动的用户进程。启用受控启动入口前，只能承诺自动检查、安装与可运行Host中的补偿，以及等待用户重启后确认生效。

## 实施前及验收时必须验证的事项

- 真实 Desktop 内嵌 DSH 版本、配置档及内置 pnpm 调用事实；本研究未读取或修改用户凭据。
- `0.2.1` 的根目录 Git 安装、固定版本 tarball 安装、同包覆盖安装与完整重启后的运行版本。
- 在两个官方基线上验证失败包、损坏包、取消安装、兼容性拒绝、旧版重装和不同启用状态。
- 网络断开和进程中断后维护记录能否恢复；旧包缓存是否能离线回滚。
- 页面、数据库、配置、今日 token 统计及正在进行的提炼任务在升级与回滚后的完整性。
- 将“安装成功、等待重启、升级已生效、自动补偿完成、回滚失败”分别展示与记录。
- 完整 Host 启动失败自动回滚在外部执行者方案明确前保持 `NOT_RUN`，不得计入插件内自动回滚通过项。

本研究没有重启用户 Desktop、没有安装真实用户配置档、没有实现自动升级或回滚、没有推送仓库或发布版本。安装入口修复及其本地验证已单独记录。
