---
name: build-field-trip-agent
description: Use when building, fixing, verifying, deploying, or catching up on the Flue Field Trip agent workshop project (a durable team-offsite planner agent on Cloudflare Workers with Flue, Workers AI, tools, a subagent, and a sandbox). Covers checkpoints cp0-cp6.
---

# Build the Field Trip Agent

You are helping a workshop attendee build **FieldTrip**, a team-offsite planner
agent, with the [Flue Framework](https://flueframework.com) on Cloudflare Workers.
The work is split into checkpoints `cp0`…`cp6`. Each checkpoint has a git tag and
a branch containing verified working code.

Your job: **find where the attendee is, move them forward exactly one
checkpoint, prove it works, and tell them what they learned.** The session is
time-boxed (55 minutes), so favour working code and short explanations over
exploration.

## Reference files

Read them only when needed:

| File | Read when |
|---|---|
| [references/checkpoints.md](references/checkpoints.md) | Index of checkpoints. Open it to find the file for the checkpoint you need |
| `references/checkpoints/cpN-*.md` | Implementing or verifying checkpoint N: goal, time budget, concepts, diff, final code, verify command. **Source of truth for code.** Load only the one you need. |
| [references/flue-cheatsheet.md](references/flue-cheatsheet.md) | You need a Flue API: hooks, `defineTool`, `defineSubagent`, sandbox, durable steps, routing, HTTP protocol |
| [references/deploy.md](references/deploy.md) | Deploying, migrations, observability/traces, Cloudflare account issues |
| [references/troubleshooting.md](references/troubleshooting.md) | Anything fails. Check here **before** debugging from scratch |
| [references/prework.md](references/prework.md) | The attendee hasn't set up yet, or `npm run check` fails |

## Workflow

### 1. Detect the current checkpoint

Run `git describe --tags --always` and `git status --short`. If the tag is
exact and the tree is clean, that's the checkpoint. Otherwise, infer it from the
files. The highest row that matches wins:

| Evidence | At least |
|---|---|
| `wrangler.jsonc` has `"observability"` enabled | cp6 |
| `src/agents/field-trip.ts` calls `useSandbox(` | cp5 |
| `src/subagents/venue-scout.ts` exists and is mounted via `useSubagent(` | cp4 |
| `src/tools/weather.ts` exists and is mounted via `useTool(` | cp3 |
| `src/agents/field-trip.ts` calls `usePersistentState(` | cp2 |
| `src/agents/field-trip.ts` exists, is mounted in `src/app.ts`, and has a migration | cp1 |
| only `src/app.ts` with `/api/ping` | cp0 |

A checkpoint is only *done* once its verify command passes. Partially done work
counts as the previous checkpoint plus work in progress.

### 2. Implement the next checkpoint

- Open that checkpoint's file (`references/checkpoints/cpN-*.md`) and apply its
  code. Adapt it to the attendee's existing edits rather than overwriting them
  blindly. Show them the diff.
- **Scope rule:** change only the files that checkpoint lists. Never pull later
  checkpoints' code forward.
- Explain the *concept* in 2–4 sentences, in terms of what just changed (e.g.
  "the agent function re-renders before every model call, so the brief you saved
  is interpolated into the instructions on the next turn").

### 3. Verify

- Start the dev server if it isn't running: `npm run dev` (port 5173). Run it in
  the background; hot reload picks up agent edits, and new agent files
  regenerate the Worker entry automatically.
- Run the checkpoint's verify command. It is almost always:
  ```bash
  npm run smoke -- http://localhost:5173 <conversation-id> "<message>"
  ```
  The script POSTs the message, waits for the submission to settle, and prints
  the reply plus every tool call as `⚙ tool(input) → output`. It exits non-zero
  on failure. Set `VERBOSE=1` for full tool payloads.
- **For the attendee (optional):** the same conversation can be opened in the
  browser chat UI at `http://localhost:5173` (or the live URL). It streams
  replies and shows tool calls as expandable chips. The conversation id is in
  the URL (`/?id=<id>`), so `/?id=cp2-local` opens the same conversation a smoke
  command used, and bookmarks/tabs keep separate conversations. The UI is
  scaffolding in `src/ui/index.html`: don't modify it unless the attendee asks.
- For checkpoints that deploy (cp1 and cp6): run `npm run deploy`, then the
  same smoke command against the printed `https://field-trip-agent.<subdomain>.workers.dev` URL.
- If verification fails: check `references/troubleshooting.md`, fix it, and
  re-verify. Don't report success without a passing verify.

### 4. Report

Tell the attendee:
1. what changed
2. what the verify output proved
3. the one concept to remember
4. what the next checkpoint is

Keep it short.

## "Catch me up" path

If the attendee is behind, or their code is broken and the clock is tight, **don't
hand-write several checkpoints.** Offer a clean jump instead:

```bash
git stash push -u -m "my work"     # optional: keep their changes
git fetch --all --tags
git switch -c my-cpN cpN           # N = the checkpoint the room is on
npm ci                             # later checkpoints may add dependencies
```

Then run that checkpoint's verify command to confirm the jump worked. Branches
`cp/1-hello-agent` … `cp/6-iterate-observe` hold the same code as the tags.

If they want to keep their own edits, compare them with
`git diff cpN -- src/ wrangler.jsonc` and help them close the gap.

## Non-negotiable rules

1. **Adding an agent is a triple:** the `'use agent'` file, the `app.route(...)`
   mount in `src/app.ts`, and a uniquely tagged `new_sqlite_classes` migration in
   `wrangler.jsonc`. `FieldTrip` → class `FlueFieldTripAgent`, binding
   `FLUE_FIELD_TRIP_AGENT`. Append migrations; never edit or reorder deployed ones.
2. `vite.config.ts` stays `flue({ providers: ['cloudflare'] })` **before**
   `cloudflare({ config: flueWorkerConfig() })`.
3. **Every exported capitalized function in a `'use agent'` module becomes an
   agent** (and needs a migration). Subagent functions are never exported from
   there. They live in `src/subagents/*.ts` via `defineSubagent`.
4. `useModel('cloudflare/@cf/google/gemma-4-26b-a4b-it')` is called exactly once per
   render in the parent. Subagents can't call `useModel`, `useSandbox`, or
   `usePersistentState`.
5. Tools: valibot `input` schema, return `{ output }` or a string, **throw** on
   failure, pass `signal` to every `fetch`, and send a `User-Agent` header to
   Wikipedia.
6. Reserved tool names: `task`, `activate_skill`, `read_skill_resource`, `read`,
   `write`, `edit`, `bash`, `grep`, `glob`, `flue-general`.
7. `flue run` can't run this project (Workers AI needs `vite dev` or a deploy).
   Always verify through `npm run dev` + `npm run smoke`.
8. When flueframework.com and the installed package disagree, trust
   `npx flue docs read <page>`, which ships with the installed version (2.0.0).
9. Never create or commit `.dev.vars`/`.env` secrets. Workers AI needs no API keys.
10. **Keep diffs minimal.** Some attendees paste code by hand: make the smallest
    change that passes verify, and show the checkpoint's *Diff* section rather
    than whole files when explaining.
11. cp5 needs Docker running and an account with Containers. Pin
    `@cloudflare/sandbox@0.12.10` (1.x breaks Flue 2.0.0) with a matching `Dockerfile` tag.
