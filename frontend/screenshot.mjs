#!/usr/bin/env node
/**
 * Browser screenshot tool for Acacia.
 * Usage: node screenshot.mjs [options]
 * Options:
 *   --login         Auto-login with test/test before screenshot
 *   --output FILE   Output filename (default: screenshot.png)
 *   --url URL       Target URL (default: http://localhost:5173)
 *   --viewport WxH  Viewport size (default: 1280x800)
 *   --wait MS       Extra wait time after page load (default: 2000)
 *   --fullpage      Capture full page scroll
 *   --selector SEL  Capture specific element only
 */

import puppeteer from 'puppeteer';
import { writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    login: false,
    output: 'screenshot.png',
    url: 'http://localhost:5173',
    viewport: '1280x800',
    wait: 2000,
    fullpage: false,
    selector: null,
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--login': opts.login = true; break;
      case '--output': opts.output = args[++i]; break;
      case '--url': opts.url = args[++i]; break;
      case '--viewport': opts.viewport = args[++i]; break;
      case '--wait': opts.wait = parseInt(args[++i], 10); break;
      case '--fullpage': opts.fullpage = true; break;
      case '--selector': opts.selector = args[++i]; break;
    }
  }
  return opts;
}

async function login(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
  await page.waitForSelector('input[type="text"], input[placeholder*="用户"]', { timeout: 5000 });
  const usernameInput = await page.$('input[type="text"]');
  const passwordInput = await page.$('input[type="password"]');
  if (usernameInput && passwordInput) {
    await usernameInput.click({ clickCount: 3 });
    await usernameInput.type('test');
    await passwordInput.click({ clickCount: 3 });
    await passwordInput.type('test');
    // Login is triggered by long-pressing the knob button
    const knob = await page.$('.knob-hit-area');
    if (knob) {
      const box = await knob.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await new Promise(r => setTimeout(r, 1000));
      await page.mouse.up();
    }
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));
  }
}

async function main() {
  const opts = parseArgs();
  const [w, h] = opts.viewport.split('x').map(Number);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h });

    if (opts.login) {
      console.log(`Logging in at ${opts.url}...`);
      await login(page, opts.url);
      console.log('Logged in.');
    } else {
      await page.goto(opts.url, { waitUntil: 'networkidle2', timeout: 15000 });
    }

    if (opts.wait > 0) {
      console.log(`Waiting ${opts.wait}ms for rendering...`);
      await new Promise(r => setTimeout(r, opts.wait));
    }

    const outputPath = resolve(__dirname, opts.output);
    let screenshotOpts = { path: outputPath, type: 'png' };

    if (opts.selector) {
      const element = await page.$(opts.selector);
      if (!element) {
        console.error(`Selector "${opts.selector}" not found`);
        process.exit(1);
      }
      await element.screenshot(screenshotOpts);
    } else {
      screenshotOpts.fullPage = opts.fullpage;
      await page.screenshot(screenshotOpts);
    }

    console.log(`Screenshot saved: ${outputPath}`);
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('Screenshot failed:', err.message);
  process.exit(1);
});
