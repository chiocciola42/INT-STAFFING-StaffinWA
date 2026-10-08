
import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        VitePWA({
          // "prompt": il nuovo service worker resta in attesa finché l'utente
          // non conferma dal toast "Aggiornamento disponibile" (nessun reload a sorpresa).
          registerType: 'prompt',
          // La registrazione e' gestita da components/PwaPrompts.tsx (progressive enhancement).
          injectRegister: false,
          includeAssets: ['favicon.svg', 'favicon-32.png', 'apple-touch-icon.png'],
          manifest: {
            name: 'Staffing Allocation Planner',
            short_name: 'Staffing',
            description: 'Pianificazione e monitoraggio dell\'allocazione delle risorse sui progetti aziendali.',
            lang: 'it',
            // L'app usa HashRouter: start_url e scope restano alla radice del sito.
            start_url: '/',
            scope: '/',
            id: '/',
            display: 'standalone',
            orientation: 'any',
            background_color: '#e7eef0',
            theme_color: '#06414a',
            icons: [
              { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
              { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
              { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            ],
          },
          workbox: {
            // App shell + tutte le pagine (chunk lazy leggeri) cosi' l'app si apre offline.
            // I chunk pesanti caricati solo su export (exceljs, jspdf, html2canvas) restano
            // fuori dal precache e vengono messi in cache al primo uso (runtimeCaching sotto).
            globPatterns: ['**/*.{html,css,js,ico,png,svg,woff2}'],
            globIgnores: ['**/excelAdapter-*.js', '**/PdfExportButton-*.js', '**/html2canvas*.js', '**/index.es-*.js'],
            maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
            cleanupOutdatedCaches: true,
            // Navigazioni offline -> index.html (SPA). Le API non sono mai interessate.
            navigateFallback: '/index.html',
            navigateFallbackDenylist: [/^\/api\//],
            runtimeCaching: [
              {
                // Dati dinamici, autenticazione e contenuti per utente: mai da cache.
                urlPattern: ({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/api/'),
                handler: 'NetworkOnly',
              },
              {
                // Chunk JS/CSS con hash (pagine lazy, librerie di export): cache-first, immutabili.
                urlPattern: ({ url, request }) =>
                  url.origin === self.location.origin &&
                  url.pathname.startsWith('/assets/') &&
                  (request.destination === 'script' || request.destination === 'style'),
                handler: 'CacheFirst',
                options: {
                  cacheName: 'app-assets',
                  expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30, purgeOnQuotaError: true },
                  cacheableResponse: { statuses: [200] },
                },
              },
              {
                // CSS dei font (Google Fonts / Fontshare): aggiornabile in background.
                urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://api.fontshare.com',
                handler: 'StaleWhileRevalidate',
                options: {
                  cacheName: 'font-styles',
                  expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 30 },
                  cacheableResponse: { statuses: [0, 200] },
                },
              },
              {
                // File dei font: immutabili.
                urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com' || url.origin === 'https://cdn.fontshare.com',
                handler: 'CacheFirst',
                options: {
                  cacheName: 'font-files',
                  expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365, purgeOnQuotaError: true },
                  cacheableResponse: { statuses: [0, 200] },
                },
              },
            ],
          },
        }),
      ],
      build: {
        rollupOptions: {
          output: {
            // Vendor splitting: isola le librerie stabili e pesanti in chunk
            // dedicati per migliorare il caching tra deploy. exceljs (via
            // excelAdapter)/jspdf restano gia in chunk separati perche importati in modo lazy.
            manualChunks: {
              'react-vendor': ['react', 'react-dom', 'react-router-dom'],
              'd3-vendor': ['d3', 'd3-sankey'],
            },
          },
        },
      },
      resolve: {
        alias: {
          // FIX: In ESM environments where the global 'process' might not have 'cwd' typed correctly,
          // path.resolve() can be used to get the current working directory.
          '@': path.resolve('.'),
          // FIX: Using path.resolve('libs/zod') instead of path.resolve(process.cwd(), 'libs/zod')
          // to avoid the same TypeScript error.
          'zod': path.resolve('libs/zod'),
        }
      },
      test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: [],
        alias: {
          '@': path.resolve('.'),
          'zod': path.resolve('libs/zod'),
        },
      },
    };
});
