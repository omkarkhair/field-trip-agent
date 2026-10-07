import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./smoke.mjs', import.meta.url));

async function listen(handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function runSmoke(baseUrl, args = [], env = {}) {
  const started = Date.now();
  const child = spawn(process.execPath, [script, baseUrl, 'test-id', ...args], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const [code] = await once(child, 'close');
  return { code, stdout, stderr, elapsedMs: Date.now() - started };
}

test('read-only history retries transient GET failures', async (t) => {
  let requests = 0;
  const { server, baseUrl } = await listen((req, res) => {
    requests++;
    if (requests === 1) {
      res.writeHead(503).end('try again');
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ messages: [] }));
  });
  t.after(() => server.close());

  const result = await runSmoke(baseUrl, [], { HISTORY_RETRIES: '1' });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(requests, 2);
});

test('read-only history retries malformed response bodies', async (t) => {
  let requests = 0;
  const { server, baseUrl } = await listen((_req, res) => {
    requests++;
    res.setHeader('content-type', 'application/json');
    res.end(requests === 1 ? '{' : JSON.stringify({ messages: [] }));
  });
  t.after(() => server.close());

  const result = await runSmoke(baseUrl, [], { HISTORY_RETRIES: '1' });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(requests, 2);
});

test('read-only history retries HTTP 408', async (t) => {
  let requests = 0;
  const { server, baseUrl } = await listen((_req, res) => {
    requests++;
    if (requests === 1) {
      res.writeHead(408).end('request timeout');
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ messages: [] }));
  });
  t.after(() => server.close());

  const result = await runSmoke(baseUrl, [], { HISTORY_RETRIES: '1' });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(requests, 2);
});

test('a timed-out POST is not retried', async (t) => {
  let requests = 0;
  const { server, baseUrl } = await listen((_req, res) => {
    requests++;
    setTimeout(() => res.writeHead(202).end('{"submissionId":"late"}'), 200);
  });
  t.after(() => server.close());

  const result = await runSmoke(baseUrl, ['hello'], { REQUEST_TIMEOUT_S: '0.05' });
  assert.equal(result.code, 1);
  assert.equal(requests, 1);
  assert.match(result.stderr, /It may have been accepted/);
});

test('a timeout after 202 reports that the POST was accepted', async (t) => {
  const { server, baseUrl } = await listen((_req, res) => {
    res.writeHead(202, { 'content-type': 'application/json' });
    res.flushHeaders();
    setTimeout(() => res.end('{"submissionId":"late"}'), 200);
  });
  t.after(() => server.close());

  const result = await runSmoke(baseUrl, ['hello'], { REQUEST_TIMEOUT_S: '0.05' });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /It was accepted/);
});

test('a reset POST connection is treated as an ambiguous submission', async (t) => {
  let requests = 0;
  const { server, baseUrl } = await listen((req) => {
    requests++;
    req.resume();
    req.on('end', () => req.socket.destroy());
  });
  t.after(() => server.close());

  const result = await runSmoke(baseUrl, ['hello']);
  assert.equal(result.code, 1);
  assert.equal(requests, 1);
  assert.match(result.stderr, /It may have been accepted/);
});

test('a refused POST connection retains the dev-server diagnostic', async () => {
  const { server, baseUrl } = await listen(() => {});
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

  const result = await runSmoke(baseUrl, ['hello']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Is the dev server running/);
  assert.doesNotMatch(result.stderr, /may have been accepted/i);
});

test('an invalid URL is not reported as an accepted submission', async () => {
  const result = await runSmoke('not-a-url', ['hello']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Failed to parse URL/);
  assert.doesNotMatch(result.stderr, /may have been accepted/i);
});

test('TIMEOUT_S is a hard reply deadline', async (t) => {
  const { server, baseUrl } = await listen((_req, res) => {
    res.writeHead(202, { 'content-type': 'application/json' });
    res.end('{"submissionId":"pending"}');
  });
  t.after(() => server.close());

  const result = await runSmoke(baseUrl, ['hello'], { TIMEOUT_S: '0.1' });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Timed out/);
  assert.ok(result.elapsedMs < 500, `expected <500ms, got ${result.elapsedMs}ms`);
});
