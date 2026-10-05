import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import * as valibot from 'valibot';

const source = stripTypeScriptTypes(
  await readFile(new URL('../src/agents/field-trip.ts', import.meta.url), 'utf8'),
);

// Execute the real agent with mocked platform boundaries. No model, Docker,
// network, or Cloudflare credentials are needed for these lifecycle checks.
async function createAgentHarness(persisted = new Map(), bindingAvailable = true) {
  const context = createContext({});
  const tools = new Map();
  const calls = [];
  const binding = {};
  let conversationId;
  const env = {
    get Sandbox() {
      calls.push(['binding']);
      if (!bindingAvailable) throw new Error('Sandbox binding is unavailable');
      return binding;
    },
  };
  const modules = {
    '@flue/runtime': {
      useModel() {},
      useSubagent() {},
      useTool(tool) { tools.set(tool.name, tool); },
      useSandbox(sandbox) { calls.push(['useSandbox', sandbox]); },
      usePersistentState(name, initial) {
        const key = `${conversationId}:${name}`;
        if (!persisted.has(key)) persisted.set(key, initial);
        return [persisted.get(key), (next) => {
          persisted.set(key, typeof next === 'function' ? next(persisted.get(key)) : next);
        }];
      },
    },
    '@flue/runtime/cloudflare': {
      cloudflareSandbox(sandbox) { calls.push(['cloudflareSandbox', sandbox.id]); return sandbox; },
    },
    '@cloudflare/sandbox': {
      getSandbox(namespace, id) { calls.push(['getSandbox', id]); return { namespace, id }; },
    },
    'cloudflare:workers': { env },
    valibot,
    '../tools/weather.ts': {
      geocodeCity: { name: 'geocode_city' },
      getForecast: { name: 'get_forecast' },
    },
    '../tools/wikipedia.ts': { findNearbyPlaces: { name: 'find_nearby_places' } },
    '../subagents/venue-scout.ts': { venueScout: {} },
  };
  const agent = new SourceTextModule(source, { context });
  await agent.link((specifier) => {
    const exports = modules[specifier];
    assert(exports, `Unexpected agent dependency: ${specifier}`);
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context });
  });
  await agent.evaluate();
  return {
    tools, calls, persisted, binding,
    render(id) {
      conversationId = id;
      tools.clear();
      return agent.namespace.FieldTrip({ id });
    },
  };
}

test('ordinary turns and brief updates never touch the Sandbox binding or attach tools', async () => {
  const harness = await createAgentHarness(new Map(), false);
  harness.render('chat');
  assert.deepEqual([...harness.tools.keys()], [
    'save_trip_brief', 'geocode_city', 'get_forecast', 'find_nearby_places', 'open_workspace',
  ]);
  await harness.tools.get('save_trip_brief').run({ data: { city: 'Lisbon', headcount: 14 } });
  const instructions = harness.render('chat');
  assert.match(instructions, /"city": "Lisbon"/);
  harness.render('chat');
  assert.deepEqual(harness.calls, []);
  assert.equal(harness.persisted.get('chat:workspace'), false);
});

test('opening a workspace only enables state; attachment happens on the next render', async () => {
  const harness = await createAgentHarness();
  harness.render('files');
  await harness.tools.get('open_workspace').run();
  assert.equal(harness.persisted.get('files:workspace'), true);
  assert.deepEqual(harness.calls, []);

  harness.render('files');
  assert.deepEqual(harness.calls.map(([name]) => name), [
    'binding', 'getSandbox', 'cloudflareSandbox', 'useSandbox',
  ]);
  const sandbox = harness.calls.at(-1)[1];
  assert.equal(sandbox.id, 'files');
  assert.equal(sandbox.namespace, harness.binding);
});

test('activation survives a new runtime, stays per conversation, and reopening is idempotent', async () => {
  const first = await createAgentHarness();
  first.render('saved-workspace');
  await first.tools.get('open_workspace').run();

  const restored = await createAgentHarness(first.persisted);
  restored.render('saved-workspace');
  assert.equal(restored.calls.filter(([name]) => name === 'getSandbox').length, 1);
  assert.equal(restored.calls.at(-1)[1].id, 'saved-workspace');
  await restored.tools.get('open_workspace').run();
  assert.equal(restored.calls.filter(([name]) => name === 'getSandbox').length, 1);
  restored.render('saved-workspace');
  assert.equal(restored.calls.filter(([name]) => name === 'getSandbox').length, 2);

  restored.calls.length = 0;
  restored.render('fresh-chat');
  assert.deepEqual(restored.calls, []);
  assert.equal(restored.persisted.get('fresh-chat:workspace'), false);
  assert.equal(restored.persisted.get('saved-workspace:workspace'), true);
});
