import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` keeps the build portable: GitHub Pages, Netlify, Vercel or any
// static host can serve it from a sub-path without rewriting asset URLs.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { host: true },
});
