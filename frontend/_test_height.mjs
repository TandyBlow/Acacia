import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({headless: true, args: ['--no-sandbox']});
const page = await browser.newPage();
await page.setViewport({width: 1280, height: 800});

page.on('console', msg => {
  const text = msg.text();
  if (text.includes('platform') || text.includes('Platform') || text.includes('texture') || text.includes('Texture') || text.includes('Failed') || text.includes('Background')) {
    console.log('LOG:', msg.type(), text.substring(0, 200));
  }
});

await page.goto('http://localhost:5173', {waitUntil: 'networkidle2'});
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

// Now inject code to change uPlatformHeight to 0.3 and screenshot
await page.evaluate(() => {
  // Find the lil-gui controller for Height and set it to 0.3
  const canvas = document.querySelector('canvas');
  if (canvas) {
    // Access WebGL directly to modify the uniform
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    // This won't work directly, need to go through Three.js
  }
});

// Use a simpler approach: modify the debug GUI slider
// Find and click the "Billboard" folder, then set height
const heightSlider = await page.$('.lil-gui .billboard .slider');
// Actually let's just use the SceneManager approach

// Let me try: modify the background mesh material uniform directly
await page.evaluate(() => {
  // Traverse Vue tree to find SceneManager
  const app = document.querySelector('#app');
  const vm = app.__vue_app__;
  // Or just modify via the debug GUI API
});

// Actually simplest: use page.evaluate to find the Three scene and modify uniform
const result = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  if (!canvas) return 'no canvas';
  
  // Get all WebGL programs
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) return 'no gl';
  
  const programs = gl.getParameter(gl.NUM_PROGRAMS);
  return `Found ${programs} WebGL programs, canvas ${canvas.width}x${canvas.height}`;
});
console.log(result);

await browser.close();
