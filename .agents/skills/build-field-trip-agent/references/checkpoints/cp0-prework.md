# cp0: Pre-work starter

- **Goal:** a Worker that builds, runs locally, and can deploy. No agent yet.
- **Files:** see [prework.md](../prework.md).
- **Verify:**
  ```bash
  npm run check                            # all ✔
  npm run dev &                            # wait for "ready"
  curl http://localhost:5173/api/ping      # → pong
  ```
  Optional: open <http://localhost:5173>. The chat UI loads, and sending a
  message shows the "no agent mounted yet (checkpoint 1)" hint.
  `npm run smoke -- http://localhost:5173 demo-1 "hi"` is **expected to fail**
  with a 404 here: no agent is mounted yet.
