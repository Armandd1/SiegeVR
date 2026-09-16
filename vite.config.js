import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    cors: true
  },
  build: {
    rollupOptions: {
      external: ['node-fetch', 'fs', 'util', 'string_decoder']
    }
  }
});
