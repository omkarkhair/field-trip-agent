# cp1: Hello agent + first deploy

- **Goal:** the first agent, answering locally *and* on the live `workers.dev` URL.
- **Time:** 9 min. Deploying here is deliberate: account and login problems
  surface early, while there's still time to fix them.
- **Branch:** `fix/flue-2.0.0-cp1`
- **Files:** `src/agents/field-trip.ts` (new), `src/app.ts`, `wrangler.jsonc`.
  Delete `src/agents/.gitkeep`.

## Concepts to explain

1. **An agent is a function that returns its system prompt.** Flue re-runs
   ("re-renders") it before every model call.
2. **`'use agent'` registers it.** At build time Flue scans for the directive
   and turns every *exported, capitalized* function into an agent.
3. **The function name is the durable identity.** `FieldTrip` → Durable Object
   class `FlueFieldTripAgent`, binding `FLUE_FIELD_TRIP_AGENT`. Each
   conversation id gets its own DO instance with its own SQLite, which stores
   the conversation history.
4. **`useModel` is the one required hook,** called exactly once per render.
   `cloudflare/...` runs on Workers AI through the `AI` binding, so no API key is needed.
5. **Adding an agent is a triple:**
   - the `'use agent'` file
   - the `app.route(...)` mount
   - a `new_sqlite_classes` migration

   Miss any one of them and it won't work.

## Diff from cp0

```diff
--- a/src/app.ts
+++ b/src/app.ts
 import { Hono } from 'hono';
+import { createAgentRouter } from '@flue/runtime/routing';
+import { FieldTrip } from './agents/field-trip.ts';
 ...
 app.get('/api/ping', (c) => c.text('pong'));
+app.route('/agents/field-trip', createAgentRouter(FieldTrip));

--- a/wrangler.jsonc
+++ b/wrangler.jsonc
-  "migrations": []
+  "migrations": [
+    {
+      "tag": "v1",
+      "new_sqlite_classes": ["FlueFieldTripAgent"]
+    }
+  ]
```

## Final code

### `src/agents/field-trip.ts` (new)

```ts
'use agent';

import { useModel } from '@flue/runtime';

export function FieldTrip() {
  useModel('cloudflare/@cf/moonshotai/kimi-k2.6');
  return `You are FieldTrip, a helpful team-offsite planner. You help groups plan memorable offsites by understanding their destination, dates, headcount, budget, and interests.`;
}
```

### `src/app.ts`

```ts
import { Hono } from 'hono';
import { createAgentRouter } from '@flue/runtime/routing';
import { FieldTrip } from './agents/field-trip.ts';

// src/app.ts is the Flue route map. Its default export owns every HTTP request
// the Worker receives. Agents get mounted here with createAgentRouter(...)
// starting in checkpoint 1.
const app = new Hono();

app.get('/api/ping', (c) => c.text('pong'));
app.route('/agents/field-trip', createAgentRouter(FieldTrip));

export default app;
```

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
    }
  ]
}
```

**Do not add `account_id`** to `wrangler.jsonc`. If the attendee has several
accounts, use `export CLOUDFLARE_ACCOUNT_ID=<id>` instead. That keeps the repo
portable.

## Verify

1. **Local**. With `npm run dev` running:
   ```bash
   npm run smoke -- http://localhost:5173 cp1-local "Hi, who are you?"
   ```
   Pass: exit 0, `202 accepted`, the agent introduces itself as FieldTrip,
   `✔ completed`.

2. **Same conversation remembers history** (the DO for `cp1-local` stores it):
   ```bash
   npm run smoke -- http://localhost:5173 cp1-local "What was the first thing I asked you? One sentence."
   ```
   Pass: it quotes "Hi, who are you?".

3. **Deploy + live**:
   ```bash
   npm run deploy
   # → Deployed field-trip-agent … https://field-trip-agent.<subdomain>.workers.dev
   #   bindings: env.FLUE_FIELD_TRIP_AGENT (FlueFieldTripAgent) Durable Object, env.AI
   npm run smoke -- https://field-trip-agent.<subdomain>.workers.dev cp1-live "Hi, who are you? Two sentences."
   ```
   Pass: exit 0, same kind of reply from the live URL.

### Sample passing output (reference build)

```
POST http://localhost:5173/agents/field-trip/cp1-local
202 accepted · submission sub_01M3NWX9… · waiting for the reply…

you › Hi, who are you?

agent ›
Hi! I'm **FieldTrip**, your team-offsite planning assistant. …
- **Destination** … **Dates** … **Headcount** … **Budget** … **Interests** …
**What kind of offsite are you thinking about?**

✔ completed in 10.6s
```

Reference timings: about 5–11 s per reply locally and live. Deploy upload is
about 807 KiB gzipped.

## What to tell the attendee

"Your agent is live. It's a function with a `'use agent'` directive, and Flue
turned it into a Durable Object class. Every conversation id is its own DO, which
is why the second message remembered the first. Next (cp2): give it memory your
*code* can read, not just chat history."
