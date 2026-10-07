# cp5: Sandbox (Cloudflare Sandbox container) (cut line)

- **Goal:** each conversation gets its own Linux container. The agent writes
  `itinerary.md` there, reads it back, and the file is still there next message.
- **Time:** 5 min. **Cut line:** if the room is behind, the instructor demos it
  and attendees recover to `cp/5-sandbox`.
- **Branch:** `cp/5-sandbox`
- **Needs:** an account with **Containers** enabled (workshop accounts have it;
  it's a Workers Paid feature) and **Docker running** for `npm run dev` and
  `npm run deploy`. See `prework.md`.
- **Files:** `package.json` (`@cloudflare/sandbox`), `Dockerfile` (new),
  `src/cloudflare.ts` (new), `wrangler.jsonc`, `src/env.d.ts`,
  `src/agents/field-trip.ts`.

## Concepts to explain

1. **Sandbox strategies**, from least to most capable:

   | Strategy | Files live | Starts | Plan | Use for |
   |---|---|---|---|---|
   | none | — | — | any | prompt/tool-only agents (cp1–cp4) |
   | virtual `just-bash` | in memory, gone next message | ms | any | scratch files, text reshaping |
   | Cloudflare Computer | SQLite in the agent's own DO, durable | ms | Paid (shell runs in a Dynamic Worker) | durable workspace, no Linux needed |
   | **Cloudflare Sandbox** (what we build) | container disk, while it's awake | seconds | Paid (Containers) | full Linux: git, node, python, real binaries |

2. **One line in the agent.** `useSandbox(cloudflareSandbox(getSandbox(env.Sandbox, id)))`
   gives the model the built-in `read`, `write`, `edit`, `bash`, `grep`, `glob`
   tools. Keying on the conversation `id` means one container per conversation.
3. **The sandbox is a Durable Object too.** `Sandbox` is a DO class (exported
   from `src/cloudflare.ts`, binding + `v2` migration) that owns a container
   built from `./Dockerfile`.
4. **Durable vs not:** the conversation and `usePersistentState` live in the
   agent's DO and survive container sleep, replacement, and Worker redeploys.
   Container files survive between messages while the instance is awake but are
   lost when it stops or restarts. A deploy with no effective container change
   does not roll out a new instance, so use another conversation ID to
   demonstrate isolation deterministically.
5. **Subagents share the parent's sandbox**: `venue-scout` gets the same tools
   and files.

## Diff from cp4 (paste these)

Install (exact version, it must match the Docker image tag):

```bash
npm install --save-exact @cloudflare/sandbox@0.12.10
```

`Dockerfile` (new, project root):

```dockerfile
FROM docker.io/cloudflare/sandbox:0.12.10
```

`src/cloudflare.ts` (new):

```ts
export { Sandbox } from '@cloudflare/sandbox';
```

`wrangler.jsonc`: append a migration, then add two top-level keys:

```jsonc
    { "tag": "v2", "new_sqlite_classes": ["Sandbox"] }
```
```jsonc
  "durable_objects": { "bindings": [{ "name": "Sandbox", "class_name": "Sandbox" }] },
  "containers": [{ "class_name": "Sandbox", "image": "./Dockerfile", "max_instances": 10 }]
```

`src/env.d.ts`: add (types `env.Sandbox` for `npm run typecheck`):

```ts
declare module 'cloudflare:workers' {
  export const env: { Sandbox: Parameters<typeof import('@cloudflare/sandbox').getSandbox>[0] };
}
```

`src/agents/field-trip.ts`:

```ts
// imports: add AgentProps + useSandbox to the @flue/runtime import, plus:
import { cloudflareSandbox } from '@flue/runtime/cloudflare';
import { getSandbox } from '@cloudflare/sandbox';
import { env } from 'cloudflare:workers';

export function FieldTrip({ id }: AgentProps) {   // was: FieldTrip()

  // after useSubagent(venueScout):
  useSandbox(cloudflareSandbox(getSandbox(env.Sandbox, id)));
```

and a new rule 5 in the instructions (old rule 5 becomes 6):

```
5. For an itinerary: \`write\` it to itinerary.md (one section per day: places, timing, weather), then \`read\` it to check. Do not repeat the file in your reply (the user sees the read result); reply in one sentence.
```

The "do not repeat the file" part matters: asked to echo a long file, Gemma
fell into a repetition loop ("most, most, most…", 40k characters) and timed out.

## Final code

### `wrangler.jsonc`

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "field-trip-agent",

  // Flue requires nodejs_compat and a compatibility_date of 2026-04-01 or newer.
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat"],

  // Workers AI binding: powers `cloudflare/@cf/...` models. No API keys needed.
  // AI always runs remotely (even in `vite dev`), so `remote: true` is explicit.
  "ai": {
    "binding": "AI",
    "remote": true
  },

  // Durable Object migrations. Flue generates one DO class per agent
  // (FieldTrip -> FlueFieldTripAgent), but YOU own the migration history.
  // Checkpoint 1 adds the first entry here. Append; never rewrite deployed entries.
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["FlueFieldTripAgent"]
    },
    { "tag": "v2", "new_sqlite_classes": ["Sandbox"] }
  ],

  // cp5: container sandbox (class exported from src/cloudflare.ts, image from ./Dockerfile).
  "durable_objects": { "bindings": [{ "name": "Sandbox", "class_name": "Sandbox" }] },
  "containers": [{ "class_name": "Sandbox", "image": "./Dockerfile", "max_instances": 10 }]
}
```

### `src/env.d.ts`

```ts
// Vite `?raw` imports return the file contents as a string (used for the chat UI).
declare module '*.html?raw' {
  const content: string;
  export default content;
}

// cp5: the Sandbox binding from wrangler.jsonc, typed for `import { env } from 'cloudflare:workers'`.
declare module 'cloudflare:workers' {
  export const env: { Sandbox: Parameters<typeof import('@cloudflare/sandbox').getSandbox>[0] };
}
```

### `src/cloudflare.ts`

```ts
// Extra Worker-entry exports. Flue re-exports everything from this file.
// The Sandbox Durable Object class backs the agent's container sandbox (cp5).
export { Sandbox } from '@cloudflare/sandbox';
```

### `Dockerfile`

```dockerfile
# Container image for the agent sandbox (cp5).
# The tag MUST match the @cloudflare/sandbox version in package.json.
FROM docker.io/cloudflare/sandbox:0.12.10
```

### `src/agents/field-trip.ts`

```ts
'use agent';

import { type AgentProps, useModel, usePersistentState, useSandbox, useSubagent, useTool } from '@flue/runtime';
import { cloudflareSandbox } from '@flue/runtime/cloudflare';
import { getSandbox } from '@cloudflare/sandbox';
import { env } from 'cloudflare:workers';
import * as v from 'valibot';
import { geocodeCity, getForecast } from '../tools/weather.ts';
import { findNearbyPlaces } from '../tools/wikipedia.ts';
import { venueScout } from '../subagents/venue-scout.ts';

// The trip brief the agent remembers for this conversation.
type TripBrief = {
  city?: string;
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  headcount?: number;
  budget?: string;
  interests?: string[];
};

export function FieldTrip({ id }: AgentProps) {
  useModel('cloudflare/@cf/google/gemma-4-26b-a4b-it');

  // Durable, per-conversation state (stored in this conversation's Durable Object).
  // Shaped like React's useState, but it survives restarts and redeploys.
  const [brief, setBrief] = usePersistentState<TripBrief>('brief', {});

  // Tools can write state. The write commits together with the tool call.
  useTool({
    name: 'save_trip_brief',
    description:
      'Save or update the offsite trip brief. Call this whenever the user states or changes the city, dates, headcount, budget, or interests. Only include fields the user mentioned; they are merged into the saved brief.',
    input: v.object({
      city: v.optional(v.string()),
      startDate: v.optional(v.pipe(v.string(), v.isoDate())),
      endDate: v.optional(v.pipe(v.string(), v.isoDate())),
      headcount: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
      budget: v.optional(v.string()),
      interests: v.optional(v.array(v.string())),
    }),
    async run({ data }) {
      const updates = Object.fromEntries(
        Object.entries(data).filter(([, value]) => value !== undefined),
      ) as TripBrief;
      setBrief((previous) => ({ ...previous, ...updates }));
      return { output: { saved: updates } };
    },
  });

  // Tools that call an external API (Open-Meteo), defined in src/tools/weather.ts.
  useTool(geocodeCity);
  useTool(getForecast);

  // The parent finds candidate places (Wikipedia geosearch)...
  useTool(findNearbyPlaces);

  // ...and delegates assessing all three to one subagent call. The scout runs
  // in a fresh context with its own tools, and only its final answer comes back.
  useSubagent(venueScout);

  // A Linux container per conversation (adds read/write/edit/bash/grep/glob tools).
  useSandbox(cloudflareSandbox(getSandbox(env.Sandbox, id)));

  // The agent re-renders before every model call, so these instructions
  // always reflect the latest saved brief.
  const hasBrief = Object.keys(brief).length > 0;
  const today = new Date().toISOString().slice(0, 10);
  return `You are FieldTrip, a helpful team-offsite planner. You help groups plan memorable offsites by understanding their destination, dates, headcount, budget, and interests.

Rules:
1. If the user's message contains ANY trip detail (city, dates, headcount, budget, interests), your FIRST action is to call \`save_trip_brief\` with those fields. Do this before writing any reply.
2. Answer questions about the trip from the saved brief below. If a detail is missing, ask for it.
3. For weather questions: call \`geocode_city\` for the city, then \`get_forecast\` with its latitude/longitude and the trip dates (use the saved brief). If there is no end date, use the start date. Summarise the forecast per day in plain words; if a tool returns an error, explain it to the user.
4. For venue, activity or place suggestions:
   a. Call \`geocode_city\`, then \`find_nearby_places\` with its coordinates.
   b. Pick the 3 places that best fit the brief (skip stations, offices, hospitals, embassies, companies, events).
   c. Call \`task\` ONCE with agent \`venue-scout\` for all 3 places. The scout cannot see this conversation, so the prompt must be a complete briefing: the exact place titles, the city, the headcount, and the interests.
   d. Combine the results into a short plan, keeping the links. If you know the forecast, suggest outdoor places for dry days and indoor ones for rainy days.
5. For an itinerary: \`write\` it to itinerary.md (one section per day: places, timing, weather), then \`read\` it to check. Do not repeat the file in your reply (the user sees the read result); reply in one sentence.
6. Keep replies short: at most 120 words unless the user asks for more detail.

Today is ${today}.

## Saved trip brief
${hasBrief ? JSON.stringify(brief, null, 2) : '(nothing saved yet)'}`;
}
```

`src/tools/*`, `src/subagents/venue-scout.ts` and `src/app.ts` are unchanged from cp4.

## Verify

The **first** `npm run dev` after this change builds the container image (pulls
~200 MB; ~1 min). Use **one** conversation id: every conversation id starts
its own container (~1.3 GB RAM locally on Apple Silicon, see troubleshooting).

```bash
npm run smoke -- http://localhost:5173 cp5-local "Offsite in Lisbon from <START> to <END> for 14 people, budget 400 EUR each. We like food, history and the outdoors."
npm run smoke -- http://localhost:5173 cp5-local "Suggest 3 places for our offsite."
npm run smoke -- http://localhost:5173 cp5-local "Write the itinerary to itinerary.md and show it to me."
npm run smoke -- http://localhost:5173 cp5-local "Show me itinerary.md again."
```

Pass:
1. Message 3 shows `⚙ write({"content":"# …","path":"itinerary.md"}) → Successfully wrote … bytes`,
   then `⚙ read({"path":"itinerary.md"}) → # …`, then a one-sentence reply.
   (The UI's cp5 chip sends the same message; expand the `read` chip to see the file.)
2. Message 4 shows the itinerary again: the file is still in the container.

Optional isolation check with a fresh local conversation id:

```bash
npm run smoke -- http://localhost:5173 cp5-local-other "Use bash to run: ls -la /workspace. Then tell me whether a trip brief is saved."
```

Pass: the different conversation does not inherit `cp5-local`'s itinerary or
trip brief. Container loss after sleep or replacement is real but not a
deterministic workshop check.

### Sample passing output (reference build)

```
you › Write the itinerary to itinerary.md and show it to me.

agent ›
  ⚙ get_forecast({"endDate":"2026-10-09",…,"startDate":"2026-10-08"}) → [{"date":"2026-10-08","minC":17,"maxC":22.3,…}]
  ⚙ write({"content":"# Offsite Itinerary: Lisbon\n\n## 2026-10-08\n**Weather**: Partly cloudy, high of 22°C.\n- 10:00 - 12:00: Gu…) → Successfully wrote 548 bytes to itinerary.md
  ⚙ read({"path":"itinerary.md"}) → # Offsite Itinerary: Lisbon …
I have created and saved your itinerary in itinerary.md.
✔ completed in 60.8s

you › Use bash to run: ls -la /workspace. Then tell me whether a trip brief is saved.   (in cp5-live-other)
agent ›
  ⚙ bash({"command":"ls -la /workspace"}) → total 8 …
The directory contains only `.` and `..`.
No trip brief is saved for this conversation.
✔ completed in 9.8s
```

Reference timings: itinerary turn 35 s live, 61 s local (when the model re-fetches
the forecast); a re-read ~8 s. Container cold start adds a few seconds to the
first message of a conversation.

## What to tell the attendee

"One line gave your agent a real Linux machine per conversation: it wrote a
file, read it back, and could run any shell command. The container is itself
a Durable Object, but its files and the agent's persistent state have different
lifecycle guarantees. Next (cp6): change behaviour, redeploy, and watch it in traces."
