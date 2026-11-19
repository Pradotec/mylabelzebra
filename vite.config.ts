import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    // bwip-js (moteur de codes-barres) pèse ~1,9 Mo à lui seul et ne se découpe pas
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // bibliothèques dans des fichiers séparés : téléchargés en parallèle et
        // gardés en cache d'une version de l'application à l'autre
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('bwip-js')) return 'vendor-barcode';
          if (id.includes('konva')) return 'vendor-canvas';
          if (/[\\/](react|react-dom|scheduler|zustand)[\\/]/.test(id)) return 'vendor-react';
          if (id.includes('lucide-react')) return 'vendor-icons';
        },
      },
    },
  },
});
