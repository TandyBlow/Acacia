import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({headless: true, args: ['--no-sandbox']});
const page = await browser.newPage();
await page.setViewport({width: 1280, height: 800});
await page.goto('http://localhost:5173', {waitUntil: 'networkidle2'});

// Login
const usernameInput = await page.$('input[type="text"]');
const passwordInput = await page.$('input[type="password"]');
await usernameInput.click({clickCount: 3});
await usernameInput.type('test');
await passwordInput.click({clickCount: 3});
await passwordInput.type('test');
const knob = await page.$('.knob-hit-area');
const box = await knob.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await new Promise(r => setTimeout(r, 1200));
await page.mouse.up();
await new Promise(r => setTimeout(r, 3000));

// Check Three.js material uniforms
const uniformValues = await page.evaluate(() => {
  const scene = window.__three_scene;
  if (!scene) return {error: 'No __three_scene on window'};
  
  const bgMesh = scene.children.find(c => c.name === 'background');
  if (!bgMesh) return {error: 'No background mesh found', children: scene.children.map(c => c.name)};
  
  const mat = bgMesh.material;
  const u = mat.uniforms;
  return {
    uBarrelK: u.uBarrelK?.value,
    uPlatformHeight: u.uPlatformHeight?.value,
    uPlatformFade: u.uPlatformFade?.value,
    uPlatformTexWidth: u.uPlatformTexWidth?.value,
    uPlatformTexture_type: u.uPlatformTexture?.value?.constructor?.name,
    uPlatformTexture_isDataTexture: u.uPlatformTexture?.value?.isDataTexture,
    uPlatformTexture_image: u.uPlatformTexture?.value?.image ? {
      width: u.uPlatformTexture.value.image.width,
      height: u.uPlatformTexture.value.image.height,
      src: u.uPlatformTexture.value.image.src?.substring(0, 80),
    } : null,
  };
});

console.log('Uniform values:', JSON.stringify(uniformValues, null, 2));

await browser.close();
