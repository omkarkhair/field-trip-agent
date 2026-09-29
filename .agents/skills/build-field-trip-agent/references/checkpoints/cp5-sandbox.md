# cp5: Sandbox strategies (cut line)

- **Goal:** the agent writes `itinerary.md` in a virtual sandbox and returns it.
- **Concepts:** no sandbox → virtual `just-bash` (in-memory, ms startup,
  ephemeral) → Cloudflare container via `@cloudflare/sandbox` (full Linux,
  seconds to start, persistent FS). Sandbox files are *not* durable;
  conversation + state are.
- **Cut line:** if the room is behind, talk it through and `git switch cp/5-sandbox`.
- **Files:** `src/agents/field-trip.ts`.
- **Code:** *pending*
- **Verify:** *pending*
