# T2/T3 真实验收入口（缺少外部条件时保留）

本文件保留真实 WeKnora 与真实模型验收所需的准确命令、合成数据与配置步骤。
当前状态：**受阻（BLOCKED）** —— 未提供实例地址、隔离知识库与凭据引用。
本机夹具（`tests/weknora-*.test.mjs`）只证明协议形状与状态机，**不代替**本文件的验收。

## 前置条件

| 输入 | 说明 |
|---|---|
| WeKnora 地址 | v0.8.2（固定提交 `3e8b0bf`），例如 `https://weknora.example.com/api/v1` |
| 租户 ID | 平台 API key 必填；租户 key 可省略 |
| 读取凭据引用 | 需要 `retrieve` 能力，且知识库 allow-list 覆盖只读库 |
| 发布凭据引用 | 需要 `retrieve` + `ingest`，仅覆盖发布库；**不得**持有 `manage_kbs` 或 full-access |
| 只读知识库 | 两份带已知答案的文档，用于核对来源与原文 |
| 发布知识库 | 独立 document KB，管理员预先关闭自动打标签、profile 生成与 Wiki |
| 模型 | 宿主已配置的提炼供应商/模型（成本对照需同模型、同起始上下文） |

凭据以引用名形式提供，密钥正文不进入提示词、配置或日志：

```bash
# 示例：把密钥放进宿主凭据层，插件只引用名字
# DSH credential ref: weknora-read / weknora-publish
```

## 测试 profile 准备

```bash
cd <repo>/runtime-v0.2.0-rc.2
DSH_HOME=<隔离 home> node node_modules/@deepseek-ai/dsh/lib/bin.js \
  --profile weknora-acceptance --from-default-profile web --dump-config
DSH_HOME=<隔离 home> node node_modules/@deepseek-ai/dsh/lib/bin.js \
  plugin --profile weknora-acceptance add <repo>/dist/dsh-memory-local-0.3.0.tgz
```

安装后**完全退出并重新打开** Host（只刷新页面不算升级）。

## T2 步骤

1. 打开「设置 → 记忆 → 知识库」，新增连接，填 `connectionId`、`baseUrl`、`apiProfile=v0.8.2-hybrid`、
   `tenantId` 与两个凭据引用名。保存后点「加载知识库列表」：应返回真实库列表；
   若失败，页面显示固定代码（UNAUTHORIZED / KB_DENIED / UPSTREAM / DEADLINE）。
2. 开启「读取」，仅在当前项目建立绑定（最多两个只读库 + 一个发布库）。
3. 在新会话中让模型调用：

   ```text
   memory(action="search", source="knowledge", query="<已知答案的问题>")
   ```

   核对：正文带 `<knowledge-evidence>`，含标题、文档 ID、chunk ID、正文 hash、获取时间与正文；
   来源与实际原文一致。
4. 分页读取：

   ```text
   memory(action="read", source="knowledge", id="<上一步的文档ID>", cursor=1)
   ```

5. 边界核对：
   - 当前项目无法读取未绑定库（应返回 NO_BINDING，且 WeKnora 侧无请求日志）。
   - 同一会话再次检索时旧槽位退役，模型可见面只剩一份远端正文。
   - 3072 字节槽位与本地 1024 字节账本同时生效，合计不超过 4096。
   - 取消（Esc / 中止）与超时不产生迟到的补注入。
   - WeKnora 不可达时本地任务继续可用。

6. 成本对照（少量固定样本，同模型同起始上下文）：
   - 普通任务：WeKnora 请求数应为 **0**；插件本地新增耗时目标 p95 ≤ 10ms；原本地链路仍在 150ms 截止内。
   - 知识任务：目标 1500ms 内结束或明确降级；单列检索与 embedding 成本。
   - 普通任务实际输入 tokens 增幅目标 ≤ 5%。
   - 供应商不返回 usage 时记为**未知**，不得记为 0 或宣称通过。

## T3 步骤

使用**合成经验**（例如「本项目把数据库操作放在 repositories 目录」），不使用真实聊天或个人记忆。

1. 在管理页对该条合成经验生成预览，核对完整正文、目标库、源 revision 与正文 hash。
2. 明确确认后发布；页面显示已发布版本与待复核候选两组字段。
3. 等待索引完成（`parse_status=completed` 且正文 hash 与批准快照一致）后，
   在**新会话**中检索到该正文及其来源版本。
4. 重复同一操作：不得再创建有效重复副本。
5. 模拟创建响应丢失：在目标库中预置同标记文档后重跑，应进入对账并复用已有映射，
   **不得**盲目重发创建；多匹配时应进入 `reconcile_required`。
6. 修改本地内容 → 变为待复核 → 重新确认后发布新版本。
7. 断开网络删除本地经验：本机应立即屏蔽已发布副本；恢复网络后完成远端删除，
   `GET /api/v1/knowledge/:id` 返回 404，新查询不再出现该内容。
8. 重启或后台旧结果晚到：墓碑仍阻止重新发布与召回。
9. 在 WeKnora 侧手工编辑该文档：插件应显示冲突并暂停覆盖，不自动改写。

## 记录要求

每条记录标明**通过 / 失败 / 受阻 / 未执行**，附实际命令、环境版本与必要结果。
样例与断言参考：

- `implementation/dsh-memory/tests/weknora-contract.test.mjs` —— 把 `baseUrl` 换成真实地址即可复用请求形状断言。
- `implementation/dsh-memory/tests/weknora-lifecycle.test.mjs` —— 状态机断言；真实环境下把 HTTP 夹具替换为真实客户端。

## 当前无法执行的项

| 项目 | 原因 |
|---|---|
| 全部真实检索与发布步骤 | 未提供地址、隔离库与凭据引用 |
| 真实 embedding 的阈值校准 | 同上 |
| 成本对照 | 需真实模型样本与同起点上下文 |
