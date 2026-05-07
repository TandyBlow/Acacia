import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({headless: true, args: ['--no-sandbox']});
const page = await browser.newPage();
await page.setViewport({width: 1280, height: 800});
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

// Set extreme values: height=0.5, barrelK=0.8, fade=0.1
await page.evaluate(() => {
  const gui = document.querySelector('.lil-gui');
  if (gui && gui.__gui) {
    for (const c of gui.__gui.controllersRecursive()) {
      if (c._name === '高度 (Height)') c.setValue(0.5);
      if (c._name === '弧度 (BarrelK)') c.setValue(0.8);
      if (c._name === '渐隐 (Fade)') c.setValue(0.1);
    }
  }
});
await new Promise(r => setTimeout(r, 1000));

// Now also directly force texture alpha to 1.0 by injecting a white texture
// to test if the shader compositing logic works independently of the real texture
await page.evaluate(() => {
  // Replace billboard texture with a solid red texture to see if compositing works
  const canvas = document.querySelector('canvas');
  // Can't modify shader uniforms from here without Three.js reference
});

await page.screenshot({path: '_extreme_params.png'});

// Compare bottom region with original
const pixels = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = canvas.width; tmpCanvas.height = canvas.height;
  const ctx = tmpCanvas.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  const centerX = Math.floor(canvas.width/2);
  const h = canvas.height;
  const rows = [];
  for (let pct of [30, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95]) {
    const y = Math.floor(h * pct / 100);
    const d = ctx.getImageData(centerX, y, 1, 1).data;
    rows.push({pct, y, rgb: `rgb(${d[0]},${d[1]},${d[2]})`});
  }
  return rows;
});
console.log('Extreme params (height=0.5, barrelK=0.8, fade=0.1):');
for (const r of pixels) console.log(`  ${r.pct}%: ${r.rgb}`);

await browser.close();
