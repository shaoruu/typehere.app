import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { replaceCodePlugin } from 'vite-plugin-replace';

// https://vitejs.dev/config/
export default defineConfig({
  clearScreen: false,
  plugins: [
    react(),
    replaceCodePlugin({
      replacements: [
        {
          from: '__START_REMOVE_FOR_ELECTRON__',
          to: '// __START_REMOVE_FOR_ELECTRON__',
        },
        {
          from: '__END_REMOVE_FOR_ELECTRON__',
          to: '// __END_REMOVE_FOR_ELECTRON__',
        },
      ],
    }),
    VitePWA({
      workbox: {
        globPatterns: ['**/*'],
      },
      includeAssets: ['**/*'],
      manifest: {
        theme_color: 'white',
        background_color: 'white',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        short_name: 'Type Here | App',
        description: 'Type here...',
        name: 'Type Here | App',
        icons: [
          {
            src: '/icon-256x256.png',
            sizes: '256x256',
            type: 'image/png',
          },
          {
            src: '/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
    }),
  ],
});
