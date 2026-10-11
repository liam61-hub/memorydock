import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  // The management console is the local product entry point. Assets must be
  // rooted at `/` because Fastify serves the console from the site root.
  base: '/',
  build: { outDir: resolve(import.meta.dirname, '../dist/admin'), emptyOutDir: true },
});
