import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({headless: true, args: ['--no-sandbox']});
const page = await browser.newPage();
await page.setViewport({width: 1280, height: 800});

// Collect console logs
page.on('console', msg => console.log('CONSOLE:', msg.type(), msg.text()));
page.on('response', resp => {
  if (resp.url().includes('/auth/')) {
    console.log('RESPONSE:', resp.status(), resp.url());
  }
});

await page.goto('http://localhost:5173', {waitUntil: 'networkidle2'});

// Fill in credentials
const usernameInput = await page.$('input[type="text"]');
const passwordInput = await page.$('input[type="password"]');
await usernameInput.click({clickCount: 3});
await usernameInput.type('test');
await passwordInput.click({clickCount: 3});
await passwordInput.type('test');

console.log('Credentials filled');

// Long press the knob
const knob = await page.$('.knob-hit-area');
if (knob) {
  const box = await knob.boundingBox();
  console.log('Knob position:', box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await new Promise(r => setTimeout(r, 1200));
  await page.mouse.up();
} else {
  console.log('No knob found!');
}

await new Promise(r => setTimeout(r, 3000));

// Check current URL and page state
console.log('URL:', page.url());
const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
console.log('Page text:', bodyText);

await page.screenshot({path: '_debug_login.png'});
console.log('Screenshot saved');

await browser.close();
