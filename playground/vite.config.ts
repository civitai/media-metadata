import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// PLAYGROUND_BASE / PLAYGROUND_PUBLIC_DIR are set by the pages.yml deploy:
// GitHub project pages serve under /<repo>/, and the built site ships a
// samples-only public dir instead of the full fixture corpus dev serves.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: process.env.PLAYGROUND_BASE ?? '/',
  publicDir:
    process.env.PLAYGROUND_PUBLIC_DIR ??
    fileURLToPath(new URL('../fixtures/images', import.meta.url)),
  server: { port: 5199 },
});
