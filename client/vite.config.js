import { defineConfig } from 'vite';

// Resolve 'three' to a single copy: the engine (file: dependency) and the
// client both depend on three@0.170.0 — without dedupe the bundle would get
// two instances and instanceof checks across the boundary would break.
export default defineConfig({
  resolve: {
    dedupe: ['three'],
  },
  build: {
    // Top-level await is used in src/main.js (valid in modern browsers).
    target: 'es2022',
  },
});
