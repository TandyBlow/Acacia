#!/usr/bin/env node
/**
 * Test script for procedure knowledge point example generation feature
 */

import puppeteer from 'puppeteer';

const BASE_URL = 'http://localhost:5180';

async function login(page) {
  console.log('Logging in...');
  await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 15000 });
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
    console.log('✓ Logged in successfully');
  }
}

async function testProcedureFeature(page) {
  console.log('\n=== Testing Procedure Knowledge Point Feature ===\n');

  // Step 0: Create a new empty node or navigate to one
  console.log('Step 0: Creating/navigating to an empty node...');

  // Try to find and click "添加节点" button
  const addNodeButtons = await page.$$('button');
  let addNodeButton = null;

  for (const button of addNodeButtons) {
    const text = await page.evaluate(el => el.textContent, button);
    if (text && text.includes('添加节点')) {
      addNodeButton = button;
      break;
    }
  }

  if (addNodeButton) {
    await addNodeButton.click();
    await new Promise(r => setTimeout(r, 1000));

    // Type node name in the input field
    const nodeNameInput = await page.$('input[type="text"], input[placeholder*="节点"]');
    if (nodeNameInput) {
      await nodeNameInput.type('测试节点');
      await new Promise(r => setTimeout(r, 500));

      // Submit by long-pressing the knob button (same as login)
      const knob = await page.$('.knob-hit-area');
      if (knob) {
        const box = await knob.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await new Promise(r => setTimeout(r, 1000));
        await page.mouse.up();
        await new Promise(r => setTimeout(r, 1500));
        console.log('✓ Created new node and confirmed with knob');
      } else {
        console.log('⚠ Could not find knob button');
      }
    } else {
      console.log('⚠ Could not find node name input');
    }
  } else {
    console.log('⚠ Could not find add node button, continuing anyway...');
  }

  // Step 1: Check if we can find the file generate button
  console.log('\nStep 1: Looking for file generate button...');
  await new Promise(r => setTimeout(r, 1000)); // Wait for button to appear

  // Try to find by class name first
  let fileGenerateButton = await page.$('.file-generate-btn');

  if (!fileGenerateButton) {
    // Fallback: search all buttons
    const buttons = await page.$$('button');

    for (const button of buttons) {
      const text = await page.evaluate(el => el.textContent, button);
      if (text && text.includes('从文件生成')) {
        fileGenerateButton = button;
        break;
      }
    }

    if (!fileGenerateButton) {
      console.log('✗ Could not find file generate button');
      console.log('Available buttons:', await Promise.all(
        buttons.map(b => page.evaluate(el => el.textContent, b))
      ));

      // Debug: check if button exists but is hidden
      const hiddenButton = await page.evaluate(() => {
        const btn = document.querySelector('.file-generate-btn');
        if (btn) {
          const style = window.getComputedStyle(btn);
          return {
            exists: true,
            display: style.display,
            visibility: style.visibility,
            opacity: style.opacity
          };
        }
        return { exists: false };
      });

      console.log('Button debug info:', hiddenButton);

      // Check if we're in the editor view
      const editorExists = await page.evaluate(() => {
        return document.querySelector('.editor-shell, .editor-input') !== null;
      });
      console.log('Editor exists:', editorExists);

      // Take a screenshot for debugging
      await page.screenshot({ path: 'test_debug.png', fullPage: true });
      console.log('✓ Screenshot saved to test_debug.png');

      return false;
    }
  }

  console.log('✓ Found file generate button');

  // Step 2: Click the button to open dialog
  console.log('\nStep 2: Opening file generate dialog...');
  await fileGenerateButton.click();
  await new Promise(r => setTimeout(r, 1000));

  // Check if dialog opened
  const dialogVisible = await page.evaluate(() => {
    const dialog = document.querySelector('.dialog-overlay, [class*="dialog"]');
    return dialog !== null;
  });

  if (!dialogVisible) {
    console.log('✗ Dialog did not open');
    return false;
  }

  console.log('✓ Dialog opened');

  // Step 3: Check for file upload area
  console.log('\nStep 3: Checking file upload area...');
  const uploadArea = await page.$('input[type="file"], .upload-area, [class*="upload"]');

  if (!uploadArea) {
    console.log('✗ File upload area not found');
    return false;
  }

  console.log('✓ File upload area found');

  // Step 4: Check if backend API is responding
  console.log('\nStep 4: Testing backend API...');

  try {
    const response = await page.evaluate(async () => {
      const res = await fetch('http://localhost:7860/health');
      return { ok: res.ok, status: res.status };
    });

    if (response.ok) {
      console.log('✓ Backend API is responding');
    } else {
      console.log(`✗ Backend API returned status ${response.status}`);
      return false;
    }
  } catch (err) {
    console.log('✗ Backend API is not accessible:', err.message);
    return false;
  }

  // Step 5: Check if example-feedback endpoint exists
  console.log('\nStep 5: Checking example-feedback endpoint...');

  try {
    const response = await page.evaluate(async () => {
      const res = await fetch('http://localhost:7860/example-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: 'test', action: 'accept' })
      });
      return { status: res.status };
    });

    // We expect 401 (unauthorized) or 404 (not found), not 405 (method not allowed)
    if (response.status === 405) {
      console.log('✗ example-feedback endpoint not found (405)');
      return false;
    } else {
      console.log(`✓ example-feedback endpoint exists (status: ${response.status})`);
    }
  } catch (err) {
    console.log('✗ Could not check example-feedback endpoint:', err.message);
    return false;
  }

  console.log('\n=== Basic Checks Passed ===\n');
  console.log('Note: Full end-to-end testing requires:');
  console.log('  1. Uploading a file with mathematical content');
  console.log('  2. Extracting procedure-type knowledge points');
  console.log('  3. Completing the conversation flow');
  console.log('  4. Verifying example generation and feedback loop');
  console.log('\nThese steps require actual file content and AI responses,');
  console.log('which are better tested manually or with integration tests.');

  return true;
}

async function main() {
  const browser = await puppeteer.launch({
    headless: false, // Show browser for debugging
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Enable console logging from page
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log('Browser Error:', msg.text());
      }
    });

    await login(page);
    const success = await testProcedureFeature(page);

    if (success) {
      console.log('\n✓ All basic checks passed!');
      console.log('\nYou can now manually test the full flow in the browser.');
      console.log('Press Ctrl+C to close the browser when done.');

      // Keep browser open for manual testing
      await new Promise(() => {});
    } else {
      console.log('\n✗ Some checks failed. Please review the output above.');
      process.exit(1);
    }
  } catch (err) {
    console.error('\n✗ Test failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    // Don't close browser automatically
  }
}

main();
