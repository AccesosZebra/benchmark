import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    // Reemplazo en build para no depender de `process` en el navegador.
    // Si no hay key en build, se deja un placeholder que el docker-entrypoint
    // sustituye en runtime con la variable de entorno del contenedor.
    'process.env.ANTHROPIC_MODEL': JSON.stringify(process.env.ANTHROPIC_MODEL || ''),
    // Client ID de Google (público). Placeholder sustituido en runtime por el entrypoint.
    'process.env.GOOGLE_CLIENT_ID': JSON.stringify(process.env.GOOGLE_CLIENT_ID || '__RUNTIME_GOOGLE_CLIENT_ID__'),
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: './index.html'
      }
    }
  },
  server: {
    port: 3000,
    // En desarrollo, la API la sirve `npm run server` (server/index.mjs).
    proxy: { '/api': 'http://localhost:8080' }
  }
});