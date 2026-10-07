# Pre-work (cp0)

Everything here should be done **before** the session. The starter on `main`
has no agent yet, just a verified Worker scaffold.

## Steps

1. **Node.js 22.19+ LTS or 24.11+**: `node --version` (Node 23 is unsupported)
2. **Cloudflare account** with a `workers.dev` subdomain. Use the **workshop account** you were given: it has Containers enabled, which cp5 needs. (On your own account, cp1–cp4 run on the free plan; cp5 onward needs Workers Paid for Containers.)
   First-time users: open **Workers & Pages** in <https://dash.cloudflare.com>
   once so the subdomain gets created.
3. **Clone + install**
   ```bash
   git clone <repo-url> field-trip-agent
   cd field-trip-agent
   npm ci
   ```
4. **Log in**: `npx wrangler login` (opens a browser; approve the OAuth scopes,
   which include Workers AI)
5. **Check**: `npm run check`
5b. **Docker (for cp5)**: install Docker Desktop or OrbStack, start it, and check `docker info`.
    On Apple Silicon, set Docker's memory to **≥ 4 GB** (Settings → Resources):
    the sandbox image is amd64 and runs emulated (~1.3 GB per container).
    Pre-pull the image so it isn't downloaded on conference Wi-Fi:
    ```bash
    docker pull --platform linux/amd64 docker.io/cloudflare/sandbox:0.12.10
    ```
    `npm run check` doesn't test Docker; `docker info` printing a server version is the pass.
6. **Dev server smoke**
   ```bash
   npm run dev                              # terminal 1
   curl http://localhost:5173/api/ping      # terminal 2 → pong
   ```
7. **Open the chat UI**: <http://localhost:5173>. At cp0, sending a message
   shows *"No agent is mounted … That's checkpoint 1"*. That's expected.

## What `npm run check` verifies

`scripts/check.mjs` (plain Node, works on Windows):

| Line | Pass condition | Fix |
|---|---|---|
| `✔ Node x.y.z` | Node 22.19+ or 24.11+ | install a supported LTS release |
| `✔ Dependencies installed (10 packages)` | every dep in `package.json` installed at the **exact** pinned version | `npm ci` |
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
| `src/app.ts` | Hono app: `GET /` → chat UI, `GET /api/ping` → `pong`; agents get mounted here from cp1 |
| `src/ui/index.html` | browser chat UI (plain HTML/JS, no build step). Streams replies over SSE, falls back to polling, shows tool calls. **Scaffolding: attendees don't edit it** |
| `src/env.d.ts` | types for the `?raw` HTML import |
| `src/agents/` | empty (`.gitkeep`); cp1 adds `field-trip.ts` |
| `scripts/check.mjs` | this pre-work check |
| `scripts/smoke.mjs` | send a message and print the reply; the verify step for every checkpoint |
| `.dev.vars.example` | intentionally empty (no model API keys needed) |

## Pinned versions

`@flue/runtime` `@flue/vite` `@flue/cli` 2.0.0 · `@cloudflare/vite-plugin` 1.62.0 ·
`wrangler` 4.143.0 · `vite` 8.3.1 · `hono` 4.13.10 · `valibot` 1.5.0 ·
`just-bash` 3.4.2 · `typescript` 7.0.2 · from cp5: `@cloudflare/sandbox` 0.12.10
(**not** 1.x: Flue 2.0.0's `cloudflareSandbox()` needs the 0.x `exec` API)

Don't upgrade during the workshop: the checkpoint code is verified against
exactly these versions.
