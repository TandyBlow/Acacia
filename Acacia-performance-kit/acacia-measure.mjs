import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

export function scrub(value) {
  return String(value ?? '').replace(/Bearer\s+[\w.+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, '[redacted-jwt]')
    .replace(/((?:access[_-]?token|refresh[_-]?token|password|api[_-]?key|authorization)\s*[=:]\s*)[^\s,;}]+/gi, '$1[redacted]')
    .replace(/https?:\/\/[^\s)'\"]+/g, match => safeURL(match))
    .slice(0, 2000);
}

export function safeURL(value) {
  try {
    const u = new URL(value);
    const pathname = u.pathname.replace(/[a-f\d]{8}-[a-f\d-]{27,}/gi, ':id')
      .replace(/\/[a-f\d]{24,}(?=\/|$)/gi, '/:id');
    return u.origin + pathname;
  } catch { return '[non-url]'; }
}

export function stats(values) {
  const a = values.filter(v => typeof v === 'number' && Number.isFinite(v)).sort((a,b) => a-b);
  if (!a.length) return { n: 0, median: null, mean: null, p95_sample: null, max: null };
  const mid = Math.floor(a.length/2);
  return { n:a.length, median: a.length%2 ? a[mid] : (a[mid-1]+a[mid])/2,
    mean:a.reduce((sum,v) => sum+v,0)/a.length,
    p95_sample:a[Math.ceil(a.length*0.95)-1], max:a.at(-1) };
}

function parseArgs(argv) {
  const options = {};
  for (let i=0; i<argv.length; i++) {
    const key=argv[i];
    if (!key.startsWith('--')) throw new Error('Unexpected argument: '+key);
    if (['--help','--manual-login','--headed'].includes(key)) options[key.slice(2)]=true;
    else {
      if (!argv[i+1] || argv[i+1].startsWith('--')) throw new Error('Missing value: '+key);
      options[key.slice(2)] = argv[++i];
    }
  }
  return options;
}

function instrumentation() {
  const state = { timeOrigin:performance.timeOrigin, lcp:null, longtasks:[], interactions:[], supported:[], observers:[] };
  window.__acaciaMeasure = state;
  performance.setResourceTimingBufferSize(3000);
  const observe = (type, callback, extra={}) => {
    if (!PerformanceObserver.supportedEntryTypes.includes(type)) return;
    const observer = new PerformanceObserver(list => callback(list.getEntries()));
    observer.observe({type, buffered:true, ...extra});
    state.supported.push(type);
    state.observers.push(observer);
  };
  observe('largest-contentful-paint', entries => { for(const e of entries) state.lcp=e.startTime; });
  observe('longtask', entries => { for(const e of entries) state.longtasks.push({startTime:e.startTime, duration:e.duration}); });
  observe('event', entries => { for(const e of entries) if(e.interactionId>0) state.interactions.push({
    name:e.name, startTime:e.startTime, duration:e.duration, interactionId:e.interactionId,
    processingStart:e.processingStart, processingEnd:e.processingEnd });
  }, {durationThreshold:16});
}

async function snapshot(page) {
  const data=await page.evaluate(() => {
    const s=window.__acaciaMeasure;
    const nav=performance.getEntriesByType('navigation')[0];
    const paints=performance.getEntriesByType('paint');
    return { now:performance.now(), timeOrigin:performance.timeOrigin,
      url:location.origin+location.pathname, title:document.title,
      appVersion:document.body.innerText.match(/Acacia\s+v[\d.]+/)?.[0] ?? null,
      viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},
      navigation:nav?.toJSON() ?? null,
      fcp_ms:paints.find(e=>e.name==='first-contentful-paint')?.startTime ?? null,
      lcp_snapshot_ms:s?.lcp ?? null,
      longtasks:s?.longtasks ?? [], interactions:s?.interactions ?? [], supported:s?.supported ?? [],
      resources:performance.getEntriesByType('resource').map(e=>({
        url:e.name, initiatorType:e.initiatorType, startTime:e.startTime, duration:e.duration,
        transferSize:e.transferSize, encodedBodySize:e.encodedBodySize,
        decodedBodySize:e.decodedBodySize, workerStart:e.workerStart, responseStatus:e.responseStatus ?? null})) };
  });
  data.url=safeURL(data.url);
  if(data.navigation) data.navigation.name=safeURL(data.navigation.name);
  for(const r of data.resources) r.url=safeURL(r.url);
  return data;
}

function attachLogs(page, records) {
  page.on('pageerror', error => records.push({kind:'pageerror',at:new Date().toISOString(),message:scrub(error.message),stack:scrub(error.stack)}));
  page.on('console', message => {
    if(!['warning','warn','error'].includes(message.type())) return;
    const location=message.location();
    if(location.url?.startsWith('chrome-extension:')) return;
    records.push({kind:'console',at:new Date().toISOString(),level:message.type(),message:scrub(message.text()),
      source:safeURL(location.url),line:location.lineNumber,column:location.columnNumber});
  });
  page.on('requestfailed', request => records.push({kind:'requestfailed',at:new Date().toISOString(),
    method:request.method(),url:safeURL(request.url()),failure:scrub(request.failure()?.errorText)}));
  page.on('requestfinished', async request => {
    try {
      const response=await request.response();
      records.push({kind:'request',at:new Date().toISOString(),method:request.method(),
        resourceType:request.resourceType(),url:safeURL(request.url()),status:response?.status()??null,
        timing:request.timing()});
    } catch { /* Page can close while its request completion callback runs. */ }
  });
}

function metricValues(sample) {
  const p=sample.performance;
  if(!p) return {};
  const isManual=sample.navigationChanged!==undefined;
  const n=isManual?null:p.navigation;
  const ready=n && n.responseStart>0;
  return { navigation_to_first_byte_ms:ready ? n.responseStart : null,
    document_request_to_first_byte_ms:ready ? n.responseStart-n.requestStart : null,
    fcp_ms:isManual?null:p.fcp_ms, lcp_snapshot_ms:isManual?null:p.lcp_snapshot_ms,
    dom_content_loaded_ms:n?.domContentLoadedEventEnd>0 ? n.domContentLoadedEventEnd : null,
    load_event_ms:n?.loadEventEnd>0 ? n.loadEventEnd : null,
    ready_selector_ms:sample.ready_selector_ms ?? null,
    observed_transfer_bytes:p.resources.reduce((sum,r)=>sum+r.transferSize,0),
    resource_count:p.resources.length,
    longtask_count:p.longtasks.length,
    longtask_total_ms:p.longtasks.reduce((sum,e)=>sum+e.duration,0) };
}

function formatNumber(v) { return v===null || v===undefined ? '未取得' : v.toFixed(2); }
export function makeReport(result) {
  const lines=['Acacia 浏览器测量报告','',
    '运行时间：'+result.createdAt,
    '测试地址：'+result.options.url,
    '人工版本标签：'+result.options.label,
    '本地仓库提交：'+(result.environment.localGitCommit ?? '未取得'),
    '浏览器：'+result.environment.browser,
    '运行模式：'+result.options.mode+'；无界面运行：'+result.environment.headless,
    '操作系统：'+result.environment.os,
    'CPU：'+result.environment.cpu,
    '窗口：1440 × 900；CPU 与网络未设降速。',''];
  if(result.options.mode==='load') {
    lines.push('每次首次访问使用新的浏览器会话；再次访问共用已访问过页面的会话。Cookie 与本地存储在内存中继承，HTTP 缓存与 Service Worker 由会话自身维护。再次访问先预热一遍。',
      '页面完成 load、就绪元素出现后，继续观察 '+result.options.settleMs+' 毫秒。就绪元素：'+result.options.readySelector+'。该元素需要对应所测页面可操作状态。',
      'ready_selector_ms 是采集器在 load 后确认元素可见的时刻，包含自动化往返开销。默认 body 不表示编辑器已可操作。',
      'LCP 是观察截止时的数值，transferSize 汇总受跨域计时权限、缓存与 Service Worker 影响。它们不等于完整用户体验或全部网络流量。',
      '本地仓库提交不证明服务器正在运行该提交；服务器版本应另外核对。','',
      '| 访问方式 | 成功 / 尝试 | 指标 | 有效样本 | 中位数 | 本批样本 p95 |',
      '| --- | --- | --- | --- | --- | --- |');
    for(const cache of ['cold','warm']) {
      const attempts=result.samples.filter(s=>s.cache===cache);
      const success=attempts.filter(s=>s.performance && !s.failure);
      const metrics=['navigation_to_first_byte_ms','fcp_ms','lcp_snapshot_ms','ready_selector_ms','observed_transfer_bytes','longtask_total_ms'];
      for(const metric of metrics) {
        const aggregate=stats(success.map(s=>metricValues(s)[metric]));
        lines.push('| '+cache+' | '+success.length+' / '+attempts.length+' | '+metric+' | '+aggregate.n+' | '+formatNumber(aggregate.median)+' | '+formatNumber(aggregate.p95_sample)+' |');
      }
    }
    lines.push('','p95 使用本批样本的排序位置计算。样本较少时不能据此估计用户总体的尾部耗时。失败样本保留在 results.json，不混入成功耗时统计。');
  } else {
    lines.push('手动操作按记录名称分段。记录中的 Event Timing 按 interactionId 合并，报告同一次交互较长的事件耗时；快于浏览器采集阈值的交互可能不在记录中。',
      '交互耗时包含输入排队、事件处理及随后绘制等待。表中数值是本次观察结果，没有作为正式 INP 或自动保存完成耗时。',
      'API 请求耗时按请求开始至响应完成计算。自动保存的等待、排队和界面状态需要结合操作录像或代码埋点另行核对。','',
      '| 操作记录 | 导航有无变化 | 可见交互数 | 交互中位数 ms | 长任务数 | 长任务累计 ms |',
      '| --- | --- | --- | --- | --- | --- |');
    for(const sample of result.samples) {
      if(!sample.performance) continue;
      const durations=new Map();
      for(const event of sample.performance.interactions) durations.set(event.interactionId,Math.max(durations.get(event.interactionId)??0,event.duration));
      const a=stats([...durations.values()]);
      lines.push('| '+sample.label.replaceAll('|','/')+' | '+(sample.navigationChanged?'有':'无')+' | '+a.n+' | '+formatNumber(a.median)+' | '+sample.performance.longtasks.length+' | '+formatNumber(sample.performance.longtasks.reduce((sum,e)=>sum+e.duration,0))+' |');
    }
  }
  const apiGroups=new Map();
  for(const record of result.records) {
    if(record.kind!=='request' || !['fetch','xhr'].includes(record.resourceType)) continue;
    const key=record.method+' '+record.url;
    if(!apiGroups.has(key)) apiGroups.set(key,{attempts:0,errors:0,times:[]});
    const group=apiGroups.get(key);group.attempts++;
    if(record.status>=400) group.errors++;
    if(record.timing?.responseEnd>=0) group.times.push(record.timing.responseEnd);
  }
  if(apiGroups.size) {
    lines.push('','| Fetch / XHR 请求 | 完成数 | HTTP 错误数 | 耗时中位数 ms | 本批样本 p95 ms |',
      '| --- | --- | --- | --- | --- |');
    for(const [key,group] of apiGroups) {
      const a=stats(group.times);
      lines.push('| '+key.replaceAll('|','/')+' | '+group.attempts+' | '+group.errors+' | '+formatNumber(a.median)+' | '+formatNumber(a.p95_sample)+' |');
    }
    lines.push('','请求时间由浏览器观测，包含网络与服务器等待，不等于后端代码自身执行时间。连接失败另见排错记录。');
  }
  lines.push('','排错记录见 browser-records.json。记录不含 Cookie、请求头、请求正文、响应正文、截图、会话存储；常见凭证文本与 URL 查询参数已移除。',
    '这些文件记录运行时观察。性能改善幅度需要使用同一浏览器、设备、文档、操作与采集参数，对照两个明确的版本计算。',
    '本报告未替简历填入性能改善数值，也未把本机结果推定为全部用户结果。','',
    '方法来源：https://developer.chrome.com/docs/devtools/performance/reference',
    '网络导出：https://developer.chrome.com/docs/devtools/network/reference',
    '导航计时：https://developer.mozilla.org/en-US/docs/Web/API/PerformanceNavigationTiming',
    '交互计时：https://developer.mozilla.org/en-US/docs/Web/API/PerformanceEventTiming',
    '浏览器会话：https://playwright.dev/docs/api/class-browsercontext');
  return lines.join('\n')+'\n';
}

async function saveResult(result,out) {
  await fs.mkdir(out,{recursive:true});
  await fs.writeFile(path.join(out,'results.json'),JSON.stringify(result,null,2));
  const headers=['cache','run','label','failure','navigation_to_first_byte_ms','document_request_to_first_byte_ms','fcp_ms','lcp_snapshot_ms','dom_content_loaded_ms','load_event_ms','ready_selector_ms','observed_transfer_bytes','resource_count','longtask_count','longtask_total_ms'];
  const csvValue=v=>'"'+String(v??'').replaceAll('"','""')+'"';
  const rows=[headers.map(csvValue).join(',')];
  for(const s of result.samples) {
    const row={cache:s.cache,run:s.run,label:s.label,failure:s.failure,...metricValues(s)};
    rows.push(headers.map(key=>csvValue(row[key])).join(','));
  }
  await fs.writeFile(path.join(out,'measurements.csv'),'\uFEFF'+rows.join('\r\n')+'\r\n');
  await fs.writeFile(path.join(out,'browser-records.json'),JSON.stringify(result.records,null,2));
  await fs.writeFile(path.join(out,'report.md'),makeReport(result));
}

export async function main(argv=process.argv.slice(2)) {
  const args=parseArgs(argv);
  if(args.help) {
    console.log('node acacia-measure.mjs --project FRONTEND_DIR --url URL [--channel msedge] [--mode load|manual] [--manual-login] [--ready-selector CSS] [--runs 10] [--label VERSION] [--out DIRECTORY] [--settle-ms 2500] [--executable CHROME_PATH]');
    return;
  }
  const requestedURL=new URL(args.url??'https://acacia.tandyblow.top/');
  if(!['http:','https:'].includes(requestedURL.protocol) || requestedURL.username || requestedURL.password || requestedURL.search || requestedURL.hash) throw new Error('Use an http(s) URL without credentials, query or fragment.');
  const mode=args.mode??'load';
  if(!['load','manual'].includes(mode)) throw new Error('Mode must be load or manual.');
  const runs=Number(args.runs??10),settleMs=Number(args['settle-ms']??2500);
  if(!Number.isInteger(runs) || runs<1 || runs>100) throw new Error('Runs must be 1..100.');
  if(!Number.isFinite(settleMs) || settleMs<0 || settleMs>10000) throw new Error('settle-ms must be 0..10000.');
  const project=path.resolve(args.project??process.cwd());
  const require=createRequire(path.join(project,'package.json'));
  let chromium;
  try { ({chromium}=require('playwright')); }
  catch { throw new Error('Playwright was not found under --project. Use the Acacia frontend directory after installing its locked dependencies.'); }
  const out=path.resolve(args.out??'acacia-measure-'+new Date().toISOString().replace(/[:.]/g,'-'));
  const launch={headless:!(mode==='manual' || args['manual-login'] || args.headed)};
  if(args.executable) launch.executablePath=path.resolve(args.executable);
  else launch.channel=args.channel??'chrome';
  const browser=await chromium.launch(launch);
  const terminal=createInterface({input:process.stdin,output:process.stdout});
  const git=spawnSync('git',['-C',project,'rev-parse','HEAD'],{encoding:'utf8'});
  const result={schemaVersion:1,createdAt:new Date().toISOString(),
    options:{url:safeURL(requestedURL.href),label:args.label??'unlabelled',mode,runs,settleMs,readySelector:args['ready-selector']??'body'},
    environment:{browser:browser.version(),channel:launch.channel??'explicit-executable',headless:launch.headless,os:os.platform()+' '+os.release(),
      cpu:os.cpus()[0]?.model??'unknown',logicalCPUs:os.cpus().length,localGitCommit:git.status===0?git.stdout.trim():null},
    samples:[],records:[]};
  const contexts=new Set();
  let storageState;
  const newContext=async()=>{
    const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'allow',...(storageState?{storageState}:{})});
    contexts.add(context);await context.addInitScript(instrumentation);return context;
  };
  try {
    if(mode==='manual' || args['manual-login']) {
      const context=await newContext();
      const page=await context.newPage();
      await page.goto(requestedURL.href,{waitUntil:'load',timeout:45000});
      await terminal.question('在新浏览器窗口登录；手动测编辑器时打开测试文档。准备好后在终端按 Enter。');
      storageState=await context.storageState();
      if(mode==='manual') {
        const records=[];attachLogs(page,records);
        for(let i=0;i<20;i++) {
          const label=(await terminal.question('输入此次操作记录名称，空白结束：')).trim();
          if(!label) break;
          const start=await page.evaluate(()=>({now:performance.now(),timeOrigin:performance.timeOrigin}));
          const recordStart=records.length;
          await terminal.question('在浏览器执行该操作，等待界面稳定后回终端按 Enter。');
          await page.waitForTimeout(Math.min(settleMs,1000));
          const performanceData=await snapshot(page);
          const navigationChanged=performanceData.timeOrigin!==start.timeOrigin;
          const since=navigationChanged?0:start.now;
          performanceData.longtasks=performanceData.longtasks.filter(e=>e.startTime>=since);
          performanceData.interactions=performanceData.interactions.filter(e=>e.startTime>=since);
          performanceData.resources=performanceData.resources.filter(e=>e.startTime>=since);
          const segment=records.slice(recordStart);
          result.records.push(...segment.map(r=>({...r,scenario:label})));
          result.samples.push({run:i+1,label,navigationChanged,performance:performanceData});
          await saveResult(result,out);
          console.log('已保存记录：'+label);
        }
        return;
      }
      await context.close();contexts.delete(context);
    }
    const measure=async(context,cache,run,record=true)=> {
      const page=await context.newPage();
      const records=[];attachLogs(page,records);
      const sample={cache,run,label:result.options.label};
      try {
        const response=await page.goto(requestedURL.href,{waitUntil:'load',timeout:45000});
        sample.documentStatus=response?.status()??null;
        if(sample.documentStatus>=400) throw new Error('Document HTTP status '+sample.documentStatus);
        await page.locator(result.options.readySelector).first().waitFor({state:'visible',timeout:20000});
        sample.ready_selector_ms=await page.evaluate(()=>performance.now());
        await page.waitForTimeout(settleMs);
        sample.performance=await snapshot(page);
      } catch(error) { sample.failure=scrub(error.message); }
      finally { await page.close(); }
      if(record) {
        result.samples.push(sample);
        result.records.push(...records.map(r=>({...r,cache,run})));
        await saveResult(result,out);
        console.log(cache+' '+run+'/'+runs+(sample.failure?' 失败':' 已记录'));
      }
    };
    for(let run=1;run<=runs;run++) {
      const context=await newContext();
      await measure(context,'cold',run);await context.close();contexts.delete(context);
    }
    const warm=await newContext();
    await measure(warm,'warm',0,false);
    for(let run=1;run<=runs;run++) await measure(warm,'warm',run);
  } finally {
    await saveResult(result,out);
    terminal.close();
    for(const context of contexts) await context.close().catch(()=>{});
    await browser.close();
    console.log('输出目录：'+out);
  }
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error=>{console.error(scrub(error.message));process.exitCode=1;});
}
