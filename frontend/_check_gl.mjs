import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({headless: true, args: ['--no-sandbox']});
const page = await browser.newPage();
await page.setViewport({width: 1280, height: 800});
await page.goto('http://localhost:5173', {waitUntil: 'networkidle2'});

// Login
const usernameInput = await page.$('input[type="text"]');
const passwordInput = await page.$('input[type="password"]');
await usernameInput.click({clickCount: 3});
await usernameInput.type('test');
await passwordInput.click({clickCount: 3});
await passwordInput.type('test');
const knob = await page.$('.knob-hit-area');
const box = await knob.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await new Promise(r => setTimeout(r, 1200));
await page.mouse.up();
await new Promise(r => setTimeout(r, 4000));

// Read bottom 10% of the rendered canvas
const canvasData = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  if (!canvas) return {error: 'No canvas element'};
  const gl = canvas.getContext('webgl') || canvas.getContext('webgl2');
  
  // Use 2d context on a copy
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = canvas.width;
  tmpCanvas.height = canvas.height;
  const ctx = tmpCanvas.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  
  const w = canvas.width, h = canvas.height;
  // Sample bottom 15% of the canvas
  const bottomH = Math.floor(h * 0.15);
  const data = ctx.getImageData(0, h - bottomH, w, bottomH);
  
  // Sample a few rows
  const rows = {};
  for (const yOff of [0, Math.floor(bottomH/4), Math.floor(bottomH/2), Math.floor(bottomH*3/4), bottomH-1]) {
    const row = [];
    for (const xOff of [0, Math.floor(w/4), Math.floor(w/2), Math.floor(w*3/4), w-1]) {
      const i = (yOff * w + xOff) * 4;
      row.push({x: xOff, r: data.data[i], g: data.data[i+1], b: data.data[i+2], a: data.data[i+3]});
    }
    rows[`y=${h-bottomH+yOff}`] = row;
  }
  return {canvasWidth: w, canvasHeight: h, bottomRegion: rows};
});

console.log('Canvas:', canvasData.canvasWidth, 'x', canvasData.canvasHeight);
console.log('Bottom 15% pixel samples:');
for (const [yLabel, pixels] of Object.entries(canvasData.bottomRegion)) {
  console.log(`  ${yLabel}:`);
  for (const p of pixels) {
    console.log(`    x=${p.x}: rgba(${p.r},${p.g},${p.b},${p.a})`);
  }
}

await browser.close();
