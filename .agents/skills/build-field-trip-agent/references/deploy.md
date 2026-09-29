# Deploy, migrations, observability

## The loop

```bash
npm run dev                                                     # local workerd on :5173, hot reload
npm run smoke -- http://localhost:5173 <id> "<message>"         # test locally
npm run deploy                                                  # vite build && wrangler deploy
npm run smoke -- https://field-trip-agent.<subdomain>.workers.dev <id> "<message>"   # test live
```

- `npm run deploy` prints the live URL. The Worker name comes from
  `wrangler.jsonc` → `field-trip-agent`.
- `vite build` writes `dist/field_trip_agent/` (code + finalized `wrangler.json`).
  `wrangler deploy` reads it automatically via the Cloudflare plugin's redirect.
  Always deploy from the project root and **never** pass `--config`.
- Validate without deploying: `npx vite build && npx wrangler deploy --dry-run`.
  At cp0 the upload is about 573 KiB gzipped.
- Local and live conversations are separate: local DOs live in `.wrangler/state`,
  live DOs in your account.

## Wrangler config essentials

```jsonc
{
  "name": "field-trip-agent",
  "compatibility_date": "2026-09-01",            // ≥ 2026-04-01, validated by Flue at build
  "compatibility_flags": ["nodejs_compat"],      // required
  "ai": { "binding": "AI", "remote": true },     // Workers AI; always remote, even in dev
  "migrations": [ /* append-only, see below */ ]
}
```

Flue never edits `wrangler.jsonc`. It merges `main` plus one DO binding per agent
into the generated, gitignored `.flue-vite.wrangler.jsonc`. Don't declare
`FLUE_*_AGENT` bindings yourself: a collision is a build error.

## Durable Object migrations

Every generated agent class needs a migration. **Append only**; never edit,
reorder, or delete an entry that has been deployed.

```jsonc
"migrations": [
  { "tag": "v1-field-trip", "new_sqlite_classes": ["FlueFieldTripAgent"] }
]
```

| Change | Migration to append |
|---|---|
| new agent `Foo` | `{ "tag": "…", "new_sqlite_classes": ["FlueFooAgent"] }` |
| renamed agent function `Foo` → `Bar` | `{ "tag": "…", "renamed_classes": [{ "from": "FlueFooAgent", "to": "FlueBarAgent" }] }` |
| removed agent `Foo` | `{ "tag": "…", "deleted_classes": ["FlueFooAgent"] }` |
| moved mount path / renamed file | nothing |

- Use `new_sqlite_classes`, **not** `new_classes`: Flue requires DO SQLite.
- Subagents are not DOs and need no migration.

## Secrets

Not needed for this workshop (Workers AI is keyless). If you switch providers:
- locally, put the key in `.dev.vars` (gitignored), e.g. `ANTHROPIC_API_KEY="…"`
- live: `npx wrangler secret put ANTHROPIC_API_KEY`
- add the provider to `flue({ providers: ['cloudflare', 'anthropic'] })`

## Observability (cp6)

```jsonc
"observability": {
  "enabled": true,
  "traces": { "enabled": true }
}
```

- **Logs:** tool `log.*` output and `console.*` appear in Workers Logs,
  attributed to the response that wrote them.
- **Traces:** one trace per agent response (the DO alarm invocation that ran it),
  with Flue spans `invoke_agent` → `chat` (per model turn, with token usage) →
  `execute_tool` (per tool call). Spans include conversation content by default.
- Live tail from the terminal: `npx wrangler tail field-trip-agent`.
- Dashboard: **Workers & Pages → field-trip-agent → Observability**.
- Locally, `vite dev` captures spans too (tables `spans`, `logs`; span columns
  `trace_id, span_id, parent_id, service, name, kind, start_ms, duration_ms, outcome, error, attributes`):
  ```bash
  curl -X POST http://localhost:5173/cdn-cgi/local/explorer/api/local/observability/query \
    -H 'Content-Type: application/json' \
    -d '{"sql":"SELECT name, kind, duration_ms FROM spans ORDER BY start_ms DESC LIMIT 20"}'
  ```

## Account gotchas

| Symptom | Fix |
|---|---|
| `You need to register a workers.dev subdomain` | open **Workers & Pages** in the dashboard once to create it (there's no `wrangler subdomain` command in wrangler 4) |
| wrangler asks which account | `export CLOUDFLARE_ACCOUNT_ID=<id>` (`npx wrangler whoami` lists them) |
| `Authentication error` mid-session | `npx wrangler login` again |
| Workers AI errors on deploy/dev | account must have Workers AI enabled; free daily allocation applies |
