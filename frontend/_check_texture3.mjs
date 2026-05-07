import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({headless: true, args: ['--no-sandbox']});
const page = await browser.newPage();
await page.goto('http://localhost:5173', {waitUntil: 'networkidle2'});

const result = await page.evaluate(async () => {
  const resp = await fetch('/platform-billboard.png');
  const blob = await resp.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  
  const w = bitmap.width, h = bitmap.height;
  const samples = {};
  const positions = [
    ['top-center', w/2, 0],
    ['mid-left', 0, h/2],
    ['mid-center', w/2, h/2],
    ['bottom-left', 0, h-1],
    ['bottom-center', w/2, h-1],
    ['bottom-right', w-1, h-1],
  ];
  
  for (const [name, x, y] of positions) {
    const d = ctx.getImageData(x, y, 1, 1).data;
    samples[name] = {r: d[0], g: d[1], b: d[2], a: d[3]};
  }
  
  // Count opaque vs transparent pixels (sample every 64th pixel)
  let opaque = 0, semi = 0, transparent = 0;
  for (let y = 0; y < h; y += 32) {
    for (let x = 0; x < w; x += 32) {
      const d = ctx.getImageData(x, y, 1, 1).data;
      if (d[3] > 200) opaque++;
      else if (d[3] > 10) semi++;
      else transparent++;
    }
  }
  
  return {width: w, height: h, samples, opaque, semi, transparent};
});
console.log('Size:', result.width, 'x', result.height);
console.log('Pixel samples:');
for (const [name, px] of Object.entries(result.samples)) {
  console.log(`  ${name}: rgba(${px.r},${px.g},${px.b},${px.a})`);
}
console.log('Opacity distribution (sampled):', JSON.stringify({opaque: result.opaque, semi: result.semi, transparent: result.transparent}));

await browser.close();
