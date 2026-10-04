# 验收记录

结论：**待完成验收**。当前版本为 0.1.9。整理协议使用合法 JSON 示例，新增省略 id/revision，更新与撤销保留旧记录的整数 revision。0.1.8 用户真实提炼已通过，整理因 revision 类型校验失败；0.1.9 真实整理与新会话读取仍需验证。固定模型或 Web 不能替代真实 Desktop 闭环。

## 实际环境

- Windows；Node 24.19.0、npm 11.17.0；CLI 包管理使用 Host pnpm 11.19.0。
- npm Host 与实际已装 Desktop/desktop-runtime/Host 均为 0.2.0-rc.2；Desktop bundled Node 24.21.0。
- 测试只使用隔离 DSH_HOME、profile、Electron user-data-dir 和合成 project-A/project-B。
- 原始测试日志在开发工作区保留。公开摘录移除了本机绝对路径，不上传测试数据库、原生日志正文、访问令牌、配置备份或日常凭证。
- 自动化验收使用固定模型。用户此前的来源不可用、格式失败与输出截断保留；0.1.8 完整重启后两次真实提炼分别结算468、447 tokens，整理仍因revision类型错误失败。当前只读账本今日已用8710、credit3207.94、paused=0，不自动补充或退还实际费用。未读取用户凭证、购买额度、扫描真实历史、修改宿主核心或安装到日常profile。

## 构建与 A1–A5

| 项目 | 状态 | 实际证据范围 |
|---|---|---|
| 插件构建 / 类型检查 | PASS | rc.2 官方严格 Typert、Host、SQLite Worker、lazy-CJS Client |
| A1 Web 安装与页面 | PASS | 实际包安装、页面、Remote、双开关、来源、编辑、revision 冲突、文件浏览、导出、清空 |
| A1 Desktop 安装与 Remote | PASS | 真实已装 exe、Electron Node-mode、bundled pnpm、独立 desktop profile、memory Remote 200 |
| A1 Desktop 可见页面 | PASS，用户截图 | 用户隔离 Desktop 0.1.4 的记忆高级页面可见；不代表全部管理操作已验收 |
| A1 Desktop 0.1.7 磁盘安装 | PASS，用户操作及只读核查 | 当前隔离Desktop profile已安装0.1.7，实际SQLite存在新额度表；磁盘文件与分发构建一致，既有账本未自动补满 |
| A1 Desktop 0.1.7 运行接口更新 | PASS，用户操作及只读核查 | 保留未重启时的request边界失败；用户完整重启后Host进程已更换，同一隔离home中人工补充成功 |
| A1 Desktop 0.1.9 升级及完整管理交互 | NOT_RUN | 0.1.8 高级页面及额度操作已确认；0.1.9 升级与全部管理交互待用户完成 |
| A1 Desktop 0.1.8 磁盘安装与重启 | PASS，用户操作及只读核查 | 已安装0.1.8，Host于本地12:36完整重启，晚于12:19插件文件更新；同一隔离home/profile |
| A1 实际非 loopback Host | BLOCKED | CLI 明确拒绝 0.0.0.0 监听，未覆盖安全条件 |
| A2 原生日志闭环 | PASS，固定模型 | 实际 AgentLoop、持久日志、提炼、整理、新会话命中、重启、中文/代码检索、A/B 与全局隔离 |
| A2 真实模型闭环 | FAIL，0.1.9 NOT_RUN | 0.1.8两次真实extract已succeeded，finish=stop，用量468/447；consolidate仍因changes.0.revision:invalid_type失败（最近尝试625/971）；全部旧错误和费用保留，真实整理、自动条目、新会话命中待验证 |
| A2 插件自身后台与默认压缩日志 | PASS，固定模型 | 0.1.9直接通过插件上下文执行原生日志读取、提炼、整理；测试时钟与usage明确为夹具 |
| A2/A4 后台推理选择 | PASS，固定模型 | 未修复时默认High夹具导致截断；修复后提炼及整理各一次off，最大输出1024；前台High不变，未声明off能力的路由保持默认 |
| A2 整理协议修订 | PASS，固定模型 | 旧协议在实际插件上下文复现MODEL_SCHEMA_FAILURE与revision字段路径；合法JSON示例修订后一次提炼/整理成功，错误revision仍被严格schema拒绝；null为合成夹具，实际响应值未知 |
| A2 只读权限夹具 | PASS | 实际管理实现按 Host 能力关闭写入；当前项目可读，越权 scope 拒绝；非真实网络连接 |
| A3 开关、来源、删除、清空 | PASS | 独立 use/generate、人工保护、revision 冲突、epoch、水位线、旧任务提交拒绝 |
| A3 原生撤回与重放 | PASS | user/message、仅修改正文的 tool/result、卸载重放 |
| A4 预算与截止 | PASS | 累计共用1024、revision去重、重启/压缩不重置；3%加显式授予、日上限、并发一、重试计费、未知usage暂停；150ms晚到不注入 |
| A4 新默认和人工额度 | PASS，固定数据 | 新配置档仅初次授予10000；旧配置档无自动授予；手动补充幂等、不可越权、不可运行中补充或解除未知usage暂停；重启不补满 |
| A4 实际Web额度页面 | PASS，实际隔离Web | 旧配置档初始为0；页面人工补充至10000并分别记账；每日默认100000、修改及保存生效；刷新和重启不补满 |
| A4 Desktop额度与失败计费 | PASS，用户截图及只读核查 | 初始授予0、人工补充8549.63后可用10000；每日100000保留，旧1453不清零；新失败两次实际结算2752，可用7248，无未知用量暂停 |
| A5 安全模型诊断 | PASS，固定模型 | JSON、schema及max-tokens分类；保留实际失败用量与固定字段路径，不保存模型正文或敏感值 |
| A5 故障与生命周期 | PASS | 格式失败、取消、存储故障前台放行、未来schema/身份拒绝、快照重建、路径/junction拒绝、Worker退出 |
| A5 同 home 卸载/重装 | PASS | 页面卸载移除；数据库保留；重装读取同一数据 |
| A1/A5 运行中升级与重启 | PASS，实际隔离Web | 实际pluginManager从0.1.6升级0.1.7返回restart-required；重启前新动作复现相同边界错误，完整重启后相同请求成功；旧账本不自动补满 |
| 系统文件管理器 | NOT_RUN | 使用已通过的页内浏览/复制路径/导出降级 |
| WAN / 真实远程 Desktop | NOT_RUN | 未建立对应实际环境 |

公开证据见 [docs/verification](../../docs/verification)。`evidence/verified-0.1.4.json` 为历史0.1.5与0.1.4的一致性记录，不适用于后续版本。0.1.6来源依赖修复见 `source-access-0.1.6.json`；0.1.7额度及诊断见 `budget-diagnostics-0.1.7.json`；0.1.8请求策略修复见 `background-routing-0.1.8.json`；0.1.9整理协议见 `consolidation-contract-0.1.9.json`，最终包见 `distribution-0.1.9.json`。原生日志、用户配置及模型正文不公开。

## 计量边界

五个有界约束用例全部通过。样本直接证据累计752/1024，以UTF-8字节保守扣额。本次总截止观测150.2ms，真实SQLite写锁争用放行150.2ms，含Node定时器调度误差，不是任意主机零误差保证。

前台usage的大数为合成边界夹具，不代表真实供应商账单。稳定策略162 UTF-8 bytes、完整工具定义290 bytes额外记录，不计入直接证据1024账本；供应商tokenizer、宿主封装和后续模型轮次另有成本。

## 待完成验收

1. 在同一授权隔离Desktop升级0.1.9并完整重启Host，完成全部管理交互。0.1.8完整重启、人工额度和每日100000已确认；升级不自动补充credit。
2. 0.1.8真实提炼已经通过；升级后使用一条新短样本验证修订后的真实整理、来源和新会话命中；若失败，记录新错误分类、校验路径及实际用量，不能修改断言代替通过。保留原失败记录，不扫描旧历史。
3. Host正式允许授权非loopback连接后，验证真实远程当前项目和只读行为。

上述缺口解除前，不宣称全部验收完成。
