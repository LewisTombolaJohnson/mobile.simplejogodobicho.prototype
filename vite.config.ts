import { defineConfig } from 'vite';

// Use relative base so built asset paths resolve correctly when served from /docs on GitHub Pages
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'esnext'
  },
  esbuild: {
    target: 'esnext'
  }
});
