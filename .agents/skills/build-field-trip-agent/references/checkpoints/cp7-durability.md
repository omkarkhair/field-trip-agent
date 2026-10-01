# cp7: Durability (instructor-led)

- **Goal:** booking survives a redeploy mid-run and happens exactly once.
- **Concepts:** submissions are admitted durably before model work; recovery on
  DO wake; ordinary interrupted tool calls get an unknown-outcome error;
  `durable: true` tools re-run with completed `step.do` steps replayed.
- **Files:** `src/shared/mock-booking-api.ts`, `src/tools/booking.ts` (new),
  `src/agents/field-trip.ts`.
- **Code:** *pending*
- **Verify:** *pending*
