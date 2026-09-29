# cp2: Hook model + persistent state

- **Goal:** the agent captures the trip brief and remembers it across messages.
- **Concepts:** the agent function re-renders before every model call;
  `usePersistentState` is `useState`-shaped but durable (DO SQLite); tools can
  write state; instructions interpolate state.
- **Files:** `src/agents/field-trip.ts` (+ optional `src/tools/trip-brief.ts`).
- **Code:** *pending*
- **Verify:** *pending*
