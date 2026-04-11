import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'

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
    }),
  ],
})
