import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({headless: true, args: ['--no-sandbox']});
const page = await browser.newPage();

// Check if the texture loads
const result = await page.evaluate(async () => {
  try {
    const resp = await fetch('/platform-billboard.png');
    const blob = await resp.blob();
    const bitmap = await createImageBitmap(blob);
    return {status: resp.status, size: blob.size, type: blob.type, width: bitmap.width, height: bitmap.height};
  } catch(e) {
    return {error: e.message};
  }
});
console.log('Texture check:', JSON.stringify(result));

await browser.close();
