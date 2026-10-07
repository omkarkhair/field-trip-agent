# cp4: Subagent delegation

- **Goal:** the parent finds candidate places near the city, then delegates
  assessing them to a `venue-scout` subagent. The scout returns activities,
  typical visit length, weather dependency and group fit, and the parent
  combines that with the forecast.
- **Time:** 8 min
- **Tag / branch:** `cp4` / `cp/4-subagent`
- **Files:** `src/tools/wikipedia.ts` (new), `src/subagents/venue-scout.ts`
  (new), `src/agents/field-trip.ts`. No config change, no new migration: a
  subagent is **not** a registered agent, so it gets no Durable Object.

## Concepts to explain

1. **`defineSubagent({ name, description, agent })`** in an ordinary module (not
   `'use agent'`). The `agent` function is not exported and has no `useModel()`:
   it is a capability of the parent, with no URL, conversation id or state.
2. **`useSubagent(venueScout)`** in the parent catalogs it in the system prompt.
   The model delegates by calling the built-in **`task`** tool with
   `{ agent: 'venue-scout', prompt }`.
3. **Fresh context.** The child sees *only* the task prompt: no history, no
   parent tools, no saved brief. **The prompt is the entire briefing**, so the
   parent's instructions say exactly what to include (titles, city, headcount,
   interests). Point at the `task` call's `prompt` in the output.
4. **Its own tools.** The scout mounts only `get_place_summary`. The parent
   keeps `find_nearby_places`. Each agent gets just the tools for its job.
5. **Only the final answer returns.** The child's tool calls and reasoning stay
   out of the parent's context. That's why the scout ends with a fixed output
   format: it's a contract with the parent.
6. **A delegate can run on a different model.** The parent runs on Gemma; the
   scout pins `model: 'cloudflare/@cf/meta/llama-4-scout-17b-16e-instruct'`,
   which is fast and fine for a narrow, well-briefed job. The scout's task drops
   from ~40 s to ~5 s.
7. **`defineTool` reuse:** `wikipedia.ts` exports two tools, mounted by two
   different agents.

Design note for Q&A: Flue runs several `task` calls in one batch in parallel,
but Gemma on Workers AI issues them one per turn (each costing a parent model
call), so one task covering all 3 places is much faster than one task per
place here. With a model that batches tool calls, a task per place fans out
in parallel.

## Diff from cp3

- New `src/tools/wikipedia.ts`: `findNearbyPlaces` (geosearch with descriptions
  and distances) and `getPlaceSummary` (REST summary + URL). Both send a
  descriptive `User-Agent`.
- New `src/subagents/venue-scout.ts`: `VenueScout` mounts `getPlaceSummary`;
  `defineSubagent` with its own `model`.
- Agent: import both, `useTool(findNearbyPlaces)`, `useSubagent(venueScout)`,
  and rule 4 (geocode → find → pick 3 → one `task` → combine with the forecast).

## Final code

### `src/tools/wikipedia.ts`

```ts
import { defineTool } from '@flue/runtime';
import * as v from 'valibot';

// Wikipedia APIs: free, no API key, but a descriptive User-Agent is required.
// https://www.mediawiki.org/wiki/API:Etiquette
const HEADERS = {
  'User-Agent': 'FieldTripAgent/0.1 (Flue workshop demo; https://github.com/omkarkhair/field-trip-agent)',
  Accept: 'application/json',
};

export const findNearbyPlaces = defineTool({
  name: 'find_nearby_places',
  description:
    'List Wikipedia articles about places near a latitude/longitude (up to 10 km), with a one-line description and distance. Results include noise (stations, offices, events): pick the places that suit a group offsite.',
  input: v.object({
    latitude: v.number(),
    longitude: v.number(),
    radiusMeters: v.optional(v.pipe(v.number(), v.minValue(100), v.maxValue(10000)), 10000),
  }),
  async run({ data, signal }) {
    const coord = `${data.latitude}|${data.longitude}`;
    const params = new URLSearchParams({
      action: 'query',
      generator: 'geosearch',
      ggscoord: coord,
      ggsradius: String(Math.round(data.radiusMeters)),
      ggslimit: '20',
      prop: 'description|coordinates',
      codistancefrompoint: coord,
      colimit: 'max', // default is 10, which would leave half the results without a distance
      format: 'json',
      formatversion: '2',
    });
    const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, { headers: HEADERS, signal });
    if (!res.ok) throw new Error(`Wikipedia geosearch failed: HTTP ${res.status}`);
    const body = (await res.json()) as {
      query?: {
        pages: Array<{ title: string; description?: string; coordinates?: Array<{ dist: number }> }>;
      };
    };
    const pages = body.query?.pages ?? [];
    if (pages.length === 0) throw new Error('No Wikipedia places found here. Try a larger radius or check the coordinates.');
    return {
      output: pages
        .map((p) => ({
          title: p.title,
          description: p.description ?? '',
          distanceM: Math.round(p.coordinates?.[0]?.dist ?? 0),
        }))
        .sort((a, b) => a.distanceM - b.distanceM),
    };
  },
});

export const getPlaceSummary = defineTool({
  name: 'get_place_summary',
  description:
    'Get a short Wikipedia summary and URL for one place, by its exact article title (as returned by find_nearby_places).',
  input: v.object({
    title: v.pipe(v.string(), v.minLength(1)),
  }),
  async run({ data, signal }) {
    const slug = encodeURIComponent(data.title.replaceAll(' ', '_'));
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`, { headers: HEADERS, signal });
    if (res.status === 404) throw new Error(`No Wikipedia article titled "${data.title}". Use a title from find_nearby_places.`);
    if (!res.ok) throw new Error(`Wikipedia summary failed: HTTP ${res.status}`);
    const page = (await res.json()) as {
      title: string;
      description?: string;
      extract?: string;
      content_urls?: { desktop?: { page?: string } };
    };
    return {
      output: {
        title: page.title,
        description: page.description ?? '',
        // Keep tool output small: it goes into the model's context window.
        summary: (page.extract ?? '').slice(0, 600),
        url: page.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${slug}`,
      },
    };
  },
});
```

### `src/subagents/venue-scout.ts`

```ts
// An ordinary module, NOT 'use agent': a subagent is a capability of the agent
// that mounts it, not a registered agent. It has no URL, no conversation id,
// no persistent state, and no useModel() (it inherits the parent's model).
import { defineSubagent, useTool } from '@flue/runtime';
import { getPlaceSummary } from '../tools/wikipedia.ts';

function VenueScout() {
  // The scout's world is only what it mounts here. The parent's tools,
  // instructions, conversation and state are NOT inherited.
  useTool(getPlaceSummary);

  return `You are venue-scout. You assess a few places for a team offsite.

You only see the task prompt, not the user's conversation. The prompt gives you up to 3 places (Wikipedia article titles) and details about the group.

1. Call \`get_place_summary\` for every place, all in one batch.
2. Then write your final answer. Use facts from the summary; you may add general knowledge, but mark estimates as estimates.

Your final answer is all the parent sees. Always finish with this exact format, one block per place, and nothing else:

**<place name>** (<Wikipedia URL>)
- What to do: <1–2 activities for a group>
- Typical visit: <e.g. ~1–2 h> (estimate)
- Weather: <indoor | outdoor | mixed>; <how rain or heat affects the visit>
- Group fit: <one sentence about this group size and interests>`;
}

export const venueScout = defineSubagent({
  name: 'venue-scout',
  description:
    'Assesses up to 3 places for a team offsite: activities, typical visit length, weather dependency, and group fit. Prompt with the exact Wikipedia titles, the city, the headcount, and the interests.',
  agent: VenueScout,
  model: 'cloudflare/@cf/meta/llama-4-scout-17b-16e-instruct',
});
```

### `src/agents/field-trip.ts`

```ts
'use agent';

import { useModel, usePersistentState, useSubagent, useTool } from '@flue/runtime';
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

export function FieldTrip() {
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
5. Keep replies short: at most 120 words unless the user asks for more detail.

Today is ${today}.

## Saved trip brief
${hasBrief ? JSON.stringify(brief, null, 2) : '(nothing saved yet)'}`;
}
```

`src/tools/weather.ts`, `src/app.ts` and `wrangler.jsonc` are unchanged from cp3.

## Verify

Use dates **3–10 days from today** for `<START>` / `<END>` (so the forecast
works too), on a **fresh** conversation id. With `npm run dev` running:

```bash
npm run smoke -- http://localhost:5173 cp4-local "Offsite in Lisbon from <START> to <END> for 14 people, budget 400 EUR each. We like food, history and the outdoors."
npm run smoke -- http://localhost:5173 cp4-local "Suggest 3 places for our offsite."
```

Pass:
1. `⚙ geocode_city` → `⚙ find_nearby_places` (often `⚙ get_forecast` too).
2. **One** `⚙ task({"agent":"venue-scout", …, "prompt":"…"})` whose prompt names
   3 places plus the city, headcount and interests. Its result is the scout's
   formatted blocks (`**Name** (URL)`, `What to do`, `Typical visit`,
   `Weather`, `Group fit`).
3. A final reply that combines them into a short plan, usually matching
   indoor/outdoor places to the forecast days.

The chat UI's cp4 chip ("Suggest 3 venues near the city centre…") works the same way.

Then deploy and repeat on the live URL with a fresh id:

```bash
npm run deploy
npm run smoke -- https://field-trip-agent.<subdomain>.workers.dev cp4-live "Offsite in Porto from <START> to <END> for 10 people. We like wine, architecture and walking."
npm run smoke -- https://field-trip-agent.<subdomain>.workers.dev cp4-live "Suggest 3 places for our offsite."
```

### Sample passing output (reference build)

```
you › Suggest 3 places for our offsite.

agent ›
  ⚙ geocode_city({"city":"Lisbon"}) → {"name":"Lisbon","country":"Portugal","latitude":38.72509,"longitude":-9.1498,…}
  ⚙ find_nearby_places({"latitude":38.72509,"longitude":-9.1498}) → [{"title":"Lisbon","description":"Capital and largest city of Portugal","distanceM":27},…]
  ⚙ get_forecast({"endDate":"2026-10-09",…,"startDate":"2026-10-08"}) → [{"date":"2026-10-08",…,"conditions":"overcast"},…]
  ⚙ task({"agent":"venue-scout","description":"Assess 3 places in Lisbon for a team offsite.","prompt":"Assess the following 3 pl…) → **Palace of the Counts of Redondo** (https://en.wikipedia.org/wiki/Palace_of_the_Counts_of_Redondo)
- What to do: Guided historical tour, photography
- Typical …
Here are three suggestions for your Lisbon offsite:

**Indoor (Ideal for the overcast Oct 8th):**
* **Palace of the Counts of Redondo**: Enjoy a guided historical tour or photography session. (1–2 hours)
* **Sotto Mayor Palace**: Perfect for history enthusiasts to explore the architecture. (1–2 hours)

**Outdoor (Ideal for the clear skies on Oct 9th):**
* **Edward VII Park**: Great for a group picnic or a leisurely walk, matching your interest in the outdoors and food. (1–3 hours)

✔ completed in 46.9s
```

Reference timings: about 27–47 s for the suggestion turn (local, 4 runs) and
32 s live. The scout's task itself takes ~5 s; the rest is Gemma's turns in the
parent. The smoke default of 180 s leaves ample headroom.

## What to tell the attendee

"Your agent found candidates itself, then handed a complete briefing to a
specialist. The scout ran in a fresh context with one tool and a faster model,
and only its formatted answer came back. That's the whole contract: a good
briefing in, a compact answer out. Next (cp5): give the agent a sandbox so it
can write the itinerary to a file."
