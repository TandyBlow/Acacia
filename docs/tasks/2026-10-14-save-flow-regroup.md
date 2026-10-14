# 2026-10-14 编辑器保存流程重整（以 4768fab 为基准）

## 背景与目标

冲突信息分散在三处维护（`MarkdownEditorSave.ts` 模块变量、`MarkdownEditorContext.ts` 每实例 ref、`nodeStoreState.ts` 的 map + 可写全局指针 `lastSaveConflict`），`enqueueSave` 把"进入队列"和"保存成功"都返回 `true`，调用方会误判状态。本次重整把保存状态收敛到一个**编辑器卸载后仍存在的按 nodeId 分桶的会话对象**，并把排队结果与写入结果拆开。

提交序列（每原子一次提交，全部基于 4768fab，未 push）：

| 提交 | 原子 |
|------|------|
| `15b292f` | 新增 `services/saveSession.ts`：按 nodeId 的记录（草稿、编辑次数、已确认内容和版本、排队任务、在途请求、重试计时器、重试次数、冲突、结果未知标记）+ 会话编号 + 单飞派发循环 + 任务等待终结语义 |
| `b7fb924` | store 写入层：`saveNodeContent` 返回结构化结果（成功带版本 / 冲突 / 未知）、`resolveNodeRevision`（首发送时定版并冻结）、每个 await 后的会话守卫、`resetAfterLogout` 先结束保存会话 |
| `3afc662` | 编辑器保存层：`enqueueSave` 返回 `{taskId, done}`（saved/conflict/unknown/refused/superseded/cancelled/session-ended），排队零副作用；`saveConflict`/`lastSavedContent` 改为按当前文档从注册表派生的只读值；删除可写 `lastSaveConflict` 与 store 冲突 map；keep-mine 钉住捕获版本（重试沿用）；保留/采用按文档串行；聊天/文件调用方按状态分支；Watchers 切换不再清冲突、不再全局清计时器 |
| `fcc1b20` | Watchers 真实挂载测试台 + 缺陷修复：`resolveNodeRevision` 等对空适配器响应加守卫（此前会把 `undefined` 写进 nodeCache） |
| （本次） | 8 场景验收 spec + 证据文档 |

## 改前失败证据（4768fab 基线）

临时复现 spec（旧 API，未入库）在基线上 5/5 失败，失败点即缺陷本身：

```
× 1. A→B→A restores the draft and the conflict banner
     AssertionError: expected 'A saved' to be 'A pending unsaved'
× 2. keep-mine queued behind another save does not stamp saved content or clear the banner early
     AssertionError: expected undefined to be 'node-a'        // 横幅被提前清空
× 3. a retry keeps the original expected revision instead of the newest cache revision
     AssertionError: expected { keepalive: undefined, revision: 3 } to match { revision: 1 }
     // 重试拿了缓存里的新版本号继续写旧稿，绕过服务器版本检查
× 4. the retry budget is per node, not global
     AssertionError: expected 1 to be greater than or equal to 2
× 5. a late response after logout does not write into the next session
     AssertionError: expected 'draft' to be 'fresh content'   // 迟到响应污染新会话缓存
```

改后对应回归（全部通过）：

| 基线缺陷 | 改后守护测试 |
|----------|--------------|
| 1. A→B→A 丢草稿/冲突 | `MarkdownEditorWatchers.spec` "switching nodes preserves…"、验收场景 3 |
| 2. keep-mine 排队窗口提前盖章/清横幅 | 验收场景 6（横幅保留、确认内容不动、服务器零写入） |
| 3. 重试取新版本写旧稿 | `saveSession.spec` "retries with the same expected revision"、验收场景 5（两次请求同版本断言） |
| 4. 重试预算全局共享 | `saveSession.spec` "the retry budget is per node" |
| 5. 登出后迟到响应污染 | `nodeStoreConflict.spec` "a late response after logout…"、验收场景 8 |

## 验收场景（`MarkdownEditorSaveScenarios.spec.ts`，8/8 通过）

真实栈：挂载组件（生产接线）+ 真实 Tiptap 编辑器 + 真实 Pinia store + 真实 nodeCache + mock 网络适配器（控制失败与返回顺序）。每个场景断言适配器收到的内容与版本（服务器侧）、缓存、草稿、派生冲突横幅、请求次数：

1. **A 保存期间切到 B**：A 后台完成（请求参数 rev1、缓存 rev2）、B 零请求零变化。
2. **A 冲突期间 B 保存成功**：A 的冲突记录与横幅存活，B 正常确认（rev5）。
3. **A→B→A**：草稿与横幅原样恢复；冲突仍暂停 A 自动保存（请求次数不涨）；B 期间已保存。
4. **保存过程中撤销编辑**：请求序列 `[B content typed, A saved]`，服务器与缓存最终停在撤销稿。
5. **服务器写入成功但响应丢失**：同内容重发**携带原预期版本 1**（两次请求同版本断言），确认后去重恢复。
6. **保留本地稿排队未发送**：横幅保留、确认内容不动、服务器零写入；放行后钉住 rev2 的 keep-mine 落地 rev3，横幅消失。
7. **旧读取晚于新写入**：过期 GET 返回 null，缓存保持 rev3 不回滚。
8. **退出账户后旧请求返回**：任务等待以 session-ended 结束，迟到成功响应不碰新会话缓存、不复活记录。

## 结构要点

- **单飞派发**：全局同一时刻一个写请求；完成（或失败结算）后按注册顺序补发。重试是后台延续：新请求编号、同内容快照、同预期版本，次数/计时器/冲突全部按文档隔离。
- **派生视图**：`ctx.saveConflict`、`ctx.lastSavedContent` = `computed`（按 activeNode.id 读注册表）。没有第二份可写副本；后台节点的冲突在该节点回到屏幕时横幅自动出现。
- **单一校验入口**：`validateContent`（解析往返 + 文档等价对照 + memo）不变；所有保存路径（自动保存、聊天、文件导入、keep-mine、撤销补写、flush）都经它取得 validated 结论后入队；未通过校验的内容以 `refused` 状态终结、绝不发送。解析器保持 `@tiptap/markdown@3.21.0`（b5a2faa 不回退）。
- **会话守卫**：每个请求记录携带会话编号；`endSaveSession()` 后迟到的响应在 store 层（缓存/activeNode）与注册表层（确认/冲突）都被丢弃。

## 有意的行为变化

- 切换节点不再 flush、不再清任何保存状态：草稿、重试、冲突随记录保留，切回恢复。flush 只发生在组件卸载与 pagehide（keepalive）。
- "在另一节点屏幕上点击该节点冲突按钮"不再可达（横幅即当前文档的派生视图）；原快照重放路径由"切回后横幅恢复 + 最新草稿重校验"覆盖。
- 未通过完整性校验的内容不再可能进入冲突横幅（发送前即被拒绝）；keep-mine 的拒绝路径改为对当前草稿的实时重校验。
- store 不再暴露 `lastSaveConflict`/`pendingSaveConflicts`/`saveActiveNodeContent`；`saveNodeContent` 是唯一写入口。

## 结果

- `npx vitest run`：**353/353 通过**（22 个文件）。
- `npm run build`（vue-tsc -b + vite build）：**成功**。
- 全程未 push（push 即生产发布，等待确认）。


## 评审修复轮（2026-10-14，ec8bdda 验收未过 → 六项修复）

独立复现确认六个缺陷，逐项修复（每项一次提交）：

| 提交 | 缺陷 → 修复 |
|------|-------------|
| `72239c5` | 旧稿覆盖新内容：加载时内容和版本一起入记录；入队时盖章写入依据版本（外部读取不改写）；连续编辑接在同一自有请求之后，确认成功才继承新版本；依据版本未知时预取并核对服务器文本，文本不同保留草稿进入冲突 |
| `a766fc7` | AI 追加绕过冲突：稳定冲突编号（失效化/重读保留 id，新捕获才换新 id 撤销许可）；入队与派发双重门禁，普通任务返回 conflict，保留本地稿凭编号获得写入许可；拦截发生在替换排队任务之前 |
| `e290eaa` | 后台重试改回本地稿：采用操作全程暂停该文档发送（取消→等待在途→重读→采用）；whenNodeIdle 返回 idle/session-ended（登出立即结束等待）；竞争写入若自行落地则重读服务器真值并同步草稿；冲突守卫全部改用稳定编号（失效化不再被误判为已被替换），重读决策跟随记录当前验证状态 |
| `19c8b44` | 无未保存修改也显示旧内容：prepareNodeView 仅在记录无任何未决状态（草稿一致、无排队/在途/版本解析中任务、无冲突、无未知结果）时用新读取刷新内容与版本 |
| `b7e412a` | 登出漏掉版本查询阶段：任务在任何 await 之前登记为处理中，登出立即结束其等待；发送占用携带会话编号，endSaveSession 释放，旧请求的 finally 身份核对后不再抢回 |
| `5517e56` | 场景 5 模拟与后端不一致：状态化服务器（内容+版本+If-Match，412 拒绝过期写入），重发被拒后经捕获读取确认服务器真值，keep-mine 钉住版本 2 收敛到版本 3 |

补充回归：连续两次编辑保存的版本继承、采用期间请求失败且重试不进入采用、冲突副本失效后许可保留且新捕获撤销、登出结束空闲等待、预取文本不一致进入冲突、普通任务拦截不触碰已排队的保留本地稿任务、版本查询阶段登出后新会话立即可发送。

结果：`npx vitest run` **364/364 通过**（23 个文件）；`npm run build` 成功。新增提交未 push，待验收确认。
