import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({headless: true, args: ['--no-sandbox']});
const page = await browser.newPage();
await page.setViewport({width: 1280, height: 800});

page.on('console', msg => {
  console.log('CONSOLE:', msg.type(), msg.text().substring(0, 300));
});

await page.goto('http://localhost:5173', {waitUntil: 'networkidle2'});
await new Promise(r => setTimeout(r, 10000));

await browser.close();
