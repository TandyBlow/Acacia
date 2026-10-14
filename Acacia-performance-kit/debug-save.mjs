// 受控复现：自动保存是否带 If-Match；428 后应用作何反应；服务器最终内容。
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { scrub, safeURL } from './acacia-measure.mjs';

const project = process.argv[2] ?? 'D:\\others\\Acacia\\frontend';
const url = 'https://acacia.tandyblow.top/';
const require = createRequire(path.join(project, 'package.json'));
const { chromium } = require('playwright');
const meta = JSON.parse(await fs.readFile(new URL('./.editor-measure-meta.json', import.meta.url), 'utf8'));
const stateFile = process.argv[3] ?? path.join(os.tmpdir(), 'acacia-editor-state-1791989628869.json');

const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'allow', storageState: stateFile });
const page = await context.newPage();
await page.goto(url, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => !!localStorage.getItem('acacia_backend_token'), null, { timeout: 15000 });

// 1. 服务器现状（不经 UI）
const truth = await page.evaluate(async (docId) => {
  const token = localStorage.getItem('acacia_backend_token');
  const res = await fetch(`/api/nodes/context/${docId}`, { headers: { Authorization: `Bearer ${token}` } });
  const etag = res.headers.get('ETag');
  const data = await res.json();
  return { etag, revision: data?.nodeInfo?.revision ?? null, contentLength: data?.nodeInfo?.content?.length ?? null, name: data?.nodeInfo?.name ?? null };
}, meta.docId);
console.log('SERVER TRUTH:', JSON.stringify(truth));

// 2. UI 内复现保存
const saves = [];
page.on('requestfinished', async (req) => {
  if (!req.url().includes('/content') || req.method() !== 'PATCH') return;
  const headers = req.headers();
  saves.push({ at: new Date().toISOString(), ifMatchPresent: !!headers['if-match'], ifMatch: headers['if-match'] ? scrub(headers['if-match']) : null, status: (await req.response())?.status() ?? null });
});
const consoleErrors = [];
page.on('console', m => { if (['error', 'warning'].includes(m.type())) consoleErrors.push(scrub(m.text()).slice(0, 300)); });

const app = () => page.evaluate(() => {
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
  return pinia._s.get('node');
});
// 记录 activeNode 变化
let lastNode = null;
const watch = setInterval(async () => {
  try {
    const s = await page.evaluate(() => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const st = pinia._s.get('node');
      const conflictPanel = document.querySelector('[class*="conflict" i], [class*="Conflict"]');
      return { active: st?.activeNode?.id ?? null, rev: st?.activeNode?.revision ?? null, view: st?.viewState ?? null, busy: st?.isBusy ?? null,
        editorLen: document.querySelector('.tiptap[contenteditable]')?.innerText.length ?? 0,
        conflictVisible: !!conflictPanel, conflictText: conflictPanel ? conflictPanel.innerText.slice(0, 120) : null };
    });
    if (s.active !== lastNode) { console.log('ACTIVE NODE →', s.active, 'rev=' + s.rev, 'view=' + s.view); lastNode = s.active; }
  } catch { /* page navigating */ }
}, 300);

// 打开文档（带诊断重试）
const openAndDiagnose = async () => {
  await page.evaluate(async (id) => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    await pinia._s.get('node').loadNode(id);
  }, meta.docId);
  try {
    await page.locator('.tiptap[contenteditable]').first().waitFor({ state: 'visible', timeout: 10000 });
    return true;
  } catch {
    const diag = await page.evaluate(() => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const st = pinia._s.get('node');
      const auth = pinia._s.get('auth');
      return { view: st?.viewState, active: st?.activeNode?.id ?? null, busy: st?.isBusy, err: st?.errorMessage ?? null,
        authed: auth?.isAuthenticated ?? null, editorMounted: !!document.querySelector('.tiptap[contenteditable]'),
        canvas: document.querySelectorAll('canvas').length, appChildren: document.querySelector('#app')?.children.length ?? 0,
        bodyLen: document.body.innerText.length };
    });
    console.log('EDITOR NOT VISIBLE, DIAG:', JSON.stringify(diag));
    return false;
  }
};
let opened = await openAndDiagnose();
if (!opened) {
  console.log('retrying loadNode once...');
  opened = await openAndDiagnose();
}
if (!opened) { console.log('giving up'); await browser.close(); process.exit(2); }
await page.waitForTimeout(1500);

// 敲 10 个字符
await page.locator('.tiptap[contenteditable]').first().click();
await page.keyboard.press('Control+End');
await page.keyboard.type('ABCDEFGHIJ', { delay: 20 });
console.log('typed, waiting for save requests...');

await page.waitForTimeout(15000);
clearInterval(watch);
const final = await page.evaluate(() => {
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
  const st = pinia._s.get('node');
  return { active: st?.activeNode?.id, editorLen: document.querySelector('.tiptap[contenteditable]')?.innerText.length ?? 0,
    bodySnippet: document.body.innerText.slice(0, 0) };
});
console.log('SAVE REQUESTS:', JSON.stringify(saves, null, 1));
console.log('CONSOLE ERRORS:', consoleErrors.slice(0, 5));
console.log('FINAL:', JSON.stringify(final));

// 3. 再查一次服务器
await page.waitForTimeout(3000);
const truth2 = await page.evaluate(async (docId) => {
  const token = localStorage.getItem('acacia_backend_token');
  const res = await fetch(`/api/nodes/context/${docId}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  return { etag: res.headers.get('ETag'), revision: data?.nodeInfo?.revision ?? null, contentLength: data?.nodeInfo?.content?.length ?? null };
}, meta.docId);
console.log('SERVER AFTER:', JSON.stringify(truth2));
await browser.close();
