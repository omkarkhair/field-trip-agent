# Flue 2.0.0 cheatsheet (Cloudflare target)

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
  useModel('cloudflare/@cf/google/gemma-4-26b-a4b-it'); // required, exactly once per render
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
  The output must be JSON-*typed*: values typed `unknown` fail typecheck, so
  type the parsed API response. (Full verified tools: `checkpoints/cp3-api-tools.md`.)
- Instructions are a template literal: escape backticks around tool names (`` \`get_forecast\` ``).
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
import { getPlaceSummary } from '../tools/wikipedia.ts';

function VenueScout() {                       // not exported from any 'use agent' file
  useTool(getPlaceSummary);                   // its own tools only
  return 'You assess a few places for a team offsite … end with this exact format: …';
}

export const venueScout = defineSubagent({
  name: 'venue-scout',
  description: 'Assesses up to 3 places … Prompt with the exact titles, city, headcount, interests.',
  agent: VenueScout,
  model: 'cloudflare/@cf/meta/llama-4-scout-17b-16e-instruct', // optional; inherits the parent model
  // thinkingLevel: 'low',                 // optional; inherits
});
```

Parent: `useSubagent(venueScout)`. The model delegates by calling the built-in
**`task`** tool with `{ agent: 'venue-scout', description, prompt }`.
Full verified code: `checkpoints/cp4-subagent.md`.

- The child gets a **fresh context**: none of the parent's history, tools,
  instructions, or state. **The prompt must be a complete briefing**, so say
  what to include in the parent's instructions.
- It shares the parent's sandbox (if any) and inherits its model unless `model` is set.
- Only its final message returns, as the `task` result. Give it a fixed
  output format.
- Inside a subagent: `useTool`, `useSkill`, `useInstruction`, and nested
  `useSubagent` work. `useModel`, `useSandbox`, and `usePersistentState` **throw**.
- Delegation depth cap: 4. `task` calls *in one batch* run in parallel, but
  Gemma on Workers AI emits one tool call per turn, so prefer one task with a
  list over one task per item (see cp4's design note).

## Sandboxes

The workshop uses a **Cloudflare Sandbox container** (cp5; full code in `checkpoints/cp5-sandbox.md`):

```ts
import { cloudflareSandbox } from '@flue/runtime/cloudflare';
import { getSandbox } from '@cloudflare/sandbox';     // pin 0.12.10 (NOT 1.x)
import { env } from 'cloudflare:workers';

export function FieldTrip({ id }: AgentProps) {
  useSandbox(cloudflareSandbox(getSandbox(env.Sandbox, id)));   // one container per conversation
```

Plus: `src/cloudflare.ts` (`export { Sandbox } from '@cloudflare/sandbox'`), a
`Dockerfile` (`FROM docker.io/cloudflare/sandbox:<same version>`), and in
`wrangler.jsonc` a `durable_objects.bindings` entry, a `new_sqlite_classes: ["Sandbox"]`
migration, and `containers: [{ class_name, image: "./Dockerfile", max_instances }]`.

- Adds built-in tools `read`, `write`, `edit`, `bash`, `grep`, `glob` (cwd `/workspace`).
- At most once per render; the factory is lazy (built once per initialization).
  Initialization touches the sandbox (workspace discovery), so **every
  conversation starts a container**, even if it never uses a file tool.
- Container files survive while it's awake; a sleep or redeploy wipes them.
  Durable facts go in `usePersistentState`.
- `@cloudflare/sandbox` 1.x changed `exec()` to return a process handle; Flue
  2.0.0's `cloudflareSandbox()` expects the 0.x API, so stay on 0.12.x.

| Strategy | Start | FS | Plan | Use for |
|---|---|---|---|---|
| none | — | — | any | prompt/tool-only agents |
| virtual `just-bash`: `useSandbox(bash(() => new Bash({ fs: new InMemoryFs() })))` | ms | in-memory, ephemeral | any | scratch files, curl/jq, text reshaping |
| Cloudflare Computer (`npx flue add sandbox cloudflare-computer`) | ms | SQLite in the agent DO, durable | Paid (Dynamic Workers) | durable workspace, shell-only work |
| **Cloudflare Sandbox** (`@cloudflare/sandbox`) | seconds | container disk, until sleep/redeploy | Paid (Containers) | full Linux, real toolchains |

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

`useModel('cloudflare/@cf/google/gemma-4-26b-a4b-it')` goes through the `AI` binding,
which routes via AI Gateway by default and needs no API key. Requires
`flue({ providers: ['cloudflare'] })` (or no `providers` list) and the `ai`
binding in `wrangler.jsonc`. Not available under `flue run`.

### Model choice (tested on this project)

Benchmark: cp2 agent, 5 fresh conversations per prompt:
- **brief** (details only)
- **mixed** (details + a question in one message)
- **follow-up** (brief, then a question answered from state)

| Model | Plan | brief | mixed | follow-up | Reply time | Verdict |
|---|---|---|---|---|---|---|
| `@cf/google/gemma-4-26b-a4b-it` | **free** | 5/5 | 5/5 | 5/5 | ~5–20 s | ✔ **workshop default** |
| `@cf/qwen/qwen3.8-27b` | free | 5/5 | 5/5 | 5/5 | ~12–19 s | ✔ alternative |
| `@cf/zai-org/glm-4.7-flash` | free | 5/5 | 5/5 | 5/5 | ~16–17 s | ✔ alternative |
| `@cf/meta/llama-4-scout-17b-16e-instruct` | free | 5/5 | **0/5** | 5/5 | ~1.5–5 s | ✘ on mixed messages it *writes* `save_trip_brief(...)` as text instead of calling the tool |
| `@cf/moonshotai/kimi-k2.6` | Workers Paid | ✔ | — | ✔ | ~13 s | ✔ paid alternative |
| `@cf/zai-org/glm-5.3` | Workers Paid | ✔ | — | ✔ | ~12 s | ✔ with `useModel(…, { thinkingLevel: 'low' })`. Reasoning is mandatory; other levels (incl. `'off'`) normalize to `'max'` |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | free | ✘ | ✘ | ✘ | — | incompatible (400, see below) |
| `@cf/mistralai/mistral-small-3.1-24b-instruct` | free | ✘ | ✘ | ✘ | — | incompatible (400, see below) |
| `@cf/qwen/qwen3-30b-a3b-fp8` | free | ✘ | ✘ | ✘ | — | incompatible (400, see below) |
| `@cf/openai/gpt-oss-120b` | free | ✘ | ✘ | ✘ | — | incompatible (400, see below) |

The "incompatible" models are **not wrong IDs** (they're exactly as listed in
the catalog). Their chat formats reject how Flue structures messages after a
tool call:
- `5006 … '/messages/0/content', 'array' not in 'string'`: the model only accepts string content
- `8007 … Unexpected role 'user' after role 'tool'`: the model rejects a message following a tool result

Prompt changes can't fix either.

**Gemma and `thinkingLevel`:** Gemma 4 has no reasoning-effort levels. Thinking
can only be toggled with `chat_template_kwargs.enable_thinking`, which Flue 2.0.0
doesn't send, so `thinkingLevel` has no effect on it. Don't set it.

**Subagent model (cp4):** `venue-scout` runs on `llama-4-scout`. Its weakness
(faking tool calls on *mixed* user messages) doesn't show up with a clean,
single-purpose task briefing, and it does the scout's job in ~5 s vs ~40 s on
Gemma.

List catalog models and their flags with
`npx wrangler ai models list --json` (look for `function_calling: true`
and `require_workers_paid`). Only models with function calling can use tools.
Switching models is a one-line change in the agent; no deploy config changes.
