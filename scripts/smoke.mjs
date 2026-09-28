#!/usr/bin/env node
// Send one message to the FieldTrip agent and print its reply.
//
// Usage:
//   npm run smoke -- <base-url> <conversation-id> "<message>"
//   npm run smoke -- <base-url> <conversation-id>            # just print the history
//
// Examples:
//   npm run smoke -- http://localhost:5173 offsite-1 "Hi, who are you?"
//   npm run smoke -- https://field-trip-agent.<you>.workers.dev offsite-1 "What's my headcount?"
//
// Options (env vars):
//   AGENT_PATH   mount path of the agent        (default: /agents/field-trip)
//   TIMEOUT_S    seconds to wait for the reply  (default: 180)
//   VERBOSE=1    also print full tool inputs/outputs and reasoning
//
// Written in plain Node (no bash/jq) so it runs the same on macOS, Linux, and Windows.

const [baseArg, id, message] = process.argv.slice(2);
if (!baseArg || !id) {
  console.error('Usage: npm run smoke -- <base-url> <conversation-id> ["<message>"]');
  process.exit(2);
}

const agentPath = process.env.AGENT_PATH ?? '/agents/field-trip';
const timeoutMs = Number(process.env.TIMEOUT_S ?? 180) * 1000;
const verbose = process.env.VERBOSE === '1';
const url = `${baseArg.replace(/\/+$/, '')}${agentPath}/${encodeURIComponent(id)}`;

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const clip = (v, n = 160) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return verbose || s.length <= n ? s : `${s.slice(0, n)}…`;
};

async function readHistory() {
  const res = await fetch(`${url}?view=history`);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${await res.text()}`);
  return res.json();
}

function printMessage(m) {
  if (m.display === 'hidden') return;
  if (m.role === 'user') {
    console.log(`\n${cyan('you ›')} ${m.parts.map((p) => p.text ?? '').join('')}`);
    return;
  }
  if (m.role === 'system') {
    const text = m.parts.map((p) => p.text ?? '').join('').trim();
    if (text) console.log(dim(`\n[${m.purpose}] ${clip(text, 300)}`));
    return;
  }
  console.log(`\n${green('agent ›')}`);
  for (const p of m.parts) {
    if (p.type === 'text') console.log(p.text);
    else if (p.type === 'reasoning' && verbose) console.log(dim(`(thinking) ${p.text}`));
    else if (p.type === 'dynamic-tool') {
      const head = `  ⚙ ${p.toolName}(${clip(p.input, 120)})`;
      if (p.state === 'output-available') console.log(dim(`${head} → ${clip(p.output)}`));
      else if (p.state === 'output-error') console.log(red(`${head} ✘ ${clip(p.errorText)}`));
      else console.log(dim(`${head} …`));
    } else if (p.type.startsWith('data-')) console.log(dim(`  [${p.type}] ${clip(p.data)}`));
  }
}

async function main() {
  // Read-only mode: print the whole conversation.
  if (!message) {
    const snap = await readHistory();
    snap.messages.forEach(printMessage);
    console.log('');
    return;
  }

  console.log(dim(`POST ${url}`));
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'user', body: message }),
  });
  if (res.status !== 202) {
    const body = await res.text();
    console.error(red(`Expected 202, got ${res.status}: ${body}`));
    if (res.status === 404) {
      console.error(dim(`Is the agent mounted at ${agentPath} in src/app.ts? (added in checkpoint 1)`));
    }
    process.exit(1);
  }
  const { submissionId } = await res.json();
  console.log(dim(`202 accepted · submission ${submissionId} · waiting for the reply…`));

  const started = Date.now();
  let snap;
  let settlement;
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 1500));
    snap = await readHistory();
    settlement = snap.settlements.find((s) => s.submissionId === submissionId);
    if (settlement) break;
  }

  const mine = (snap?.messages ?? []).filter((m) => m.submissionId === submissionId);
  mine.forEach(printMessage);

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (!settlement) {
    console.error(red(`\nTimed out after ${secs}s. The work is still accepted — re-run without a message to read it later.`));
    process.exit(1);
  }
  if (settlement.outcome !== 'completed') {
    console.error(red(`\nSubmission ${settlement.outcome} after ${secs}s: ${clip(settlement.error, 500)}`));
    process.exit(1);
  }
  console.log(dim(`\n✔ completed in ${secs}s`));
}

main().catch((err) => {
  console.error(red(err.message));
  if (err.cause?.code === 'ECONNREFUSED') console.error(dim('Is the dev server running? npm run dev'));
  process.exit(1);
});
