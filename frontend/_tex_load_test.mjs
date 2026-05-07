import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({headless: true, args: ['--no-sandbox']});
const page = await browser.newPage();
await page.setViewport({width: 1280, height: 800});

page.on('console', msg => {
  const t = msg.text();
  if (t.includes('BackgroundRenderer') || t.includes('texture') || t.includes('Texture') || t.includes('Failed') || t.includes('BG-DEBUG')) {
    console.log('CONSOLE:', msg.type(), t);
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
await new Promise(r => setTimeout(r, 5000));

await browser.close();
