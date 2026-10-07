# Field Trip Agent

Build and deploy a **durable AI agent** with the [Flue Framework](https://flueframework.com)
on **Cloudflare Workers**, backed by **Durable Objects** for persistence and recovery.

By the end of this session you will have a live agent on your own `*.workers.dev`
URL that plans a team offsite: it remembers the trip brief, checks the weather,
delegates venue research to a sub-agent, writes an itinerary, and exposes each
model and tool call through production traces.

> **Using a coding agent** (OpenCode, Claude Code, Cursor, ...)? Point it at this
> README and the skill in [`.agents/skills/build-field-trip-agent/`](.agents/skills/build-field-trip-agent/SKILL.md).
> Rules for agents are at the [bottom of this file](#for-coding-agents).

---

## What you'll learn

| Concept | How you'll see it |
|---|---|
| Creating an agent | An agent *is* a function that returns its instructions, marked with `'use agent'` |
| The Flue hook model | `useModel`, `usePersistentState`, `useTool`, `useSubagent`, `useSandbox` — the agent re-renders before every model call |
| Tools that call external APIs | `defineTool` + [valibot](https://valibot.dev) schemas → Open-Meteo and Wikipedia |
| Sub-agent delegation | A `venue-scout` sub-agent with its own tool, its own model, and a fresh context |
| Sandbox strategies | No sandbox → in-memory virtual sandbox → Cloudflare Computer → Cloudflare Sandbox container (built) |
| Deploy, test, iterate | `vite dev` → `wrangler deploy` → test live → read traces |
| Durable Objects | One agent Durable Object per conversation, plus a Sandbox container-manager Durable Object |

---

## Before the session (pre-work, ~10 min)

Please do this **before** you arrive — conference Wi-Fi is not your friend.

1. **Install Node.js 22.19+ LTS or 24.11+** — `node --version` (Node 23 is unsupported)
2. **Have a Cloudflare account** (use the workshop account you were given; it has Containers enabled for cp5) with a `workers.dev`
   subdomain. If you've never deployed a Worker, open
   **Workers & Pages** in the [dashboard](https://dash.cloudflare.com) once so the
   subdomain gets created.
3. **Clone and install:**
   ```bash
   git clone <repo-url> field-trip-agent
   cd field-trip-agent
   npm ci
   ```
4. **Install and start Docker** (Docker Desktop or OrbStack; needed from cp5). On Apple Silicon, give it ≥ 4 GB of memory, then pre-pull the sandbox image:
   ```bash
   docker pull --platform linux/amd64 docker.io/cloudflare/sandbox:0.12.10
   ```
5. **Log in to Cloudflare:**
   ```bash
   npx wrangler login
   ```
6. **Check everything:**
   ```bash
   npm run check
   ```
   All lines should be green. If not, see [Troubleshooting](#troubleshooting).
7. **Smoke test the dev server:**
   ```bash
   npm run dev
   # in another terminal
   curl http://localhost:5173/api/ping      # → pong
   ```
8. **Open the chat UI** at <http://localhost:5173>. Until checkpoint 1 it tells
   you no agent is mounted yet. That's expected.

**No model API keys are needed.** The agent uses
[Workers AI](https://developers.cloudflare.com/workers-ai/) through the Worker's
`AI` binding, and every external API we call is free and keyless.

The pinned install may report audit findings in transitive workshop dependencies.
Do not run `npm audit fix` during the lab: it changes the checkpoint-verified
dependency graph. The deployed `workers.dev` URL is public and billable, so use
only synthetic prompts and never paste credentials or customer data.

---

## The agent you'll build: `FieldTrip`

You tell it about an offsite — **city, dates, headcount, budget, interests** — and it:

1. Saves the **trip brief** and remembers it across messages.
2. Checks the **weather** for your dates.
3. Finds places nearby and asks its **`venue-scout`** sub-agent to assess them
   (activities, visit length, weather dependency), then matches them to the forecast.
4. Writes an **itinerary** to `itinerary.md` in its sandbox.
5. Opens **production traces** to inspect model latency, token use, and tool calls.

### External APIs (free, no keys)

| API | Used for |
|---|---|
| [Open-Meteo Geocoding](https://open-meteo.com/en/docs/geocoding-api) | city → latitude/longitude |
| [Open-Meteo Forecast](https://open-meteo.com/en/docs) | daily forecast, up to 16 days ahead |
| [Wikipedia API](https://www.mediawiki.org/wiki/API:Geosearch) | places near a location + summaries |

---

## Checkpoints

The session is split into checkpoints. Each one has a tested branch
(`cp/1-hello-agent`…`cp/6-iterate-observe`) so you can always catch up.

| Branch | Checkpoint | You build | You verify |
|---|---|---|---|
| `main` | **Starter** | — | `npm run check`, `/api/ping` → `pong` |
| `cp/1-hello-agent` | **Hello agent + first deploy** | `src/agents/field-trip.ts`, mount it in `src/app.ts`, add a Durable Object migration | agent replies locally **and** on your `workers.dev` URL |
| `cp/2-hooks-state` | **Hooks + persistent state** | `usePersistentState('brief')` + a `save_trip_brief` tool | a second message remembers your headcount |
| `cp/3-api-tools` | **Tools calling external APIs** | `geocode_city`, `get_forecast` (Open-Meteo) | a weather question shows tool calls in the conversation |
| `cp/4-subagent` | **Sub-agent delegation** | Wikipedia tools; a `venue-scout` sub-agent with its own tool and model | the parent finds places, calls `task`, and combines the scout's assessment with the weather |
| `cp/5-sandbox` | **Sandbox** | a Cloudflare Sandbox container per conversation | the agent writes `itinerary.md` and reads it back |
| `cp/6-iterate-observe` | **Iterate + observe** | change behavior, redeploy, turn on traces | new behavior live; traces in the Cloudflare dashboard |

### Fell behind? Catch up in one command

```bash
git stash push -u -m "my work" # keep tracked and untracked work
git fetch origin
git branch -f workshop-backup HEAD # preserve the current commit too
git switch --no-track -C workshop origin/cp/3-api-tools
npm ci                         # later checkpoints may add dependencies
```

The backup branch preserves commits that a stash would not capture.
Then re-run that checkpoint's verify step. Or ask your coding agent: *"catch me up
to checkpoint 3"* — the skill knows how.

---

## Commands

| Command | What it does |
|---|---|
| `npm run check` | Pre-work check: Node version, dependencies, `wrangler whoami` |
| `npm run dev` | Local dev server on `http://localhost:5173` (runs in local `workerd`) |
| `npm run build` | Build the Worker into `dist/` |
| `npm run deploy` | Build and deploy to `https://field-trip-agent.<your-subdomain>.workers.dev` |
| `npm run smoke -- <base-url> <id> "<message>"` | Send a message to the agent and print its reply |

`npm run smoke` waits up to 180 seconds for the agent turn. Individual HTTP
requests are capped at 15 seconds, and safe history reads retry transient
failures. Override these with `TIMEOUT_S`, `REQUEST_TIMEOUT_S`, and
`HISTORY_RETRIES` when diagnosing a slow environment.

### Talking to your agent

**In the browser:** open <http://localhost:5173> (or your `workers.dev` URL). The
chat UI streams replies live, shows every tool call as an expandable chip, and
has example prompts for each checkpoint. **New conversation** starts a fresh
Durable Object. The browser keeps its conversation id in local storage and shows
it in the header; terminal smoke checks use the explicit id passed to the command.

The historical checkpoint UI still shows a cp7 booking example. Cp7 is outside
this workshop and no booking tool is mounted, so ignore that prompt.

**From the terminal:**

Every conversation lives at `/agents/field-trip/<id>`. The `<id>` is anything you
choose — use the same id to continue a conversation.

```bash
# easiest
npm run smoke -- http://localhost:5173 offsite-1 "Plan an offsite in Lisbon for 12 people"

# or by hand: send (returns 202 immediately) ...
curl -X POST http://localhost:5173/agents/field-trip/offsite-1 \
  -H 'content-type: application/json' \
  -d '{"kind":"user","body":"Plan an offsite in Lisbon for 12 people"}'

# ... then read the conversation
curl 'http://localhost:5173/agents/field-trip/offsite-1?view=history'
```

Swap `http://localhost:5173` for your `workers.dev` URL to talk to the live agent.

---

## Project layout

What the repo looks like by the final checkpoint:

```
src/
├── app.ts                      # Hono app: chat UI at /, /agents/field-trip, /api/ping
├── ui/index.html               # browser chat UI (given; no build step)
├── agents/field-trip.ts        # 'use agent' — the FieldTrip agent
├── subagents/venue-scout.ts    # sub-agent (not a registered agent)
├── tools/
│   ├── weather.ts              # Open-Meteo tools
│   └── wikipedia.ts            # Wikipedia tools
vite.config.ts                  # plugins: [flue(), cloudflare({ config: flueWorkerConfig() })]
wrangler.jsonc                  # AI binding, Durable Object migrations, observability
scripts/                        # check.mjs, smoke.mjs (plain Node — works on Windows too)
.agents/skills/build-field-trip-agent/   # skill for your coding agent
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `npm run check` says not logged in | `npx wrangler login`, then re-run the check |
| `Port 5173 is already in use` | Another dev server (maybe another project) is running. Stop it, or `npm run dev -- --port 5180` and smoke against `http://localhost:5180` |
| `ERR_FILE_NOT_FOUND_IN_OPTIMIZED_DEP_DIR` or `Cannot find module 'agents'` after switching checkpoints | Stop every workshop Vite process, run `npm ci` on the selected branch, then restart `npm run dev` |
| Dev server: "Cloudflare plugin is not receiving Flue's Worker configuration" | `vite.config.ts` must use `cloudflare({ config: flueWorkerConfig() })` |
| Deploy fails asking for a `workers.dev` subdomain | Open **Workers & Pages** in the dashboard once to create it |
| Deploy fails with a Durable Object / migration error | Every agent needs a `new_sqlite_classes` migration in `wrangler.jsonc` — see cp1 |
| `cloudflare/...` model errors under `flue run` | Workers AI models only run under `npm run dev` or deployed — not `flue run` |
| POST returns `202` but no reply yet | Replies are async — poll `GET .../<id>?view=history` or use `npm run smoke` |
| Smoke POST times out | The submission may have been accepted; re-run smoke without a message before sending it again |
| Container application belongs to another Durable Object namespace | Run `npx wrangler containers list`, delete only the `field-trip-agent-sandbox` application by ID, then deploy again |
| Files the agent wrote are gone | The container was replaced after sleeping or deployment; persistent state is what survives |
| Stuck? | Stash your work, then reset the reusable `workshop` branch to the matching `origin/cp/*` branch as shown above |

More gotchas live in the skill's
[`references/troubleshooting.md`](.agents/skills/build-field-trip-agent/references/troubleshooting.md).

---

## Resources

- Flue docs — <https://flueframework.com/docs/guide/getting-started/>
- Flue on Cloudflare — <https://flueframework.com/docs/ecosystem/deploy/cloudflare/>
- Durable Objects — <https://developers.cloudflare.com/durable-objects/>
- Workers AI — <https://developers.cloudflare.com/workers-ai/>
- Workers Observability — <https://developers.cloudflare.com/workers/observability/>

---

## For coding agents

You are helping a workshop attendee build this project checkpoint by checkpoint.

**Load the skill first:** `.agents/skills/build-field-trip-agent/SKILL.md`. It
contains the verified code and verify command for every checkpoint
(`references/checkpoints/cpN-*.md`), a Flue cheatsheet, deploy notes, and
troubleshooting.

**Workflow:** detect the current checkpoint (`git branch --show-current`, then
inspect `src/`) → implement only the *next* checkpoint → run its verify step →
report. If the attendee is behind, use the resettable `workshop` branch recovery
above instead of hand-writing several checkpoints at once.

**Rules:**

1. **Adding an agent is a triple:** the `'use agent'` file, the `app.route(...)`
   mount in `src/app.ts`, and a uniquely tagged `new_sqlite_classes` migration in
   `wrangler.jsonc`. The Durable Object class is `Flue<Name>Agent`
   (`FieldTrip` → `FlueFieldTripAgent`). Append migrations; never rewrite existing ones.
2. **`flue()` comes before `cloudflare()`** in `vite.config.ts`, and
   `cloudflare()` receives `{ config: flueWorkerConfig() }` (from `@flue/vite`).
   Keep `flue({ providers: ['cloudflare'] })` unless you add another model provider.
   When the flueframework.com docs and the installed version disagree, trust
   `npx flue docs read <page>` — it ships with the installed version.
3. `wrangler.jsonc` keeps `compatibility_flags: ["nodejs_compat"]` and a
   `compatibility_date` of `2026-04-01` or later.
4. **Every exported capitalized function in a `'use agent'` file becomes an
   agent.** Never export sub-agent functions from it — define sub-agents in
   `src/subagents/*.ts` with `defineSubagent`.
5. `useModel` is required and called **exactly once** per render. Sub-agents
   cannot call `useModel`, `useSandbox`, or `usePersistentState` — set `model` on
   the sub-agent definition instead.
6. Use the Workers AI model `cloudflare/@cf/google/gemma-4-26b-a4b-it` — no API keys.
   `cloudflare/...` models only work under `vite dev` or when deployed, not `flue run`.
7. Reserved tool names: `task`, `activate_skill`, `read_skill_resource`, `read`,
   `write`, `edit`, `bash`, `grep`, `glob`.
8. Tools: validate input with valibot, return `{ output }` or a string, **throw**
   on failure so the model can recover, and pass `signal` to every `fetch`.
   Wikipedia requests need a descriptive `User-Agent` header.
9. Sandbox files (the cp5 container) may not survive sleep or replacement. Anything
   that must survive goes in `usePersistentState`. Keep `@cloudflare/sandbox` at
   `0.12.10` (not 1.x) and the `Dockerfile` tag equal to it.
10. Never commit `.dev.vars`, `.env`, or secrets.
11. Stay within the attendee's current checkpoint; don't pull later checkpoints'
    code forward.
12. `src/ui/index.html` is given scaffolding. Don't edit it unless the attendee
    asks. It already renders tool calls and any `data-<name>` parts.
