import puppeteer from 'puppeteer';
import { writeFileSync } from 'fs';

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

// Set height=0.3, barrelK=0.8, fade=0.05
await page.evaluate(() => {
  const guiEl = document.querySelector('.lil-gui');
  if (!guiEl) return 'no gui';
  // lil-gui stores the GUI instance on the DOM element
  const gui = guiEl.__gui || guiEl;
  const controllers = gui.controllersRecursive ? gui.controllersRecursive() : [];
  for (const c of controllers) {
    const label = c.$name?.textContent || '';
    if (label.includes('Height') || label.includes('高度')) c.setValue(0.3);
    if (label.includes('BarrelK') || label.includes('弧度')) c.setValue(0.8);
    if (label.includes('Fade') || label.includes('渐隐')) c.setValue(0.05);
  }
  return `set ${controllers.length} controllers`;
});
await new Promise(r => setTimeout(r, 2000));

// Read pixel data from canvas
const pixelData = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  const tmp = document.createElement('canvas');
  tmp.width = canvas.width; tmp.height = canvas.height;
  const ctx = tmp.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  const cx = Math.floor(canvas.width/2);
  const h = canvas.height;
  const result = [];
  for (let pct = 65; pct <= 100; pct += 3) {
    const y = Math.floor(h * pct / 100);
    const d = ctx.getImageData(cx, y, 1, 1).data;
    result.push(pct + '%: rgba(' + d[0] + ',' + d[1] + ',' + d[2] + ',' + d[3] + ')');
  }
  return result.join('\n');
});
console.log('Bottom pixels (height=0.3, barrelK=0.8, fade=0.05):');
console.log(pixelData);

await page.screenshot({path: '_param_final2.png'});
console.log('Screenshot saved');
await browser.close();
