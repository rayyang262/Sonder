import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // relative paths so the build works on any host
  server: {
    host: '127.0.0.1',
    port: 5173,
    open: true
  }
});
