import { cloudflare } from '@cloudflare/vite-plugin';
import { flue, flueWorkerConfig } from '@flue/vite';
import { defineConfig } from 'vite';

// ORDER MATTERS: flue() must come before cloudflare().
// flue() scans every 'use agent' module and generates the Worker entry (one
// Durable Object class per agent) plus the merged wrangler config.
// flueWorkerConfig() hands that generated config to the Cloudflare plugin,
// which runs local workerd for `vite dev` and builds the Worker for deploy.
//
// providers: ship only the Workers AI provider (`cloudflare/...` models).
// This keeps the Worker bundle small and deploys fast. Add e.g. 'anthropic'
// here if you switch models.
export default defineConfig({
  plugins: [flue({ providers: ['cloudflare'] }), cloudflare({ config: flueWorkerConfig() })],
});
