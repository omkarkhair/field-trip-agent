# Pre-work (cp0)

Everything here should be done **before** the session. The starter on `main`
(tag `cp0`) has no agent yet, just a verified Worker scaffold.

## Steps

1. **Node.js ≥ 22.19**: `node --version`
2. **Cloudflare account** (the free plan works: the default model `llama-4-scout` runs on it) with a `workers.dev` subdomain.
   First-time users: open **Workers & Pages** in <https://dash.cloudflare.com>
   once so the subdomain gets created.
3. **Clone + install**
   ```bash
   git clone <repo-url> field-trip-agent
   cd field-trip-agent
   npm install
   ```
4. **Log in**: `npx wrangler login` (opens a browser; approve the OAuth scopes,
   which include Workers AI)
5. **Check**: `npm run check`
6. **Dev server smoke**
   ```bash
   npm run dev                              # terminal 1
   curl http://localhost:5173/api/ping      # terminal 2 → pong
   ```

## What `npm run check` verifies

`scripts/check.mjs` (plain Node, works on Windows):

| Line | Pass condition | Fix |
|---|---|---|
| `✔ Node x.y.z` | Node ≥ 22.19.0 | install a newer Node |
| `✔ Dependencies installed (10 packages)` | every dep in `package.json` installed at the **exact** pinned version | `npm install` |
| `✔ Logged in to Cloudflare as …` | `wrangler whoami --json` reports `loggedIn: true` | `npx wrangler login` |
| `! You have access to several Cloudflare accounts` | warning only | `export CLOUDFLARE_ACCOUNT_ID=<id>` or pick it when wrangler prompts |
| `! Your token may be missing the Workers AI scope` | warning only | re-run `npx wrangler login` |

Exit code 0 means ready.

## The cp0 starter, file by file

| File | Purpose |
|---|---|
| `package.json` | pinned versions; scripts `dev`, `build`, `deploy`, `check`, `smoke`, `typecheck` |
| `vite.config.ts` | `flue({ providers: ['cloudflare'] })` then `cloudflare({ config: flueWorkerConfig() })` |
| `wrangler.jsonc` | name `field-trip-agent`, `nodejs_compat`, compat date ≥ 2026-04-01, `ai` binding (`remote: true`), **empty** `migrations: []` |
| `src/app.ts` | Hono app, `GET /api/ping` → `pong`; agents get mounted here from cp1 |
| `src/agents/` | empty (`.gitkeep`); cp1 adds `field-trip.ts` |
| `scripts/check.mjs` | this pre-work check |
| `scripts/smoke.mjs` | send a message and print the reply; the verify step for every checkpoint |
| `.dev.vars.example` | intentionally empty (no model API keys needed) |

## Pinned versions

`@flue/runtime` `@flue/vite` `@flue/cli` 2.1.1 · `@cloudflare/vite-plugin` 1.62.0 ·
`wrangler` 4.143.0 · `vite` 8.3.1 · `hono` 4.13.10 · `valibot` 1.5.0 ·
`just-bash` 3.4.2 · `typescript` 7.0.2

Don't upgrade during the workshop: the checkpoint code is verified against
exactly these versions.
