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

// Read entire canvas vertical profile (center column) - complete
const profile = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = canvas.width;
  tmpCanvas.height = canvas.height;
  const ctx = tmpCanvas.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  
  const w = canvas.width, h = canvas.height;
  const centerX = Math.floor(w / 2);
  const data = ctx.getImageData(centerX, 0, 1, h);
  
  const rows = [];
  // Sample every 8 pixels for full coverage
  for (let y = 0; y < h; y += 8) {
    const i = y * 4;
    rows.push({y, r: data.data[i], g: data.data[i+1], b: data.data[i+2]});
  }
  return {totalHeight: h, rows};
});

// Print as compact format, grouping by color similarity
console.log(`Canvas height: ${profile.totalHeight}`);
let prevR = -1;
for (const p of profile.rows) {
  // Only print when color changes noticeably
  if (Math.abs(p.r - prevR) > 5 || true) {
    const pct = Math.round(p.y / profile.totalHeight * 100);
    console.log(`  y=${p.y} (${pct}%): rgb(${p.r},${p.g},${p.b})`);
    prevR = p.r;
  }
}

await browser.close();
