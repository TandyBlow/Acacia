// Acacia 登录后编辑器测量驱动。
// 复用 acacia-measure.mjs 的采集口径（instrumentation/snapshot/records/scrub），
// 但登录与文档操作程序化完成：登录表单 + 旋钮确认（按住 700ms），
// 打开文档调用与画布点击相同的 store.loadNode。
// 凭证只从环境变量 ACACIA_USER / ACACIA_PASS 读取，不写入任何输出。
//
// 用法：
//   node editor-measure.mjs probe  --project <frontend> --url <url> [--state-file <path>]
//   node editor-measure.mjs load   --project <frontend> --url <url> --runs 10 --out <dir> --label <label> [--state-file <path>] [--settle-ms 2500]
//   node editor-measure.mjs actions --project <frontend> --url <url> --out <dir> --label <label> [--state-file <path>]
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { scrub, safeURL, stats } from './acacia-measure.mjs';

const DOC_NAME = 'perf-测试文档-2026-10-14';
const SWITCH_DOC_NAME = 'perf-切换目标-2026-10-14';
const META_FILE = '.editor-measure-meta.json';
const READY_TEXT_MIN = 1000; // 编辑区出现正文的最小字符数，视为文档内容已渲染

// ---------- 与 acacia-measure.mjs 相同的页面内采集器 ----------
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
    const editor=document.querySelector('.tiptap[contenteditable]');
    return { now:performance.now(), timeOrigin:performance.timeOrigin,
      url:location.origin+location.pathname, title:document.title,
      appVersion:document.body.innerText.match(/Acacia\s+v[\d.]+/)?.[0] ?? null,
      viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},
      navigation:nav?.toJSON() ?? null,
      fcp_ms:paints.find(e=>e.name==='first-contentful-paint')?.startTime ?? null,
      lcp_snapshot_ms:s?.lcp ?? null,
      editor_present:!!editor, editor_text_length:editor?editor.innerText.length:0,
      topElement:(()=>{const el=document.elementFromPoint(innerWidth/2, innerHeight/2); return el ? el.tagName+(el.id?'#'+el.id:'')+'.'+String(el.className).slice(0,40) : null;})(),
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
  const n=p.navigation;
  const ready=n && n.responseStart>0;
  return { navigation_to_first_byte_ms:ready ? n.responseStart : null,
    document_request_to_first_byte_ms:ready ? n.responseStart-n.requestStart : null,
    fcp_ms:p.fcp_ms, lcp_snapshot_ms:p.lcp_snapshot_ms,
    dom_content_loaded_ms:n?.domContentLoadedEventEnd>0 ? n.domContentLoadedEventEnd : null,
    load_event_ms:n?.loadEventEnd>0 ? n.loadEventEnd : null,
    shell_ready_ms:sample.shell_ready_ms ?? null,
    ready_selector_ms:sample.ready_selector_ms ?? null,
    editor_text_length:sample.editor_text_length ?? null,
    observed_transfer_bytes:p.resources.reduce((sum,r)=>sum+r.transferSize,0),
    resource_count:p.resources.length,
    longtask_count:p.longtasks.length,
    longtask_total_ms:p.longtasks.reduce((sum,e)=>sum+e.duration,0) };
}

function formatNumber(v) { return v===null || v===undefined ? '未取得' : v.toFixed(2); }

// ---------- 测试文档正文（确定性生成） ----------
function buildPayload() {
  const chapter = (i) => {
    const sentences = '这是一段用于性能测量的中文正文内容，覆盖常见的段落长度与标点混合场景，用来观察编辑器在持续渲染大量文本时的表现。'.repeat(14);
    return `## 第 ${i} 章 测试章节\n\n${sentences}\n\n本节包含行内公式 $a^2+b^2=c^2$ 与 $e^{i\\pi}+1=0$ 的混排验证，以及列表：\n\n- 列表项一，用于观察轻量节点渲染\n- 列表项二，包含代码 \`inline_code_${i}\` 的行内元素\n- 列表项三，收尾项\n`;
  };
  const table1 = ['| 列一 | 列二 | 列三 | 列四 |','| --- | --- | --- | --- |',
    ...Array.from({length:10},(_,r)=>`| 单元 ${r}1 | 单元 ${r}2 | 单元 ${r}3 | 单元 ${r}4 |`)].join('\n');
  const table2 = ['| 日期 | 项目 | 数值一 | 数值二 | 数值三 | 备注 |','| --- | --- | --- | --- | --- | --- |',
    ...Array.from({length:20},(_,r)=>`| 2026-10-${String(1+r%28).padStart(2,'0')} | 任务 ${r} | ${r*3} | ${r*7} | ${r*11} | 备注文本 ${r} |`)].join('\n');
  const blocks = [
    '以下是一个块级公式：\n\n$$\n\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}\n$$\n',
    '再一个块级公式：\n\n$$\n\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}\n$$\n',
    '```js\nfunction perfSample(n) {\n  let acc = 0;\n  for (let i = 0; i < n; i++) acc += i * 2;\n  return acc;\n}\n```\n',
  ];
  const parts = [
    '# 性能测试文档（2026-10-14）\n\n本文档由测量脚本生成，专用于编辑器性能测量，不承载真实内容。\n',
    ...Array.from({length:10},(_,i)=>chapter(i+1)),
    '## 附表一（10 行 × 4 列）\n\n'+table1+'\n',
    '## 附表二（20 行 × 6 列）\n\n'+table2+'\n',
    ...blocks,
  ];
  const text = parts.join('\n');
  return { text,
    chars: text.length,
    blockFormulas: 2 + 0, // 章节内只有行内公式
    inlineFormulas: 20,
    tables: [{rows:11, cols:4},{rows:21, cols:6}],
    codeBlocks: 1 };
}

function buildPasteText() {
  const para = '这是一段用于粘贴测量的混合内容，包含中文、English、数字 12345 与标点；'.repeat(40);
  const table = ['| 粘贴列一 | 粘贴列二 | 粘贴列三 |','| --- | --- | --- |',
    ...Array.from({length:8},(_,r)=>`| 单元 ${r}1 | 单元 ${r}2 | 单元 ${r}3 |`)].join('\n');
  const text = `${para}\n\n行内公式 $x=y^2$ 出现一次。\n\n${table}\n\n${'收尾段落。'.repeat(50)}`;
  return { text, chars: text.length, tables: 1, inlineFormulas: 1 };
}

// ---------- 登录与工具 ----------
async function launchBrowser(requirePlaywright, {channel='msedge'}={}) {
  const { chromium } = requirePlaywright;
  return chromium.launch({ headless:true, channel });
}

async function loginAndSaveState(browser, url, {stateFile}) {
  const context = await browser.newContext({ viewport:{width:1440,height:900}, serviceWorkers:'allow' });
  const page = await context.newPage();
  const errors = [];
  attachLogs(page, errors);
  await page.goto(url, { waitUntil:'load', timeout:45000 });
  const userInput = page.locator('input.field-input[type="text"]').first();
  await userInput.waitFor({ state:'visible', timeout:30000 });
  await userInput.fill(process.env.ACACIA_USER ?? '');
  const passInput = page.locator('input.field-input[type="password"]').first();
  await passInput.fill(process.env.ACACIA_PASS ?? '');
  const loginResponse = page.waitForResponse(r => r.url().includes('/auth/login') && r.request().method()==='POST', { timeout:30000 });
  await page.locator('button.knob-hit-area').first().click({ delay: 1200 }); // 按住超过 KNOB_HOLD_MS(700ms) 触发确认
  const resp = await loginResponse;
  if (resp.status() !== 200) throw new Error('Login failed: HTTP '+resp.status());
  await page.waitForFunction(() => !!localStorage.getItem('acacia_backend_token'), null, { timeout:15000 });
  const state = await context.storageState();
  await fs.writeFile(stateFile, JSON.stringify(state));
  await page.close();
  await context.close();
  return stateFile;
}

async function ensureState(browser, url, args) {
  const stateFile = args['state-file'] ?? path.join(os.tmpdir(), `acacia-editor-state-${Date.now()}.json`);
  try {
    const raw = JSON.parse(await fs.readFile(stateFile,'utf8'));
    if (raw?.cookies?.length || raw?.origins?.length) return { stateFile, reused:true };
  } catch { /* need fresh login */ }
  await loginAndSaveState(browser, url, { stateFile });
  return { stateFile, reused:false };
}

async function newLoggedInContext(browser, stateFile) {
  const context = await browser.newContext({ viewport:{width:1440,height:900}, serviceWorkers:'allow', storageState:stateFile });
  await context.addInitScript(instrumentation);
  return context;
}

// 打开文档：与画布点击走同一 store action（nodeStore.loadNode）。
async function openNodeViaStore(page, nodeId) {
  return page.evaluate(async (id) => {
    const app = document.querySelector('#app')?.__vue_app__;
    const pinia = app?.config?.globalProperties?.$pinia;
    const store = pinia?._s?.get('node');
    if (!store || typeof store.loadNode !== 'function') return { ok:false, reason:'pinia node store 不可达' };
    try { await store.loadNode(id); return { ok:true }; }
    catch (e) { return { ok:false, reason:String(e?.message ?? e) }; }
  }, nodeId);
}

async function pageHasToken(page) {
  return page.evaluate(() => !!localStorage.getItem('acacia_backend_token'));
}

async function waitForEditorReady(page, {timeout=20000, minText=READY_TEXT_MIN}={}) {
  await page.locator('.tiptap[contenteditable]').first().waitFor({ state:'visible', timeout });
  await page.waitForFunction((min) => (document.querySelector('.tiptap[contenteditable]')?.innerText?.length ?? 0) >= min,
    minText, { timeout });
}

// ---------- probe ----------
async function probe(args) {
  if (!process.env.ACACIA_USER || !process.env.ACACIA_PASS) throw new Error('需要环境变量 ACACIA_USER / ACACIA_PASS。');
  const project = path.resolve(args.project ?? process.cwd());
  const require = createRequire(path.join(project,'package.json'));
  let playwright; try { playwright = require('playwright'); } catch { throw new Error('frontend 下未找到 playwright。'); }
  const url = args.url ?? 'https://acacia.tandyblow.top/';
  const browser = await launchBrowser(playwright);
  try {
    const { stateFile, reused } = await ensureState(browser, url, args);
    console.log('登录态：'+(reused?'复用现有 state 文件':'新登录完成')+' → '+stateFile);
    const context = await newLoggedInContext(browser, stateFile);
    const page = await context.newPage();
    await page.goto(url, { waitUntil:'load', timeout:45000 });
    await page.waitForFunction(() => !!localStorage.getItem('acacia_backend_token'), null, { timeout:15000 });
    await page.waitForTimeout(3000); // 等入场过渡结束
    const domState = await page.evaluate(() => {
      const q = (s) => document.querySelectorAll(s).length;
      const app = document.querySelector('#app')?.__vue_app__;
      const pinia = app?.config?.globalProperties?.$pinia;
      const store = pinia?._s?.get('node');
      const editor = document.querySelector('.tiptap[contenteditable]');
      return {
        appVersion: document.body.innerText.match(/Acacia\s+v[\d.]+/)?.[0] ?? null,
        editorMounted: !!editor, editorTextLength: editor?.innerText.length ?? 0,
        nodeBtnCount: q('.node-btn'), dataItemCount: q('[data-item-id]'), canvasCount: q('canvas'),
        buttons: [...document.querySelectorAll('button')].map(b=>b.getAttribute('aria-label')).filter(Boolean).slice(0,20),
        storeReachable: !!store, storeKeys: store?Object.keys(store.$state ?? {}).slice(0,20):[],
        activeNodeId: store?.activeNode?.id ?? null, treeNodeCount: store?.treeNodes?.length ?? null,
        viewState: store?.viewState ?? null, hasAnyNodes: store?.hasAnyNodes ?? null,
      };
    });
    console.log('登录后 DOM 状态：'+JSON.stringify(domState,null,2));

    // 建测试文档（幂等：按名字查，存在即复用）
    const setup = await page.evaluate(async ({docName, switchDocName, payload, pasteText}) => {
      const app = document.querySelector('#app').__vue_app__;
      const token = localStorage.getItem('acacia_backend_token');
      const api = async (p, opts={}) => {
        const res = await fetch('/api'+p, { ...opts,
          headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${token}`, ...(opts.headers??{}) } });
        if (!res.ok) throw new Error(p+' → HTTP '+res.status+': '+(await res.text()).slice(0,200));
        return res.status===204 ? null : res.json();
      };
      const findByName = async (name) => {
        const tree = await api('/tree');
        const walk = (nodes) => { for (const n of nodes) { if (n.name===name) return n; if (n.children?.length) { const hit = walk(n.children); if (hit) return hit; } } return null; };
        return walk(tree);
      };
      const ensureDoc = async (name, content) => {
        let node = await findByName(name);
        if (!node) node = await api('/nodes', { method:'POST', body: JSON.stringify({ name, parent_id: null }) });
        const ctxRes = await fetch(`/api/nodes/context/${node.id}`, { headers:{ 'Authorization':`Bearer ${token}` } });
        const ctxData = await ctxRes.json();
        const etagMatch = ctxRes.headers.get('ETag')?.match(/\d+/);
        const revision = etagMatch ? etagMatch[0] : (ctxData?.nodeInfo?.revision ?? null);
        const headers = revision!=null ? { 'If-Match': `"${revision}"` } : {};
        await api(`/nodes/${node.id}/content`, { method:'PATCH', body: JSON.stringify({ content }), headers });
        return node;
      };
      const doc = await ensureDoc(docName, payload.text);
      const target = await ensureDoc(switchDocName, '切换目标文档（轻量）。\n');
      return { docId: doc.id, docName: doc.name, switchDocId: target.id,
        docRevision: doc.revision ?? null, treeRootCount: (await api('/tree')).length };
    }, { docName:DOC_NAME, switchDocName:SWITCH_DOC_NAME,
         payload:buildPayload(), pasteText:buildPasteText().text });

    // 写入正文后节点信息可能过期，重新拉一次上下文以确认内容长度
    const verify = await page.evaluate(async (docId) => {
      const token = localStorage.getItem('acacia_backend_token');
      const res = await fetch(`/api/nodes/context/${docId}`, { headers:{ 'Authorization':`Bearer ${token}` } });
      const data = await res.json();
      return { contentLength: data?.nodeInfo?.content?.length ?? null, name: data?.nodeInfo?.name ?? null };
    }, setup.docId);

    // 验证 store.loadNode 能打开文档
    const opened = await openNodeViaStore(page, setup.docId);
    let editorAfterOpen = null;
    if (opened.ok) {
      const t0 = Date.now();
      await waitForEditorReady(page, { timeout:30000 });
      editorAfterOpen = { ok:true, ms: Date.now()-t0,
        textLength: await page.evaluate(() => document.querySelector('.tiptap[contenteditable]')?.innerText.length ?? 0) };
    }
    console.log('测试文档：'+JSON.stringify({setup, verify, opened, editorAfterOpen},null,2));

    const meta = { createdAt:new Date().toISOString(), url, docId:setup.docId, docName:setup.docName,
      switchDocId:setup.switchDocId, verify, payloadStats:buildPayload(), pasteStats:buildPasteText() };
    await fs.writeFile(fileURLToPath(new URL('./'+META_FILE, import.meta.url)), JSON.stringify(meta,null,2));
    await page.close(); await context.close();
  } finally { await browser.close(); }
}

// ---------- load ----------
async function measureLoad(args) {
  const project = path.resolve(args.project ?? process.cwd());
  const require = createRequire(path.join(project,'package.json'));
  let playwright; try { playwright = require('playwright'); } catch { throw new Error('frontend 下未找到 playwright。'); }
  const url = args.url ?? 'https://acacia.tandyblow.top/';
  const runs = Number(args.runs ?? 10), settleMs = Number(args['settle-ms'] ?? 2500);
  const out = path.resolve(args.out ?? 'production-editor-load');
  const label = args.label ?? 'unlabelled';
  const meta = JSON.parse(await fs.readFile(new URL('./'+META_FILE, import.meta.url),'utf8'));
  const browser = await launchBrowser(playwright);
  const result = { schemaVersion:1, kind:'editor-load', createdAt:new Date().toISOString(),
    options:{ url:safeURL(url), label, mode:'editor-load', runs, settleMs, readySelector:'.tiptap[contenteditable]（内容渲染后）' },
    environment:null, meta:{ docId:meta.docId, docChars:meta.payloadStats.chars, method:'storageState 登录；goto 后经 store.loadNode 打开测试文档' },
    samples:[], records:[] };
  const contexts = new Set();
  try {
    const git = spawnSync('git',['-C',project,'rev-parse','HEAD'],{encoding:'utf8'});
    const probe = await browser.newContext();
    const ppage = await probe.newPage();
    await ppage.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
    result.environment = { browser:browser.version(), channel:'msedge', headless:true,
      os:os.platform()+' '+os.release(), cpu:os.cpus()[0]?.model??'unknown', logicalCPUs:os.cpus().length,
      localGitCommit:git.status===0?git.stdout.trim():null };
    await ppage.close(); await probe.close();

    const { stateFile } = await ensureState(browser, url, args);
    const measure = async (context, cache, run) => {
      const page = await context.newPage();
      const records = []; attachLogs(page, records);
      const sample = { cache, run, label };
      try {
        const t0 = Date.now();
        const response = await page.goto(url, { waitUntil:'load', timeout:45000 });
        sample.documentStatus = response?.status() ?? null;
        if (sample.documentStatus >= 400) throw new Error('Document HTTP status '+sample.documentStatus);
        if (!await pageHasToken(page)) throw new Error('登录态未生效');
        // shell 就绪：登录后编辑器 DOM 挂载（或 2s 稳定）
        try {
          await page.locator('.tiptap[contenteditable]').first().waitFor({ state:'visible', timeout:20000 });
          sample.shell_ready_ms = Date.now()-t0;
        } catch { sample.shell_ready_ms = null; }
        // 打开测试文档并等正文渲染
        const t1 = Date.now();
        const opened = await openNodeViaStore(page, meta.docId);
        if (!opened.ok) throw new Error('loadNode 失败：'+opened.reason);
        await waitForEditorReady(page, { timeout:30000 });
        sample.ready_selector_ms = Date.now()-t1;
        await page.waitForTimeout(settleMs);
        sample.performance = await snapshot(page);
        sample.editor_text_length = sample.performance.editor_text_length;
      } catch (error) { sample.failure = scrub(error.message); }
      finally { await page.close(); }
      result.samples.push(sample);
      result.records.push(...records.map(r=>({...r, cache, run})));
      await saveResult(result, out);
      console.log(cache+' '+run+'/'+runs+(sample.failure?' 失败：'+sample.failure:' 已记录 ready='+Math.round(sample.ready_selector_ms??-1)+'ms'));
    };
    for (let run=1; run<=runs; run++) {
      const context = await newLoggedInContext(browser, stateFile);
      contexts.add(context);
      await measure(context,'cold',run);
      await context.close(); contexts.delete(context);
    }
    const warm = await newLoggedInContext(browser, stateFile); contexts.add(warm);
    await measure(warm,'warm',0); // 预热，不计入
    result.samples = result.samples.filter(s=>!(s.cache==='warm'&&s.run===0));
    for (let run=1; run<=runs; run++) await measure(warm,'warm',run);
    await warm.close(); contexts.delete(warm);
  } finally {
    await saveResult(result, out);
    for (const c of contexts) await c.close().catch(()=>{});
    await browser.close();
    console.log('输出目录：'+out);
  }
}

// ---------- actions ----------
async function measureActions(args) {
  const project = path.resolve(args.project ?? process.cwd());
  const require = createRequire(path.join(project,'package.json'));
  let playwright; try { playwright = require('playwright'); } catch { throw new Error('frontend 下未找到 playwright。'); }
  const url = args.url ?? 'https://acacia.tandyblow.top/';
  const out = path.resolve(args.out ?? 'production-editor-actions');
  const label = args.label ?? 'unlabelled';
  const meta = JSON.parse(await fs.readFile(new URL('./'+META_FILE, import.meta.url),'utf8'));
  const browser = await launchBrowser(playwright);
  const result = { schemaVersion:1, kind:'editor-actions', createdAt:new Date().toISOString(),
    options:{ url:safeURL(url), label, mode:'editor-actions', settleMs:1000 },
    environment:null, meta:{ docId:meta.docId, docChars:meta.payloadStats.chars, switchDocId:meta.switchDocId,
      method:'storageState 登录；文档开合经 store.loadNode；输入为真实键盘事件；粘贴为合成 ClipboardEvent(text/plain)' },
    samples:[], records:[] };
  try {
    const git = spawnSync('git',['-C',project,'rev-parse','HEAD'],{encoding:'utf8'});
    const { stateFile } = await ensureState(browser, url, args);
    const context = await newLoggedInContext(browser, stateFile);
    const page = await context.newPage();
    const records = []; attachLogs(page, records);
    await page.goto(url, { waitUntil:'load', timeout:45000 });
    await page.waitForFunction(() => !!localStorage.getItem('acacia_backend_token'), null, { timeout:15000 });
    await page.waitForTimeout(2500);
    result.environment = { browser:browser.version(), channel:'msedge', headless:true,
      os:os.platform()+' '+os.release(), cpu:os.cpus()[0]?.model??'unknown', logicalCPUs:os.cpus().length,
      localGitCommit:git.status===0?git.stdout.trim():null };

    let run = 0;
    const storeState = () => page.evaluate(() => {
      const st = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('node');
      return { active: st?.activeNode?.id ?? null, view: st?.viewState ?? null };
    });
    const serverTruth = () => page.evaluate(async (docId) => {
      const token = localStorage.getItem('acacia_backend_token');
      const res = await fetch(`/api/nodes/context/${docId}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      return { revision: data?.nodeInfo?.revision ?? null, contentLength: data?.nodeInfo?.content?.length ?? null };
    }, meta.docId);
    // 等到出现满足条件的 PATCH /content 响应（收集全部尝试及其状态）
    const collectSaveWrites = async (windowMs) => {
      const writes = [];
      const deadline = Date.now() + windowMs;
      while (Date.now() < deadline) {
        try {
          const resp = await page.waitForResponse(r => r.url().includes('/content') && r.request().method()==='PATCH', { timeout: Math.max(1000, deadline - Date.now()) });
          writes.push({ status: resp.status(), at: Date.now() });
          if (resp.status() === 200) break; // 成功保存即结束
        } catch { break; }
      }
      return writes;
    };
    const segment = async (segLabel, action) => {
      run += 1;
      const start = await page.evaluate(() => ({ now:performance.now(), timeOrigin:performance.timeOrigin }));
      const recordStart = records.length;
      let note = null;
      try { note = await action(); } catch (error) { note = { error: scrub(error.message) }; }
      await page.waitForTimeout(1000); // 与 kit 手动模式一致的动作后稳定观察
      const performanceData = await snapshot(page);
      const navigationChanged = performanceData.timeOrigin !== start.timeOrigin;
      const since = navigationChanged ? 0 : start.now;
      performanceData.longtasks = performanceData.longtasks.filter(e=>e.startTime>=since);
      performanceData.interactions = performanceData.interactions.filter(e=>e.startTime>=since);
      performanceData.resources = performanceData.resources.filter(e=>e.startTime>=since);
      performanceData.store = await storeState().catch(()=>null);
      const seg = records.slice(recordStart);
      result.records.push(...seg.map(r=>({...r, scenario:segLabel})));
      result.samples.push({ run, label:segLabel, navigationChanged, performance:performanceData, note });
      await saveResult(result, out);
      const save = (note&&note.saveWrites) ? ` 保存尝试 ${JSON.stringify(note.saveWrites)}` : '';
      const err = (note&&note.error) ? ' 失败：'+note.error : '';
      console.log(`记录 ${run}: ${segLabel} 长任务 ${performanceData.longtasks.length} 个${save}${err}`);
    };

    const waitStoreAndText = async (nodeId, minText, maxText, timeout=30000) => {
      await page.waitForFunction(({nodeId, minText, maxText}) => {
        const st = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$pinia?._s?.get('node');
        const len = document.querySelector('.tiptap[contenteditable]')?.innerText.length ?? 0;
        return st?.activeNode?.id === nodeId && len >= minText && (maxText == null || len <= maxText);
      }, { nodeId, minText, maxText }, { timeout });
    };

    const docSize = (meta.payloadStats.chars/10000).toFixed(1); // 万字，用于分段命名

    // 1. 打开一万字测试文档（从空状态；loadNode 后出现卡滞时重试一次）
    await segment(`打开${docSize}万字测试文档`, async () => {
      const openOnce = async () => {
        const t0 = Date.now();
        const opened = await openNodeViaStore(page, meta.docId);
        if (!opened.ok) return { openMs: Date.now()-t0, loadNodeError: opened.reason };
        try { await waitStoreAndText(meta.docId, READY_TEXT_MIN, null, 10000); return { openMs: Date.now()-t0 }; }
        catch { return { openMs: Date.now()-t0, stuck:true }; }
      };
      let note = await openOnce();
      if (note.stuck || note.loadNodeError) {
        note = { ...note, retried: true, ...(await openOnce()) };
      }
      if (note.stuck || note.loadNodeError) throw new Error('打开文档失败：'+JSON.stringify(note));
      return note;
    });

    // 2. 一次插入 280 字（真实键盘事件，evaluate 聚焦以避开覆盖层拦截指针），观察自动保存与服务器核验
    await segment('一次插入280字并观察自动保存', async () => {
      await page.evaluate(() => {
        const el = document.querySelector('.tiptap[contenteditable]');
        el.focus();
        const sel = window.getSelection();
        sel.selectAllChildren(el);
        sel.collapseToEnd();
      });
      await page.waitForTimeout(100);
      await page.keyboard.press('Control+End');
      const lenBefore = await page.evaluate(() => document.querySelector('.tiptap[contenteditable]')?.innerText.length ?? 0);
      await page.keyboard.insertText('性能测量输入段：'.repeat(35)); // 8 字 × 35 = 280 字，单次 insertText 插入
      await page.waitForFunction((base) => (document.querySelector('.tiptap[contenteditable]')?.innerText.length ?? 0) >= base + 250,
        lenBefore, { timeout: 10000 }).catch(()=>{});
      const len = await page.evaluate(() => document.querySelector('.tiptap[contenteditable]')?.innerText.length ?? 0);
      const saveWrites = await collectSaveWrites(20000);
      const serverAfter = await serverTruth();
      return { editorLenAfterType: len, insertedChars: len - lenBefore, saveWrites, serverAfter };
    });

    // 3. 粘贴约两千二百字符混合内容（真实剪贴板 + Ctrl+V），观察自动保存与服务器核验
    const paste = buildPasteText();
    await segment(`粘贴${paste.chars}字符混合内容并观察自动保存`, async () => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.evaluate((text) => navigator.clipboard.writeText(text), paste.text);
      await page.evaluate(() => {
        const el = document.querySelector('.tiptap[contenteditable]');
        el.focus();
        const sel = window.getSelection();
        sel.selectAllChildren(el);
        sel.collapseToEnd();
      });
      await page.waitForTimeout(100);
      await page.keyboard.press('Control+V');
      await page.waitForFunction((min) => (document.querySelector('.tiptap[contenteditable]')?.innerText.length ?? 0) >= min,
        paste.chars + 11000, { timeout: 20000 });
      const saveWrites = await collectSaveWrites(20000);
      const serverAfter = await serverTruth();
      return { saveWrites, serverAfter };
    });

    // 4. 切到轻量文档再切回（复用与画布点击相同的 loadNode；等待 store 与正文都到位）
    await segment('切换到轻量文档', async () => {
      const t0 = Date.now();
      const opened = await openNodeViaStore(page, meta.switchDocId);
      if (!opened.ok) throw new Error('loadNode 失败：'+opened.reason);
      await waitStoreAndText(meta.switchDocId, 1, 200, 20000);
      return { openMs: Date.now()-t0 };
    });
    await segment(`切回${docSize}万字文档`, async () => {
      const t0 = Date.now();
      const opened = await openNodeViaStore(page, meta.docId);
      if (!opened.ok) throw new Error('loadNode 失败：'+opened.reason);
      await waitStoreAndText(meta.docId, READY_TEXT_MIN, null, 30000);
      return { openMs: Date.now()-t0 };
    });

    result.meta.saveVerificationAfterAll = await serverTruth();
    await page.close(); await context.close();
  } finally {
    await saveResult(result, out);
    await browser.close();
    console.log('输出目录：'+out);
  }
}

// ---------- 保存与报告 ----------
const CSV_HEADERS = ['cache','run','label','failure','navigation_to_first_byte_ms','document_request_to_first_byte_ms',
  'fcp_ms','lcp_snapshot_ms','dom_content_loaded_ms','load_event_ms','shell_ready_ms','ready_selector_ms',
  'editor_text_length','observed_transfer_bytes','resource_count','longtask_count','longtask_total_ms'];

async function saveResult(result, out) {
  await fs.mkdir(out,{recursive:true});
  await fs.writeFile(path.join(out,'results.json'),JSON.stringify(result,null,2));
  const csvValue=v=>'"'+String(v??'').replaceAll('"','""')+'"';
  const rows=[CSV_HEADERS.map(csvValue).join(',')];
  for(const s of result.samples) {
    const row={cache:s.cache,run:s.run,label:s.label,failure:s.failure,...metricValues(s)};
    rows.push(CSV_HEADERS.map(key=>csvValue(row[key])).join(','));
  }
  await fs.writeFile(path.join(out,'measurements.csv'),'\uFEFF'+rows.join('\r\n')+'\r\n');
  await fs.writeFile(path.join(out,'browser-records.json'),JSON.stringify(result.records,null,2));
  await fs.writeFile(path.join(out,'report.md'),makeEditorReport(result));
}

function interactionTable(result) {
  const lines=['','| 操作记录 | 导航有无变化 | 可见交互数 | 交互中位数 ms | 长任务数 | 长任务累计 ms |','| --- | --- | --- | --- | --- | --- |'];
  for(const sample of result.samples) {
    if(!sample.performance) continue;
    const durations=new Map();
    for(const event of sample.performance.interactions) durations.set(event.interactionId,Math.max(durations.get(event.interactionId)??0,event.duration));
    const a=stats([...durations.values()]);
    lines.push('| '+sample.label.replaceAll('|','/')+' | '+(sample.navigationChanged?'有':'无')+' | '+a.n+' | '+formatNumber(a.median)+' | '+sample.performance.longtasks.length+' | '+formatNumber(sample.performance.longtasks.reduce((sum,e)=>sum+e.duration,0))+' |');
  }
  return lines;
}

function apiTable(records) {
  const apiGroups=new Map();
  for(const record of records) {
    if(record.kind!=='request' || !['fetch','xhr'].includes(record.resourceType)) continue;
    const key=record.method+' '+record.url;
    if(!apiGroups.has(key)) apiGroups.set(key,{attempts:0,errors:0,times:[]});
    const group=apiGroups.get(key);group.attempts++;
    if(record.status>=400) group.errors++;
    if(record.timing?.responseEnd>=0) group.times.push(record.timing.responseEnd);
  }
  const lines=['','| Fetch / XHR 请求 | 完成数 | HTTP 错误数 | 耗时中位数 ms | 本批样本 p95 ms |','| --- | --- | --- | --- | --- |'];
  for(const [key,group] of apiGroups) {
    const a=stats(group.times);
    lines.push('| '+key.replaceAll('|','/')+' | '+group.attempts+' | '+group.errors+' | '+formatNumber(a.median)+' | '+formatNumber(a.p95_sample)+' |');
  }
  if (apiGroups.size) lines.push('','请求时间由浏览器观测，包含网络与服务器等待，不等于后端代码自身执行时间。');
  return lines;
}

function makeEditorReport(result) {
  const e=result.environment ?? {};
  const lines=['Acacia 编辑器浏览器测量报告','',
    '运行时间：'+result.createdAt,
    '测试地址：'+result.options.url,
    '人工版本标签：'+result.options.label,
    '本地仓库提交：'+(e.localGitCommit ?? '未取得'),
    '浏览器：'+(e.browser??'未知'),
    '运行模式：'+result.options.mode+'；无界面运行：'+(e.headless??true),
    '操作系统：'+(e.os??'未知'),
    'CPU：'+(e.cpu??'未知'),
    '窗口：1440 × 900；CPU 与网络未设降速。',''];
  if (result.kind==='editor-load') {
    lines.push('方法：使用登录后的 storageState。每次访问先加载应用外壳，再经 nodeStore.loadNode（与树画布点击相同代码路径）打开 '+result.meta.docChars+' 字符的测试文档；ready_selector_ms 从 loadNode 调用起算，到 .tiptap[contenteditable] 可见且正文渲染完毕为止。shell_ready_ms 是加载完成到编辑器 DOM 挂载的时间。',
      '冷启动每次新建浏览器上下文（共享登录态，无 HTTP 缓存）；热启动共用一个上下文，先预热一遍。',
      '本测量未模拟真实输入设备点击树节点，打开文档不含指针定位与动画等待。','',
      '| 访问方式 | 成功 / 尝试 | 指标 | 有效样本 | 中位数 | 本批样本 p95 |','| --- | --- | --- | --- | --- | --- |');
    for(const cache of ['cold','warm']) {
      const attempts=result.samples.filter(s=>s.cache===cache);
      const success=attempts.filter(s=>s.performance && !s.failure);
      for(const metric of ['navigation_to_first_byte_ms','fcp_ms','lcp_snapshot_ms','shell_ready_ms','ready_selector_ms','observed_transfer_bytes','longtask_total_ms']) {
        const aggregate=stats(success.map(s=>metricValues(s)[metric]));
        lines.push('| '+cache+' | '+success.length+' / '+attempts.length+' | '+metric+' | '+aggregate.n+' | '+formatNumber(aggregate.median)+' | '+formatNumber(aggregate.p95_sample)+' |');
      }
    }
    lines.push('','p95 使用本批样本的排序位置计算。失败样本保留在 results.json，不混入成功耗时统计。');
  } else {
    lines.push('方法：登录后按分段执行操作。打开/切换文档经 nodeStore.loadNode（与画布点击相同代码路径），以 store.activeNode 与编辑区正文字数双条件确认到位；文本输入为一次 insertText 插入（真实键盘事件，evaluate 聚焦以避开覆盖层对指针的拦截）；粘贴为真实系统剪贴板写入后发送 Ctrl+V。每段结束后固定观察 1 秒。',
      '性能观察器（longtask / event / LCP）经 addInitScript 注入每个页面；涉及自动保存的分段记录观察窗内全部 PATCH /content 尝试及状态码，并直接向服务器核对内容长度；打开文档出现卡滞时重试一次并在备注注明。',
      '交互计时来自 Event Timing，程序化触发不含真实指针事件，可见交互数偏低属预期。');
    lines.push(...interactionTable(result));
    const notes=result.samples.map(s=>s.note?('| '+s.label+' | '+JSON.stringify(s.note)+' |'):'').filter(Boolean);
    if(notes.length) lines.push('','| 操作记录 | 备注 |','| --- | --- |',...notes);
  }
  lines.push(...apiTable(result.records));
  lines.push('','排错记录见 browser-records.json。记录不含 Cookie、请求头、请求正文、响应正文、截图、会话存储；常见凭证文本与 URL 查询参数已移除。',
    '登录口令仅经环境变量传入脚本；会话令牌（storageState）写入系统临时目录的 JSON 以复用登录态，测量结束后删除，不进入本目录输出。',
    '这些文件记录运行时观察。性能改善幅度需要使用同一浏览器、设备、文档、操作与采集参数，对照两个明确的版本计算。',
    '本报告未替简历填入性能改善数值，也未把本机结果推定为全部用户结果。');
  return lines.join('\n')+'\n';
}

// ---------- 入口 ----------
async function main() {
  const argv = process.argv.slice(2);
  const phase = argv.shift();
  const args = {};
  for (let i=0;i<argv.length;i++) { const k=argv[i]; if(!k.startsWith('--')) continue; args[k.slice(2)] = (argv[i+1] && !argv[i+1].startsWith('--')) ? argv[++i] : true; }
  if (phase==='probe') await probe(args);
  else if (phase==='load') await measureLoad(args);
  else if (phase==='actions') await measureActions(args);
  else throw new Error('用法：node editor-measure.mjs probe|load|actions [--project ...] [--url ...] ...');
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error=>{console.error(scrub(error.message));process.exitCode=1;});
}
