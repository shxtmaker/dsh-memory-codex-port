# 实施状态

实施规范：技术方案v1.1。公开分发版本：0.1.5，Host严格匹配0.2.0-rc.2。状态：**待完成验收**。

## 环境与版本

实际源码位于 `implementation/dsh-memory/`。匹配运行时 manifest/锁文件位于 `runtime-v0.2.0-rc.2/`。Windows实测Node24.19.0/npm11.17.0；实际Desktop/Host0.2.0-rc.2、bundled Node24.21.0。源参考提交5badb15009ae1756c3afe0ae0cef1faafc290ccc仅是参考，不用它代替实际版本核验。

生产源码与已验收0.1.4一致。0.1.5补公开README、锁定版本元数据、许可和便携Desktop目标路径；仍不扫描真实历史，不运行Codex，不改宿主核心，不安装到日常profile。原始证据保留在开发工作区，公开仓库只保留可共享摘录和源码哈希。

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
| T10 | P2 | DONE | 空闲10分钟、8候选、并发1、租约/fence、3%/日上限/失败及重试计费 |
| T11 | P2 | DONE | Phase1严格schema、seq验证、空结果和保守状态；真实模型BLOCKED |
| T12 | P2 | DONE | Phase2差异基线、无差异不调用、受影响旧项、来源/epoch/revision校验 |
| T13 | P3 | DONE | 原生pre-step；稳定策略；所有自动召回共用150ms |
| T14 | P3 | DONE | 原生memory search/read、顶层调用、/memory note/off |
| T15 | P3 | DONE | 累计共用1024、持久去重、一次turn、重启/压缩不重置、晚到回收 |
| T16 | P3 | DONE | 原生失效撤回；tool/result仅改正文、保持身份/meta；卸载重放 |
| T17 | P4 | DONE | 双开关、全局/项目卡片、覆盖、按需概览 |
| T18 | P4 | DONE | 分页列表、详情/来源、人工编辑、冲突保留草稿 |
| T19 | P4 | DONE | epoch确认清空、页内浏览、导出/复制；系统目录打开NOT_RUN |
| T20 | P4 | DONE | 当前代文件数/时间、额度、状态、错误、权限、连接刷新 |
| T21 | P5 | DONE | 防重生、未知usage暂停、路径/junction拒绝、存储故障前台放行 |
| T22 | P5 | BLOCKED | 已通过构建/类型、固定模型及实际Web；Desktop可见交互/真实模型/真实远程待验收 |
| T23 | P5 | DONE | 完整源码/锁文件/构建、本地tgz和源码zip、README、验收与SHA-256；双远端上传结果独立核验 |

## 已执行检查

- 0.1.4：build、typecheck、五个有界A2–A5用例、真实内核固定适配器闭环、真实Web管理与卸载重装PASS。
- 已装Desktop：真实exe/bundled pnpm的隔离安装与Remote200 PASS；登录后的可见页面BLOCKED。
- 0.1.5：生产源文件哈希与基线逐文件核对；必要构建、包安装和Remote核对。精确公开结果见 `docs/verification/distribution.json`。

## 阻塞与下一步

需要授权的隔离Desktop登录、可用真实模型路由及正式支持的非loopback Host。条件具备后执行ACCEPTANCE.md中的三项真实环境验收。不给缺失项补造证据，不为了验收提高额度、改安全条件或绕过欢迎页。
