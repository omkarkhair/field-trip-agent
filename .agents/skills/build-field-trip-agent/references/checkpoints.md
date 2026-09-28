# Checkpoints

Each checkpoint lists its goal, time budget, the files it touches, the final
verified code, and the verify command. Code is **filled in only after the
checkpoint passes verification** on the reference build. A section marked
*pending* has no verified code yet, so don't invent it; tell the attendee to
`git switch -c my-cpN cpN` instead.

Conversation ids in verify commands are arbitrary. Use a fresh id when a
checkpoint changes agent behaviour, so old history doesn't confuse the test.

| Tag | Branch | Minutes | Status |
|---|---|---|---|
| `cp0` | `main` | pre-work | verified |
| `cp1` | `cp/1-hello-agent` | 9 | pending |
| `cp2` | `cp/2-hooks-state` | 6 | pending |
| `cp3` | `cp/3-api-tools` | 9 | pending |
| `cp4` | `cp/4-subagent` | 8 | pending |
| `cp5` | `cp/5-sandbox` | 5 (cut line) | pending |
| `cp6` | `cp/6-iterate-observe` | 7 | pending |
| `cp7` | `cp/7-durability` | 6 (instructor-led) | pending |

---

## cp0: Pre-work starter

- **Goal:** a Worker that builds, runs locally, and can deploy. No agent yet.
- **Files:** see [prework.md](prework.md).
- **Verify:**
  ```bash
  npm run check                            # all ✔
  npm run dev &                            # wait for "ready"
  curl http://localhost:5173/api/ping      # → pong
  ```
  `npm run smoke -- http://localhost:5173 demo-1 "hi"` is **expected to fail**
  with a 404 here: no agent is mounted yet.

---

## cp1: Hello agent + first deploy

- **Goal:** the first agent, answering locally *and* on the live `workers.dev` URL.
- **Concepts:** an agent *is* a function that returns its system prompt;
  `'use agent'` registers every exported capitalized function; the function name
  is the durable identity → Durable Object class `FlueFieldTripAgent`; one DO per
  conversation id; `useModel` is the one required hook.
- **Files:** `src/agents/field-trip.ts` (new), `src/app.ts`, `wrangler.jsonc`.
- **Code:** *pending*
- **Verify:** *pending*

---

## cp2: Hook model + persistent state

- **Goal:** the agent captures the trip brief and remembers it across messages.
- **Concepts:** the agent function re-renders before every model call;
  `usePersistentState` is `useState`-shaped but durable (DO SQLite); tools can
  write state; instructions interpolate state.
- **Files:** `src/agents/field-trip.ts` (+ optional `src/tools/trip-brief.ts`).
- **Code:** *pending*
- **Verify:** *pending*

---

## cp3: Tools calling external APIs

- **Goal:** the agent looks up the weather for the trip dates.
- **Concepts:** `defineTool({ name, description, input, run })`; valibot
  validates model arguments; thrown errors become tool errors the model can
  recover from; pass `signal` to `fetch`.
- **Files:** `src/tools/weather.ts` (new), `src/agents/field-trip.ts`.
- **Code:** *pending*
- **Verify:** *pending*

---

## cp4: Subagent delegation

- **Goal:** a `venue-scout` subagent researches venues with Wikipedia tools and
  returns a shortlist.
- **Concepts:** `defineSubagent` / `useSubagent`; the built-in `task` tool; the
  child gets a fresh context and its own tools, and only its final answer
  returns; the task prompt must be a complete briefing.
- **Files:** `src/tools/wikipedia.ts`, `src/subagents/venue-scout.ts` (new),
  `src/agents/field-trip.ts`.
- **Code:** *pending*
- **Verify:** *pending*

---

## cp5: Sandbox strategies (cut line)

- **Goal:** the agent writes `itinerary.md` in a virtual sandbox and returns it.
- **Concepts:** no sandbox → virtual `just-bash` (in-memory, ms startup,
  ephemeral) → Cloudflare container via `@cloudflare/sandbox` (full Linux,
  seconds to start, persistent FS). Sandbox files are *not* durable;
  conversation + state are.
- **Cut line:** if the room is behind, talk it through and `git switch cp/5-sandbox`.
- **Files:** `src/agents/field-trip.ts`.
- **Code:** *pending*
- **Verify:** *pending*

---

## cp6: Iterate + observe

- **Goal:** change behaviour, redeploy, and read the traces.
- **Concepts:** the loop is edit → `vite dev` → smoke → deploy → smoke live →
  traces (`invoke_agent`, `chat`, `execute_tool` spans).
- **Files:** `wrangler.jsonc` (`observability`), a prompt/tool tweak.
- **Code:** *pending*
- **Verify:** *pending*

---

## cp7: Durability (instructor-led)

- **Goal:** booking survives a redeploy mid-run and happens exactly once.
- **Concepts:** submissions are admitted durably before model work; recovery on
  DO wake; ordinary interrupted tool calls get an unknown-outcome error;
  `durable: true` tools re-run with completed `step.do` steps replayed.
- **Files:** `src/shared/mock-booking-api.ts`, `src/tools/booking.ts` (new),
  `src/agents/field-trip.ts`.
- **Code:** *pending*
- **Verify:** *pending*
