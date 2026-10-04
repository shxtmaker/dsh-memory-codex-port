# 实施状态

实施规范：技术方案v1.1；预算按用户2026-10-04明确修订；用户同日明确远程暂未启用、暂不纳入本轮。当前版本：0.1.9，Host严格匹配0.2.0-rc.2。状态：**本轮本机范围必要验收PASS**。跨机器远程及WAN为NOT_RUN、本轮范围之外。

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
| T11 | P2 | DONE | Phase1严格schema、seq验证、空结果和保守状态；后台按能力选择off；0.1.8及0.1.9真实提炼PASS |
| T12 | P2 | DONE | Phase2差异基线、无差异不调用、受影响旧项、来源/epoch/revision校验；0.1.8真实整理FAIL保留，0.1.9真实整理及新会话召回PASS |
| T13 | P3 | DONE | 原生pre-step；稳定策略；所有自动召回共用150ms |
| T14 | P3 | DONE | 原生memory search/read、顶层调用、/memory note/off |
| T15 | P3 | DONE | 累计共用1024、持久去重、一次turn、重启/压缩不重置、晚到回收 |
| T16 | P3 | DONE | 原生失效撤回；tool/result仅改正文、保持身份/meta；卸载重放 |
| T17 | P4 | DONE | 双开关、全局/项目卡片、覆盖、按需概览 |
| T18 | P4 | DONE | 分页列表、详情/来源、人工编辑、冲突保留草稿 |
| T19 | P4 | DONE | epoch确认清空及页内浏览真实Desktop PASS；真实Desktop复制路径、当前空快照导出及复制路径后Windows文件资源管理器浏览PASS；插件不提供直接目录打开按钮 |
| T20 | P4 | DONE | 当前代文件数/时间、分来源额度、手动补充、每日上限、状态、安全错误诊断、权限、连接刷新 |
| T21 | P5 | DONE | 防重生、未知usage暂停、路径/junction拒绝、存储故障前台放行 |
| T22 | P5 | DONE，本轮本机范围 | 本地构建/类型、固定模型、实际loopback Web、真实Desktop记忆/管理及复制导出/系统目录降级验收PASS；用户明确跨机器远程及WAN暂不纳入，记为NOT_RUN |
| T23 | P5 | DONE | 完整源码/锁文件/构建、本地tgz和源码zip、README、验收与SHA-256；0.1.9已完成Gitea交付，本次按用户明确要求同步GitHub；后续仍默认仅Gitea |

## 已执行检查

- 0.1.4：build、typecheck、五个有界A2–A5用例、真实内核固定适配器闭环、真实Web管理与卸载重装PASS。
- 已装Desktop：真实exe/bundled pnpm的隔离安装与Remote200 PASS；登录后的可见页面BLOCKED。
- 0.1.5：生产源文件哈希与基线逐文件核对；必要构建、包安装和Remote核对。精确公开结果见 `docs/verification/distribution.json`。
- 0.1.6：build、typecheck、六项测试、test:host、实际候选包test:web及隔离卸载/重装PASS；真实远程监听仍被Host拒绝。生产源只有日志服务依赖声明变化。

## 当前范围与交付状态

0.1.9本地核心验收PASS：真实提炼/整理/新会话、重启读取、A/B隔离、全局共享，以及保存修改、页内文件浏览、两级使用关闭且保留数据、单条删除、来源删除和project-A作用域清空均有实际证据。既有必要A1–A5自动化检查继续有效。当前隔离project-A有效条目0，项目使用开启、全局使用关闭、两级生成关闭；旧原生日志、实际费用和证据账本保留。

真实Desktop复制路径、当前空快照导出及复制目录后在Windows文件资源管理器浏览已实测PASS。用户明确远程暂未启用、暂不纳入，因此T22在本轮本机范围内为DONE；真实跨机器远程和WAN为NOT_RUN，不宣称通过。A1要求的本机Remote RPC及A2作用域越权/只读限制证据仍保留。不新增远程监听、服务或授权，不再重复本地模型调用。本次仅更新记录，原0.1.9安装包和源码包哈希保持不变，包内文档仍为构建时状态。

下列按时间排列的实施日志保存当时的版本、失败和缺口；当前结论以上述范围和最新验收记录为准。

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

## 2026-10-04 0.1.9用户真实主链路通过

- 用户在同一隔离home安装0.1.9，Desktop/Host于本地15:40完整重启，晚于15:11插件构建文件更新；仍为Host0.2.0-rc.2。
- 真实extract与consolidate均attempts=1、succeeded、finish=stop，分别结算500、1555 tokens。自动项目条目含MEM-A-019，manual=false、revision=1、status=suggested、有有效来源；不自动提升为目录已创建或业务已验证。
- 新会话memory_usage记录了该条目和另一项目条目，总计824/1024、reserved=0。用户回答引用约定，截图确认详情、来源与Markdown快照文件列表，真实主链路PASS。
- 按同一生产索引规则只读核查，集成测试、tests/integration、MEM-A-019三个查询均命中同一条目，该revision已在本次会话提供；空工具返回与同会话去重一致，不表示数据库无记录。未捕获实际工具返回轨迹，不将归因推断冒充逐次工具调用实测。
- 当前空project-A/B为隔离验收目录，不创建测试代码来证明记忆。正常重启后的持久化、真实A/B及全局隔离、保存/文件内容浏览/清空等真实Desktop操作仍NOT_RUN；真实非loopback仍BLOCKED。
- 仅更新验收与说明，0.1.9安装包、源码包保持原哈希。未读取凭证、触发真实模型、修改用户配置/数据库或追加实际credit。后续只上传Gitea。

## 2026-10-04 0.1.9真实正常重启读取通过

- 用户按只读记忆问题返回tests/integration、MEM-A-019和原条目id@1；同时正确区分另一条数据库约定。本次不检查或修改项目文件。
- 当前Desktop/Host均于本地16:04重新启动，晚于自动记忆15:52生成；同一隔离home/profile和Electron user-data-dir。项目生成已关闭、使用保留，全局读写关闭。
- 只读核查原条目revision=1、来源和创建/更新时间未变化；新增会话已结算该条目及另一项目条目824/1024，reserved=0。正常重启持久化与新会话读取PASS。
- 真实项目B、全局共享及剩余Desktop管理仍NOT_RUN；下一步由用户在project-B新建会话，保持全局关闭，验证不返回project-A约定。代码和安装包不变，复用既有构建及必要测试；只上传Gitea验收文档。

## 2026-10-04 0.1.9真实项目A/B隔离通过

- 用户截图显示当前工作区为project-B，使用同一隔离Host/配置档的新会话；按记忆查询集成测试约定，结果为空，未返回A路径、MEM-A-019或A来源。
- 只读数据库确认A/B真实目录对应不同项目UUID、同一执行目标；B记忆数为0，集成测试、测试路径、验收、MEM-A-019索引查询均无B命中。B会话账本reserved=0、settled=0，memory_usage没有A记录用于B。结合A正向召回证据，真实项目隔离PASS。
- 当前全局读取/生成均false，项目使用true、生成false。此次仅验收项目隔离，不能推断全局存储为空或全局共享通过。
- 下一步：用户仅启用全局使用、保持两级生成关闭，在页面手动保存一条全局偏好，然后A/B各自新会话核对共享；复用此次页面保存操作作为A1手动记忆证据。代码、锁文件和包不变，不重复构建/模型提炼。

## 2026-10-04 0.1.9真实全局共享及人工保存通过

- 用户在隔离Desktop中保存并修改全局偏好：回答先给结论，验收标识MEM-G-019。只读核查条目scope=global、manual=true、pinned=true、status=observed、revision=2，并有两次save审计记录；人工保存与修改PASS。
- 用户截图显示project-A和project-B的不同新会话均返回该全局偏好与标识。两会话memory_usage均结算相同global条目id@2；A还包含当前A的两条项目记忆，共用988/1024，B仅global为270/1024，无A项目记录进入B。真实全局共享PASS。
- A模型回答将a23fb236作用域描述为另一个项目，该UUID实际属于当前project-A。此句为模型表述错误，不能作为插件串用证据；数据库的项目映射及B账本支持既有隔离结论。
- 当前全局和项目use均true、generate均false，consent=true、每日上限100000；未触发后台模型、调整额度、修改用户数据、创建项目文件或重新打包。
- 下一步：由用户验证页内MEMORY.md正文，关闭全局使用但保留条目，并在project-B新会话验证不召回；随后仅在隔离测试范围验证删除及清空。整体仍待完成验收，真实远程仍BLOCKED。仅更新验收文档并上传Gitea，原安装包及源码包哈希不变。

## 2026-10-04 0.1.9真实全局使用关闭后保留数据通过

- 用户在project-B的新会话中仅按当前可用记忆查询全局偏好及标识，截图显示没有相关可用记忆，未返回MEM-G-019或原偏好。问题未携带待验证答案。
- 只读配置确认globalUse=false、globalGenerate=false、projectUse=true、projectGenerate=false；原global人工条目仍为相同id@2、status=observed、manual/pinned=true，创建及更新时间均未变。关闭使用没有删除条目。
- 最新独立会话的直接证据reserved=0、settled=0，memory_usage没有该会话记录；结合先前启用全局使用的正向召回，本项PASS。未捕获逐次工具响应轨迹，不把模型所述每个查询都作为独立实测。
- 文件内容浏览尚无对应用户结果，仍NOT_RUN；项目使用关闭、删除与清空也待验证。代理没有读取凭证、修改实际配置/数据库、触发真实模型或重新打包。验收文档仅上传Gitea。

## 2026-10-04 0.1.9真实Desktop页面内文件正文浏览通过

- 用户截图显示全局记忆浏览窗口中的Markdown正文，包含全局验收偏好、回答先给结论、MEM-G-019、observed、人工保存及revision2；不只是文件名称列表。
- 只读核查globalUse=false、两级generate=false。截图中的快照代目录与SQLite当前global快照一致，MEMORY.md存在于快照允许列表；实际137字节正文的标题、偏好、标识、来源、revision和状态均核查通过，文件SHA-256为e6f7e7f438b11d8c2d763c6d6810840804ae9d5d990dd110d81ad4ab401017f5。
- A1真实Desktop页面内文件内容浏览PASS，并补充关闭使用仍可在页面浏览持久数据的证据。此项不代表系统文件管理器、复制路径或导出操作已经在真实Desktop执行。
- 下一步由用户保持全局使用关闭及两级生成关闭，关闭项目使用后在project-A新会话验证不召回；随后仅在隔离测试范围验证删除和清空。整体仍待完成验收，真实非loopback环境仍BLOCKED。
- 本次仅只读核查及验收文档更新；未读取凭证、修改用户配置/数据库、追加credit、触发真实模型或重打包。文档只上传Gitea。

## 2026-10-04 0.1.9真实项目使用关闭后保留数据通过

- 用户按project-A新会话步骤提供回答：当前可用记忆不包含集成测试路径或验收标识，未返回tests/integration或MEM-A-019，未读取项目文件。仅有用户提供的回答，不将其自述的四次检索视为独立捕获的工具返回证据。
- 只读配置确认globalUse=false、projectUse=false，两级generate均false；A项目use/generate覆盖为null，继承关闭的默认。最新独立会话直接证据reserved=0、settled=0，memory_usage记录数为0。
- A的集成测试及数据库约定仍为原id@1、status=suggested，创建及更新时间均为1791100337876，来源仍保留。关闭项目使用没有删除原自动记忆；结合先前A正向读取，本项PASS。
- 下一步由用户仅在当前隔离配置档删除全局人工验收条目，启用全局使用但保持两级生成关闭，在project-B新会话确认删除后不召回；随后完成来源删除和项目作用域清空。整体仍待完成验收，真实非loopback Host仍BLOCKED。
- 本次仅只读核查和验收文档更新；未修改用户配置/数据库、读取凭证、触发真实模型或重新打包。文档仅上传Gitea，包哈希不变。

## 2026-10-04 0.1.9真实单条删除及删除后不召回通过

- 用户完成全局人工验收条目删除并重新启用全局使用后，提供新会话回答：没有相关全局偏好与验收标识。用户自述六次检索均空，未捕获逐次工具返回，不将每次检索独立记为实测。
- 只读核查globalUse=true、projectUse=false、两级generate=false。目标条目由原observed/id@2变为expired/id@3，删除时刻1791104073682对应remove审计；全局有效条目为0，新一代MEMORY.md仅含1字节换行，正文为空。
- 最新独立会话直接证据reserved=0、settled=0，memory_usage记录数0。A的集成测试和数据库条目仍为原id@1、原更新时间及1/2个来源。单条逻辑删除、快照更新、删除后不召回与项目条目保留PASS，不宣称物理擦除或旧会话历史消失。
- 下一步仅在隔离project-A浏览集成测试条目，删除其唯一来源；该来源不属于数据库约定，后者应保留。两级生成持续关闭，启用项目使用并以新会话确认集成测试约定不再召回，再完成项目作用域清空。
- 来源删除和作用域清空仍NOT_RUN；整体仍待完成验收，真实非loopback Host仍BLOCKED。本次未修改实际配置/数据、读取凭证、触发真实模型或重打包，文档仅上传Gitea。

## 2026-10-04 0.1.9真实来源删除及无关条目保留通过

- 用户按隔离project-A来源删除步骤提供新会话回答：未发现集成测试约定，但可准确返回数据库访问代码的repositories和MEM-A-1004，并区分主题及suggested状态。
- 只读核查projectUse=true、globalUse=false、两级generate=false。集成测试唯一来源f72d1543对应remove-source审计及A作用域tombstone，A epoch由5增至6，对应提炼输入数为0；原来源段元数据仍保留，不宣称聊天原始数据被删除。
- 集成测试条目由id@1变为expired/id@2、sources为空；数据库条目仍为原id@1、suggested、原创建/更新时间及两个来源，新快照文件列表已移除被删除来源的rollout摘要。
- 新会话直接证据reserved=0、settled=498/1024，仅结算数据库条目id@1，没有集成测试条目usage。来源逻辑删除、相关记忆失效、未影响数据库条目及新会话区分主题PASS；逐次工具响应未捕获，不补造工具实测证据。
- 下一步仅在当前隔离配置档清空project-A记忆作用域，保持项目使用开启、全局使用关闭及两级生成关闭；确认卡片有效条目为0，再以新会话验证数据库约定不再召回。其后按实际证据关闭本地验收，真实非loopback Host仍BLOCKED。
- 作用域清空仍NOT_RUN，整体仍待完成验收。仅更新README、验收及状态和公开摘录，原包哈希保持；未修改用户配置/数据库、读取凭证、触发真实模型或重打包，文档仅上传Gitea。

## 2026-10-04 0.1.9真实作用域清空通过，本地核心验收关闭

- 用户按project-A清空步骤提供新会话回答：数据库访问目录与验收标识均无可用记忆，未读取项目文件。未将用户自述的六次检索各自作为捕获的工具返回证据。
- 只读核查projectUse=true、globalUse=false、两级generate=false。project-A epoch6→7，有clear审计1791106002807；有效条目和提炼输入均0。原数据库条目变为expired/id@2，集成测试条目保持此前expired/id@2。
- 当前代memory_summary.md、MEMORY.md、raw_memories.md正文均空，各1字节换行。清空前12段来源均有覆盖end的排除水位线；新增问答来源发生在清空之后，不属于旧来源。
- 新会话已在project-A原生会话目录确认，证据reserved=0、settled=0、usage数0；前一会话498/1024及usage保留。三份原始样本和上一问答的session.v4.jsonl.zstd仍存在且非空；仅核查存在与大小，未解码原始正文或承诺磁盘擦除。
- A1/A3真实作用域清空及新会话不召回PASS，本地核心手动验收已完成。必要构建/类型及A1–A5自动化证据复用，不重新调用真实提炼/整理，不重打包。
- 完整验收仍待完成：真实非loopback Host BLOCKED；系统文件管理器、真实Desktop复制/导出、WAN NOT_RUN，页内浏览降级已通过。T22保留BLOCKED，不宣称全环境通过。仅更新文档并上传Gitea，GitHub和原包保持原状态。

## 2026-10-04 真实Desktop复制、导出与本轮范围关闭

- 在唯一正在运行的隔离Desktop窗口中，通过实际设置页点击全局记忆浏览、复制路径和导出Markdown。复制后的剪贴板与当前global快照代目录一致；export生成文件和审计时间1791106926218。导出文件为1字节换行，SHA-256与当前MEMORY.md完全一致；只补充空快照的Desktop导出证据，不声称重新执行了有内容样本导出。
- 将插件复制的普通目录路径粘贴到Windows文件资源管理器地址栏，实际显示三个Markdown文件。此为系统目录浏览的降级流程，插件未新增revealStore或直接打开按钮。电脑操作随后被用户Escape中止，没有继续发送UI输入。
- 用户明确“远程暂未启用，暂不纳入”。本轮范围为Windows本机Desktop和loopback Web；真实跨机器远程及WAN保持NOT_RUN，不再作为T22放行阻塞。官方CLI明确拒绝的是0.0.0.0监听，历史该次拒绝不能推导为所有远程连接均不可用。未改变监听、trusted-host、认证或权限。
- 本轮本机必要验收PASS，T01–T23在表述的本机范围内DONE。构建/类型检查和必要A1–A5复用已有效证据；不重新调用真实模型、不扩大测试矩阵。新增公开摘录见docs/verification/desktop-copy-export-0.1.9.json及acceptance-scope-0.1.9.json；旧失败、计费和历史摘录保持。
- 本次只修改README、ACCEPTANCE、IMPLEMENTATION_STATUS及公开验收摘录；导出产生一个隔离文件和export审计，记忆条目、profile、额度和生产代码不变。0.1.9安装包及完整源码包保持原哈希，包内文档为打包时状态。文档仅上传Gitea，GitHub不更新。
- 文档补录的一次补丁因插件README使用绝对链接而上下文不匹配，读取实际内容后修正，未写入部分补丁。`git diff --check`、两份新增JSON解析及发布边界检查、两份原分发包大小/SHA-256核对均PASS；没有生产源码或锁文件变更，不重复运行构建或模型测试。

## 2026-10-04 本次GitHub同步授权与范围

- 用户明确要求“同步上传至GitHub”。本次将已核验的Gitea main内容同步至既有GitHub仓库shxtmaker/dsh-memory-codex-port，并补记本次授权。同步包括0.1.9源码、锁文件、README、验收记录、可安装tgz、完整源码zip及SHA-256；不新增版本、tag或Release，不重打包。
- 同步前工作树干净，Gitea main为5f79dc3f1ea35f20cb4f955b9df641280561146d；GitHub main为fbdb92efb177c304fc35723d562cac3868c3ce13。以普通快进push同步，保留历史，不强推。
- “后续默认只上传Gitea，明确提出再上传GitHub”的偏好保持；本次明确授权只适用于此次同步。前述GitHub保留旧版与Gitea单独发布的日志为历史时点记录。真实跨机器远程及WAN仍未验收，本轮本机范围必要验收PASS。
