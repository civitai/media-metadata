import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  // serve the fixture corpus at / so the sample buttons work
  publicDir: fileURLToPath(new URL('../fixtures/images', import.meta.url)),
  server: { port: 5199 },
});
