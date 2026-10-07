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
//   REQUEST_TIMEOUT_S seconds per HTTP request   (default: 15)
//   HISTORY_RETRIES retries for transient GETs  (default: 2)
//   VERBOSE=1    also print full tool inputs/outputs and reasoning
//
// Written in plain Node (no bash/jq) so it runs the same on macOS, Linux, and Windows.

const [baseArg, id, message] = process.argv.slice(2);
if (!baseArg || !id) {
  console.error('Usage: npm run smoke -- <base-url> <conversation-id> ["<message>"]');
  process.exit(2);
}

const agentPath = process.env.AGENT_PATH ?? '/agents/field-trip';
const seconds = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value * 1000;
};
const timeoutMs = seconds('TIMEOUT_S', 180);
const requestTimeoutMs = seconds('REQUEST_TIMEOUT_S', 15);
const historyRetries = Number(process.env.HISTORY_RETRIES ?? 2);
if (!Number.isInteger(historyRetries) || historyRetries < 0) {
  throw new Error('HISTORY_RETRIES must be a non-negative integer');
}
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const request = (input, init, limitMs = requestTimeoutMs) => fetch(input, {
  ...init,
  signal: AbortSignal.timeout(Math.max(1, Math.floor(limitMs))),
});
const deadlineError = () => Object.assign(new Error('Reply deadline reached'), { code: 'REPLY_DEADLINE' });

async function readHistory(deadline = Infinity) {
  let lastError;
  for (let attempt = 0; attempt <= historyRetries; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw deadlineError();
    try {
      const res = await request(`${url}?view=history`, undefined, Math.min(requestTimeoutMs, remaining));
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const error = new Error(`GET ${url} → ${res.status} ${body}`);
        if (res.status !== 408 && res.status !== 429 && res.status < 500) {
          throw Object.assign(error, { retryable: false });
        }
        throw error;
      }
      return await res.json();
    } catch (error) {
      if (error.retryable === false) throw error;
      if (Date.now() >= deadline) throw deadlineError();
      lastError = error;
    }
    if (attempt < historyRetries) {
      const pause = Math.min(500 * 2 ** attempt, deadline - Date.now());
      if (pause <= 0) throw deadlineError();
      await sleep(pause);
    }
  }
  if (Date.now() >= deadline) throw deadlineError();
  throw lastError;
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
  let res;
  let accepted = false;
  let submissionId;
  try {
    res = await request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'user', body: message }),
    });
    accepted = res.status === 202;
    if (accepted) {
      ({ submissionId } = await res.json());
      if (typeof submissionId !== 'string' || submissionId.length === 0) {
        throw new Error('the response did not contain a valid submissionId');
      }
    }
  } catch (error) {
    if (accepted) {
      throw new Error('POST returned 202 but its response body failed. It was accepted; re-run without a message to check before sending again.');
    }
    if (error.name === 'TimeoutError') {
      throw new Error(
        `POST timed out after ${requestTimeoutMs / 1000}s. It may have been accepted; re-run without a message to check before sending again.`,
      );
    }
    if (['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(error.cause?.code)) {
      throw new Error(
        `POST failed before a response: ${error.message}. It may have been accepted; re-run without a message to check before sending again.`,
        { cause: error },
      );
    }
    throw error;
  }
  if (res.status !== 202) {
    const body = await res.text();
    console.error(red(`Expected 202, got ${res.status}: ${body}`));
    if (res.status === 404) {
      console.error(dim(`Is the agent mounted at ${agentPath} in src/app.ts? (added in checkpoint 1)`));
    }
    process.exit(1);
  }
  console.log(dim(`202 accepted · submission ${submissionId} · waiting for the reply…`));

  const started = Date.now();
  const deadline = started + timeoutMs;
  let snap;
  let settlement;
  while (Date.now() < deadline) {
    await sleep(Math.min(1500, deadline - Date.now()));
    if (Date.now() >= deadline) break;
    try {
      snap = await readHistory(deadline);
    } catch (error) {
      if (error.code === 'REPLY_DEADLINE') break;
      throw error;
    }
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
