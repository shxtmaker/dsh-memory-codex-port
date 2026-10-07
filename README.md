# DeepSeek Harness 记忆插件

提供全局记忆、项目记忆、后台提炼与整理、「设置 → 记忆」管理页面，以及按需检索
WeKnora 知识库与经确认后单向发布共享经验的能力。版本：**0.3.0**。

## 安装

Host 需匹配 **0.2.0-rc.2**，Node.js 需为 **24 或更新版本**。

在插件管理页面输入仓库地址安装：

```text
https://github.com/shxtmaker/dsh-memory-codex-port
```

也可安装发布的本地 tgz：

```bash
dsh plugin --profile <配置档> add ./dist/dsh-memory-local-0.3.0.tgz
```

安装或更换版本后，完全退出并重新打开相同 home/profile 的 Host。**只刷新页面不算升级完成。**

## 使用

读取与自动生成默认关闭。先配置宿主供应商，在记忆高级设置中选择供应商和模型、保存并确认发送许可，再开启相应范围的记忆。

- 全局记忆保存个人偏好；项目记忆按执行主机和工作目录隔离。
- 支持人工保存、修改、删除、来源查看、清空、Markdown 浏览及导出。
- 自动提炼在新会话完成并空闲后进行，默认等待 10 分钟；整理最短间隔 30 分钟。
- 高级设置显示最新状态及今日后台 token 消耗。提炼、整理和重试按供应商返回的总 tokens 分别累计；未知用量单独提示。日期按执行主机本地时间计算，重启保留统计。

### 证据额度口径

界面显示的是 **UTF-8 字节**，不是计费 tokens：

| 项目 | 上限 |
|---|---|
| 本地直接证据（整会话累计，重启与轮次变化都不重置） | 1024 字节 |
| 远端活动槽位（标题、引用、正文与封装合计，每会话同时只有一份） | 3072 字节 |
| 退役后的短引用合计 | 256 字节 |
| 直接证据合计 | 4096 字节 |

估算 tokens 与供应商实际 usage 单独统计，两者不可互换。

### 知识库（WeKnora）

首版要求 WeKnora **v0.8.2**。在「设置 → 记忆 → 知识库」中：

1. 新增连接：填写 `connectionId`、`baseUrl`、接口 profile、`tenantId` 与两个**凭据引用名**
   （读取用一个、发布用一个，必须不同）。密钥正文只由 Host 解析，页面与日志都不记录。
2. 分别开启「读取」与「发布」开关，两者独立，默认关闭。
3. 为当前项目建立绑定：选择连接、最多两个只读知识库、一个发布库。
   发布库必须同时出现在只读列表中。**没有绑定就不会检索**，不会退化为查询全部可见库。

模型侧通过同一个 `memory` 工具按需检索：

```text
memory(action="search", source="knowledge", query="...")
memory(action="read",   source="knowledge", id="<文档ID>", cursor=1)
```

`source` 省略时为 `local`（本地历史证据），行为与旧版一致。

### 共享经验发布

本地经验不会自动外发。流程为：在管理页对某条经验生成**预览** → 查看将发送的完整正文、
目标库、源 revision 与正文 hash → 明确确认后才写入持久发布队列。
队列执行：创建草稿 → 写元数据 → 发布正文 → 轮询索引完成。

- 本地修改后该条变为「待复核」，需重新确认；页面同时显示已发布版本与待复核候选。
- 本地删除、拒绝或来源失效会立即写墓碑并排队撤回已发布副本；撤回不影响本地经验。
- 远端被其他客户端修改时显示冲突并暂停覆盖，不自动改写。
- 关闭发布开关会暂停队列但**不清空**待办。

## 数据

数据位于 `$DSH_HOME/memory/<memoryProfileId>/`，默认记忆配置档为 `local-default`。
关闭读取或清空长期记忆不删除原始聊天记录。

数据库结构版本为 2（0.3.0 由 1 升级）。连接设置、项目绑定、发布映射、出站队列与
远端墓碑都在同一 SQLite 中，连接只保存凭据引用。

## 升级与回滚

**升级**

1. 停止 Host，或使用 SQLite 一致备份机制；备份 `$DSH_HOME/memory/<memoryProfileId>` **整个目录**。
   运行中只复制 `state.sqlite` 会忽略 WAL，备份不可用。
2. 先在临时 profile 演练迁移。新增表按 `user_version` 在事务内升级；
   连接与发布默认关闭，既有 `memory_items`、来源、墓碑与模型选择保持不变。
3. 用目标 profile 安装 0.3.0，完全退出并重新打开 Host。

**回滚**

> 旧版会拒绝 `user_version > 1` 的数据库，因此**不能只换回旧 tgz**。

1. 先关闭发布开关，停止 Host；保存未同步条目与队列状态。
2. 恢复升级前的一致备份与旧插件版本。
3. 保留升级后的数据库副本用于对账。
4. 重新启用远端功能前，必须对账保存的 outbox、墓碑与远端映射；
   禁止沿用旧备份中的批准状态自动重发，以免恢复已撤回内容。

远端已发布的副本不会因为恢复本地备份自动消失，需要按需在 WeKnora 侧处理。

## 诊断

- 构建与检查：`npm run build`、`npm run typecheck`、`npm test`
- 打包与一致性：`node scripts/release.mjs`（产出 `dist/` 下的 tgz 与 SHA256SUMS）
- 接口契约核查依据：`implementation/dsh-memory/docs/weknora-v0.8.2-contract.md`
- 实施进度：`implementation/dsh-memory/PROGRESS.md`
- 验收记录：`implementation/dsh-memory/ACCEPTANCE.md`

## 许可证

MIT。第三方声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
