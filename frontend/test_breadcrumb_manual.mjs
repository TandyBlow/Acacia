/**
 * Manual verification test for breadcrumb scroll functionality
 * Opens browser and provides instructions for manual testing
 */

import puppeteer from 'puppeteer';

const TEST_URL = 'http://localhost:5173';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runManualTest() {
  console.log('Starting Manual Breadcrumb Scroll Test...\n');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 720 },
    args: ['--no-sandbox']
  });

  const page = await browser.newPage();

  try {
    await page.goto(TEST_URL, { waitUntil: 'networkidle0' });

    // Check implementation
    console.log('=== Implementation Verification ===\n');

    const verification = await page.evaluate(() => {
      const track = document.querySelector('.crumb-track');
      if (!track) return { error: 'Breadcrumb track not found' };

      // Check if ref is bound
      const hasRef = track.__vnode || track._vnode || true; // Vue internal

      // Check event listeners (Vue 3 uses addEventListener internally)
      const listeners = {
        wheel: false,
        touchstart: false,
        touchmove: false,
        touchend: false
      };

      // Try to detect listeners (limited in Puppeteer)
      const trackHTML = track.outerHTML;

      return {
        trackExists: true,
        trackHTML: trackHTML.substring(0, 200),
        crumbCount: document.querySelectorAll('.crumb-wrap').length,
        scrollWidth: track.scrollWidth,
        clientWidth: track.clientWidth,
        canScroll: track.scrollWidth > track.clientWidth
      };
    });

    console.log('Breadcrumb Track Info:');
    console.log(`- Track exists: ${verification.trackExists}`);
    console.log(`- Breadcrumb count: ${verification.crumbCount}`);
    console.log(`- Scroll width: ${verification.scrollWidth}px`);
    console.log(`- Client width: ${verification.clientWidth}px`);
    console.log(`- Can scroll: ${verification.canScroll}`);
    console.log(`- Track HTML: ${verification.trackHTML}...`);

    // Check source code
    console.log('\n=== Source Code Verification ===\n');

    const sourceCheck = await page.evaluate(() => {
      // Try to access the component source via Vue devtools data
      const track = document.querySelector('.crumb-track');
      if (!track) return null;

      return {
        hasWheelListener: track.outerHTML.includes('wheel') || 'unknown',
        hasTouchListener: track.outerHTML.includes('touch') || 'unknown',
        hasRef: track.outerHTML.includes('ref') || 'unknown'
      };
    });

    console.log('Event Bindings (from HTML):');
    console.log(`- Wheel: ${sourceCheck?.hasWheelListener}`);
    console.log(`- Touch: ${sourceCheck?.hasTouchListener}`);
    console.log(`- Ref: ${sourceCheck?.hasRef}`);

    // Read the actual source file
    const fs = await import('fs');
    const path = await import('path');
    const sourceFile = path.join(process.cwd(), 'src', 'components', 'layout', 'Breadcrumbs.vue');

    if (fs.existsSync(sourceFile)) {
      const source = fs.readFileSync(sourceFile, 'utf-8');

      const checks = {
        hasOnWheel: source.includes('@wheel'),
        hasOnTouchStart: source.includes('@touchstart'),
        hasOnTouchMove: source.includes('@touchmove'),
        hasOnTouchEnd: source.includes('@touchend'),
        hasCrumbTrackRef: source.includes('ref="crumbTrackRef"'),
        hasOnWheelFunction: source.includes('function onWheel'),
        hasOnTouchStartFunction: source.includes('function onTouchStart'),
        hasOnTouchMoveFunction: source.includes('function onTouchMove'),
        hasOnTouchEndFunction: source.includes('function onTouchEnd'),
        hasScrollQueue: source.includes('scrollQueue'),
        hasProcessScrollQueue: source.includes('processScrollQueue'),
        hasAnimateSingleScroll: source.includes('animateSingleScroll'),
        hasCalcAnimDuration: source.includes('calcAnimDuration'),
        hasFindNextScrollTarget: source.includes('findNextScrollTarget'),
        hasPathWatchReset: source.includes('scrollQueue.value = []')
      };

      console.log('\n=== Code Implementation Checks ===\n');

      console.log('Template Bindings:');
      console.log(`  ✓ @wheel event: ${checks.hasOnWheel ? '✓' : '❌'}`);
      console.log(`  ✓ @touchstart event: ${checks.hasOnTouchStart ? '✓' : '❌'}`);
      console.log(`  ✓ @touchmove event: ${checks.hasOnTouchMove ? '✓' : '❌'}`);
      console.log(`  ✓ @touchend event: ${checks.hasOnTouchEnd ? '✓' : '❌'}`);
      console.log(`  ✓ ref="crumbTrackRef": ${checks.hasCrumbTrackRef ? '✓' : '❌'}`);

      console.log('\nEvent Handlers:');
      console.log(`  ✓ onWheel function: ${checks.hasOnWheelFunction ? '✓' : '❌'}`);
      console.log(`  ✓ onTouchStart function: ${checks.hasOnTouchStartFunction ? '✓' : '❌'}`);
      console.log(`  ✓ onTouchMove function: ${checks.hasOnTouchMoveFunction ? '✓' : '❌'}`);
      console.log(`  ✓ onTouchEnd function: ${checks.hasOnTouchEndFunction ? '✓' : '❌'}`);

      console.log('\nCore Functions:');
      console.log(`  ✓ scrollQueue: ${checks.hasScrollQueue ? '✓' : '❌'}`);
      console.log(`  ✓ processScrollQueue: ${checks.hasProcessScrollQueue ? '✓' : '❌'}`);
      console.log(`  ✓ animateSingleScroll: ${checks.hasAnimateSingleScroll ? '✓' : '❌'}`);
      console.log(`  ✓ calcAnimDuration: ${checks.hasCalcAnimDuration ? '✓' : '❌'}`);
      console.log(`  ✓ findNextScrollTarget: ${checks.hasFindNextScrollTarget ? '✓' : '❌'}`);

      console.log('\nState Management:');
      console.log(`  ✓ Path watch reset: ${checks.hasPathWatchReset ? '✓' : '❌'}`);

      const allPassed = Object.values(checks).every(v => v === true);

      console.log('\n=== Implementation Status ===');
      if (allPassed) {
        console.log('✓ All implementation checks passed!');
      } else {
        console.log('❌ Some implementation checks failed');
        const failed = Object.entries(checks).filter(([k, v]) => !v).map(([k]) => k);
        console.log('Failed checks:', failed.join(', '));
      }

      console.log('\n=== Manual Testing Instructions ===\n');
      console.log('The browser will stay open for manual testing.');
      console.log('\nTo test the breadcrumb scroll functionality:');
      console.log('1. Create a deep hierarchy of nodes (10+ levels)');
      console.log('2. Navigate to the deepest node');
      console.log('3. Hover over the breadcrumb area');
      console.log('4. Use mouse wheel to scroll left/right');
      console.log('5. Try fast scrolling (rapid wheel movements)');
      console.log('6. Click a breadcrumb to navigate (should reset scroll state)');
      console.log('7. On mobile/touch device: swipe left/right on breadcrumbs');
      console.log('\nPress Ctrl+C to close the browser and exit.');

      // Keep browser open
      await new Promise(() => {}); // Never resolves
    }

  } catch (error) {
    if (error.message !== 'Target closed') {
      console.error('Test error:', error);
    }
  } finally {
    await browser.close();
  }
}

runManualTest().catch(console.error);
