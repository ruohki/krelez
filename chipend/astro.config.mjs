// @ts-check
import { defineConfig, envField } from 'astro/config';

import tailwindcss from "@tailwindcss/vite";

import node from '@astrojs/node';

import react from '@astrojs/react';

import icon from 'astro-icon';

// https://astro.build/config
export default defineConfig({
  adapter: node({
    mode: 'standalone'
  }),
  output: "server",
  integrations: [
    react(),
    icon({
      include: {
        lucide: ["*"]
      }
    })
  ],

  vite: {
    plugins: [tailwindcss()],
  },
});