# Checkpoints index

One file per checkpoint in [checkpoints/](checkpoints/). **Load only the file
for the checkpoint you are implementing.** Each file has:

- **Goal** and **time budget**
- **Concepts** to explain to the attendee
- **Files** touched
- **Diff** from the previous checkpoint
- **Final code** (verified on the reference build; the same code as the git tag)
- **Verify** command and what passing output looks like

| Tag | Branch | Min | File |
|---|---|---|---|
| `cp0` | `main` | pre-work | [cp0-prework.md](checkpoints/cp0-prework.md) |
| `cp1` | `cp/1-hello-agent` | 9 | [cp1-hello-agent.md](checkpoints/cp1-hello-agent.md) |
| `cp2` | `cp/2-hooks-state` | 6 | [cp2-hooks-state.md](checkpoints/cp2-hooks-state.md) |
| `cp3` | `cp/3-api-tools` | 9 | [cp3-api-tools.md](checkpoints/cp3-api-tools.md) |
| `cp4` | `cp/4-subagent` | 8 | [cp4-subagent.md](checkpoints/cp4-subagent.md) |
| `cp5` | `cp/5-sandbox` | 5 (cut line) | [cp5-sandbox.md](checkpoints/cp5-sandbox.md) |
| `cp6` | `cp/6-iterate-observe` | 7 | [cp6-iterate-observe.md](checkpoints/cp6-iterate-observe.md) |

## Conventions

- **Pending sections:** if a file says *pending*, it has no verified code yet.
  Don't invent it; offer `git switch -c my-cpN cpN` instead.
- **Scope:** implement exactly one checkpoint at a time, touching only the files
  it lists. Never pull later checkpoints' code forward.
- **Code is authoritative** and matches the git tag `cpN`. If the attendee's
  code differs, reconcile it with `git diff cpN -- src/ wrangler.jsonc package.json`.
- **Conversation ids** in verify commands are arbitrary. Use a fresh id when a
  checkpoint changes agent behaviour, so old history doesn't confuse the test.
- **Model:** `cloudflare/@cf/google/gemma-4-26b-a4b-it` (Workers AI, no API key).
- **Model output varies.** Verify passes when the *structure* matches (exit 0,
  expected tool calls appear). The exact wording will differ from the samples.
