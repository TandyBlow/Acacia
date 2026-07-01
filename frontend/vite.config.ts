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
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024, // 8 MB
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
