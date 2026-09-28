import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'

let gitCommitCount = '0'
try {
  gitCommitCount = execSync('git rev-list --count HEAD', { encoding: 'utf-8' }).trim()
} catch {
  // Not a git repo or git not available — version will show 0
}

function loadManifest() {
  try {
    return JSON.parse(
      readFileSync(new URL('./public/manifest.json', import.meta.url), 'utf-8'),
    )
  } catch (error) {
    throw new Error(
      `Failed to load frontend/public/manifest.json: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

const manifest = loadManifest()

// https://vite.dev/config/
export default defineConfig({
  define: {
    __GIT_COMMIT_COUNT__: JSON.stringify(gitCommitCount),
  },
  plugins: [
    vue(),
    VitePWA({
      injectRegister: 'auto',
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'public',
      filename: 'sw.js',
      manifestFilename: 'manifest.json',
      manifest,
      injectManifest: {
        // Only precache small app-shell assets. Large chunks (main.js ≈6.4 MB)
        // are fetched by the page itself — precaching them doubles the
        // first-load download (page + SW install). Per-user AI background
        // images (2–4 MB each) are served by nginx and must never enter the
        // precache list either.
        globIgnores: [
          'sw.js',
          // Injecting an over-limit asset is a hard error, so main.js must
          // be excluded from the manifest, not just left over the limit.
          '**/assets/main-*.js',
          '**/backgrounds/**',
          '**/platform-billboard.png',
          '**/demo_styles*.json',
          '**/sunken-demo.html',
          '**/*.tmp',
        ],
        maximumFileSizeToCacheInBytes: 512 * 1024, // 512 KB
      },
    }),
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:7860',
      '/backgrounds': 'http://localhost:7860',
      '/tree': 'http://localhost:7860',
      '/generate-tree-skeleton': 'http://localhost:7860',
      '/style': 'http://localhost:7860',
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
})
