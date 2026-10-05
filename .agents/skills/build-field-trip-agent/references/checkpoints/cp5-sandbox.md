# cp5: On-demand Cloudflare Sandbox workspace (cut line)

- **Goal:** the agent opens a Linux workspace only for file or shell work, writes
  `itinerary.md`, and reads it back. Ordinary conversations remain container-free.
- **Branch:** `cp/5-sandbox`.
- **Needs:** a Workers Paid account with Containers enabled and Docker running.
- **Files:** `src/agents/field-trip.ts`, `src/cloudflare.ts`, `src/env.d.ts`,
  `Dockerfile`, `wrangler.jsonc`, and the matching `@cloudflare/sandbox` package.
- **Cut line:** if the room is behind, demo this and switch to `cp/5-sandbox`.

## Workspace lifecycle

The agent stores `usePersistentState('workspace', false)` per conversation. The
`open_workspace` tool enables that state; the next render attaches
`useSandbox(cloudflareSandbox(getSandbox(env.Sandbox, id)))` inside an
`if (workspace)` block. Keep the entire expression inside the guard, including
access to `env.Sandbox` and `getSandbox`.

`getSandbox` itself returns a stub without starting a container, but attaching
it to Flue triggers workspace discovery (directory listings, `AGENTS.md`, and
skills). That discovery performs container I/O before any `write` or `bash` call.
An unconditional `useSandbox` therefore starts containers for ordinary chats.

The tool description and agent instructions restrict activation to requests for
files or shell commands. Greetings, brief updates, weather, venue research, and
itineraries described in chat must not call `open_workspace`. File tools become
available on the next model turn. After activation, the persistent flag reattaches
the same conversation's workspace on later turns; another conversation starts
with its own flag set to false.

Container files can survive later messages while the container is awake, but
they are not durable across container sleep or replacement. The trip brief and
workspace flag live in the agent's Durable Object, independently of those files.

## Verify

Run the deterministic regression tests and build first:

```bash
npm run test:workspace
npm run typecheck
npm run build
```

With `npm run dev` running, use a fresh conversation ID and watch `docker ps`
in another terminal:

```bash
npm run smoke -- http://localhost:5173 cp5-lazy "Hi, who are you? One sentence."
npm run smoke -- http://localhost:5173 cp5-lazy "Our offsite is in Lisbon for 14 people. We like food and history."
TIMEOUT_S=200 npm run smoke -- http://localhost:5173 cp5-lazy "Suggest 3 places for our offsite."
TIMEOUT_S=200 npm run smoke -- http://localhost:5173 cp5-lazy "Write the itinerary to itinerary.md and show it to me."
npm run smoke -- http://localhost:5173 cp5-lazy "Show me itinerary.md again."
```

Pass:
1. The first three messages do not call `open_workspace` or start a conversation
   Sandbox container. Building the Docker image at dev-server startup is separate
   from starting a conversation's workspace.
2. The file request calls `open_workspace`, then `write` and `read` on a subsequent
   model turn. The model is told its sandbox execution environment changed.
3. The final message reads the file from the same workspace.
4. A fresh conversation can greet the agent without starting another container.

Repeat against the deployed URL after `npm run deploy`. Docker and the
`cloudflare/sandbox:0.12.10` image are needed for the workspace, not for every chat.
