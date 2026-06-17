import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// The API landing page builds into ../static so the NestJS app serves it as-is:
// AppController returns static/index.html at "/", and ServeStaticModule serves
// static/** (so /app/*.js|css resolve). emptyOutDir is false to preserve the
// sibling docs/, favicon.*, and cw-swagger.* already in static/.
export default defineConfig({
  base: '/',
  plugins: [svelte()],
  // CWUI ships uncompiled .svelte files; let the svelte plugin compile them
  // instead of esbuild trying to pre-bundle them.
  optimizeDeps: { exclude: ['@cropwatchdevelopment/cwui'] },
  build: {
    outDir: '../static',
    emptyOutDir: false,
    assetsDir: 'app',
  },
});
