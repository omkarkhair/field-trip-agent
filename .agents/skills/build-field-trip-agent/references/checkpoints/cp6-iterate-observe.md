# cp6: Iterate + observe

- **Goal:** turn on Workers Logs + Traces, redeploy, and read what the agent
  did in the Cloudflare dashboard.
- **Time:** 7 min
- **Tag / branch:** `cp6` / `cp/6-iterate-observe`
- **Files:** `wrangler.jsonc`, `src/tools/weather.ts` (one log line).

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

## Diff from cp5 (paste these)

`wrangler.jsonc`: add a comma after the `containers` line, then:

```jsonc
  "observability": { "enabled": true, "traces": { "enabled": true } }
```

`src/tools/weather.ts`, in `get_forecast`'s `run`, just before `return {`:

```ts
    console.log({ event: 'forecast', latitude: data.latitude, longitude: data.longitude, days: daily.time.length }); // cp6: Workers Logs
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

`npx wrangler tail field-trip-agent` shows the short request/RPC/alarm
invocations but **not** the response's own log lines (the response runs
detached from the invocation that starts it). Use the dashboard.

## What to tell the attendee

"Four lines of config and you can see every model turn, token count and tool
call your agent made, per response, in production. Next (cp7): what happens
when the deploy lands in the middle of a booking."
