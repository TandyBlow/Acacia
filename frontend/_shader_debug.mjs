import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({headless: true, args: ['--no-sandbox']});
const page = await browser.newPage();
await page.setViewport({width: 1280, height: 800});
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
await new Promise(r => setTimeout(r, 4000));

// Add a console interceptor to capture THREE.js texture info
const logs = [];
page.on('console', msg => logs.push(msg.type() + ': ' + msg.text()));

// Check if texture is loaded: re-navigate and watch for load events
// Actually let's just check via WebGL: read the texture unit that uPlatformTexture is bound to

// Force-replace the texture with a visible red data texture to test if compositing works
await page.evaluate(() => {
  // Find the Three.js scene by scanning window for THREE objects
  // Actually, the SceneManager creates the scene but doesn't expose it globally
  // Let's use a different approach: modify the shader to output debug info
  
  // Find the background mesh canvas and check WebGL texture state
  const canvas = document.querySelector('canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  
  // Enumerate all textures
  const maxTextures = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
  const textureInfo = [];
  for (let i = 0; i < maxTextures; i++) {
    gl.activeTexture(gl.TEXTURE0 + i);
    const boundTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
    textureInfo.push({unit: i, bound: boundTex !== null});
  }
  
  // Check program uniforms
  const numPrograms = gl.getParameter(gl.NUM_PROGRAMS);
  
  return {
    maxTextures,
    textureUnits: textureInfo,
    numPrograms,
    canvasSize: `${canvas.width}x${canvas.height}`
  };
});

// Alternative: inject a script that adds a global reference to the scene manager
const injectResult = await page.evaluate(() => {
  // Override BackgroundRenderer constructor to store reference
  // Can't do that post-hoc. Let's try to find the material through Vue internals
  const appEl = document.querySelector('#app');
  if (!appEl || !appEl.__vue_app__) return 'no vue app';
  
  // Get root component
  const root = appEl.__vue_app__._instance;
  return 'found vue app, root type: ' + (root?.type?.name || 'unknown');
});
console.log('Vue app:', injectResult);

// Let's just check if the texture file is accessible from the browser
const texCheck = await page.evaluate(async () => {
  try {
    const r = await fetch('/platform-billboard.png');
    return {status: r.status, size: r.headers.get('content-length'), type: r.headers.get('content-type')};
  } catch(e) {
    return {error: e.message};
  }
});
console.log('Texture fetch:', JSON.stringify(texCheck));

await browser.close();
