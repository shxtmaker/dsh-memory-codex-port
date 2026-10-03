# 验收记录

结论：**待完成验收**。当前修复版本为 0.1.6。0.1.4/0.1.5 的直接插件上下文后台链路存在缺陷，旧测试另建 Engine，未覆盖该路径。0.1.6 声明 `sessionPersistence` 依赖，并补充直接运行生产插件后台、使用默认压缩日志的回归验收。不得把固定适配器或 Web 页面算作真实供应商模型或完整 Desktop 管理交互通过。

## 实际环境

- Windows；Node 24.19.0、npm 11.17.0；CLI 包管理使用 Host pnpm 11.19.0。
- npm Host 与实际已装 Desktop/desktop-runtime/Host 均为 0.2.0-rc.2；Desktop bundled Node 24.21.0。
- 测试只使用隔离 DSH_HOME、profile、Electron user-data-dir 和合成 project-A/project-B。
- 原始测试日志在开发工作区保留。公开摘录移除了本机绝对路径，不上传测试数据库、原生日志正文、访问令牌、配置备份或日常凭证。
- 没有真实模型调用、购买、真实历史扫描、宿主核心修改或日常 profile 安装。

## 构建与 A1–A5

| 项目 | 状态 | 实际证据范围 |
|---|---|---|
| 插件构建 / 类型检查 | PASS | rc.2 官方严格 Typert、Host、SQLite Worker、lazy-CJS Client |
| A1 Web 安装与页面 | PASS | 实际包安装、页面、Remote、双开关、来源、编辑、revision 冲突、文件浏览、导出、清空 |
| A1 Desktop 安装与 Remote | PASS | 真实已装 exe、Electron Node-mode、bundled pnpm、独立 desktop profile、memory Remote 200 |
| A1 Desktop 可见页面 | PASS，用户截图 | 用户隔离 Desktop 0.1.4 的记忆高级页面可见；不代表全部管理操作已验收 |
| A1 Desktop 0.1.6 升级及完整管理交互 | NOT_RUN | 未修改用户正在运行的隔离实例，待用户升级后完成 |
| A1 实际非 loopback Host | BLOCKED | CLI 明确拒绝 0.0.0.0 监听，未覆盖安全条件 |
| A2 原生日志闭环 | PASS，固定模型 | 实际 AgentLoop、持久日志、提炼、整理、新会话命中、重启、中文/代码检索、A/B 与全局隔离 |
| A2 真实模型闭环 | BLOCKED | 原尝试 FAIL：SOURCE_UNAVAILABLE，尝试次数0、后台费用0；0.1.6待重验，原可用credit不足 |
| A2 插件自身后台与默认压缩日志 | PASS，固定模型 | 0.1.6直接通过插件上下文执行原生日志读取、提炼、整理；测试时钟与usage明确为夹具 |
| A2 只读权限夹具 | PASS | 实际管理实现按 Host 能力关闭写入；当前项目可读，越权 scope 拒绝；非真实网络连接 |
| A3 开关、来源、删除、清空 | PASS | 独立 use/generate、人工保护、revision 冲突、epoch、水位线、旧任务提交拒绝 |
| A3 原生撤回与重放 | PASS | user/message、仅修改正文的 tool/result、卸载重放 |
| A4 预算与截止 | PASS | 累计共用1024、revision去重、重启/压缩不重置；3%、日上限、并发一、重试计费、未知usage暂停；150ms晚到不注入 |
| A5 故障与生命周期 | PASS | 格式失败、取消、存储故障前台放行、未来schema/身份拒绝、快照重建、路径/junction拒绝、Worker退出 |
| A5 同 home 卸载/重装 | PASS | 页面卸载移除；数据库保留；重装读取同一数据 |
| 系统文件管理器 | NOT_RUN | 使用已通过的页内浏览/复制路径/导出降级 |
| WAN / 真实远程 Desktop | NOT_RUN | 未建立对应实际环境 |

公开证据见 [docs/verification](../../docs/verification)。`evidence/verified-0.1.4.json` 为历史0.1.5与0.1.4的源文件一致性记录，不适用于0.1.6。来源日志副本的事件范围/hash一致；原始日志和用户配置不公开。0.1.6失败复现、修复和检查结果见 `source-access-0.1.6.json`。

## 计量边界

五个有界约束用例全部通过。样本直接证据累计752/1024，以UTF-8字节保守扣额。一次总截止观测150.4ms，真实SQLite写锁争用放行150.9ms，含Node定时器调度误差，不是任意主机零误差保证。

前台usage的大数为合成边界夹具，不代表真实供应商账单。稳定策略162 UTF-8 bytes、完整工具定义290 bytes额外记录，不计入直接证据1024账本；供应商tokenizer、宿主封装和后续模型轮次另有成本。

## 待完成验收

1. 在同一授权隔离Desktop中升级0.1.6后，完成全部记忆管理交互。
2. 实际3% credit足够后，一个新短样本完成一次真实提炼、一次真实整理；保留原失败记录，不扫描旧历史，不自动透支。
3. Host正式允许授权非loopback连接后，验证真实远程当前项目和只读行为。

上述缺口解除前，不宣称全部验收完成。
