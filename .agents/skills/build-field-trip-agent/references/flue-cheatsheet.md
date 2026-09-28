# Flue 2.1.1 cheatsheet (Cloudflare target)

Verified against the installed packages. For anything not covered here, use the
bundled docs, which match the installed version:

```bash
npx flue docs                                   # list pages
npx flue docs search "<query>"
npx flue docs read guide/tools                  # e.g. guide/agent-hooks, guide/subagents,
                                                # guide/sandboxes, guide/durability,
                                                # reference/agent-api, reference/agent-hooks-api,
                                                # reference/streaming-protocol, guide/cloudflare-target
```

## Imports

```ts
import {
  useModel, useTool, useSubagent, useSandbox, usePersistentState, useInstruction,
  useSkill, useAgentStart, useDataWriter, useInitialData,
  defineTool, defineSubagent, defineSkill, bash, GeneralSubagent, dispatch,
  type AgentProps,
} from '@flue/runtime';
import { createAgentRouter } from '@flue/runtime/routing';
import * as v from 'valibot';
import { Bash, InMemoryFs } from 'just-bash';
```

## Agent = function + `'use agent'`

```ts
// src/agents/field-trip.ts
'use agent';                                  // must be the first statement
import { type AgentProps, useModel } from '@flue/runtime';

export function FieldTrip({ id }: AgentProps) {
  useModel('cloudflare/@cf/moonshotai/kimi-k2.6'); // required, exactly once per render
  return `You plan team offsites. Conversation: ${id}`; // = system prompt
}
```

- Every **exported, capitalized** function in the module is an agent.
- The function re-renders **before every model call**, like a React component.
- Identity = function name (or `FieldTrip.agentName = 'literal'`). Renaming the
  function changes storage identity and needs a `renamed_classes` migration.
- Optional retry policy: `FieldTrip.durability = { maxAttempts: 10, timeoutMs: 3_600_000 }` (defaults shown).

## Naming → Durable Objects

| Agent identity | DO class | Env binding |
|---|---|---|
| `FieldTrip` | `FlueFieldTripAgent` | `FLUE_FIELD_TRIP_AGENT` |
| `IssueTriage` | `FlueIssueTriageAgent` | `FLUE_ISSUE_TRIAGE_AGENT` |

One Durable Object instance **per conversation id**, with its own SQLite: the
conversation stream, persistent state, submissions queue, and durable step
records all live there.

## Routing (`src/app.ts`)

```ts
import { createAgentRouter } from '@flue/runtime/routing';
import { Hono } from 'hono';
import { FieldTrip } from './agents/field-trip.ts';

const app = new Hono();
app.route('/agents/field-trip', createAgentRouter(FieldTrip));
app.get('/api/ping', (c) => c.text('pong'));
export default app;
```

Mount path is free to choose and is **not** part of identity. Put auth
middleware before the mount in real apps.

## HTTP protocol (per conversation)

| Request | Result |
|---|---|
| `POST /agents/field-trip/:id` body `{"kind":"user","body":"..."}` | `202 { streamUrl, offset, submissionId, uid }` (fire-and-forget) |
| `GET /agents/field-trip/:id` (`?view=history`) | snapshot `{ messages[], settlements[] }` |
| `GET …/:id?view=updates&offset=<o>&live=sse` | live stream of chunks |
| `POST …/:id/abort` | abort in-flight + queued work |

- Unknown conversation → `404 stream_not_found` on reads (the first POST creates it).
- Message parts: `text`, `reasoning`, `dynamic-tool` (`toolName`, `input`,
  `state: input-available | output-available | output-error`), `data-<name>`.
- A submission is done when `settlements[]` has its `submissionId`
  (`completed | failed | aborted`). `npm run smoke` does exactly this.

## Tools

```ts
// src/tools/weather.ts
import { defineTool } from '@flue/runtime';
import * as v from 'valibot';

export const geocodeCity = defineTool({
  name: 'geocode_city',                       // snake_case; must be unique; not reserved
  description: 'Look up latitude/longitude for a city name. Use before get_forecast.',
  input: v.object({ city: v.string() }),      // top-level v.object(...) required
  async run({ data, signal, log }) {
    const res = await fetch(`https://…?name=${encodeURIComponent(data.city)}`, { signal });
    if (!res.ok) throw new Error(`Geocoding failed: ${res.status}`); // model sees this
    return { output: await res.json() };      // or return a string
  },
});
```

Mount in the agent with `useTool(geocodeCity)`, or inline with `useTool({ …same shape… })`.

- `run` context: `data` (parsed input), `signal`, `log.info/warn/error` (streamed,
  not shown to the model), `toolCallId`; `harness` if `harness: true`; `step` if `durable: true`.
- Return `{ output }` (JSON-serializable), a bare string, or nothing (only when
  there's no `output` schema). Returning a bare object throws, so wrap it in `{ output }`.
- `{ output, terminate: true }` ends the turn after the batch.
- Optional: `output` schema, `timeoutMs`.
- Invalid args → `ToolInputValidationError` goes back to the model, which retries.
- **Reserved names:** `task`, `activate_skill`, `read_skill_resource`, `read`,
  `write`, `edit`, `bash`, `grep`, `glob`.

## Persistent state

```ts
const [brief, setBrief] = usePersistentState<Brief | null>('brief', null);
setBrief(next);                  // from a tool's run
setCount((prev) => prev + 1);    // updater form when deriving from previous
```

- Durable per conversation (DO SQLite), JSON values, keyed by name.
- Writes from a tool commit **atomically with that tool batch**: if the batch is
  interrupted, the write never happened.
- Only the parent agent can use it. Subagents can't.

## Conditional hooks

Resource hooks (`useTool`, `useSubagent`, `useSkill`, `useSandbox`) may be
conditional: `if (brief) useTool(bookOffsite);`. The runtime announces roster
changes to the model. `useModel` must never be conditional.

## Instructions helpers

- `useInstruction(text)` appends to the system prompt (handy inside custom hooks).
- Custom hooks = plain `useXxx()` functions that call other hooks and return a
  string to splice into instructions.

## Subagents

```ts
// src/subagents/venue-scout.ts  — ordinary module, NOT 'use agent'
import { defineSubagent, useTool } from '@flue/runtime';
import { findNearbyPlaces, getPlaceSummary } from '../tools/wikipedia.ts';

function VenueScout() {                       // not exported from any 'use agent' file
  useTool(findNearbyPlaces);
  useTool(getPlaceSummary);
  return 'You research offsite venues near a location and return a short, cited shortlist.';
}

export const venueScout = defineSubagent({
  name: 'venue-scout',
  description: 'Researches venues near a lat/lon and returns a shortlist with one-line reasons.',
  agent: VenueScout,
  // model: 'cloudflare/@cf/...',            // optional override; inherits parent model
});
```

Parent: `useSubagent(venueScout)`. The model delegates by calling the built-in
**`task`** tool with `{ agent: 'venue-scout', prompt }`.

- The child gets a **fresh context**: none of the parent's history, tools, or
  state. **The prompt must be a complete briefing** (city, lat/lon, headcount,
  interests), so say so in the parent's instructions.
- It shares the parent's sandbox (if any) and model.
- Only its final message returns, as the `task` result.
- Inside a subagent: `useTool`, `useSkill`, `useInstruction`, and nested
  `useSubagent` work. `useModel`, `useSandbox`, and `usePersistentState` **throw**.
- Delegation depth cap: 4. Tasks in one batch run in parallel.

## Sandboxes

```ts
import { bash, useSandbox } from '@flue/runtime';
import { Bash, InMemoryFs } from 'just-bash';

useSandbox(bash(() => new Bash({ fs: new InMemoryFs() })));
// optional seed + network allowlist:
// new Bash({ fs: new InMemoryFs({ '/data/x.csv': '…' }),
//            network: { allowedUrlPrefixes: ['https://api.open-meteo.com/'] } })
```

- Adds built-in tools `read`, `write`, `edit`, `bash`, `grep`, `glob`.
- At most once per render; the factory is lazy (built once per initialization).
- The virtual FS is **ephemeral**: rebuilt for each new submission. Durable
  facts go in `usePersistentState`.

| Strategy | Start | FS | Use for |
|---|---|---|---|
| none | — | — | prompt/tool-only agents |
| virtual `just-bash` | ms | in-memory, ephemeral | scratch files, curl/jq, text reshaping |
| Cloudflare container (`@cloudflare/sandbox` + `cloudflareSandbox(getSandbox(env.Sandbox, id))` from `@flue/runtime/cloudflare`) | seconds | full Linux, persistent per id | coding agents, real toolchains |

The container option needs `src/cloudflare.ts` (`export { Sandbox } from '@cloudflare/sandbox'`),
a DO binding + migration + `containers[]` entry, and a `Dockerfile`. See
`npx flue docs read ecosystem/sandboxes/cloudflare`. It is discussed, not built, in this workshop.

## Durable tools

```ts
export const bookOffsite = defineTool({
  name: 'book_offsite',
  description: '…',
  input: v.object({ /* … */ }),
  durable: true,
  async run({ data, step, toolCallId }) {
    const hold = await step.do('hold-venue', () => api.holdVenue(/* … */));
    const bus  = await step.do('book-transport', () => api.bookTransport(/* … */));
    const conf = await step.do('confirm', () => api.confirm(hold.id, bus.id));
    return { output: conf };
  },
});
```

- An interrupted **ordinary** tool call → recovery settles it with an
  unknown-outcome error (never re-run).
- An interrupted **durable** tool call → the whole `run` re-executes; completed
  `step.do` names return their recorded value without running again.
- Rules:
  - every side effect goes in a step
  - code between steps must be cheap and pure
  - step names must be deterministic and unique per call
  - values must be small JSON
  - steps are at-least-once executed, so make each one idempotent (key on `toolCallId` + step name)
- If a redeploy removes the tool or drops `durable: true`, recovery falls back
  to the unknown-outcome path.

## Durability model (one paragraph)

Every POST/dispatch is admitted as a **submission**, recorded in the DO before
any model work (that's what the `202` means). Each submission reaches exactly one
terminal outcome. Submissions for one conversation are processed in order.
When a DO restarts (deploy, eviction), Flue reconciles from durable records:
- finished output is kept
- partial output is closed and continued
- unresolved tool calls are repaired (ordinary → error marker; durable → re-run; `task` → child resumes)

Defaults: 10 attempts, 1 h per submission.

## Workers AI model

`useModel('cloudflare/@cf/moonshotai/kimi-k2.6')` goes through the `AI` binding,
which routes via AI Gateway by default and needs no API key. Requires
`flue({ providers: ['cloudflare'] })` (or no `providers` list) and the `ai`
binding in `wrangler.jsonc`. Not available under `flue run`.
