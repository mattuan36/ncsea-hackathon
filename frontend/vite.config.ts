import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.PAGES_BASE || "/",
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      '/api/site-report': 'http://127.0.0.1:8101',
      '/api/site-health': 'http://127.0.0.1:8101',
      '/api': 'http://127.0.0.1:8100',
    },
  },
});
