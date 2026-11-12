import { build } from 'vite';

await build({
  configFile: false,
  root: process.cwd(),
  base: '/schoolbus/',
  publicDir: 'public',
  esbuild: {
    jsx: 'automatic',
    tsconfigRaw: { compilerOptions: { jsx: 'react-jsx' } },
  },
  build: {
    outDir: 'dist-schoolbus',
    emptyOutDir: true,
    rollupOptions: { input: 'schoolbus.html' },
  },
});
