# 验收记录

## V0.2.0（2026-10-04）

移除报警配置、阈值保存和超额提示，改为按执行主机本地自然日累计后台逐次实际token用量，统计位于原用量说明位置。提炼、整理、失败与重试分别计量，通过任务id及租约fence唯一标识防止重复结算。未知用量不计入总量，单独提示次数。无模型整理不计调用，统计与最新30条任务展示独立，清空记忆不删除消耗记录。只读概览按允许作用域在Worker内聚合，不泄露其他项目合计。

逐次表为usage_attempts，新增表和索引按幂等方式建立，schema保持1。旧usage_alerts及旧额度表已有数据保留，不参与显示或统计；不以不完整旧任务最近用量回填历史。旧alarmTokens不再参与运行。统计按结算时刻归属自然日，使用日历递增处理夏令时，页面可见时每10秒更新。

本轮构建、类型检查、15项自动化检查、固定模型原生Host闭环及实际隔离loopback Web验证的结果见docs/verification/iteration-0.2.0.json。真实Desktop、真实供应商调用及跨机器远程为NOT_RUN。用户自行重启，日常Desktop未安装或重启。本轮经用户明确授权提交、打V0.2.0标签并上传GitHub和Gitea；远程结果单独记录。

## 0.1.13 本地迭代（2026-10-04）

按照同行按钮上下对齐的要求，明确固定操作按钮的最小与最大高度为36px，禁止按钮文本换行与横向压缩；行内输入控件使用相同高度限制并居中。供应商、模型与保存按钮以及报警输入与保存按钮保持顶边、底边一致，保留原有单行布局与列宽。记忆卡片的浏览、清空按钮同时检查上下边界。

验证包括构建、类型检查、实际隔离loopback Web页面几何检查和保存持久化，以及最终安装包逐文件核对。真实Desktop、真实供应商调用与跨机器远程为NOT_RUN。用户自行重启验证，当前Desktop未安装或重启，未提交、推送或发布。验证结果见docs/verification/iteration-0.1.13.json。

## 0.1.12 本地迭代（2026-10-04）

供应商与模型的标签、选择框及保存按钮调整为单行；报警阈值标签、输入框、tokens单位及保存按钮调整为单行。两行保存按钮共用右侧132px列，所有控件垂直居中，保持宿主字体与36px高度。报警输入保留完整无障碍名称，选择器继续使用宿主已配置目录。

本轮验证包括构建、类型检查、隔离原生Host夹具准备、实际loopback Web布局与原有功能检查，以及最终安装包逐文件核对。Web检查两行高度、标签与控件的中心位置、行内边界和保存按钮对齐。真实Desktop、真实供应商调用与跨机器远程为NOT_RUN，用户稍后自行重启验证。未修改或重启日常Desktop，未提交、推送或发布。验证结果见docs/verification/iteration-0.1.12.json。首次几何检查发现报警输入的通用上边距导致行高42px，随后提高行内控件样式的选择器优先级；修复后重新构建和验证，保留首次失败，不降低36px行高与居中断言。

## 0.1.11 本地迭代（2026-10-04）

本轮增加仅有官方路由时的默认选择，优先已配置API Key的deepseek-official，只有可用官方账号时使用deepseek-account。默认模型取宿主目录首项；已有有效显式选择保留。凭证只调用describe查询configured，不读取、导出或打印值。第三方路由不自动选择；失效旧路由的许可不自动迁移到默认路由。

字体、字号和行高参照宿主模型设置页：正文14px/22px、标题16px/24px、说明12px/18px；按钮和输入控件36px。路由保存与报警阈值保存共用右侧132px列，并与对应输入控件底部对齐。调整仅作用于记忆页。

构建、类型检查、13项自动化检查以及原生Host闭环通过；默认官方账号和API的生产插件上下文闭环使用固定适配器与合成凭证状态，不能作为真实官方调用证据。实际隔离Web检查字体与宿主导航一致、两个按钮的坐标与尺寸，并核对原有功能。最终包通过独立路径安装和逐文件核对。0.1.11真实Desktop、真实官方调用与跨机器远程为NOT_RUN。用户明确稍后自行重启验证，本轮未重启当前Desktop、未安装到其profile，未提交、推送或发布。

升级必须完整重启Host。0.1.9→0.1.10的实际隔离升级测试在restart-required阶段复现wire request boundary validation，重启后新增请求恢复；不能通过刷新页面代替。0.1.10旧包和证据保留。回滚使用旧包、升级前完整数据目录与profile备份。


## 0.1.10 本地迭代（2026-10-04）

本轮按用户四项要求修改供应商与模型选择、后台单次报警、设置页图标和最新状态默认显示。构建、类型检查、9项自动化检查、原生Host闭环及实际隔离loopback Web页面通过；固定模型和合成用量不作为真实供应商证据。0.1.10真实Desktop和真实模型为NOT_RUN，跨机器远程不纳入本轮。当前仅交付本地候选，未安装到日常profile，未提交、推送或发布。

后台额度、3% credit、手动补充与日上限已停止使用，旧表保留为历史数据。新alarmTokens默认10000，整数范围1–1000000；每次调用使用开始时的阈值，实际usage严格超过阈值时记录页内报警，未知usage独立提示，两种情况均不暂停后续任务。并发1、空闲期、租约、生成开关、来源epoch和一次格式重试保持有效。前台1024证据边界保留。会话计量按最近计量更新时间排序，extract按最近状态更新时间排序；历史可展开。

Web初次测试在配置保存尚未完成时读取了旧route，后续改为轮询宿主实际route与配置文件，验证重启后的持久值。重复执行中出现隔离夹具目录EEXIST，已改为每次使用独立配置档名称。原失败保留在本轮验证记录；未降低保存与重启断言。

验证和截图见docs/verification/iteration-0.1.10.json及docs/screenshots/web-iteration-0.1.10.png。回滚应恢复旧包和升级前完整数据与profile备份；旧版已完成的真实验收仅说明对应版本。

## 0.1.9 历史记录


结论：**本轮本机范围必要验收PASS**。当前版本为0.1.9，实际Windows Desktop及Host为0.2.0-rc.2。真实提炼、整理、新会话召回、重启读取、项目A/B隔离、全局共享、保存与修改、页面内文件浏览、两级使用关闭且保留数据、单条删除、来源删除及project-A作用域清空均已通过。真实Desktop复制路径、当前空快照的Markdown导出及复制目录后在Windows文件资源管理器浏览的降级流程也已通过。用户于2026-10-04明确远程暂未启用、暂不纳入；真实跨机器远程及WAN记为NOT_RUN，不作为本轮放行门槛。旧版本真实失败、固定模型与Web证据分别保留。

## 实际环境

- Windows；Node 24.19.0、npm 11.17.0；CLI 包管理使用 Host pnpm 11.19.0。
- npm Host 与实际已装 Desktop/desktop-runtime/Host 均为 0.2.0-rc.2；Desktop bundled Node 24.21.0。
- 测试只使用隔离 DSH_HOME、profile、Electron user-data-dir 和合成 project-A/project-B。
- 原始测试日志在开发工作区保留。公开摘录移除了本机绝对路径，不上传测试数据库、原生日志正文、访问令牌、配置备份或日常凭证。
- 自动化验收使用固定模型；0.1.9真实模型验收由用户操作。此前的来源不可用、格式失败、输出截断及费用全部保留。0.1.9新增extract/consolidate实际计费500+1555，该次真实闭环核查时账本今日已用10765、credit9809.68、paused=0；未自动补充或退还实际费用。未读取用户凭证、购买额度、扫描真实历史、修改宿主核心或安装到日常profile。

## 构建与 A1–A5

表内数值与条目状态对应各次验收时点；历史PASS不表示相关条目当前仍有效。清空后的当前状态见最新作用域清空证据。

| 项目 | 状态 | 实际证据范围 |
|---|---|---|
| 插件构建 / 类型检查 | PASS | rc.2 官方严格 Typert、Host、SQLite Worker、lazy-CJS Client |
| A1 Web 安装与页面 | PASS | 实际包安装、页面、Remote、双开关、来源、编辑、revision 冲突、文件浏览、导出、清空 |
| A1 Desktop 安装与 Remote | PASS | 真实已装 exe、Electron Node-mode、bundled pnpm、独立 desktop profile、memory Remote 200 |
| A1 Desktop 可见页面 | PASS，用户截图 | 用户隔离 Desktop 0.1.4 的记忆高级页面可见；不代表全部管理操作已验收 |
| A1 Desktop 0.1.7 磁盘安装 | PASS，用户操作及只读核查 | 当前隔离Desktop profile已安装0.1.7，实际SQLite存在新额度表；磁盘文件与分发构建一致，既有账本未自动补满 |
| A1 Desktop 0.1.7 运行接口更新 | PASS，用户操作及只读核查 | 保留未重启时的request边界失败；用户完整重启后Host进程已更换，同一隔离home中人工补充成功 |
| A1 Desktop 0.1.9 升级、列表、详情与来源 | PASS，用户截图及只读核查 | 磁盘0.1.9，Host于本地15:40完整重启；自动条目、revision1、来源及Markdown文件列表可见，不代表全部管理操作通过 |
| A1 Desktop 0.1.9 人工保存与修改 | PASS，用户操作结果及只读核查 | 全局manual/pinned条目持久化为revision2、status=observed，并有两次save审计记录；A/B新会话均使用相同id@2 |
| A1 Desktop 0.1.9 页面内文件内容浏览 | PASS，用户截图及只读文件核查 | 全局MEMORY.md正文显示偏好、MEM-G-019、observed、人工来源及revision2；截图代目录与当前SQLite快照一致，137字节文件对应内容核查通过；globalUse仍false |
| A1 Desktop 0.1.9 清空 | PASS，用户操作结果及只读核查 | project-A的clear审计已保存，有效条目0，当前代三个Markdown正文均空；新会话不返回已清空的数据库约定 |
| A1 Desktop 0.1.8 磁盘安装与重启 | PASS，用户操作及只读核查 | 已安装0.1.8，Host于本地12:36完整重启，晚于12:19插件文件更新；同一隔离home/profile |
| A1 实际非 loopback Host | NOT_RUN，本轮范围之外 | 用户明确暂不纳入；历史CLI拒绝0.0.0.0监听的记录保留，该结果不代表所有远程连接均被拒绝。未改变监听、信任或授权条件 |
| A2 原生日志闭环 | PASS，固定模型 | 实际 AgentLoop、持久日志、提炼、整理、新会话命中、重启、中文/代码检索、A/B 与全局隔离 |
| A2 真实提炼→整理→新会话召回 | PASS，用户操作及只读核查 | 0.1.9 extract与consolidate均一次成功，finish=stop，用量500/1555；MEM-A-019自动条目revision1及来源存在，新会话账本824/1024且对应memory_usage已结算；用户回答引用该约定 |
| A2 真实重启后读取 | PASS，用户回答及只读核查 | 条目于本地15:52生成；同一隔离Desktop/Host于16:04完整重启。新会话仍引用相同id@1，来源与更新时间保持，新会话账本824/1024；生成关闭、使用保留 |
| A2 真实项目A/B隔离 | PASS，用户截图及只读核查 | A/B在同一执行目标下具有不同项目UUID；B当前0条目，相关索引查询均为空，B会话直接证据reserved/settled均0，未出现A条目的usage；用户回答未返回A路径、标识或来源 |
| A2 真实全局共享 | PASS，用户截图及只读核查 | A/B新会话均返回全局偏好及MEM-G-019，结算同一global人工条目id@2；A全局与项目共用988/1024，B仅global为270/1024，无A项目usage进入B |
| A2 插件自身后台与默认压缩日志 | PASS，固定模型 | 0.1.9直接通过插件上下文执行原生日志读取、提炼、整理；测试时钟与usage明确为夹具 |
| A2/A4 后台推理选择 | PASS，固定模型 | 未修复时默认High夹具导致截断；修复后提炼及整理各一次off，最大输出1024；前台High不变，未声明off能力的路由保持默认 |
| A2 整理协议修订 | PASS，固定模型 | 旧协议在实际插件上下文复现MODEL_SCHEMA_FAILURE与revision字段路径；合法JSON示例修订后一次提炼/整理成功，错误revision仍被严格schema拒绝；null为合成夹具，实际响应值未知 |
| A2 只读权限夹具 | PASS | 实际管理实现按 Host 能力关闭写入；当前项目可读，越权 scope 拒绝；非真实网络连接 |
| A3 开关、来源、删除、清空 | PASS | 独立 use/generate、人工保护、revision 冲突、epoch、水位线、旧任务提交拒绝 |
| A3 Desktop全局使用关闭且数据保留 | PASS，用户截图及只读核查 | globalUse=false，原global人工条目id@2及时间未变；project-B新会话reserved/settled均0，无memory_usage，用户回答未返回偏好或标识。未捕获逐次工具响应轨迹 |
| A3 Desktop项目使用关闭且数据保留 | PASS，用户提供回答及只读核查 | projectUse=false，A项目继承策略无覆盖；两条原自动条目id@1及时间未变，最新独立会话reserved/settled均0且无memory_usage；用户回答不返回路径或标识。逐次工具响应未捕获 |
| A3 Desktop单条删除及删除后不召回 | PASS，用户提供回答及只读核查 | globalUse=true，目标人工条目expired/revision3，有remove审计；全局有效条目0、当前MEMORY.md正文为空，新会话reserved/settled均0且无memory_usage；A两条项目条目保持原id@1 |
| A3 Desktop来源删除及无关条目保留 | PASS，用户提供回答及只读核查 | 唯一来源remove-source审计、tombstone及epoch5→6已保存；提炼输入已移除，集成测试条目expired/id@2、sources为空，数据库条目保持id@1及2来源；新会话仅数据库usage，498/1024，未返回集成测试路径或标识 |
| A3 Desktop作用域清空 | PASS，用户提供回答及只读核查 | A epoch6→7、有效条目/提炼输入均0，原数据库条目expired/id@2；清空前12段来源水位线均覆盖其end，新会话reserved/settled均0且无memory_usage，旧会话498账本仍保留；原生会话日志文件仍存在 |
| A3 原生撤回与重放 | PASS | user/message、仅修改正文的 tool/result、卸载重放 |
| A4 预算与截止 | PASS | 累计共用1024、revision去重、重启/压缩不重置；3%加显式授予、日上限、并发一、重试计费、未知usage暂停；150ms晚到不注入 |
| A4 新默认和人工额度 | PASS，固定数据 | 新配置档仅初次授予10000；旧配置档无自动授予；手动补充幂等、不可越权、不可运行中补充或解除未知usage暂停；重启不补满 |
| A4 实际Web额度页面 | PASS，实际隔离Web | 旧配置档初始为0；页面人工补充至10000并分别记账；每日默认100000、修改及保存生效；刷新和重启不补满 |
| A4 Desktop额度与失败计费 | PASS，用户截图及只读核查 | 初始授予0、人工补充8549.63后可用10000；每日100000保留，旧1453不清零；新失败两次实际结算2752，可用7248，无未知用量暂停 |
| A5 安全模型诊断 | PASS，固定模型 | JSON、schema及max-tokens分类；保留实际失败用量与固定字段路径，不保存模型正文或敏感值 |
| A5 故障与生命周期 | PASS | 格式失败、取消、存储故障前台放行、未来schema/身份拒绝、快照重建、路径/junction拒绝、Worker退出 |
| A5 同 home 卸载/重装 | PASS | 页面卸载移除；数据库保留；重装读取同一数据 |
| A1/A5 运行中升级与重启 | PASS，实际隔离Web | 实际pluginManager从0.1.6升级0.1.7返回restart-required；重启前新动作复现相同边界错误，完整重启后相同请求成功；旧账本不自动补满 |
| Desktop复制路径与Markdown导出 | PASS，真实Desktop操作及只读核查 | 实际点击复制路径，剪贴板与当前global快照目录一致；点击导出生成global-d9ccc3f9-8119-43ee-8d32-1c0b2c98c0b4.md及export审计。文件为当前空快照的1字节换行，与MEMORY.md逐字节及SHA-256一致；有内容的导出复用既有隔离Web证据 |
| 系统文件管理器降级流程 | PASS，真实Windows操作 | 将插件复制的目录粘贴至文件资源管理器地址栏，成功显示MEMORY.md、memory_summary.md、raw_memories.md。插件没有直接打开系统目录按钮，不将手动粘贴流程称为原生目录打开API |
| WAN / 真实远程 Desktop | NOT_RUN，本轮范围之外 | 用户明确远程暂未启用、暂不纳入；不声明远程部署或WAN兼容性已经通过 |

公开证据见 [docs/verification](../../docs/verification)。`evidence/verified-0.1.4.json` 为历史0.1.5与0.1.4的一致性记录，不适用于后续版本。0.1.6来源依赖修复见 `source-access-0.1.6.json`；0.1.7额度及诊断见 `budget-diagnostics-0.1.7.json`；0.1.8请求策略修复见 `background-routing-0.1.8.json`；0.1.9整理协议见 `consolidation-contract-0.1.9.json`，最终包见 `distribution-0.1.9.json`。原生日志、用户配置及模型正文不公开。0.1.9用户真实主链路及页内详情新增证据见 `manual-real-chain-0.1.9.json`；生成后正常重启见 `manual-restart-0.1.9.json`；真实项目A/B隔离见 `manual-isolation-0.1.9.json`；真实全局共享及人工保存修改见 `manual-global-sharing-0.1.9.json`；全局使用关闭且数据保留见 `manual-global-disable-0.1.9.json`；项目使用关闭且数据保留见 `manual-project-disable-0.1.9.json`；单条删除及删除后不召回见 `manual-record-delete-0.1.9.json`；来源删除及无关条目保留见 `manual-source-delete-0.1.9.json`；project-A作用域清空、旧来源水位线和新会话不召回见 `manual-scope-clear-0.1.9.json`；Desktop页面内文件正文浏览见 `manual-file-browse-0.1.9.json`；分发包及源码包维持原哈希，包内文档为打包时的验收状态。

## 计量边界

五个有界约束用例全部通过。样本直接证据累计752/1024，以UTF-8字节保守扣额。本次总截止观测150.2ms，真实SQLite写锁争用放行150.2ms，含Node定时器调度误差，不是任意主机零误差保证。

前台usage的大数为合成边界夹具，不代表真实供应商账单。稳定策略162 UTF-8 bytes、完整工具定义290 bytes额外记录，不计入直接证据1024账本；供应商tokenizer、宿主封装和后续模型轮次另有成本。

## 本轮验收范围与结论

0.1.9本轮Windows本机Desktop及loopback Web必要验收已完成，不需要继续重复提炼、整理或记忆问答。既有构建/类型检查及必要A1–A5自动化检查继续有效；本次只补录真实Desktop操作、更新文档及本轮范围，未改生产代码或分发包。隔离project-A当前有效记忆为0，项目使用开启、全局使用关闭、两级自动生成关闭。原始日志、失败记录、实际费用和历史证据账本保留；本次导出新增一个文件及export审计，不修改记忆条目或profile。

1. 用户范围决策：2026-10-04明确“远程暂未启用，暂不纳入”。真实跨机器连接、远程页面/权限及WAN记为NOT_RUN、本轮范围之外；不是通过或免除未来远程部署前的验收。本机实际Remote RPC及既有作用域越权/只读限制测试仍属于必需项，证据继续保留。
2. 真实Desktop复制路径、Markdown导出及系统文件管理器降级流程PASS，补充证据见`docs/verification/desktop-copy-export-0.1.9.json`。导出样本为删除后空快照，不能据此声称Desktop有内容样本也在本次单独导出验证；其既有Web验证继续有效。
3. 清空后的旧任务竞态与防重生约束复用既有固定模型A3证据；本轮实际核对了epoch及清空前来源水位线，不为重复验证额外调用付费模型。原生日志保留仅核查文件存在及大小，未重新解码正文或验收完整聊天历史界面。

本轮本机范围必要验收PASS；跨机器远程及WAN未验收。后续启用远程时另行验证实际连接、当前项目范围、只读/写入限制和执行主机存储归属。历史证据中的BLOCKED/NOT_RUN为当时状态，不覆盖本次明确的范围决策，也不改写为历史PASS。
