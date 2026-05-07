import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { renderInspector } from '../packages/vite-plugin/src/index';

export default defineConfig({
  plugins: [
    react(),
    renderInspector({
      threshold: 5,
      enableInDev: true,
    }),
  ],
});
