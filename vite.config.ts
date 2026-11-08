import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Content Security Policy of the built app. Only on build: the dev server needs an inline script
 * (React Fast Refresh) and a websocket.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: {
          'http-equiv': 'Content-Security-Policy',
          content: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:",
        },
        injectTo: 'head-prepend',
      },
    ],
  };
}

// The renderer (browser part) of the app. Relative base, as Electron loads the build from file://.
export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react(), contentSecurityPolicy()],
  server: { port: 5183, strictPort: true },
  build: { outDir: '../../dist/renderer', emptyOutDir: true },
});
