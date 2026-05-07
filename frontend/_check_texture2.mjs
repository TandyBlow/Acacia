import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({headless: true, args: ['--no-sandbox']});
const page = await browser.newPage();
await page.goto('http://localhost:5173', {waitUntil: 'networkidle2'});

const result = await page.evaluate(async () => {
  try {
    const resp = await fetch('/platform-billboard.png');
    const blob = await resp.blob();
    const bitmap = await createImageBitmap(blob);
    // Draw to canvas to check pixel data
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, Math.min(bitmap.width, 64), Math.min(bitmap.height, 64));
    // Sample a few pixels
    const pixels = [];
    for (let y = 0; y < Math.min(bitmap.height, 8); y++) {
      for (let x = 0; x < Math.min(bitmap.width, 8); x++) {
        const i = (y * data.width + x) * 4;
        pixels.push({x, y, r: data.data[i], g: data.data[i+1], b: data.data[i+2], a: data.data[i+3]});
      }
    }
    return {status: resp.status, width: bitmap.width, height: bitmap.height, pixels};
  } catch(e) {
    return {error: e.message};
  }
});
console.log('Texture:', result.width, 'x', result.height);
console.log('Pixel samples (top-left corner):');
for (const p of result.pixels) {
  if (p.x < 4 && p.y < 4) console.log(`  (${p.x},${p.y}) rgba(${p.r},${p.g},${p.b},${p.a})`);
}

await browser.close();
