# cp3: Tools calling external APIs

- **Goal:** the agent looks up the weather for the trip dates.
- **Concepts:** `defineTool({ name, description, input, run })`; valibot
  validates model arguments; thrown errors become tool errors the model can
  recover from; pass `signal` to `fetch`.
- **Files:** `src/tools/weather.ts` (new), `src/agents/field-trip.ts`.
- **Code:** *pending*
- **Verify:** *pending*
