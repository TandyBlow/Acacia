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

// Set uPlatformHeight to 0.5 via DebugGUI DOM manipulation
await page.evaluate(() => {
  // lil-gui exposes its controllers
  const gui = document.querySelector('.lil-gui');
  if (gui && gui.__gui) {
    const controllers = gui.__gui.controllers;
    const heightCtrl = controllers.find(c => c._name === '高度 (Height)');
    if (heightCtrl) {
      heightCtrl.setValue(0.5);
    }
  }
});

await new Promise(r => setTimeout(r, 1000));

// Read bottom region pixels
const bottomPixels = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = canvas.width;
  tmpCanvas.height = canvas.height;
  const ctx = tmpCanvas.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  
  const centerX = Math.floor(canvas.width / 2);
  const h = canvas.height;
  const rows = [];
  for (let yPct of [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 98, 100]) {
    const y = Math.floor(h * yPct / 100);
    const d = ctx.getImageData(centerX, y, 1, 1).data;
    rows.push({pct: yPct, y, rgb: `rgb(${d[0]},${d[1]},${d[2]})`});
  }
  return rows;
});

console.log('With uPlatformHeight=0.5:');
for (const r of bottomPixels) {
  console.log(`  ${r.pct}% (y=${r.y}): ${r.rgb}`);
}

await page.screenshot({path: '_param_height05.png'});

await browser.close();
