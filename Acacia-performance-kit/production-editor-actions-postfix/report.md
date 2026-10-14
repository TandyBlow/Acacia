Acacia 编辑器浏览器测量报告

运行时间：2026-10-14T16:43:14.868Z
测试地址：https://acacia.tandyblow.top/
人工版本标签：production-postfix-2026-10-15
本地仓库提交：6970f13b992db259f2626823e9e63a4be6aabfc9
浏览器：155.0.4283.45
运行模式：editor-actions；无界面运行：true
操作系统：win32 10.0.26200
CPU：13th Gen Intel(R) Core(TM) i7-13700H
窗口：1440 × 900；CPU 与网络未设降速。

方法：登录后按分段执行操作。打开/切换文档经 nodeStore.loadNode（与画布点击相同代码路径），以 store.activeNode 与编辑区正文字数双条件确认到位；文本输入为一次 insertText 插入（真实键盘事件，evaluate 聚焦以避开覆盖层对指针的拦截）；粘贴为真实系统剪贴板写入后发送 Ctrl+V。每段结束后固定观察 1 秒。
性能观察器（longtask / event / LCP）经 addInitScript 注入每个页面；涉及自动保存的分段记录观察窗内全部 PATCH /content 尝试及状态码，并直接向服务器核对内容长度；打开文档出现卡滞时重试一次并在备注注明。
交互计时来自 Event Timing，程序化触发不含真实指针事件，可见交互数偏低属预期。

| 操作记录 | 导航有无变化 | 可见交互数 | 交互中位数 ms | 长任务数 | 长任务累计 ms |
| --- | --- | --- | --- | --- | --- |
| 打开1.1万字测试文档 | 无 | 0 | 未取得 | 2 | 836.00 |
| 一次插入280字并观察自动保存 | 无 | 2 | 40.00 | 1 | 88.00 |
| 粘贴2204字符混合内容并观察自动保存 | 无 | 1 | 96.00 | 1 | 70.00 |
| 切换到轻量文档 | 无 | 0 | 未取得 | 1 | 54.00 |
| 切回1.1万字文档 | 无 | 0 | 未取得 | 2 | 206.00 |

| 操作记录 | 备注 |
| --- | --- |
| 打开1.1万字测试文档 | {"openMs":3030} |
| 一次插入280字并观察自动保存 | {"editorLenAfterType":11660,"insertedChars":279,"saveWrites":[{"status":200,"at":1791996213040}],"serverAfter":{"revision":4,"contentLength":11341}} |
| 粘贴2204字符混合内容并观察自动保存 | {"saveWrites":[{"status":200,"at":1791996216157}],"serverAfter":{"revision":5,"contentLength":13558}} |
| 切换到轻量文档 | {"openMs":797} |
| 切回1.1万字文档 | {"openMs":729} |

| Fetch / XHR 请求 | 完成数 | HTTP 错误数 | 耗时中位数 ms | 本批样本 p95 ms |
| --- | --- | --- | --- | --- |
| GET https://acacia.tandyblow.top/api/nodes/context/:id | 4 | 0 | 415.22 | 1781.73 |
| GET https://acacia.tandyblow.top/api/tree | 6 | 0 | 488.59 | 924.75 |
| PATCH https://acacia.tandyblow.top/api/nodes/:id/content | 2 | 0 | 443.88 | 471.96 |

请求时间由浏览器观测，包含网络与服务器等待，不等于后端代码自身执行时间。

排错记录见 browser-records.json。记录不含 Cookie、请求头、请求正文、响应正文、截图、会话存储；常见凭证文本与 URL 查询参数已移除。
登录口令仅经环境变量传入脚本；会话令牌（storageState）写入系统临时目录的 JSON 以复用登录态，测量结束后删除，不进入本目录输出。
这些文件记录运行时观察。性能改善幅度需要使用同一浏览器、设备、文档、操作与采集参数，对照两个明确的版本计算。
本报告未替简历填入性能改善数值，也未把本机结果推定为全部用户结果。
