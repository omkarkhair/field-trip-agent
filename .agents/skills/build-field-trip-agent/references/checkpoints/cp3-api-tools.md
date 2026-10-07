# cp3: Tools calling external APIs

- **Goal:** the agent looks up the weather for the trip dates by chaining two
  tools that call Open-Meteo (free, no API key).
- **Time:** 9 min
- **Branch:** `cp/3-api-tools`
- **Files:** `src/tools/weather.ts` (new), `src/agents/field-trip.ts`. No config
  change, no new migration. Outbound `fetch` needs no binding.

## Concepts to explain

1. **`defineTool({ name, description, input, run })`** defines a tool once, in
   its own module, so it can be reused and tested. The agent mounts it with
   `useTool(geocodeCity)`. The inline `useTool({...})` from cp2 has the same shape.
2. **The description is the model's documentation.** Say what the tool returns,
   when to call it, and its limits ("only up to 16 days ahead", "call
   geocode_city first"). That's how the model learns to chain tools.
3. **valibot validates the model's arguments** before `run` executes
   (`v.isoDate()`, `v.number()`). Bad arguments come back to the model as a
   validation error, so `run` only ever sees typed `data`.
4. **Throw on failure.** A thrown error becomes a *tool error* the model can
   see and recover from: here, it explains the 16-day limit to the user. Make
   error messages actionable, because the model reads them.
5. **Pass `signal` to `fetch`.** If the turn is cancelled, the request stops too.
6. **Return small, model-friendly output.** Map WMO weather codes to words and
   pick only the fields the model needs. The tool output goes into the context window.
7. **Put "today" in the instructions.** The model doesn't know the date, and
   relative dates ("the day after tomorrow") need it. The agent re-renders every
   turn, so this stays current.

## Diff from cp2

- New `src/tools/weather.ts` with `geocodeCity` and `getForecast`.
- Agent: import both, `useTool(geocodeCity); useTool(getForecast);`, add
  rule 3 (the weather workflow), renumber "keep replies short" to rule 4, and
  add `Today is ${today}.`.

## Final code

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

import { useModel, usePersistentState, useTool } from '@flue/runtime';
import * as v from 'valibot';
import { geocodeCity, getForecast } from '../tools/weather.ts';

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

  // The agent re-renders before every model call, so these instructions
  // always reflect the latest saved brief.
  const hasBrief = Object.keys(brief).length > 0;
  const today = new Date().toISOString().slice(0, 10);
  return `You are FieldTrip, a helpful team-offsite planner. You help groups plan memorable offsites by understanding their destination, dates, headcount, budget, and interests.

Rules:
1. If the user's message contains ANY trip detail (city, dates, headcount, budget, interests), your FIRST action is to call \`save_trip_brief\` with those fields. Do this before writing any reply.
2. Answer questions about the trip from the saved brief below. If a detail is missing, ask for it.
3. For weather questions: call \`geocode_city\` for the city, then \`get_forecast\` with its latitude/longitude and the trip dates (use the saved brief). If there is no end date, use the start date. Summarise the forecast per day in plain words; if a tool returns an error, explain it to the user.
4. Keep replies short: at most 120 words unless the user asks for more detail.

Today is ${today}.

## Saved trip brief
${hasBrief ? JSON.stringify(brief, null, 2) : '(nothing saved yet)'}`;
}
```

`src/app.ts` and `wrangler.jsonc` are unchanged from cp2.

## Verify

The forecast only covers **today up to 16 days ahead**, so use dates
**3–10 days from today** for `<START>` / `<END>` (YYYY-MM-DD). In the chat UI,
the cp2 and cp3 example chips already fill in dates a week out.

With `npm run dev` running, on a **fresh** conversation id:

```bash
npm run smoke -- http://localhost:5173 cp3-local "Offsite in Lisbon from <START> to <END> for 14 people, budget 400 EUR each. We like food and hiking."
npm run smoke -- http://localhost:5173 cp3-local "What's the weather forecast for our trip dates?"
```

Pass:
1. Message 1 shows `⚙ save_trip_brief(...)` (cp2 still works).
2. Message 2 shows `⚙ geocode_city({"city":"Lisbon"})`, **then**
   `⚙ get_forecast({...latitude/longitude from step 1..., "startDate":"<START>","endDate":"<END>"})`,
   and the reply summarises each day. The dates came from the saved brief.

Error path (the model recovers from a thrown tool error):

```bash
npm run smoke -- http://localhost:5173 cp3-err "What will the weather be in Lisbon on 2027-03-01?"
```

Pass: `get_forecast` shows `✘ Forecast unavailable …` in red, and the reply
explains that forecasts only go 16 days ahead. It doesn't invent a forecast.

### Sample passing output (reference build)

```
you › What's the weather forecast for our trip dates?

agent ›
  ⚙ geocode_city({"city":"Lisbon"}) → {"name":"Lisbon","country":"Portugal","latitude":38.72509,"longitude":-9.1498,"timezone":"Europe/Lisbon"}
  ⚙ get_forecast({"endDate":"2026-10-08","latitude":38.72509,"longitude":-9.1498,"startDate":"2026-10-07"}) → [{"date":"2026-10-07","minC":18.7,"maxC":24.6,"rainChancePct":29,"conditions":"thunderstorm"},…]
For your trip to Lisbon:

*   **Oct 7th:** Expect thunderstorms with a high of 25°C and a low of 19°C. There's a 29% chance of rain.
*   **Oct 8th:** It looks beautiful! Clear skies with a high of 27°C and a low of 18°C, and only an 11% chance of rain.

Since the first day might have storms, we could plan your hiking for the 8th and focus on food tours or indoor activities for the 7th!

✔ completed in 9.1s

you › What will the weather be in Lisbon on 2027-03-01?
agent ›
  ⚙ geocode_city({"city":"Lisbon"}) → {…}
  ⚙ get_forecast({"endDate":"2027-03-01",…,"startDate":"2027-03-01"}) ✘ Forecast unavailable for 2027-03-01..2027-03-01: Parameter 'start_date' is out of allowed range …
I'm sorry, but I can't provide a weather forecast for Lisbon on March 1, 2027. My weather tool can only provide forecasts up to 16 days in advance.
✔ completed in 18.2s
```

Reference timings (gemma-4-26b-a4b-it): about 9–16 s for a weather turn (two
chained tool calls, three model calls), and up to about 20 s on the error path.

## What to tell the attendee

"You gave the agent two tools with clear descriptions, and it worked out the
order itself: geocode first, then forecast, with dates from the brief it saved
in cp2. When the API said no, the thrown error went back to the model, which
explained it instead of making something up. Next (cp4): hand research off to
a subagent with its own tools."
