# cp1: Hello agent + first deploy

- **Goal:** the first agent, answering locally *and* on the live `workers.dev` URL.
- **Concepts:** an agent *is* a function that returns its system prompt;
  `'use agent'` registers every exported capitalized function; the function name
  is the durable identity → Durable Object class `FlueFieldTripAgent`; one DO per
  conversation id; `useModel` is the one required hook.
- **Files:** `src/agents/field-trip.ts` (new), `src/app.ts`, `wrangler.jsonc`.
- **Code:** *pending*
- **Verify:** *pending*
