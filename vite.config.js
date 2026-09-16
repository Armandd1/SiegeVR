import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0', // Minden hálózati kártyán hallgat
    port: 5173,
    cors: true
  }
});
