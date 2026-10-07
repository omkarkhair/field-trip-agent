# Checkpoints index

One file per checkpoint in [checkpoints/](checkpoints/). **Load only the file
for the checkpoint you are implementing.** Each file has:

- **Goal** and **time budget**
- **Concepts** to explain to the attendee
- **Files** touched
- **Diff** from the previous checkpoint
- **Final code** (verified on the reference build and Flue 2.0 checkpoint branch)
- **Verify** command and what passing output looks like

| Checkpoint | Branch | Min | File |
|---|---|---|---|
| `cp0` | `fix/flue-2.0.0-main` | pre-work | [cp0-prework.md](checkpoints/cp0-prework.md) |
| `cp1` | `fix/flue-2.0.0-cp1` | 9 | [cp1-hello-agent.md](checkpoints/cp1-hello-agent.md) |
| `cp2` | `fix/flue-2.0.0-cp2` | 6 | [cp2-hooks-state.md](checkpoints/cp2-hooks-state.md) |
| `cp3` | `fix/flue-2.0.0-cp3` | 9 | [cp3-api-tools.md](checkpoints/cp3-api-tools.md) |
| `cp4` | `fix/flue-2.0.0-cp4` | 8 | [cp4-subagent.md](checkpoints/cp4-subagent.md) |
| `cp5` | `fix/flue-2.0.0-cp5` | 5 (cut line) | [cp5-sandbox.md](checkpoints/cp5-sandbox.md) |
| `cp6` | `fix/flue-2.0.0-cp6` | 7 | [cp6-iterate-observe.md](checkpoints/cp6-iterate-observe.md) |

## Conventions

- **Pending sections:** if a file says *pending*, it has no verified code yet.
  Don't invent it; reset the `workshop` branch to `origin/fix/flue-2.0.0-cpN` instead.
- **Scope:** implement exactly one checkpoint at a time, touching only the files
  it lists. Never pull later checkpoints' code forward.
- **Code is authoritative** and matches `origin/fix/flue-2.0.0-cpN`. If the attendee's
  code differs, reconcile it with `git diff origin/fix/flue-2.0.0-cpN -- src/ wrangler.jsonc package.json`.
- **Conversation ids** in verify commands are arbitrary. Use a fresh id when a
  checkpoint changes agent behaviour, so old history doesn't confuse the test.
- **Model:** `cloudflare/@cf/moonshotai/kimi-k2.6` (Workers AI, no API key).
- **Model output varies.** Verify passes when the *structure* matches (exit 0,
  expected tool calls appear). The exact wording will differ from the samples.
