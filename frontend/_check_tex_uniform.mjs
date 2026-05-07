import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({headless: true, args: ['--no-sandbox']});
const page = await browser.newPage();
await page.setViewport({width: 1280, height: 800});
await page.goto('http://localhost:5173', {waitUntil: 'networkidle2'});

// Login
const uI = await page.$('input[type="text"]');
const pI = await page.$('input[type="password"]');
await uI.click({clickCount: 3}); await uI.type('test');
await pI.click({clickCount: 3}); await pI.type('test');
const knob = await page.$('.knob-hit-area');
const b = await knob.boundingBox();
await page.mouse.move(b.x+b.width/2, b.y+b.height/2);
await page.mouse.down();
await new Promise(r => setTimeout(r, 1200));
await page.mouse.up();
await new Promise(r => setTimeout(r, 4000));

// Inject a debug function into the page to access the Three.js renderer internals
const texInfo = await page.evaluate(() => {
  // Find the canvas and its WebGL context
  const canvas = document.querySelector('canvas');
  if (!canvas) return {error: 'no canvas'};
  
  // Look for Three.js renderer internals via __THREE_DEVTOOLS_HOOK__
  // Or traverse the DOM for Vue component references
  const app = document.querySelector('#app').__vue_app__;
  if (!app) return {error: 'no vue app'};
  
  // Try to find the scene through Three.js internals
  const allObjects = [];
  const renderer = canvas.__threeRenderer;
  
  return {canvasSize: `${canvas.width}x${canvas.height}`, hasVue: !!app, hasRenderer: !!renderer};
});

console.log('Scene access:', JSON.stringify(texInfo));

// Alternative: check console for texture loading logs
const logs = [];
page.on('console', msg => {
  if (msg.text().includes('platform') || msg.text().includes('Platform') || msg.text().includes('texture') || msg.text().includes('Texture')) {
    logs.push(msg.text());
  }
});

// Reload to catch texture loading logs
await page.reload({waitUntil: 'networkidle2'});
await uI = await page.$('input[type="text"]');
await pI = await page.$('input[type="password"]');
await uI.click({clickCount: 3}); await uI.type('test');
await pI.click({clickCount: 3}); await pI.type('test');
const knob2 = await page.$('.knob-hit-area');
const b2 = await knob2.boundingBox();
await page.mouse.move(b2.x+b2.width/2, b2.y+b2.height/2);
await page.mouse.down();
await new Promise(r => setTimeout(r, 1200));
await page.mouse.up();
await new Promise(r => setTimeout(r, 4000));

console.log('Texture-related logs:', logs);

await browser.close();
