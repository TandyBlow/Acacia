import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({headless: true, args: ['--no-sandbox']});
const page = await browser.newPage();
await page.goto('http://localhost:5173', {waitUntil: 'networkidle2'});
const buttons = await page.$$eval('button', els => els.map(e => ({text: e.textContent.trim(), type: e.type, class: e.className})));
console.log(JSON.stringify(buttons, null, 2));
await browser.close();
