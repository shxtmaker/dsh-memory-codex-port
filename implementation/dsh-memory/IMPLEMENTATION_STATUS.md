# 实施状态

实施规范：技术方案v1.1；预算按用户2026-10-04明确修订。当前版本：0.1.9，Host严格匹配0.2.0-rc.2。状态：**待完成验收**。

## 环境与版本

实际源码位于 `implementation/dsh-memory/`。匹配运行时 manifest/锁文件位于 `runtime-v0.2.0-rc.2/`。Windows实测Node24.19.0/npm11.17.0；实际Desktop/Host0.2.0-rc.2、bundled Node24.21.0。源参考提交5badb15009ae1756c3afe0ae0cef1faafc290ccc仅是参考，不用它代替实际版本核验。

0.1.5生产源码与原0.1.4一致。0.1.6修复后台原生日志服务依赖遗漏；旧固定模型测试另建Engine，不能证明插件自身后台链路通过。仍不扫描真实历史，不运行Codex，不改宿主核心，不安装到日常profile。原始证据保留在开发工作区，公开仓库只保留可共享摘录和源码哈希。

## T01–T23

DONE限定于下列实测范围，不能替代BLOCKED环境验收。

| 编号 | 阶段 | 状态 | 实现与证据范围 |
|---|---|---|---|
| T01 | P0 | DONE | 完整材料、参考截图、实际API、版本、仓库与工具链核查 |
| T02 | P0 | DONE | 原生bundle、lazy-CJS、settings.section；实际Web加载，Desktop安装通过 |
| T03 | P0 | DONE | 自有严格memory/invoke、挂载/卸载；Worker/SQLite/FTS5；实际Remote200 |
| T04 | P0 | DONE | 原生user/message、tool/result、持久化、SurfaceOp与卸载重放 |
| T05 | P1 | DONE | WAL/schema1、身份及未来版本拒绝、Worker生命周期和降级 |
| T06 | P1 | DONE | realpath/执行目标/持久UUID、严格工作树、会话作用域授权 |
| T07 | P1 | DONE | 事务CRUD/revision、不可变快照、重建和路径防护 |
| T08 | P1 | DONE | 中文n-gram、英文/代码词法索引、先范围过滤、24候选/3结果 |
| T09 | P2 | DONE | 有界元数据、原生flush/read、hash/seq、脱敏、水位线 |
| T10 | P2 | DONE | 空闲10分钟、8候选、并发1、租约/fence、3%加初始/人工额度、日上限、失败及重试计费 |
| T11 | P2 | DONE | Phase1严格schema、seq验证、空结果和保守状态；后台按能力选择off；0.1.8真实提炼PASS，0.1.9待验收 |
| T12 | P2 | DONE | Phase2差异基线、无差异不调用、受影响旧项、来源/epoch/revision校验；0.1.8真实整理FAIL，0.1.9修订协议待验收 |
| T13 | P3 | DONE | 原生pre-step；稳定策略；所有自动召回共用150ms |
| T14 | P3 | DONE | 原生memory search/read、顶层调用、/memory note/off |
| T15 | P3 | DONE | 累计共用1024、持久去重、一次turn、重启/压缩不重置、晚到回收 |
| T16 | P3 | DONE | 原生失效撤回；tool/result仅改正文、保持身份/meta；卸载重放 |
| T17 | P4 | DONE | 双开关、全局/项目卡片、覆盖、按需概览 |
| T18 | P4 | DONE | 分页列表、详情/来源、人工编辑、冲突保留草稿 |
| T19 | P4 | DONE | epoch确认清空、页内浏览、导出/复制；系统目录打开NOT_RUN |
| T20 | P4 | DONE | 当前代文件数/时间、分来源额度、手动补充、每日上限、状态、安全错误诊断、权限、连接刷新 |
| T21 | P5 | DONE | 防重生、未知usage暂停、路径/junction拒绝、存储故障前台放行 |
| T22 | P5 | BLOCKED | 已通过构建/类型、固定模型及实际Web；Desktop可见交互/真实模型/真实远程待验收 |
| T23 | P5 | DONE | 完整源码/锁文件/构建、本地tgz和源码zip、README、验收与SHA-256；双远端上传结果独立核验 |

## 已执行检查

- 0.1.4：build、typecheck、五个有界A2–A5用例、真实内核固定适配器闭环、真实Web管理与卸载重装PASS。
- 已装Desktop：真实exe/bundled pnpm的隔离安装与Remote200 PASS；登录后的可见页面BLOCKED。
- 0.1.5：生产源文件哈希与基线逐文件核对；必要构建、包安装和Remote核对。精确公开结果见 `docs/verification/distribution.json`。
- 0.1.6：build、typecheck、六项测试、test:host、实际候选包test:web及隔离卸载/重装PASS；真实远程监听仍被Host拒绝。生产源只有日志服务依赖声明变化。

## 阻塞与下一步

用户隔离Desktop0.1.8完整重启、页面和两次真实提炼已确认；真实整理仍因revision类型校验失败。0.1.9修订整理协议，并通过固定模型原生闭环及隔离Web；还需用户同一配置档升级、完整重启，验证真实整理、来源、新会话读取及完整管理交互。真实非loopback Host仍BLOCKED。不提高预算或改动权限来通过测试，不改写用户数据。

## 2026-10-04 来源访问修复

- 复现：`node tests/production-source.mjs` 在原生产包失败，任务为 `SOURCE_UNAVAILABLE`，未进入模型；探针报 `cannot get property "sessionPersistence" without inject`。
- 原始隔离日志副本可读取完整来源范围且hash一致，排除缺失日志和压缩解码不一致。
- 修复：`src/index.ts` 的inject加入 `sessionPersistence`，不改宿主或管理权限。
- 回归：新增生产插件上下文、默认zstd日志、一次提炼/一次整理用例；纳入 `npm test`。时钟前移和大usage只用于全新夹具home，不改用户credit。
- 检查：build、typecheck、五项原A2–A5及新增生产后台闭环PASS；test:host、test:web及隔离包安装/卸载/重装PASS。真实模型未调用，用户实例未升级或重启；原失败记录保留。
- 下一步：用户在同一隔离profile升级0.1.6，用新样本继续验收。credit不足时正确等待，不提高额度。分发包最终校验记录见 `docs/verification/distribution-0.1.6.json`。

## 2026-10-04 额度修订与模型诊断

- 用户选择：新配置档初始10000 tokens，已有配置档手动补充至10000；每日后台上限提高至100000。重启和刷新不补满，明确保存的旧日上限保留，页面可调整。
- 实现：新增credit_grants，初始绑定和额度授予同一事务；手动请求以UUID幂等、需明确确认、本机写权限且无运行中任务；未知usage暂停不能被补充解除。额度来源单独记录，日已用和重试次数不重置。
- 诊断：记录最近一次usage、结束原因和固定schema路径；细分MODEL_INVALID_JSON、MODEL_SCHEMA_FAILURE、MODEL_OUTPUT_TRUNCATED、MODEL_CALL_FAILURE。严格schema、来源/fence校验和重试上限保留，不保存模型正文。
- 已执行：build、typecheck、八项必要测试、test:host和实际候选包test:web PASS；新增额度/诊断用例已在原实现失败、修改后通过。实际页面确认旧配置档不自动授予、人工补充、每日100000及可修改、刷新/重启不补满。
- 页面回归：首次Web验收发现人工补充异步刷新期间可编辑每日上限，随后刷新覆盖输入；已在忙碌时禁用输入并重新验收通过，未放宽断言。
- 未执行：未升级用户实例、未补充用户实际credit、未读取凭证或由代理触发真实模型调用。真实校验失败具体原因仍待新诊断证据。
- 分发结果：最终包逐文件安装核对及实际Remote/Page结果见 `docs/verification/distribution-0.1.7.json`；双远端交付以仓库main和dist校验值为准。
- 下一步：用户在同一隔离配置档升级0.1.7，手动补充并受控重验真实提炼/整理；完成Desktop全部管理交互和正式支持的远程环境验收。

## 2026-10-04 用户重装后的验收基线

- 用户报告已重装。只读核查当前Desktop主进程及Host使用既有隔离 `desktop-YMA7EY` home、desktop profile和独立Electron user-data-dir；已安装插件manifest为0.1.7，Host要求0.2.0-rc.2，SQLite存在credit_grants新表。
- 当前记忆配置档仍为desktop-fixture，credit为1217.72、今日已用1453、paused为0，初始/人工授予记录为空。重装未自动补满，符合已有配置档迁移规则。
- 用户已保存的dailyTokens为20000，projectUse为true、projectGenerate为false；全局读取和生成关闭。旧SOURCE_UNAVAILABLE失败保留，旧格式重试及待执行任务已经取消，没有本轮新任务。
- project-A仍指向用户建立的manual-acceptance隔离目录，未清空数据库、改写配置、补充额度、触发模型或重新安装日常profile。
- 当前0.1.7安装基线已确认；完整页面操作及真实模型闭环NOT_RUN，既有0.1.6模型失败证据不改为通过。
- 下一步：用户在高级页面手动补充至10000并保存每日100000，启用项目自动生成，建立一条不使用工具、不修改文件的短样本；按任务、条目来源、新会话读取的顺序继续验收。

## 2026-10-04 重装后严格Remote边界错误

- 用户截图：每日100000已经生效，当前credit1450、manualGranted为0，新extract等待额度；点击人工补充后出现 `typert gateway: memory/invoke: wire field "request" failed boundary validation`。
- 只读核查：已安装index/client/typert.host/typert.remote-client与0.1.7分发构建的SHA-256一致，新动作及requestId声明存在；当前Desktop Host仍为包重装前启动的同一进程。
- 复现命令：`node tests/upgrade-boundary.mjs`。使用全新隔离home、实际官方Host/pluginManager和0.1.6→0.1.7包，得到restart-required；未重启时相同补充请求被旧严格接口拒绝，复现完全相同错误。完整重启后相同请求成功，credit/manualGranted为10000，initialGranted为0，原账本保留，模型调用为0。
- 结论：升级需要完整Host重启。先前仅确认磁盘版本和新表不能证明运行接口已更新；已补充A1/A5验收及安装说明，不修改宿主、生成schema、权限或预算以绕过校验。
- 实际隔离Web升级/重启测试PASS；用户Desktop完整重启、新补充及真实模型仍待验收。未关闭用户应用、改写用户数据库、补充实际额度或触发真实模型。
- 后续上传只使用Gitea；GitHub必须有用户新的明确指示。当前0.1.7安装包保持原哈希，问题处理是完整重启，不需要再次安装相同包。

## 2026-10-04 真实截断及后台推理修订

- 用户完整重启后Host进程已更换，截图及只读账本确认manualGranted=8549.63、credit=10000、dailyTokens=100000；旧已用1453未重置。运行接口及额度管理PASS，旧边界错误保留。
- 新真实extract及一次重试均输出截断，attempts=2、error=MODEL_OUTPUT_TRUNCATED、modelFinish=max-tokens、最近一次usage=1376；共结算2752，当前credit7248、日已用4205、paused=0。任务已failed，没有继续自动重试；未保存响应正文或私有推理。
- 实际rc.2官方模型能力默认包含High和off，序列化会把off映射为disabled。旧后台只传maxTokens，继承适配器默认推理；不能仅凭旧记录断言推理是实际截断的唯一原因。
- 红绿回归：`node tests/production-source.mjs --reasoning-regression` 通过实际插件上下文复现MODEL_OUTPUT_TRUNCATED；新增能力查询及显式off选择后，提炼/整理各一次成功、输出上限1024不变、前台High不变。未声明off的普通固定适配器闭环继续通过。
- 实现仅修改后台调用配置：使用Host实际公开的resolveModelInfo和prepareCall；不改供应商、路由、宿主、schema、额度、重试上限或失败计费。初次构建误用了适配器的resolveModel名称，TS2551拒绝；核对Host声明后更正为resolveModelInfo并构建通过。
- 版本0.1.8：build、typecheck、九项必要测试、test:host及实际候选包Web均通过。最终分发核查记录见 `docs/verification/distribution-0.1.8.json`。
- 未读取凭证、安装用户实例、追加用户额度或由代理触发真实模型；用户0.1.7真实失败仍为FAIL。0.1.8升级、真实提炼/整理及完整Desktop管理交互NOT_RUN，真实远程环境BLOCKED。
- 下一步：交付0.1.8源码及安装包，仅上传Gitea；用户同一隔离配置档升级、完整重启，用一条新短样本受控重验。已有失败任务不重置尝试次数，不扫描历史。

## 2026-10-04 0.1.8安装后尚未重启的样本

- 0.1.8源码包和安装包已上传Gitea，commit为115b3a9；远端main、tgz及source.zip的哈希核对PASS，GitHub未更新。
- 用户新截图再次出现extract等待重试、MODEL_OUTPUT_TRUNCATED及max-tokens。只读核查新任务attempts=1、实际usage=1369、credit=6111.47、今日已用5574、paused=0；旧失败记录保留。
- 磁盘manifest为0.1.8且包含off选择代码，插件文件修改时间为本地12:19。当前Desktop/Host仍是本地11:10启动的同一进程，早于本次升级；不能把磁盘版本当作修订代码运行证据，也不能把该样本归为0.1.8修订策略已验证失败。
- 立即建议用户关闭项目自动生成以阻止待执行重试，随后完全退出并以同一隔离home、desktop profile和Electron user-data-dir重启；不需要再次安装或补充额度。
- 尚未由代理修改用户配置、取消任务、重置attempts、追加额度或触发真实模型。用户关闭开关、完整重启后的新Host进程与真实0.1.8闭环仍NOT_RUN。

## 2026-10-04 真实提炼通过与整理协议修订

- 用户已完整重启，Host 启动时间为本地12:36，晚于0.1.8安装；同一隔离home/profile中的两次真实提炼成功，finish=stop，attemptUsage分别为468、447。先前1369截断保留，不抹除失败账单。
- 真实整理仍失败：MODEL_SCHEMA_FAILURE，changes.0.revision:invalid_type，最近两任务的最终尝试用量625、971；前一个attempts=2已failed，后一个在关闭生成后已cancelled。仅人工编辑条目存在，不能当作自动整理成功。只读账本为credit3207.94、今日已用8710、paused=0。
- 红色复现：node tests/production-source.mjs --consolidation-contract，实际插件上下文及原生日志链路报同一MODEL_SCHEMA_FAILURE和字段路径。null revision为合成模型夹具；真实响应未保存，不能断言其实际值为null。
- 修订：原整理提示将操作类型和字段混在非合法JSON示例中；改成add/update/revoke各自合法JSON，并明确新增不含id/revision、更新撤销复制旧记录正整数revision。schema、权限、来源校验、fence、重试上限及计费保持原样。
- 当前红绿复现、build、typecheck、九项必要测试、test:host及实际0.1.9候选包Web已通过；最终分发包核对见docs/verification/distribution-0.1.9.json。真实模型及用户升级NOT_RUN。未读取凭证、修改用户配置/数据库、补充实际credit或触发真实模型。
- 下一步：完成0.1.9构建/必要A1–A5、最终包核对及Gitea分发；用户同一隔离配置档升级、完整重启后用一条新短样本重验整理与新会话读取。

- 打包准备中一处文档更新命令误用插件目录而非仓库根目录，报ENOENT；已更正工作目录。未发布的初次打包保留为pre-docs候选，分发包重新生成并单独核对。

- 最终分发包核对PASS：30个安装文件逐字节一致，23个构建文件与已验收候选一致；实际设置页及Remote200通过。最终包SHA-256为c1cc197c370f7c9c1c8ee614a698cda1d23eb2cfb49a50aa154b82edfbf398c2。0.1.9真实Desktop升级、整理和新会话命中仍NOT_RUN；历史真实整理FAIL保留。

- 0.1.9源码、锁文件、README、安装包和完整源码包已上传Gitea，分发commit为6f3a45e1fdf25d1e31e0074fdebab54f65c956a1。远端main及两个分发文件SHA-256核对PASS；源码包73个文件及清单逐项哈希通过。GitHub仍为fbdb92e，未推送。
- 当前下一步仅为用户操作：保持生成关闭完成同一隔离配置档的0.1.9升级及完整Host重启；必要时手动补充至10000，再启用项目生成，用一条新短样本验证consolidate、自动条目来源与新会话读取。旧任务尝试、实际费用、人工更正和失败记录保留。真实Desktop完整管理与真实远程仍待完成验收。
