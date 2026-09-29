# cp4: Subagent delegation

- **Goal:** a `venue-scout` subagent researches venues with Wikipedia tools and
  returns a shortlist.
- **Concepts:** `defineSubagent` / `useSubagent`; the built-in `task` tool; the
  child gets a fresh context and its own tools, and only its final answer
  returns; the task prompt must be a complete briefing.
- **Files:** `src/tools/wikipedia.ts`, `src/subagents/venue-scout.ts` (new),
  `src/agents/field-trip.ts`.
- **Code:** *pending*
- **Verify:** *pending*
