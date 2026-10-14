Acacia 编辑器浏览器测量报告

运行时间：2026-10-14T14:57:40.924Z
测试地址：https://acacia.tandyblow.top/
人工版本标签：production-editor-2026-10-14
本地仓库提交：0e197bffedf3fcee74a9119d3472d75f7d02bf1d
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
| cold | 9 / 10 | navigation_to_first_byte_ms | 9 | 1944.40 | 4046.70 |
| cold | 9 / 10 | fcp_ms | 9 | 21540.00 | 30696.00 |
| cold | 9 / 10 | lcp_snapshot_ms | 0 | 未取得 | 未取得 |
| cold | 9 / 10 | shell_ready_ms | 0 | 未取得 | 未取得 |
| cold | 9 / 10 | ready_selector_ms | 9 | 1705.00 | 3607.00 |
| cold | 9 / 10 | observed_transfer_bytes | 9 | 6376527.00 | 6386957.00 |
| cold | 9 / 10 | longtask_total_ms | 9 | 0.00 | 0.00 |
| warm | 10 / 10 | navigation_to_first_byte_ms | 10 | 475.35 | 1049.80 |
| warm | 10 / 10 | fcp_ms | 10 | 4602.00 | 5064.00 |
| warm | 10 / 10 | lcp_snapshot_ms | 0 | 未取得 | 未取得 |
| warm | 10 / 10 | shell_ready_ms | 0 | 未取得 | 未取得 |
| warm | 10 / 10 | ready_selector_ms | 10 | 1508.00 | 2722.00 |
| warm | 10 / 10 | observed_transfer_bytes | 10 | 46623.00 | 46623.00 |
| warm | 10 / 10 | longtask_total_ms | 10 | 0.00 | 0.00 |

p95 使用本批样本的排序位置计算。失败样本保留在 results.json，不混入成功耗时统计。

| Fetch / XHR 请求 | 完成数 | HTTP 错误数 | 耗时中位数 ms | 本批样本 p95 ms |
| --- | --- | --- | --- | --- |
| POST https://acacia.tandyblow.top/cdn-cgi/rum | 21 | 0 | 412.89 | 957.48 |
| GET https://acacia.tandyblow.top/api/auth/me | 21 | 0 | 401.65 | 1079.17 |
| GET https://acacia.tandyblow.top/api/official-nodes | 42 | 0 | 949.08 | 3063.06 |
| GET https://acacia.tandyblow.top/api/nodes/context/null | 21 | 0 | 935.68 | 2833.14 |
| POST https://acacia.tandyblow.top/api/generate-tree-skeleton | 36 | 0 | 943.49 | 3954.05 |
| POST https://acacia.tandyblow.top/api/tag-nodes | 42 | 0 | 934.38 | 3954.58 |
| GET https://acacia.tandyblow.top/api/daily-quiz/status | 21 | 0 | 896.14 | 1876.32 |
| GET https://acacia.tandyblow.top/api/style | 42 | 0 | 639.37 | 1946.71 |
| GET https://acacia.tandyblow.top/api/quiz-stats | 21 | 0 | 404.41 | 976.51 |
| GET https://acacia.tandyblow.top/api/nodes/context/:id | 20 | 0 | 542.33 | 1638.22 |
| GET https://acacia.tandyblow.top/api/tree | 40 | 0 | 597.25 | 958.79 |

请求时间由浏览器观测，包含网络与服务器等待，不等于后端代码自身执行时间。

排错记录见 browser-records.json。记录不含 Cookie、请求头、请求正文、响应正文、截图、会话存储；常见凭证文本与 URL 查询参数已移除。
这些文件记录运行时观察。性能改善幅度需要使用同一浏览器、设备、文档、操作与采集参数，对照两个明确的版本计算。
本报告未替简历填入性能改善数值，也未把本机结果推定为全部用户结果。
