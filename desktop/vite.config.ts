import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import tauriConfig from './src-tauri/tauri.conf.json' with { type: 'json' };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    headers: { 'Content-Security-Policy': tauriConfig.app.security.devCsp },
  },
  preview: {
    headers: { 'Content-Security-Policy': tauriConfig.app.security.csp },
  },
  envPrefix: ['VITE_'],
  build: { target: ['es2022', 'chrome111', 'safari16.4'] },
});
