import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const standalone = process.env.VITE_STANDALONE === '1';

export default defineConfig({
  plugins: [react()],
  // Standalone (in-page backend) builds are hosted at arbitrary paths, so assets are referenced relatively.
  base: standalone ? './' : '/',
  server: { port: 5173, host: true, fs: { allow: ['..', '../..'] } },
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  define: standalone ? { 'process.env': '{}' } : {},
  build: {
    target: 'es2022', sourcemap: !standalone, outDir: standalone ? 'dist-standalone' : 'dist', chunkSizeWarningLimit: 4000,
    // Server-only optional adapters sit behind dynamic imports that never run in the browser.
    rollupOptions: standalone ? { external: ['nodemailer', '@aws-sdk/client-s3', 'postgres', /^node:/] } : {},
  },
  test: { include: ['src/**/*.test.ts', 'src/**/*.test.tsx'], environment: 'node' },
} as any);
