import path from 'path';
import { defineConfig, loadEnv } from 'vite';
/// <reference types="vitest" />
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { wealthErrorCollector } from './scripts/errorCollectorPlugin';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');

  // ----------------------------------------------------------------------------
  // Env Var Validation (Dev Warning)
  // ----------------------------------------------------------------------------
  // In production builds, missing API keys will silently produce empty strings
  // (defensive `|| ''` fallbacks below). To make silent failures more visible
  // in dev, we warn at config-load time for any non-empty keys that are unset.
  // We intentionally do NOT hard-fail the build: services like the AI Advisor
  // and Telegram alerts gracefully degrade when their keys are missing.
  if (mode !== 'production') {
    const recommended = [
      'GEMINI_API_KEY', // Powers the AI Advisor / Copilot
    ];
    const missing = recommended.filter((k) => !env[k]);
    if (missing.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[vite.config] Warning: the following env vars are not set and will be empty strings at runtime: ${missing.join(', ')}.`
      );
    }
  }
  return {

    server: {
      port: 3000,
      host: '0.0.0.0',
      allowedHosts: true,
      watch: {
        usePolling: false,
        ignored: [
          "**/Extras/**",
          "**/graphify-out/**",
          "**/dist/**",
          "**/scratch/**",
          "**/restore/**",
          "**/venv/**",
          "**/.venv/**",
          "**/.git/**",
          "**/*.pdf",
          "**/*.har",
          "**/*_log.txt",
          "**/*_errors.txt",
          "**/python-bridge/.venv/**",
          "**/python-bridge/cache.db",
          "**/python-bridge/data/**",
          "**/*.parquet",
          "**/*.json.tmp",
          "**/__pycache__/**",
          "**/*.pyc"
        ]
      },
      proxy: {
        // DhanHQ API Proxy (bypasses CORS for browser requests)
        '/api/dhan': {
          target: 'https://api.dhan.co',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/dhan/, ''),
          secure: true,
        },
        '/auth/dhan': {
          target: 'https://auth.dhan.co',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/auth\/dhan/, ''),
          secure: true,
        },
        '/data/dhan': {
          target: 'https://images.dhan.co',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/data\/dhan/, ''),
          secure: true,
        },
        '/data/stock-logos': {
          target: 'https://assets.upstox.com',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/data\/stock-logos/, '/content/assets/images/logos/lk'),
          configure: (proxy, _options) => {
            proxy.on('proxyReq', (proxyReq, _req, _res) => {
              proxyReq.setHeader('Host', 'assets.upstox.com');
              proxyReq.setHeader('Origin', 'https://upstox.com');
              proxyReq.setHeader('Referer', 'https://upstox.com/');
              proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
            });
          },
          secure: true,
        },
        '/api/yahoo': {
          target: 'https://query1.finance.yahoo.com',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/yahoo/, ''),
          configure: (proxy, _options) => {
            proxy.on('proxyReq', (proxyReq, _req, _res) => {
              proxyReq.setHeader('Host', 'query1.finance.yahoo.com');
              proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
              proxyReq.setHeader('Referer', 'https://finance.yahoo.com/');
            });
          },
          secure: true,
        },
        '/api/moneycontrol': {
          target: 'https://www.moneycontrol.com',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/moneycontrol/, ''),
          configure: (proxy, _options) => {
            proxy.on('proxyReq', (proxyReq, _req, _res) => {
              proxyReq.setHeader('Host', 'www.moneycontrol.com');
              proxyReq.setHeader('Origin', 'https://www.moneycontrol.com');
              proxyReq.setHeader('Referer', 'https://www.moneycontrol.com/');
              proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
            });
          },
          secure: true,
        },
        '/api/moneycontrol-api': {
          target: 'https://api.moneycontrol.com',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/moneycontrol-api/, ''),
          configure: (proxy, _options) => {
            proxy.on('proxyReq', (proxyReq, _req, _res) => {
              proxyReq.setHeader('Host', 'api.moneycontrol.com');
              proxyReq.setHeader('Origin', 'https://www.moneycontrol.com');
              proxyReq.setHeader('Referer', 'https://www.moneycontrol.com/');
              proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
            });
          },
          secure: true,
        },
        '/api/moneycontrol-price': {
          target: 'https://priceapi.moneycontrol.com',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/moneycontrol-price/, ''),
          configure: (proxy, _options) => {
            proxy.on('proxyReq', (proxyReq, _req, _res) => {
              proxyReq.setHeader('Host', 'priceapi.moneycontrol.com');
              proxyReq.setHeader('Origin', 'https://www.moneycontrol.com');
              proxyReq.setHeader('Referer', 'https://www.moneycontrol.com/');
              proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
            });
          },
          secure: true,
        },
        '/api/nse': {
          target: 'https://www.nseindia.com',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/nse/, ''),
          configure: (proxy, _options) => {
            proxy.on('proxyReq', (proxyReq, _req, _res) => {
              proxyReq.setHeader('Host', 'www.nseindia.com');
              proxyReq.setHeader('Origin', 'https://www.nseindia.com');
              proxyReq.setHeader('Referer', 'https://www.nseindia.com/market-data/live-equity-market');
              proxyReq.setHeader('Accept', 'application/json, text/plain, */*');
              proxyReq.setHeader('Accept-Language', 'en-US,en;q=0.9');
              proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
              proxyReq.setHeader('sec-fetch-dest', 'empty');
              proxyReq.setHeader('sec-fetch-mode', 'cors');
              proxyReq.setHeader('sec-fetch-site', 'same-origin');
            });
          },
          secure: true,
        },
        '/api/stockezee-web': {
          target: 'https://www.stockezee.com',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/stockezee-web/, ''),
          configure: (proxy, _options) => {
            proxy.on('proxyReq', (proxyReq, _req, _res) => {
              proxyReq.setHeader('Host', 'www.stockezee.com');
              proxyReq.setHeader('Origin', 'https://www.stockezee.com');
              proxyReq.setHeader('Referer', 'https://www.stockezee.com/');
              proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
            });
          },
          secure: true,
        },
        '/api/stockezee': {
          target: 'https://webapi.stockezee.com',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/stockezee/, ''),
          configure: (proxy, _options) => {
            proxy.on('proxyReq', (proxyReq, _req, _res) => {
              proxyReq.setHeader('Host', 'webapi.stockezee.com');
              proxyReq.setHeader('Origin', 'https://www.stockezee.com');
              proxyReq.setHeader('Referer', 'https://www.stockezee.com/');
              proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
            });
          },
          secure: true,
        },
        '/api/sz-pulse': {
          target: 'https://webapi.niftytrader.in',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/sz-pulse/, ''),
          secure: true,
        },
        '/api/sz-sector': {
          target: 'https://api.stockezee.com',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/sz-sector/, ''),
          secure: true,
        },
        '/api/python-nse': {
          target: 'http://127.0.0.1:8765',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/python-nse/, ''),
          secure: false,
        },
        '/api/vectorbt': {
          target: 'http://127.0.0.1:8765',
          changeOrigin: true,
          secure: false,
        },
        '/api/backtrader': {
          target: 'http://127.0.0.1:8765',
          changeOrigin: true,
          secure: false,
        },
        '/api/lumibot': {
          target: 'http://127.0.0.1:8765',
          changeOrigin: true,
          secure: false,
        },
        '/api/agentic-bridge': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/agentic-bridge/, ''),
          secure: false,
        },
        '/api/openalgo': {
          target: 'http://127.0.0.1:8765',
          changeOrigin: true,
          secure: false,
        },
        '/api/freqtrade': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
          secure: false,
        },
        '/api/telegram-ear': {
          target: 'http://127.0.0.1:3001',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/telegram-ear/, ''),
          secure: false,
        },
        '/ws/telegram-ear': {
          target: 'ws://127.0.0.1:8081',
          ws: true,
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/ws\/telegram-ear/, ''),
          secure: false,
        },
        '/api_be': {
          target: 'https://tradefinder.in',
          changeOrigin: true,
          secure: true,
          configure: (proxy, _options) => {
            proxy.on('proxyReq', (proxyReq, _req, _res) => {
              proxyReq.setHeader('Host', 'tradefinder.in');
              proxyReq.setHeader('Origin', 'https://tradefinder.in');
              proxyReq.setHeader('Referer', 'https://tradefinder.in/');
            });
          }
        },
      },
    },
    preview: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [
      react(),
      // Dev-only always-on console/runtime/API error collector → Extras/ErrorLogs/live-errors.ndjson
      wealthErrorCollector(),
      VitePWA({
        disable: mode === 'development' || mode === 'nopwa',
        registerType: 'autoUpdate',
        workbox: {
          maximumFileSizeToCacheInBytes: 4000000 // Increased from 2MB to 4MB to prevent build failures
        },
        manifestFilename: 'manifest.json',
        includeAssets: ['favicon.ico', 'favicon.png', 'favicon-16x16.png', 'favicon-32x32.png', 'apple-touch-icon.png', 'mask-icon.svg'],
        manifest: {
          name: 'Wealth Aggregator Pro',
          short_name: 'WealthPro',
          description: 'Advanced Personal Finance Dashboard',
          // Keep in sync with index.html <meta name="theme-color"> (#08090C)
          theme_color: '#08090C',
          background_color: '#08090C',
          display: 'standalone',
          orientation: 'any',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'maskable'
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable'
            }
          ]
        }
      }),
      // Custom Bundle Size Budget Check Plugin
      {
        name: 'vite-bundle-budget-check',
        writeBundle(_options, bundle) {
          const budgetLimit = 800 * 1024; // 800 KB
          console.log('\n=== Bundle Size Budget Check ===');
          let exceeded = false;
          for (const [fileName, chunk] of Object.entries(bundle)) {
            if (chunk.type === 'chunk') {
              const size = chunk.code.length;
              const sizeKB = (size / 1024).toFixed(2);
              if (size > budgetLimit) {
                console.warn(`[WARNING] Chunk "${fileName}" is ${sizeKB} KB, which exceeds the budget limit of 800 KB!`);
                exceeded = true;
              } else {
                console.log(`[OK] Chunk "${fileName}" is ${sizeKB} KB`);
              }
            }
          }
          if (!exceeded) {
            console.log('All chunks are within the 800 KB budget limit.\n');
          }
        }
      }
    ],
    define: {
      // SECURITY FIX: Removed API key build-time injection. 
      // All keys must be securely provided at runtime by the user or fetched via BFF.
      'process.env.API_KEY': '""',
      'process.env.GEMINI_API_KEY': '""',
      'process.env.UPSTOX_API_KEY': '""',
      'process.env.UPSTOX_API_SECRET': '""',
      'process.env.UPSTOX_ACCESS_TOKEN': '""',
      'process.env.UPSTOX_REDIRECT_URI': '""'
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    },
    // The hand-written public/sw.ts is a legacy dev artifact and is NOT used
    // (vite-plugin-pwa generates its own workbox-based sw.js). We exclude it
    // from the dist output to prevent confusion and bloat.
    publicDir: 'public',
    build: {
      // Enable minification and tree-shaking
      minify: 'esbuild',
      // CSS minify uses the same esbuild pipeline for speed
      cssMinify: 'esbuild',
      // Report gzipped sizes in build output (useful for perf budgets)
      reportCompressedSize: true,
      // CSS code splitting is enabled by default in Vite 5+; we keep it explicit
      // to make sure CSS for each async chunk is split correctly.
      cssCodeSplit: true,
      sourcemap: mode === 'development',
      modulePreload: {
        resolveDependencies: (_filename, deps) => {
          return deps.filter((dep) =>
            !dep.includes('vendor-export') &&
            !dep.includes('vendor-firebase') &&
            !dep.includes('vendor-tensorflow') &&
            !dep.includes('vendor-pdf') &&
            !dep.includes('vendor-genai')
          );
        },
      },
      // Target modern browsers for better optimization
      target: 'esnext',
      rollupOptions: {
        treeshake: 'recommended',
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              // TensorFlow - massive (~3 MB), must be isolated and loaded only when needed
              if (id.includes('@tensorflow')) {
                return 'vendor-tensorflow';
              }
              // Firebase - large, isolated
              if (id.includes('firebase')) {
                return 'vendor-firebase';
              }
              // Icons (must precede generic react check to avoid being swallowed)
              if (id.includes('lucide-react')) {
                return 'vendor-icons';
              }
              // Markdown rendering (must precede generic react check)
              if (id.includes('react-markdown') || id.includes('remark') || id.includes('rehype') || id.includes('unified') || id.includes('micromark') || id.includes('mdast') || id.includes('hast')) {
                return 'vendor-markdown';
              }
              // Forms + validation (must precede generic react check)
              if (id.includes('react-hook-form') || id.includes('@hookform') || id.includes('zod')) {
                return 'vendor-forms';
              }
              // Misc small libs (must precede generic react check)
              if (id.includes('canvas-confetti') || id.includes('react-hotkeys-hook') || id.includes('totp-generator')) {
                return 'vendor-misc';
              }
              // Core React ecosystem
              if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom') || id.includes('react-router') || id.includes('@remix-run')) {
                return 'vendor-react';
              }
              // Animation
              if (id.includes('framer-motion')) {
                return 'vendor-framer';
              }
              // Charts & data-viz
              if (id.includes('recharts') || id.includes('lightweight-charts') || id.includes('d3-')) {
                return 'vendor-charts';
              }
              // IndexedDB
              if (id.includes('dexie')) {
                return 'vendor-db';
              }
              // State
              if (id.includes('zustand')) {
                return 'vendor-state';
              }
              // Supabase
              if (id.includes('supabase')) {
                return 'vendor-supabase';
              }
              // Google GenAI SDK
              if (id.includes('@google/genai') || id.includes('@google-cloud')) {
                return 'vendor-genai';
              }
              // PDF generation
              if (id.includes('jspdf')) {
                return 'vendor-pdf';
              }
              // Telegram client
              if (id.includes('/telegram/') || id.includes('\\telegram\\')) {
                return 'vendor-telegram';
              }
              // Date utilities
              if (id.includes('date-fns')) {
                return 'vendor-dates';
              }
              // CSV parsing
              if (id.includes('papaparse')) {
                return 'vendor-csv';
              }
              // Drag-and-drop
              if (id.includes('@dnd-kit')) {
                return 'vendor-dnd';
              }
              // Crypto
              if (id.includes('crypto-js')) {
                return 'vendor-crypto';
              }
            }
            return undefined;
          }
        }
      },
      chunkSizeWarningLimit: 1000,
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './tests/setup.ts',
      css: true,
      pool: 'threads',
      poolOptions: {
        threads: {
          singleThread: true
        }
      },
    },
    // Optimize dependencies
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'zustand',
        'dexie',
        'recharts',
        'framer-motion',
        'lucide-react',
        'date-fns',
      ],
      exclude: [
        '@google/genai', // Lazy loaded
      ],
      esbuildOptions: {
        target: 'esnext',
        legalComments: 'none',
        treeShaking: true
      }
    },
  };
});
