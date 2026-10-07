# Troubleshooting

Append-only log of real problems hit while building and running this workshop.
Format: **symptom** → cause → fix. Newest checkpoint last.

## Setup / cp0

**`vite dev` fails: "The Cloudflare plugin is not receiving Flue's Worker configuration"**
→ The flueframework.com example shows `cloudflare()` with no arguments, but Flue
2.0.0 requires the config customizer.
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

**Chat UI (`http://localhost:5173`) says "No agent is mounted … checkpoint 1"**
→ Expected at cp0. POST to `/agents/field-trip/:id` returns 404 until cp1
mounts the agent.

**Chat UI connection panel says "polling history" instead of "streaming (SSE)"**
→ The live stream failed (a proxy or extension blocking `text/event-stream`,
or a dropped connection), and the UI fell back to polling the snapshot every
1.5 s. Replies still arrive, just all at once. No action needed.

**Chat UI shows an old conversation / you want a clean slate**
→ Click **New conversation**. The id lives in the URL (`/?id=web-xxxxxx`): bookmark
it, open several tabs with different ids, or open a smoke conversation with
`/?id=<smoke-id>`. Older checkpoint tags still keep the id in `localStorage`
and may show extra checkpoint cards; ignore those.

**Fonts look plain in the UI**
→ Space Grotesk / JetBrains Mono load from Google Fonts. Offline, the UI falls
back to system fonts. Harmless.

**`npm run smoke` → `Expected 202, got 404` at cp0**
→ Expected: no agent is mounted until cp1.

**`npm run smoke` → `fetch failed` / "Is the dev server running?"**
→ Start `npm run dev` (port 5173) in another terminal. If 5173 is taken, Vite
picks another port, so use the URL it prints.

**`ERR_FILE_NOT_FOUND_IN_OPTIMIZED_DEP_DIR` / `Cannot find module 'agents'` after switching checkpoints**
→ The branch or `node_modules` changed while an old Vite process was still
running, leaving its generated Worker and optimized dependency cache stale.
→ Stop every workshop Vite process, run `npm ci` on the selected branch, then
start `npm run dev` again. Do not run `npm ci` under a live dev server.

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

**Agent behaves like an older version / ignores new tools, even after edits**
→ Seen while building: **another project's dev server was already on port
5173**. Vite's new server failed to bind, and every smoke test silently hit the
*other* project's agent (which had no `save_trip_brief`). We wrongly blamed the
model for an hour.
→ `npm run dev` now uses `--strictPort`, so a busy port fails with
`Port 5173 is already in use` instead of drifting. Stop the other server, or run
`npm run dev -- --port 5180` and point smoke at `http://localhost:5180`.
→ Quick diagnosis: ask the agent *"List the exact names of the tools you can
call."* If a tool you added is missing, you're talking to the wrong server or
old code.

## cp2

**Model never calls `save_trip_brief`**
→ First rule out the wrong-server problem above (the tool list check).
→ Then check the model. `gemma-4-26b-a4b-it` (default), `qwen3.8-27b`,
`glm-4.7-flash`, `kimi-k2.6` and `glm-5.3` (`thinkingLevel: 'low'`) all call
it reliably. Keep the "FIRST action is to call `save_trip_brief`" rule at the
top of the instructions. See the model table in `flue-cheatsheet.md`.

**The reply *contains* `save_trip_brief(city="…", …)` as text, but no `⚙` tool call ran**
→ The model faked the tool call in prose, so nothing was saved. Seen with
`@cf/meta/llama-4-scout-17b-16e-instruct` whenever a message mixes trip details
with a question (0/5 in our benchmark).
→ Use the default `gemma-4-26b-a4b-it`. Teaching point: that's why verify
checks for a real `⚙` tool part, not for text in the reply.

**`Submission failed … AiError … 5006 … Type mismatch of '/messages/0/content', 'array' not in 'string'`**
→ The model can't accept Flue's structured message content after a tool call.
Seen with `llama-3.3-70b-instruct-fp8-fast` and `mistral-small-3.1-24b-instruct`.
Not a wrong model ID.
→ Switch to `@cf/google/gemma-4-26b-a4b-it`.

**`Submission failed … AiError … 8007 … Unexpected role 'user' after role 'tool'`**
→ The model's chat template rejects a message following a tool result. Seen
with `qwen3-30b-a3b-fp8` and `gpt-oss-120b`. Not a wrong model ID, and prompt
changes can't fix it.
→ Switch to `@cf/google/gemma-4-26b-a4b-it`.

**Replies take 10–20 s**
→ Expected with `gemma-4-26b-a4b-it` (tool turns take two model calls). The chat
UI streams tokens as they arrive. The fastest free model, `llama-4-scout`
(~2–5 s), fakes tool calls on mixed messages, so the workshop trades speed
for reliability.

**Workers AI error mentioning a paid plan / `require_workers_paid`**
→ `kimi-k2.6`, `glm-5.x`, `deepseek-v4-*` need Workers Paid. Use the default
`gemma-4-26b-a4b-it`, which runs on the free plan.

**`glm-5.3` is very slow even with `thinkingLevel: 'off'`**
→ Its reasoning is mandatory. `'off'`/`'minimal'`/`'medium'` normalize to
`'max'`. Use `thinkingLevel: 'low'`.

**`[advisory] System instructions updated.` in smoke output**
→ Expected. The tool wrote state and the agent re-rendered its instructions.
That line is the hook model made visible.

## cp3

**`error TS1005: ';' expected` / `TS1443: Module declaration names…` in `field-trip.ts`**
→ A tool name in the instructions was wrapped in bare backticks inside the
template literal. Escape them: `` \`geocode_city\` ``.

**`TS2322 … Promise<{ output: { name: unknown; … } }> is not assignable …` in a tool**
→ `output` must be JSON-typed. `unknown` values (e.g. from
`Record<string, unknown>`) are rejected. Give the parsed API response a
concrete type (`{ name: string; latitude: number; … }`).

**`get_forecast ✘ Forecast unavailable … 'start_date' is out of allowed range`**
→ Expected for dates more than 16 days ahead (or in the past). The model should
explain the limit. To *pass* verify, use dates 3–10 days from today.

**`geocode_city ✘ No city found named "…"`**
→ The Open-Meteo geocoder matches city names only. The reference tool already
strips anything after a comma ("Lisbon, Portugal" → "Lisbon"). Check the spelling.

**The model guesses a forecast without a `⚙ get_forecast` call, or uses the wrong year**
→ Check that the instructions include `Today is ${today}.` and the weather rule
(geocode, then forecast, with dates from the saved brief).

**A stray `<turn|>` at the end of a reply**
→ A gemma end-of-turn token occasionally leaks through Workers AI. It's cosmetic,
and the turn completed normally. Ignore it.

**Weather turns take 10–20 s**
→ Expected: three model calls (decide → geocode → forecast → answer) at
roughly 4–5 s each. The chat UI shows each `⚙` chip as it happens.

## cp4

**`Timed out after 180s` on the suggestion turn**
→ The work keeps going after a timeout. Do not immediately send the prompt again:
re-run `npm run smoke -- <url> <id>` (no message) to read the result. If turns
regularly exceed ~60 s, check that the parent sends **one** `task` (rule 4c)
and that the scout has `model: '…llama-4-scout…'`. On Gemma, the scout takes
~40 s per task.

**Several `⚙ task` calls in a row, each 20–30 s, and 2+ minutes in total**
→ The parent is sending one task per place. Gemma emits one tool call per turn,
so they run one after another, not in parallel. Use the reference rule 4c:
"Call `task` ONCE … for all 3 places".

**`⚙ task(...) → (task completed with no text)`**
→ The child finished without a final message, usually because its job was too
long (many chained tool calls). Keep the scout's job small (one summary per
place) and end its instructions with a fixed output format ("Always finish
with this exact format …").

**The turn ends after a task with no final reply, or the reasoning contains `<|tool_call>call:task{…}`**
→ Gemma occasionally writes a tool call in raw template tokens inside its
reasoning, so it never runs. It happened with one-task-per-place fan-out and
not with the single-task design. Re-send the message. Setting `thinkingLevel`
won't help: Gemma ignores it.

**`distanceM` is `0` for most places**
→ The geosearch query needs `colimit: 'max'`. `prop=coordinates` only returns
coordinates for 10 pages by default.

**`find_nearby_places` returns stations, banks, embassies, battles…**
→ Expected: Wikipedia geosearch is noisy. The parent filters (rule 4b). Point
this out as *why* the model, not code, picks the places.

**Wikipedia returns 403 / `Please set a user-agent`**
→ Every Wikipedia request needs a descriptive `User-Agent` header (see
`HEADERS` in `wikipedia.ts`).

**`Error: useModel() … cannot be called inside a subagent`** (or `useSandbox` / `usePersistentState`)
→ Subagents can't use instance hooks. Set `model` on the `defineSubagent`
definition instead.

## cp5

**`npm run dev` hangs on "Building container images…" or fails with a Docker error**
→ Docker isn't running (`docker info` must print a server version). Start
Docker Desktop/OrbStack and restart `npm run dev`. The first build pulls
~200 MB; pre-pull with `docker pull --platform linux/amd64 docker.io/cloudflare/sandbox:0.12.10`.

**`SandboxDiedError: Sandbox exists failed: the sandbox stopped while the call was in flight`**
**/ `Container exited with unexpected exit code: 137`** (local)
→ Docker ran out of memory and killed the container. On Apple Silicon the amd64
image runs emulated at ~1.3 GB per container, and **every conversation id
starts its own container**. Fix: raise Docker memory to ≥ 4 GB, reuse one
conversation id, and clear old containers:
`docker ps -q --filter name=workerd-field-trip-agent | xargs docker rm -f`.
A single 137 during a cold start can retry on its own; repeated ones are memory.

**The itinerary turn times out; the reasoning ends in `most, most, most, …`**
→ Gemma fell into a repetition loop while echoing the file back. Rule 5 must
say "Do not repeat the file in your reply … reply in one sentence". The user
sees the file through the `read` result.

**`exec` errors like `sandbox.exec(...).then is not a function` / stdout undefined after `npm install`**
→ `@cloudflare/sandbox` 1.x was installed (it's `latest`). Flue 2.0.0 needs
0.x: `npm install --save-exact @cloudflare/sandbox@0.12.10` and keep the
Dockerfile tag the same.

**Container errors after changing the package version**
→ The `Dockerfile` tag must equal the `@cloudflare/sandbox` version in
`package.json` (`0.12.10` ↔ `cloudflare/sandbox:0.12.10`). Restart `npm run dev`
to rebuild the image.

**`Cannot find module 'cloudflare:workers'` in `npm run typecheck`**
→ Add the `declare module 'cloudflare:workers'` block to `src/env.d.ts`. The build
works without it; only the typechecker needs it.

**`npm run deploy` ends with `Login failed with code: 1` after `lookup registry.cloudflare.com … no such host`**
→ Docker's VM lost DNS (common on flaky Wi-Fi). The Worker itself **was** uploaded
(`Uploaded field-trip-agent`), only the image push step failed; if the `Dockerfile`
didn't change, the old image keeps working. Check with
`docker run --rm alpine nslookup registry.cloudflare.com`, then re-run `npm run deploy`.
Not a wrangler login problem.

**Deploy fails mentioning containers / not entitled / `max_instances`**
→ The account doesn't have Containers enabled. Use the workshop account
(`npx wrangler whoami` shows which one you're on), or Workers Paid.

**`itinerary.md` is gone**
→ The container was replaced, possibly after a deployment or idle sleep. Files
are not durable; the brief survives because it's state in the agent's DO. A
no-op redeploy does not guarantee immediate replacement.

**The first message of a new conversation is a few seconds slower**
→ Container cold start. In cp5 every conversation starts its container on the
first message; cp6 makes it lazy (only when the itinerary needs files).

## cp6

**No traces / logs in the dashboard**
→ Check `wrangler.jsonc` has the `observability` block and that you redeployed.
Ingestion takes a minute or two. Look under the agent's Durable Object
(`FlueFieldTripAgent`), not the POST request: each response runs as its own unit of work.

**`npx wrangler tail` doesn't show the `forecast` log**
→ Expected: tail sees the short request/RPC/alarm invocations, but the response
runs detached from them. Use the dashboard's Logs view.

**`[advisory] The agent's execution environment (sandbox) was replaced.` in the output**
→ Expected (cp6+): `open_workspace` flipped the `workspace` flag and Flue attached
the sandbox at the next turn boundary. It appears once per conversation.

**The model writes the itinerary as text, or says it has no `write` tool**
→ It skipped `open_workspace`. Check rule 5 starts with "if you have no `write`
tool yet, call `open_workspace` first", and resend.

**"Hi" still starts a container (cp6+)**
→ That conversation already opened the workspace: the flag is persistent state,
so every later message re-attaches. Use a fresh conversation id.

**`log.info(...)` in a tool shows nothing anywhere**
→ Flue's tool `log` goes to the runtime event stream (`observe()` subscribers),
not to Workers Logs. Use `console.log({...})` for Workers Logs.

**The first message right after `npm run deploy` fails with `SandboxDiedError`**
→ The container was being replaced by the deploy. Resend the message; it works
once the new container is up (seen once, ~30 s after deploy).

**Local: `SandboxDiedError` keeps repeating after you `docker rm`-ed containers**
→ Don't remove containers under a running `npm run dev`: the local Sandbox DO
keeps retrying the vanished one. Stop the dev server, then clear containers, then restart.

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

**Files written in the virtual sandbox are gone on the next message**
→ The `just-bash` virtual sandbox is rebuilt for each submission. The Cloudflare
Sandbox container added at cp5 persists while it is awake, but files can still
disappear after sleep or replacement. Keep durable data in persistent state or
external storage.

**Wikipedia returns 403**
→ A `User-Agent` header is missing. Send a descriptive one, e.g.
`field-trip-agent-workshop/1.0 (https://github.com/<you>/field-trip-agent)`.

**Open-Meteo forecast returns an error for the date**
→ The forecast only covers up to 16 days ahead. Ask for a date within range or
use historical/climate data.
