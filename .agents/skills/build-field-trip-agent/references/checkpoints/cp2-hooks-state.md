# cp2: Hook model + persistent state

- **Goal:** the agent captures the trip brief with a tool, remembers it
  durably, and answers from it.
- **Time:** 6 min
- **Branch:** `fix/flue-2.0.0-cp2`
- **Files:** `src/agents/field-trip.ts` only. No config change, no new migration:
  state lives in the same Durable Object.

## Concepts to explain

1. **The agent function re-renders before every model call.** Hooks run again
   each time, so the returned instructions always include the *latest* saved
   brief. After a tool writes state, the next model call sees it (the smoke output
   shows `[advisory] System instructions updated.`).
2. **`usePersistentState(name, initial)`** is shaped like React's `useState` but
   **durable**: every write is recorded in this conversation's DO SQLite and
   survives restarts and redeploys. Values are JSON, keyed by name.
3. **Tools can write state.** `useTool({ name, description, input, run })`
   with a valibot `input` schema. Flue validates the model's arguments before
   `run`. The state write commits atomically with the tool call.
4. **Use the updater form** `setBrief(prev => ({ ...prev, ...updates }))` to
   merge. The render value is a snapshot; the updater sees the latest write.
5. **Setters only work in tools/callbacks, not during render**: renders are
   pure reads.
6. **Chat history vs state:** the model could recall details from history
   alone, but state is data *your code* can read, gate tools on (later
   checkpoints), and inject into instructions.

## Diff from cp1

- Import `usePersistentState`, `useTool` and `valibot`.
- Add the `TripBrief` type and `usePersistentState<TripBrief>('brief', {})`.
- Add the inline `save_trip_brief` tool (merges only the fields provided).
- Instructions gain three rules (save first, answer from the brief, stay short)
  and a `## Saved trip brief` section rendered from state.

## Final code

### `src/agents/field-trip.ts`

```ts
'use agent';

import { useModel, usePersistentState, useTool } from '@flue/runtime';
import * as v from 'valibot';

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

  // The agent re-renders before every model call, so these instructions
  // always reflect the latest saved brief.
  const hasBrief = Object.keys(brief).length > 0;
  return `You are FieldTrip, a helpful team-offsite planner. You help groups plan memorable offsites by understanding their destination, dates, headcount, budget, and interests.

Rules:
1. If the user's message contains ANY trip detail (city, dates, headcount, budget, interests), your FIRST action is to call \`save_trip_brief\` with those fields. Do this before writing any reply.
2. Answer questions about the trip from the saved brief below. If a detail is missing, ask for it.
3. Keep replies short: at most 120 words unless the user asks for more detail.

## Saved trip brief
${hasBrief ? JSON.stringify(brief, null, 2) : '(nothing saved yet)'}`;
}
```

`src/app.ts` and `wrangler.jsonc` are unchanged from cp1.

## Verify

Use a **fresh** conversation id. With `npm run dev` running:

```bash
npm run smoke -- http://localhost:5173 cp2-local "We're planning an offsite in Lisbon from 2026-10-08 to 2026-10-09 for 14 people, budget around 400 EUR per person. We like food, history and something outdoorsy."
npm run smoke -- http://localhost:5173 cp2-local "Update: two more people are joining, so 16 now."
npm run smoke -- http://localhost:5173 cp2-local "What's my headcount, city and budget? One line."
```

Pass:
1. Message 1 shows `⚙ save_trip_brief({"city":"Lisbon",…,"headcount":14,…})`.
2. Message 2 shows `⚙ save_trip_brief({"headcount":16})`: only the changed field.
3. Message 3 answers **16**, Lisbon, 400 EUR. The merge kept the other fields.

Then deploy and repeat on the live URL (any fresh id):

```bash
npm run deploy
npm run smoke -- https://field-trip-agent.<subdomain>.workers.dev cp2-live "Offsite in Porto, 2026-10-15, 20 people, budget 300 EUR each, we love wine and hiking."
npm run smoke -- https://field-trip-agent.<subdomain>.workers.dev cp2-live "What's my headcount? One line."
```

### Sample passing output (reference build)

```
you › We're planning an offsite in Lisbon from 2026-10-08 to 2026-10-09 for 14 people, …

agent ›
  ⚙ save_trip_brief({"budget":"400 EUR per person","city":"Lisbon","endDate":"2026-10-09","headcount":14,…) → {"saved":{…}}
I've saved your trip details for Lisbon! You're looking at a 2-day offsite for 14 people …

[advisory] System instructions updated.

✔ completed in 13.7s

you › Update: two more people are joining, so 16 now.
agent ›
  ⚙ save_trip_brief({"headcount":16}) → {"saved":{"headcount":16}}
I've updated your headcount to 16 people. …
✔ completed in 12.1s

you › What's my headcount, city and budget? One line.
agent ›
Your headcount is 16, the city is Lisbon, and the budget is 400 EUR per person.
✔ completed in 4.5s
```

Reference timings (gemma-4-26b-a4b-it): about 12–14 s for a turn with a tool
call (two model calls), about 4–5 s for a plain answer.

**Optional robustness check** (details and a question in one message):

```bash
npm run smoke -- http://localhost:5173 cp2-mixed "Offsite in Madrid for 6 people in November. What's my headcount? One line."
```

Pass: `⚙ save_trip_brief({"city":"Madrid","headcount":6})`, then "6". If the
reply instead *contains* `save_trip_brief(...)` as text, the model faked the
call (see troubleshooting).

## Bonus (optional): show the brief live in the chat UI

An optional exercise for attendees with a coding agent who finish early (it is
no longer advertised in the chat UI). The prompt:

> Implement the cp2 bonus: add a useDataWriter('brief') channel to the FieldTrip
> agent and write the merged brief every time save_trip_brief runs.

**This bonus is not part of the checkpoint code** and isn't in any tag. Only do
it when the attendee asks, and don't carry it into later checkpoints unless they
want to keep it. Guidance for the implementation:

- `useDataWriter('brief')` returns a write function. Declare it
  **unconditionally** in the agent body, identical on every render. A changing
  set of data writers between renders throws.
- Call the writer **inside the tool's `run`**, never during render (it throws there).
- Write the *merged* brief: compute `const next = { ...brief, ...updates }`,
  then `setBrief(next)` and `writeBrief(next)`.
- An optional valibot schema can validate writes: `useDataWriter('brief', { schema })`.
- The model never sees data parts. They are one-way, client-facing output.
- The UI needs no change: it renders any `data-<name>` part as a card, keeping
  the latest write per name. Verify in the browser by sending a brief and
  seeing a `◆ data-brief` card with the JSON. With `npm run smoke`, data parts
  print as `[data-brief] {…}`.
- Concept to highlight: **state** (`usePersistentState`) is what the agent
  remembers, and a **data writer** is how the agent shows structured data to
  your UI.

## What to tell the attendee

"Your agent function ran again before every model call. That's the hook model.
The tool wrote durable state into this conversation's Durable Object, and the next
render put it straight into the instructions. Next (cp3): tools that call real
external APIs."
