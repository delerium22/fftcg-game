import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The workspace packages are published as raw TypeScript (`main: src/index.ts`), so Vite must be
// allowed to pull them out of the monorepo root rather than treating them as prebuilt deps.
export default defineConfig({
  plugins: [react()],
  server: { fs: { allow: ['../..'] } },
  build: { target: 'es2022' },
})
