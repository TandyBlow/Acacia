Acacia 浏览器测量报告

运行时间：2026-10-14T13:33:53.487Z
测试地址：https://acacia.tandyblow.top/
人工版本标签：production-2026-10-14
本地仓库提交：0e197bffedf3fcee74a9119d3472d75f7d02bf1d
浏览器：155.0.4283.45
运行模式：load；无界面运行：true
操作系统：win32 10.0.26200
CPU：13th Gen Intel(R) Core(TM) i7-13700H
窗口：1440 × 900；CPU 与网络未设降速。

每次首次访问使用新的浏览器会话；再次访问共用已访问过页面的会话。Cookie 与本地存储在内存中继承，HTTP 缓存与 Service Worker 由会话自身维护。再次访问先预热一遍。
页面完成 load、就绪元素出现后，继续观察 2500 毫秒。就绪元素：body。该元素需要对应所测页面可操作状态。
ready_selector_ms 是采集器在 load 后确认元素可见的时刻，包含自动化往返开销。默认 body 不表示编辑器已可操作。
LCP 是观察截止时的数值，transferSize 汇总受跨域计时权限、缓存与 Service Worker 影响。它们不等于完整用户体验或全部网络流量。
本地仓库提交不证明服务器正在运行该提交；服务器版本应另外核对。

| 访问方式 | 成功 / 尝试 | 指标 | 有效样本 | 中位数 | 本批样本 p95 |
| --- | --- | --- | --- | --- | --- |
| cold | 10 / 10 | navigation_to_first_byte_ms | 10 | 1526.90 | 2827.50 |
| cold | 10 / 10 | fcp_ms | 10 | 15216.00 | 22692.00 |
| cold | 10 / 10 | lcp_snapshot_ms | 10 | 15216.00 | 22692.00 |
| cold | 10 / 10 | ready_selector_ms | 10 | 14874.65 | 22473.80 |
| cold | 10 / 10 | observed_transfer_bytes | 10 | 4070626.00 | 4070626.00 |
| cold | 10 / 10 | longtask_total_ms | 10 | 446.00 | 471.00 |
| warm | 10 / 10 | navigation_to_first_byte_ms | 10 | 615.45 | 1270.30 |
| warm | 10 / 10 | fcp_ms | 10 | 1480.00 | 2160.00 |
| warm | 10 / 10 | lcp_snapshot_ms | 10 | 1480.00 | 2160.00 |
| warm | 10 / 10 | ready_selector_ms | 10 | 1474.30 | 2154.40 |
| warm | 10 / 10 | observed_transfer_bytes | 10 | 300.00 | 714.00 |
| warm | 10 / 10 | longtask_total_ms | 10 | 322.50 | 384.00 |

p95 使用本批样本的排序位置计算。样本较少时不能据此估计用户总体的尾部耗时。失败样本保留在 results.json，不混入成功耗时统计。

| Fetch / XHR 请求 | 完成数 | HTTP 错误数 | 耗时中位数 ms | 本批样本 p95 ms |
| --- | --- | --- | --- | --- |
| POST https://acacia.tandyblow.top/cdn-cgi/rum | 20 | 0 | 454.86 | 1323.10 |

请求时间由浏览器观测，包含网络与服务器等待，不等于后端代码自身执行时间。连接失败另见排错记录。

排错记录见 browser-records.json。记录不含 Cookie、请求头、请求正文、响应正文、截图、会话存储；常见凭证文本与 URL 查询参数已移除。
这些文件记录运行时观察。性能改善幅度需要使用同一浏览器、设备、文档、操作与采集参数，对照两个明确的版本计算。
本报告未替简历填入性能改善数值，也未把本机结果推定为全部用户结果。

方法来源：https://developer.chrome.com/docs/devtools/performance/reference
网络导出：https://developer.chrome.com/docs/devtools/network/reference
导航计时：https://developer.mozilla.org/en-US/docs/Web/API/PerformanceNavigationTiming
交互计时：https://developer.mozilla.org/en-US/docs/Web/API/PerformanceEventTiming
浏览器会话：https://playwright.dev/docs/api/class-browsercontext
