// 修复后保存验证（带诊断）：UI 建 ADD 面板填名，转储 store 状态，
// 旋钮不生效则直接调 store.confirmOperation（与旋钮同一动作），然后键盘输入验证保存。
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const project = 'D:\\others\\Acacia\\frontend';
const url = 'https://acacia.tandyblow.top/';
const require = createRequire(path.join(project, 'package.json'));
const { chromium } = require('playwright');
const DOC_NAME = 'perf-保存验证-2026-10-15';

const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'allow' });
const page = await context.newPage();

const saves = [];
page.on('requestfinished', async (req) => {
  if (!req.url().includes('/nodes') && !req.url().includes('/tree')) return;
  const entry = { at: new Date().toISOString(), method: req.method(), url: req.url().replace(/\/[0-9a-f-]{36}/, '/:id'), ifMatch: req.headers()['if-match'] ?? null };
  try { entry.status = (await req.response())?.status() ?? null; } catch { /* page closed */ }
  saves.push(entry);
});

// 1. 登录
await page.goto(url, { waitUntil: 'load', timeout: 45000 });
const userInput = page.locator('input.field-input[type="text"]').first();
await userInput.waitFor({ state: 'visible', timeout: 30000 });
await userInput.fill(process.env.ACACIA_USER ?? '');
await page.locator('input.field-input[type="password"]').first().fill(process.env.ACACIA_PASS ?? '');
const loginResponse = page.waitForResponse(r => r.url().includes('/auth/login') && r.request().method() === 'POST', { timeout: 30000 });
await page.locator('button.knob-hit-area').first().click({ delay: 1200 });
console.log('login:', (await loginResponse).status());
await page.waitForFunction(() => !!localStorage.getItem('acacia_backend_token'), null, { timeout: 15000 });
await page.waitForTimeout(3000);

// 2. UI 进入 ADD 并填名
await page.locator('.add-shell').first().click();
const nameInput = page.locator('input.name-input');
await nameInput.waitFor({ state: 'visible', timeout: 20000 });
await nameInput.fill(DOC_NAME);
await page.waitForTimeout(300);
const addState = await page.evaluate(() => {
  const st = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('node');
  return { view: st.viewState, name: st.pendingNodeName, canConfirm: st.canConfirm, busy: st.isBusy };
});
console.log('ADD state:', JSON.stringify(addState));

// 3. 确认：先试旋钮，POST 未出现则直接调 confirmOperation
let createdVia = 'knob';
const createResponse = page.waitForResponse(r => r.url().endsWith('/nodes') && r.request().method() === 'POST', { timeout: 8000 }).catch(() => null);
await page.locator('button.knob-hit-area').first().click({ delay: 1200 });
let created = await createResponse;
if (!created) {
  createdVia = 'store.confirmOperation';
  const confirmResponse = page.waitForResponse(r => r.url().endsWith('/nodes') && r.request().method() === 'POST', { timeout: 20000 }).catch(() => null);
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('node').confirmOperation());
  created = await confirmResponse;
}
if (!created) { console.log('CREATE FAILED both ways'); await browser.close(); process.exit(2); }
const createdBody = await created.json().catch(() => null);
console.log(`create node via ${createdVia}:`, created.status(), createdBody?.id ?? null);

// 4. 等编辑器出现并输入
await page.locator('.tiptap[contenteditable]').first().waitFor({ state: 'visible', timeout: 30000 });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const el = document.querySelector('.tiptap[contenteditable]');
  el.focus();
  const sel = window.getSelection();
  sel.selectAllChildren(el);
  sel.collapseToEnd();
});
await page.keyboard.type('保存验证文本：If-Match 应随请求发出并返回 200。', { delay: 15 });
console.log('typed, waiting for autosave PATCH...');

// 5. PATCH 结果
let patch = null;
try {
  const pr = await page.waitForResponse(r => r.url().includes('/content') && r.request().method() === 'PATCH', { timeout: 30000 });
  patch = { status: pr.status() };
} catch { patch = { status: 'timeout' }; }
await page.waitForTimeout(2000);

// 6. 服务器核验
const truth = await page.evaluate(async (name) => {
  const token = localStorage.getItem('acacia_backend_token');
  const tree = await (await fetch('/api/tree', { headers: { Authorization: `Bearer ${token}` } })).json();
  const walk = (nodes) => { for (const n of nodes) { if (n.name === name) return n; if (n.children?.length) { const hit = walk(n.children); if (hit) return hit; } } return null; };
  const node = walk(tree);
  if (!node) return { found: false };
  const ctx = await (await fetch(`/api/nodes/context/${node.id}`, { headers: { Authorization: `Bearer ${token}` } })).json();
  return { found: true, id: node.id, revision: ctx?.nodeInfo?.revision ?? null, contentLength: ctx?.nodeInfo?.content?.length ?? null, contentHasText: (ctx?.nodeInfo?.content ?? '').includes('If-Match') };
}, DOC_NAME);

console.log('PATCH:', JSON.stringify(patch));
console.log('nodes/tree requests:', JSON.stringify(saves, null, 1));
console.log('SERVER TRUTH:', JSON.stringify(truth));

await page.close();
const stateFile = path.join(os.tmpdir(), 'acacia-verify-state.json');
await fs.writeFile(stateFile, JSON.stringify(await context.storageState()));
await context.close();
await browser.close();
console.log('state kept at', stateFile);
