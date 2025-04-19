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

  env: {
    schema: {
      ICEPRXY_VAPOR_URL: envField.string({ context: "server", access: "secret", optional: true }),
      ICEPRXY_CHIPTUNE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      CHIPTUNE_STREAM_URL: envField.string({ context: "server", access: "secret", optional: true }),
      VAPOR_STREAM_URL: envField.string({ context: "server", access: "secret", optional: true }),
    }
  }
});