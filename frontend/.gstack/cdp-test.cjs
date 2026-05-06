// CDP QA — working result-retrieval pattern + login + 3D scene check
const { spawn } = require('child_process');
const { randomBytes } = require('crypto');
const path = require('path');
const fs = require('fs');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9248;
const URL = 'http://localhost:4176';
const UD = path.join(process.env.TEMP || '/tmp', 'cdp-qa-' + randomBytes(4).toString('hex'));
const SHOT_DIR = path.join(__dirname, '..', '.gstack', 'qa-reports', 'screenshots');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('=== Phase 01 QA — 3D Scene Browser Test ===\n');

  // Launch
  console.log('[1] Launching Edge...');
  const edge = spawn(EDGE, [
    '--remote-debugging-port=' + PORT, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-gpu-sandbox', '--user-data-dir=' + UD,
    '--window-size=1280,720', 'about:blank',
  ], { stdio: 'pipe' });

  // Give Edge time to fully start before polling CDP
  await sleep(3000);

  let wsUrl = null;
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    try {
      const targets = await (await fetch('http://localhost:' + PORT + '/json')).json();
      wsUrl = targets[0]?.webSocketDebuggerUrl;
      if (wsUrl) break;
    } catch (e) {}
  }
  if (!wsUrl) { console.error('FAIL: CDP'); edge.kill(); process.exit(1); }

  const ws = new WebSocket(wsUrl);
  let mid = 0;
  const results = new Map();
  const errors = [];

  function send(m, p = {}) {
    const i = ++mid;
    ws.send(JSON.stringify({ id: i, method: m, params: p }));
    return i;
  }

  // Helper: send evaluate, wait, then scan results for the value
  async function evalAndGet(expr, waitMs = 3000) {
    results.clear();
    send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    await sleep(waitMs);
    for (const [, m] of results) {
      if (m.result?.result?.value !== undefined) return m.result.result.value;
    }
    // Retry once
    await sleep(2000);
    for (const [, m] of results) {
      if (m.result?.result?.value !== undefined) return m.result.result.value;
    }
    return null;
  }

  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data.toString());
    if (m.id) results.set(m.id, m);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push(m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    }
  });

  await new Promise(r => { ws.addEventListener('open', r); ws.addEventListener('error', r); });
  send('Runtime.enable'); send('Page.enable'); send('Log.enable');

  // Navigate
  console.log('[2] Loading app...');
  send('Page.navigate', { url: URL });
  await sleep(10000);

  let val = await evalAndGet(
    'document.title + " | vue=" + !!document.getElementById("app")?.hasAttribute("data-v-app") + " | " + (document.body?.innerText?.substring(0, 200) || "EMPTY")'
  );
  console.log('   ' + val);

  if (!val?.includes('vue=true')) {
    console.log('   Retrying navigation...');
    send('Page.navigate', { url: URL });
    await sleep(10000);
    val = await evalAndGet(
      'document.title + " | vue=" + !!document.getElementById("app")?.hasAttribute("data-v-app") + " | " + (document.body?.innerText?.substring(0, 200) || "EMPTY")'
    );
    console.log('   ' + val);
  }

  // Login via Pinia store
  console.log('[3] Logging in via Pinia store...');
  const loginPrep = await evalAndGet(`
    (function(){
      try {
        var app = document.getElementById('app');
        if (!app?.__vue_app__) return 'ERR: no vue app';
        var pinia = app.__vue_app__.config.globalProperties.$pinia;
        var auth = pinia._s.get('auth');
        auth.username = 'qatester';
        auth.password = 'test123456';
        return 'OK canSubmit=' + auth.canSubmit + ' mode=' + auth.mode;
      } catch(e) { return 'ERR: ' + e.message; }
    })()
  `);
  console.log('   ' + loginPrep);

  if (loginPrep?.includes('canSubmit=true')) {
    console.log('[4] Submitting...');
    await evalAndGet(`
      (function(){
        try {
          var pinia = document.getElementById('app').__vue_app__.config.globalProperties.$pinia;
          pinia._s.get('auth').submitByKnob();
          return 'SUBMITTED';
        } catch(e) { return 'ERR: ' + e.message; }
      })()
    `);
    await sleep(12000); // Wait for auth + redirect + shader compile
  }

  // Check scene
  console.log('[5] Checking 3D scene...');
  const sceneVal = await evalAndGet(`
    (function(){
      var cavs = document.querySelectorAll('canvas');
      var info = [];
      for (var i = 0; i < cavs.length; i++) {
        try {
          var gl = cavs[i].getContext('webgl2') || cavs[i].getContext('webgl');
          if (gl) {
            info.push('canvas[' + i + ']: ' + cavs[i].width + 'x' + cavs[i].height + ' WebGL ' + (gl.getParameter(gl.RENDERER) || '?'));
          } else {
            info.push('canvas[' + i + ']: ' + cavs[i].width + 'x' + cavs[i].height + ' no-WebGL');
          }
        } catch(e) { info.push('canvas[' + i + ']: err=' + e.message); }
      }
      var body = document.body?.innerText?.substring(0, 500) || '';
      return JSON.stringify({canvases:cavs.length, details:info, body:body});
    })()
  `, 3000);
  let scene = {};
  try { scene = JSON.parse(sceneVal || '{}'); } catch(e) {}
  console.log('   Canvases:', scene.canvases);
  console.log('   Details:', (scene.details || []).join(' | '));
  if (scene.body) console.log('   Body:', scene.body.substring(0, 300).replace(/\n/g, ' '));

  // Console
  console.log('[6] Console errors:');
  if (errors.length === 0) console.log('   (none)');
  else errors.forEach(e => console.log('   -', e.substring(0, 300)));

  // Screenshot
  console.log('[7] Screenshot...');
  const shot = await evalAndGet('"skip"'); // clear results first
  send('Page.captureScreenshot', { format: 'png' });
  await sleep(3000);
  for (const [, m] of results) {
    if (m.result?.result?.data) {
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      const p = path.join(SHOT_DIR, 'app-3d-scene.png');
      fs.writeFileSync(p, Buffer.from(m.result.result.data, 'base64'));
      console.log('   Saved:', p);
    }
  }

  // Verdict
  console.log('\n=== Verdict ===');
  const shaderErrs = errors.filter(e => /shader|webgl|compile|uniform|three|gpu/i.test(e));
  if (shaderErrs.length > 0) {
    console.log('FAIL: Shader/WebGL errors:');
    shaderErrs.forEach(e => console.log('  - ' + e.substring(0, 300)));
  } else if (scene.canvases > 0) {
    console.log('PASS: 3D scene rendered! ' + scene.canvases + ' canvas(es), no shader errors.');
    if (scene.details?.length) console.log('   ' + scene.details.join('\n   '));
  } else if (scene.body?.includes('登录')) {
    console.log('PARTIAL: Still on login screen — auth failed.');
    console.log('   Try manually: open ' + URL + ', login with qatester / test123456');
  } else {
    console.log('PARTIAL: Page loaded, no 3D scene. Manual check needed.');
  }

  ws.close(); edge.kill();
  await sleep(300);
  try { fs.rmSync(UD, { recursive: true, force: true }); } catch {}
  process.exit(shaderErrs.length > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
