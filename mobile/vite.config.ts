import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// PWA companion app. Builds a static site. Service worker registered at runtime.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    host: true
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2020'
  },
  resolve: {
    alias: {
      // Share the same DTOs/zod schemas with the desktop app
      '@shared': path.resolve(__dirname, '..', 'shared')
    }
  }
});
