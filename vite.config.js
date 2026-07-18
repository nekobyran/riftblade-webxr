import { defineConfig } from 'vite';

export default defineConfig({
  // Relative assets let the same artifact run at a GitHub project-page path.
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
    // Three.js + WebXR controller models are intentionally kept together so
    // headset startup does not cross a lazy-chunk boundary. The gzip payload
    // remains below 180 kB.
    chunkSizeWarningLimit: 700,
    outDir: process.env.RIFTBLADE_OUT_DIR || 'dist',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
});
