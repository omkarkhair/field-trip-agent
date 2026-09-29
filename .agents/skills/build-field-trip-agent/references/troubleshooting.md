# Troubleshooting

Append-only log of real problems hit while building and running this workshop.
Format: **symptom** → cause → fix. Newest checkpoint last.

## Setup / cp0

**`vite dev` fails: "The Cloudflare plugin is not receiving Flue's Worker configuration"**
→ The flueframework.com example shows `cloudflare()` with no arguments, but Flue
2.1.1 requires the config customizer.
→ Fix `vite.config.ts`:
```ts
import { flue, flueWorkerConfig } from '@flue/vite';
plugins: [flue({ providers: ['cloudflare'] }), cloudflare({ config: flueWorkerConfig() })]
```
General rule: when the website and the installed package disagree, trust
`npx flue docs read <page>`.

**`vite dev` warning: "AI bindings always access remote resources…"**
→ Workers AI always runs remotely, even in local dev (usage counts against the
account).
→ Set `"ai": { "binding": "AI", "remote": true }` (already done in the starter).

**Vite fails to load `vite.config.ts` / can't resolve `@cloudflare/vite-plugin`**
→ The plugin is ESM-only.
→ `package.json` must have `"type": "module"` (the starter does).

**Worker bundle is large / slow deploy**
→ Without a `providers` list, every model provider SDK is bundled.
→ Keep `flue({ providers: ['cloudflare'] })`.

**`npm run check` → "Dependency mismatch … (missing)" right after `npm install`**
→ An old check read `<pkg>/package.json` via `require`, which fails for packages
without that export.
→ Fixed in `scripts/check.mjs` (reads `node_modules/<pkg>/package.json`
directly). Pull the latest `main` if you see this.

**`npm run smoke` → `Expected 202, got 404` at cp0**
→ Expected: no agent is mounted until cp1.

**`npm run smoke` → `fetch failed` / "Is the dev server running?"**
→ Start `npm run dev` (port 5173) in another terminal. If 5173 is taken, Vite
picks another port, so use the URL it prints.

## cp1

**`vite build` / `npm run deploy` warning: `[MODULE_LEVEL_DIRECTIVE] The semantics of the module level directive "use agent" … may not be preserved when bundling`**
→ Harmless. Flue reads `'use agent'` at scan time, before bundling, and the
deploy output lists `env.FLUE_FIELD_TRIP_AGENT (FlueFieldTripAgent)`, which proves
it worked. Ignore it.

**A coding agent added `"account_id": "…"` to `wrangler.jsonc`**
→ This happened on a test run when wrangler asked for an account. It makes the
config deploy to that one account only.
→ Remove it and use `export CLOUDFLARE_ACCOUNT_ID=<id>` (or answer wrangler's
prompt) instead. Never commit an account id to the workshop repo.

**Deploy upload grew from ~573 KiB to ~807 KiB gzipped at cp1**
→ Expected: the Flue agent runtime and the Durable Object class are now bundled.

## Known in advance (from the Flue docs)

**Build error mentioning migrations / DO class not found on deploy**
→ Every agent class needs a `new_sqlite_classes` migration (`FlueFieldTripAgent`).

**A helper function suddenly became an agent / wants a migration**
→ It's an exported, capitalized function in a `'use agent'` file. Un-export it
or move it to `src/subagents/`.

**Tool registration throws on name conflict**
→ The name is a duplicate or reserved (`task`, `read`, `write`, `bash`, …). Rename it.

**`useModel` / `useSandbox` / `usePersistentState` throws inside the subagent**
→ Not allowed in subagents. Set `model` on `defineSubagent` instead; state stays
in the parent.

**Subagent answers vaguely / asks for info the parent had**
→ Subagents get a fresh context. The parent must pass a complete briefing in the
`task` prompt (city, lat/lon, dates, headcount, interests).

**`cloudflare/...` model fails under `flue run`**
→ `flue run` is Node-only. Use `npm run dev` + `npm run smoke`.

**Files written in the sandbox are gone on the next message**
→ The virtual sandbox is rebuilt for each submission. Return content in the
reply, or keep it in `usePersistentState`.

**Wikipedia returns 403**
→ A `User-Agent` header is missing. Send a descriptive one, e.g.
`field-trip-agent-workshop/1.0 (https://github.com/<you>/field-trip-agent)`.

**Open-Meteo forecast returns an error for the date**
→ The forecast only covers up to 16 days ahead. Ask for a date within range or
use historical/climate data.
