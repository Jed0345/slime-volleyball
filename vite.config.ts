import { defineConfig } from 'vite';

// `index.html` at the project root is the build entry. Everything in `/public`
// (images, audio, svg) is served at `/` during dev and copied as-is into the
// build output (`dist/`). Run `npm run dev` for the hot-reloading dev server,
// `npm run build` to produce `dist/`, and `npm start` to serve that build +
// the WebSocket relay (see server.js).
export default defineConfig({
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    open: false,
  },
});
