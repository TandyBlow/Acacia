#!/usr/bin/env npx tsx
/**
 * Record the Acacia cinematic demo using Playwright's built-in video recording.
 *
 * Usage:
 *   1. Start the dev servers (backend + frontend)
 *   2. npx tsx scripts/record_demo.ts
 *
 * Output: scripts/demo_output/<uuid>.webm
 * Then run: bash scripts/compose_demo_video.sh
 */

import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const OUTPUT_DIR = path.resolve(__dirname, 'demo_output');

async function main() {
  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('[record] launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
    recordVideo: {
      dir: OUTPUT_DIR,
      size: { width: 1920, height: 1080 },
    },
  });

  const page = await context.newPage();
  console.log(`[record] navigating to ${FRONTEND_URL}/?cinema ...`);
  await page.goto(`${FRONTEND_URL}/?cinema`, { waitUntil: 'domcontentloaded' });

  // Wait for the demo to finish loading (Phase 1 controls appear)
  console.log('[record] waiting for demo to load...');
  await page.waitForSelector('.cinema-controls', { timeout: 120_000 });
  console.log('[record] demo loaded, hiding controls...');

  // Hide the control bar for clean recording
  await page.addStyleTag({ content: '.cinema-controls { display: none !important; }' });

  // Wait for the demo to reach the "done" phase
  console.log('[record] recording... (waiting for demo to finish)');
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.done-label');
      return el && window.getComputedStyle(el).opacity !== '0';
    },
    { timeout: 120_000 },
  );

  // Hold the final frame for 3 seconds
  console.log('[record] demo finished, holding final frame...');
  await page.waitForTimeout(3000);

  await context.close();
  await browser.close();

  console.log(`[record] done! Video saved to ${OUTPUT_DIR}/`);
}

main().catch((err) => {
  console.error('[record] failed:', err);
  process.exit(1);
});
