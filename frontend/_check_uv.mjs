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
await new Promise(r => setTimeout(r, 4000));

// Calculate what UV values the shader would sample for the billboard region
// and check what the texture actually has at those UV positions
const result = await page.evaluate(async () => {
  const resp = await fetch('/platform-billboard.png');
  const blob = await resp.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  
  const w = bitmap.width, h = bitmap.height;
  
  // Shader parameters
  const uPlatformHeight = 0.12;
  const uBarrelK = 0.3;
  const uResolution_x = 851; // actual canvas width
  const uPlatformTexWidth = 1536.0;
  
  // Simulate shader UV mapping for the billboard region
  const samples = [];
  for (let screenY_pct = 0.0; screenY_pct <= uPlatformHeight; screenY_pct += 0.02) {
    // vScreenUV.y at this screen position
    const screenUV_y = 1.0 - screenY_pct; // flip: bottom of screen = low vScreenUV.y... wait
    
    // Actually vScreenUV.y goes 0(bottom) to 1(top) in shader
    // billboard region: distortedUV.y < uPlatformHeight means y < 0.12
    // which is bottom 12% of screen
    
    const vScreenUV_y = screenY_pct; // 0 = bottom of screen in UV space
    const bc_y = vScreenUV_y - 0.5;
    const bc_x = 0; // center column
    const br2 = bc_x*bc_x + bc_y*bc_y;
    const distortedUV_y = 0.5 + bc_y * (1.0 + uBarrelK * br2);
    
    if (distortedUV_y < uPlatformHeight) {
      const uvX = 0.5; // center
      const uvY = distortedUV_y / uPlatformHeight;
      
      // Sample the texture at this UV
      const texX = Math.floor(uvX * w);
      const texY = Math.floor(uvY * h);
      const px = ctx.getImageData(Math.min(texX, w-1), Math.min(texY, h-1), 1, 1).data;
      
      samples.push({
        screen_pct: Math.round(screenY_pct * 100) + '%',
        distortedUV_y: distortedUV_y.toFixed(3),
        texUV_y: uvY.toFixed(3),
        texY_px: texY,
        texture_rgba: `rgba(${px[0]},${px[1]},${px[2]},${px[3]})`,
      });
    }
  }
  
  return {textureSize: `${w}x${h}`, samples};
});

console.log('Texture:', result.textureSize);
console.log('Shader UV mapping (bottom of screen):');
for (const s of result.samples) {
  console.log(`  Screen ${s.screen_pct} -> texUV_y=${s.texUV_y} (tex row ${s.texY_px}) -> ${s.texture_rgba}`);
}

await browser.close();
