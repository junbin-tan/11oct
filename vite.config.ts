import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const apiTarget = `http://localhost:${process.env.API_PORT ?? 3001}`;

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': apiTarget,
      '/health': apiTarget,
    },
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
