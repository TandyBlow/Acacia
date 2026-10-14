Acacia 编辑器浏览器测量报告

运行时间：2026-10-14T16:32:11.787Z
测试地址：https://acacia.tandyblow.top/
人工版本标签：production-postfix-2026-10-15
本地仓库提交：6970f13b992db259f2626823e9e63a4be6aabfc9
浏览器：155.0.4283.45
运行模式：editor-load；无界面运行：true
操作系统：win32 10.0.26200
CPU：13th Gen Intel(R) Core(TM) i7-13700H
窗口：1440 × 900；CPU 与网络未设降速。

方法：使用登录后的 storageState。每次访问先加载应用外壳，再经 nodeStore.loadNode（与树画布点击相同代码路径）打开 10935 字符的测试文档；ready_selector_ms 从 loadNode 调用起算，到 .tiptap[contenteditable] 可见且正文渲染完毕为止。shell_ready_ms 是加载完成到编辑器 DOM 挂载的时间。
冷启动每次新建浏览器上下文（共享登录态，无 HTTP 缓存）；热启动共用一个上下文，先预热一遍。
本测量未模拟真实输入设备点击树节点，打开文档不含指针定位与动画等待。

| 访问方式 | 成功 / 尝试 | 指标 | 有效样本 | 中位数 | 本批样本 p95 |
| --- | --- | --- | --- | --- | --- |
| cold | 10 / 10 | navigation_to_first_byte_ms | 10 | 1134.85 | 2173.30 |
| cold | 10 / 10 | fcp_ms | 10 | 13498.00 | 16952.00 |
| cold | 10 / 10 | lcp_snapshot_ms | 10 | 31412.00 | 35900.00 |
| cold | 10 / 10 | shell_ready_ms | 0 | 未取得 | 未取得 |
| cold | 10 / 10 | ready_selector_ms | 10 | 1653.50 | 2661.00 |
| cold | 10 / 10 | observed_transfer_bytes | 10 | 6376950.00 | 6387540.00 |
| cold | 10 / 10 | longtask_total_ms | 10 | 1445.00 | 1842.00 |
| warm | 10 / 10 | navigation_to_first_byte_ms | 10 | 468.65 | 1088.90 |
| warm | 10 / 10 | fcp_ms | 10 | 3908.00 | 4808.00 |
| warm | 10 / 10 | lcp_snapshot_ms | 10 | 3908.00 | 4808.00 |
| warm | 10 / 10 | shell_ready_ms | 0 | 未取得 | 未取得 |
| warm | 10 / 10 | ready_selector_ms | 10 | 1575.00 | 1813.00 |
| warm | 10 / 10 | observed_transfer_bytes | 10 | 47191.00 | 47194.00 |
| warm | 10 / 10 | longtask_total_ms | 10 | 1509.50 | 1734.00 |

p95 使用本批样本的排序位置计算。失败样本保留在 results.json，不混入成功耗时统计。

| Fetch / XHR 请求 | 完成数 | HTTP 错误数 | 耗时中位数 ms | 本批样本 p95 ms |
| --- | --- | --- | --- | --- |
| POST https://acacia.tandyblow.top/cdn-cgi/rum | 21 | 0 | 413.50 | 760.20 |
| GET https://acacia.tandyblow.top/api/auth/me | 21 | 0 | 416.73 | 727.51 |
| GET https://acacia.tandyblow.top/api/official-nodes | 42 | 0 | 792.94 | 1317.05 |
| POST https://acacia.tandyblow.top/api/generate-tree-skeleton | 34 | 0 | 790.57 | 1695.34 |
| POST https://acacia.tandyblow.top/api/tag-nodes | 42 | 0 | 744.92 | 1343.21 |
| GET https://acacia.tandyblow.top/api/daily-quiz/status | 21 | 0 | 672.69 | 1196.91 |
| GET https://acacia.tandyblow.top/api/nodes/context/null | 21 | 0 | 752.05 | 1359.70 |
| GET https://acacia.tandyblow.top/api/style | 42 | 0 | 747.53 | 1409.68 |
| GET https://acacia.tandyblow.top/api/quiz-stats | 21 | 0 | 622.93 | 1841.70 |
| GET https://acacia.tandyblow.top/api/nodes/context/:id | 21 | 0 | 488.38 | 1288.67 |
| GET https://acacia.tandyblow.top/api/tree | 42 | 0 | 580.80 | 1239.79 |

请求时间由浏览器观测，包含网络与服务器等待，不等于后端代码自身执行时间。

排错记录见 browser-records.json。记录不含 Cookie、请求头、请求正文、响应正文、截图、会话存储；常见凭证文本与 URL 查询参数已移除。
登录口令仅经环境变量传入脚本；会话令牌（storageState）写入系统临时目录的 JSON 以复用登录态，测量结束后删除，不进入本目录输出。
这些文件记录运行时观察。性能改善幅度需要使用同一浏览器、设备、文档、操作与采集参数，对照两个明确的版本计算。
本报告未替简历填入性能改善数值，也未把本机结果推定为全部用户结果。
