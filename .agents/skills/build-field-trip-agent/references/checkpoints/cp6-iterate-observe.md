# cp6: Iterate + observe

- **Goal:** turn on Workers Logs + Traces, redeploy, and read what the agent
  did in the Cloudflare dashboard. Plus one iteration: attach the sandbox only
  when it's needed, so "Hi" no longer starts a container.
- **Time:** 7 min
- **Branch:** `cp/6-iterate-observe`
- **Files:** `wrangler.jsonc`, `src/tools/weather.ts` (one log line),
  `src/agents/field-trip.ts` (lazy sandbox).

## Concepts to explain

1. **The loop:** edit → `npm run dev` → smoke → `npm run deploy` → smoke live →
   look at the dashboard.
2. **Observability is config, not code.** One `wrangler.jsonc` block turns on
   Workers Logs and Traces. Flue adds agent-shaped spans to every trace on its
   own: `invoke_agent` → `chat` (one per model turn, with token usage) →
   `execute_tool` (one per tool call, including `task` for the scout).
3. **One trace per agent response.** Admission (the POST) answers right away;
   the response then runs as its own unit of work, so look for traces on the
   agent's Durable Object, not on the POST.
4. **Logs:** `console.log({...})` in a tool shows up in Workers Logs, and object
   fields become searchable (`event = forecast`). The model never sees it.
   (Flue's `log.info` in a tool's `run` context is different: it goes to the
   runtime event stream for `observe()` subscribers, not to Workers Logs.)
5. **Iterate: lazy sandbox.** In cp5, *every* conversation started a container,
   even for "Hi": Flue initializes the sandbox up front and checks the workspace
   (`exists('/workspace/AGENTS.md')`, `.agents/skills`, a directory listing) to
   build the system prompt. Now `useSandbox` is called only once a persistent
   `workspace` flag is true, and a tiny `open_workspace` tool flips it. Hooks may
   be conditional: Flue swaps the environment at the next turn boundary and tells
   the model with an `[advisory] The agent's execution environment (sandbox) was replaced…`
   signal. Because the flag is persistent state, later messages re-attach the same container.

## Diff from cp5 (paste these)

`wrangler.jsonc`: add a comma after the `containers` line, then:

```jsonc
  "observability": { "enabled": true, "traces": { "enabled": true } }
```

`src/tools/weather.ts`, in `get_forecast`'s `run`, just before `return {`:

```ts
    console.log({ event: 'forecast', latitude: data.latitude, longitude: data.longitude, days: daily.time.length }); // cp6: Workers Logs
```

`src/agents/field-trip.ts`: replace the `useSandbox(...)` line with:

```ts
  const [workspace, setWorkspace] = usePersistentState('workspace', false);
  useTool({ name: 'open_workspace', description: 'Attach the file workspace (read/write/bash tools).', async run() { setWorkspace(true); return 'Workspace attached.'; } });
  if (workspace) useSandbox(cloudflareSandbox(getSandbox(env.Sandbox, id)));
```

and start rule 5 with `if you have no \`write\` tool yet, call \`open_workspace\` first. Then`:

```
5. For an itinerary: if you have no \`write\` tool yet, call \`open_workspace\` first. Then \`write\` it to itinerary.md (one section per day: places, timing, weather), then \`read\` it to check. Do not repeat the file in your reply (the user sees the read result); reply in one sentence.
```

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
  "containers": [{ "class_name": "Sandbox", "image": "./Dockerfile", "max_instances": 10 }],

  // cp6: Workers Logs + Traces (dashboard → Workers & Pages → field-trip-agent → Observability).
  "observability": { "enabled": true, "traces": { "enabled": true } }
}
```

### `src/tools/weather.ts`

```ts
import { defineTool } from '@flue/runtime';
import * as v from 'valibot';

// Open-Meteo: free, no API key. https://open-meteo.com/en/docs

export const geocodeCity = defineTool({
  name: 'geocode_city',
  description:
    'Look up a city by name and return its latitude, longitude, country and timezone. Call this before get_forecast.',
  input: v.object({
    city: v.pipe(v.string(), v.minLength(2), v.description('City name only, e.g. "Lisbon"')),
  }),
  async run({ data, signal }) {
    // The geocoder matches names only, so "Lisbon, Portugal" -> "Lisbon".
    const name = data.city.split(',')[0].trim();
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=en&format=json`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Geocoding failed: HTTP ${res.status}`);
    const body = (await res.json()) as {
      results?: Array<{ name: string; country: string; latitude: number; longitude: number; timezone: string }>;
    };
    const place = body.results?.[0];
    // Throwing turns into a tool error the model can see and recover from.
    if (!place) throw new Error(`No city found named "${name}". Ask the user to check the spelling.`);
    return {
      output: {
        name: place.name,
        country: place.country,
        latitude: place.latitude,
        longitude: place.longitude,
        timezone: place.timezone,
      },
    };
  },
});

// WMO weather codes -> short descriptions, so the model doesn't have to guess.
const WEATHER: Record<number, string> = {
  0: 'clear sky', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'rime fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'dense drizzle', 61: 'light rain', 63: 'rain', 65: 'heavy rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 80: 'rain showers', 81: 'heavy showers',
  82: 'violent showers', 95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'severe thunderstorm with hail',
};

const isoDate = v.pipe(v.string(), v.isoDate());

export const getForecast = defineTool({
  name: 'get_forecast',
  description:
    'Get the daily weather forecast (min/max °C, chance of rain, conditions) for a latitude/longitude between two dates (YYYY-MM-DD). Only works up to 16 days ahead. Get coordinates from geocode_city first.',
  input: v.object({
    latitude: v.number(),
    longitude: v.number(),
    startDate: isoDate,
    endDate: isoDate,
  }),
  async run({ data, signal }) {
    const params = new URLSearchParams({
      latitude: String(data.latitude),
      longitude: String(data.longitude),
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code',
      start_date: data.startDate,
      end_date: data.endDate,
      timezone: 'auto',
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal });
    if (!res.ok) {
      const reason = ((await res.json().catch(() => ({}))) as { reason?: string }).reason;
      const today = new Date().toISOString().slice(0, 10);
      throw new Error(
        `Forecast unavailable for ${data.startDate}..${data.endDate}: ${reason ?? `HTTP ${res.status}`}. ` +
          `Forecasts only cover today (${today}) up to 16 days ahead.`,
      );
    }
    const { daily } = (await res.json()) as {
      daily: {
        time: string[];
        temperature_2m_min: number[];
        temperature_2m_max: number[];
        precipitation_probability_max: number[];
        weather_code: number[];
      };
    };
    console.log({ event: 'forecast', latitude: data.latitude, longitude: data.longitude, days: daily.time.length }); // cp6: Workers Logs
    return {
      output: daily.time.map((date, i) => ({
        date,
        minC: daily.temperature_2m_min[i],
        maxC: daily.temperature_2m_max[i],
        rainChancePct: daily.precipitation_probability_max[i],
        conditions: WEATHER[daily.weather_code[i]] ?? `code ${daily.weather_code[i]}`,
      })),
    };
  },
});
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

  // ...and delegates assessing each one to a subagent. The model calls the
  // built-in `task` tool once per place; each scout runs in a fresh context
  // with its own tools, and only its final answer comes back here.
  useSubagent(venueScout);

  // A Linux container per conversation (adds read/write/edit/bash/grep/glob tools),
  // attached only once the model opens it, so "Hi" never starts a container.
  const [workspace, setWorkspace] = usePersistentState('workspace', false);
  useTool({ name: 'open_workspace', description: 'Attach the file workspace (read/write/bash tools).', async run() { setWorkspace(true); return 'Workspace attached.'; } });
  if (workspace) useSandbox(cloudflareSandbox(getSandbox(env.Sandbox, id)));

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
5. For an itinerary: if you have no \`write\` tool yet, call \`open_workspace\` first. Then \`write\` it to itinerary.md (one section per day: places, timing, weather), then \`read\` it to check. Do not repeat the file in your reply (the user sees the read result); reply in one sentence.
6. Keep replies short: at most 120 words unless the user asks for more detail.

Today is ${today}.

## Saved trip brief
${hasBrief ? JSON.stringify(brief, null, 2) : '(nothing saved yet)'}`;
}
```

Everything else is unchanged from cp5.

## Verify

Local (log line in the `npm run dev` terminal):

```bash
npm run smoke -- http://localhost:5173 cp6-local "Offsite in Lisbon from <START> to <END> for 14 people. What's the weather for those dates?"
```

Pass: `⚙ get_forecast(...)` in the smoke output, and the dev terminal prints
`{ event: 'forecast', latitude: 38.72509, longitude: -9.1498, days: 2 }`.

Live:

```bash
npm run deploy
npm run smoke -- https://field-trip-agent.<subdomain>.workers.dev cp6-live "Offsite in Lisbon from <START> to <END> for 14 people. What's the weather for those dates?"
```

Then in the dashboard: **Workers & Pages → field-trip-agent → Observability**
(give it a minute or two to ingest):

- **Traces:** open the newest trace for `FlueFieldTripAgent`. Walk the tree:
  `invoke_agent FieldTrip` → `chat @cf/google/gemma-4-26b-a4b-it` (token usage) →
  `execute_tool geocode_city` / `get_forecast` → the outbound `fetch` to Open-Meteo.
- **Logs / Events:** filter `event = forecast` to find the log line.
- **Things worth pointing at:** the `task` span for `venue-scout` (cp4) and the
  scout's own `chat` spans on llama-4-scout; the cp5 itinerary turn, where
  the trace shows the model re-fetching the weather it already had.

Lazy sandbox (fresh id; on the live URL, or locally with `docker ps` in another terminal):

```bash
npm run smoke -- <url> cp6-lazy "Hi, who are you? One sentence."
npm run smoke -- <url> cp6-lazy "Offsite in Porto from <START> to <END> for 10 people. We like wine, architecture and walking."
npm run smoke -- <url> cp6-lazy "Write the itinerary to itinerary.md and show it to me."
npm run smoke -- <url> cp6-lazy "Show me itinerary.md again."
```

Pass:
1. "Hi" replies in a few seconds and **no container starts** (`docker ps` shows
   no `workerd-field-trip-agent-Sandbox-…` locally).
2. The itinerary turn shows `⚙ open_workspace({}) → Workspace attached.`, then
   `⚙ write` and `⚙ read`, and the output ends with
   `[advisory] The agent's execution environment (sandbox) was replaced.`
3. The re-read works: the same container is re-attached.

Sample (live, reference build):

```
you › Hi, who are you? One sentence.
✔ completed in 3.2s                       (was ~10 s with a container cold start)

you › Write the itinerary to itinerary.md and show it to me.
  ⚙ geocode_city … ⚙ get_forecast … ⚙ find_nearby_places … ⚙ task …
  ⚙ open_workspace({}) → Workspace attached.
  ⚙ write({"content":"# Porto Offsite Itinerary\n\n## 2026-10-09 …","path":"itinerary.md"}) → Successfully wrote …
  ⚙ read({"path":"itinerary.md"}) → # Porto Offsite Itinerary …
I've written your itinerary to itinerary.md.
[advisory] The agent's execution environment (sandbox) was replaced.
✔ completed in 75.6s

you › Show me itinerary.md again.
  ⚙ read({"path":"itinerary.md"}) → # Porto Offsite Itinerary …
✔ completed in 7.9s
```

In the dashboard, compare the "Hi" trace with cp5's: no `Sandbox` spans now.

`npx wrangler tail field-trip-agent` shows the short request/RPC/alarm
invocations but **not** the response's own log lines (the response runs
detached from the invocation that starts it). Use the dashboard.

## What to tell the attendee

"Four lines of config and you can see every model turn, token count and tool
call your agent made, per response, in production. And one iteration: three
lines made the sandbox lazy, because a hook can be conditional and a tool can
flip the state that gates it. You now have the complete six-checkpoint agent."
