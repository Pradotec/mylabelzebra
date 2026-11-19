import { defineConfig } from 'vitest/config';

// Tests unitaires de la logique pure (ZPL, codes, mise en page, résolution des champs).
// happy-dom fournit window/document/localStorage ; le canvas 2D est fourni par
// @napi-rs/canvas (binaire précompilé, aucune compilation native) — voir src/test/setup.ts.
export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    // évite toute surprise d'ordre entre fichiers (caches de modules partagés)
    pool: 'forks',
  },
});
