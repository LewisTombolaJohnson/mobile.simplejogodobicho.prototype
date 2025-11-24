import { defineConfig } from 'vite';

export default defineConfig({
  base: '/game.jogodobicho.prototype/', // repo name for GitHub Pages
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'esnext' // allow top-level await
  },
  esbuild: {
    target: 'esnext'
  }
});
