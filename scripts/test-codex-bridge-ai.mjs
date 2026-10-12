import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createBridgeClient, createOpenAIResponder, parseAiArgs, runWorker } from './codex-bridge-ai.mjs';

// The provider is always injected. Git transport uses temporary local bare repositories.
// No OpenAI request, real GitHub push or paid model call occurs in this suite.
const execute = promisify(execFile);
const cli = fileURLToPath(new URL('./codex-bridge.mjs', import.meta.url));
const marker = '[codex-bridge-ai/v1]';
const primaryKey = 'TEST_AI_PRIMARY_SECRET_MARKER';
const fallbackKey = 'TEST_AI_FALLBACK_SECRET_MARKER';
const upstreamSecret = 'TEST_AI_UPSTREAM_SECRET_MARKER';
const modelMessage = {
  schema: 'codex-bridge/v1', type: 'message', id: '11111111-1111-4111-8111-111111111111',
  from: 'local', to: 'cloud-ai', createdAt: '2026-10-12T00:00:00.000Z', replyTo: null, body: 'Test',
};
const temporary = await mkdtemp(path.join(tmpdir(), 'vive-codex-bridge-ai-test-'));
const mailbox = path.join(temporary, 'private-mailbox.git');
const website = path.join(temporary, 'website.git');
const local = path.join(temporary, 'local');
const cloud = path.join(temporary, 'cloud');
const runtimeEnvironment = {
  ...process.env,
  GIT_CONFIG_GLOBAL: path.join(temporary, 'empty.gitconfig'),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
  CODEX_BRIDGE_REMOTE: mailbox,
};
const workerEnvironment = {
  CODEX_BRIDGE_REMOTE: mailbox,
  VIVE_OPENAI_API_KEY: primaryKey,
  OPENAI_API_KEY: fallbackKey,
};
let payloadNumber = 0;
let passed = 0;
await writeFile(runtimeEnvironment.GIT_CONFIG_GLOBAL, '');

async function command(program, args, cwd) {
  try {
    return await execute(program, args, {
      cwd, env: runtimeEnvironment, timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(`${program} failed: ${error.stderr || error.message}`);
  }
}

async function git(cwd, ...args) {
  return (await command('git', args, cwd)).stdout;
}

async function core(cwd, ...args) {
  return JSON.parse((await command(process.execPath, [cli, ...args], cwd)).stdout);
}

function actualBridge(cwd) {
  return {
    inbox: (agent, { all = false } = {}) => core(cwd, 'inbox', '--agent', agent, '--json', ...(all ? ['--all'] : [])),
    async send({ from, to, body, replyTo = null }) {
      const filename = path.join(temporary, `payload-${++payloadNumber}.txt`);
      await writeFile(filename, body);
      return core(cwd, 'send', '--from', from, '--to', to, '--file', filename, ...(replyTo ? ['--reply-to', replyTo] : []));
    },
    ack: (agent, id) => core(cwd, 'ack', '--agent', agent, '--id', id),
    status: () => core(cwd, 'status', '--json'),
  };
}

const localBridge = actualBridge(local);
const cloudBridge = actualBridge(cloud);

function options(agent, extra = []) {
  return parseAiArgs(['--agent', agent, '--once', '--state', path.join(temporary, `${agent}.json`), '--remote', mailbox, ...extra], {
    cwd: cloud, env: workerEnvironment,
  });
}

function assertSafe(text) {
  for (const secret of [primaryKey, fallbackKey, upstreamSecret]) {
    assert.ok(!String(text).includes(secret), 'Credential or raw upstream diagnostics reached output');
  }
}

async function invoke(configuration, { bridge = cloudBridge, complete, env = workerEnvironment, signal } = {}) {
  const output = [];
  const errors = [];
  let result;
  let failure;
  try {
    result = await runWorker(configuration, {
      bridge, complete, env, signal,
      stdout: async value => { output.push(String(value)); },
      stderr: async value => { errors.push(String(value)); },
    });
  } catch (error) {
    failure = error;
    assertSafe(error.message);
  }
  assertSafe([...output, ...errors].join('\n'));
  return { result, failure, output, errors };
}

function success(outcome, expectedCount) {
  assert.equal(outcome.failure, undefined, outcome.failure?.message);
  assert.equal(outcome.result, expectedCount);
}

async function replies(source) {
  return (await localBridge.inbox(source.from, { all: true })).messages.filter(message =>
    message.replyTo === source.id && message.from === source.to && message.to === source.from);
}

async function acknowledged(source) {
  return (await localBridge.inbox(source.to, { all: true })).messages.find(message => message.id === source.id)?.acknowledged;
}

function response(text) {
  return {
    status: 200,
    body: JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] }),
  };
}

async function test(name, run) {
  await run();
  passed++;
  console.log(`PASS: ${name}`);
}

async function snapshot(cwd) {
  return {
    status: await git(cwd, 'status', '--porcelain=v1', '--untracked-files=all'),
    staged: await git(cwd, 'diff', '--cached', '--binary'),
    unstaged: await git(cwd, 'diff', '--binary'),
    head: await git(cwd, 'rev-parse', 'HEAD'),
    notes: await readFile(path.join(cwd, 'user-notes.txt'), 'utf8'),
  };
}

try {
  await test('OpenAI requests use the fixed endpoint, preferred key, no tools and no storage', async () => {
    let calls = 0;
    const complete = createOpenAIResponder({
      env: workerEnvironment,
      request: async (url, request) => {
        calls++;
        assert.equal(String(url), 'https://api.openai.com/v1/responses');
        assert.equal(request.method, 'POST');
        const headers = Object.fromEntries(Object.entries(request.headers).map(([name, value]) => [name.toLowerCase(), value]));
        assert.equal(headers.authorization, `Bearer ${primaryKey}`);
        const body = JSON.parse(request.body);
        assert.equal(body.store, false);
        assert.ok(!body.tools || body.tools.length === 0);
        assert.equal(body.model, 'gpt-5.4-mini');
        assert.ok(Number.isInteger(body.max_output_tokens) && body.max_output_tokens > 0 && body.max_output_tokens <= 1200);
        assert.ok(!request.body.includes(primaryKey));
        assert.ok(!request.body.includes(fallbackKey));
        return response('Ein knapper hilfreicher Entwurf.');
      },
    });
    assert.equal(await complete({ ...modelMessage, body: 'Hilf mir mit einer lokalen Übergabe.' }, { model: 'gpt-5.4-mini' }), 'Ein knapper hilfreicher Entwurf.');
    assert.equal(calls, 1);
  });

  await test('the standard key is reused when no VIVE key exists and missing credentials make no request', async () => {
    let calls = 0;
    const complete = createOpenAIResponder({
      env: { OPENAI_API_KEY: fallbackKey },
      request: async (_url, request) => {
        calls++;
        const authorization = request.headers.Authorization ?? request.headers.authorization;
        assert.equal(authorization, `Bearer ${fallbackKey}`);
        return response('Fallback funktioniert.');
      },
    });
    assert.equal(await complete(modelMessage, { model: 'gpt-5.4-mini' }), 'Fallback funktioniert.');
    assert.equal(calls, 1);
    await assert.rejects(async () => {
      const missing = createOpenAIResponder({ env: {}, request: async () => { calls++; return response('Unexpected'); } });
      await missing(modelMessage, { model: 'gpt-5.4-mini' });
    }, /key|credential|OPENAI|configuration/i);
    assert.equal(calls, 1);
  });

  await test('provider failures, malformed responses and oversized output cannot become drafts', async () => {
    const invalidResponses = [
      { status: 401, body: JSON.stringify({ error: { message: upstreamSecret } }) },
      { status: 200, body: '{ invalid JSON' },
      { status: 200, body: JSON.stringify({ status: 'completed', output: [{ type: 'function_call', arguments: upstreamSecret }] }) },
      { status: 200, body: JSON.stringify({ status: 'incomplete', output: [] }) },
      response(''),
      response('x'.repeat(100_000)),
    ];
    for (const invalid of invalidResponses) {
      const complete = createOpenAIResponder({ env: workerEnvironment, request: async () => invalid });
      await assert.rejects(() => complete(modelMessage, { model: 'gpt-5.4-mini' }), error => {
        assertSafe(error.message);
        return true;
      });
    }
    const disconnected = createOpenAIResponder({ env: workerEnvironment, request: async () => { throw new Error(upstreamSecret); } });
    await assert.rejects(() => disconnected(modelMessage, { model: 'gpt-5.4-mini' }), error => {
      assertSafe(error.message);
      return true;
    });
  });

  await test('HTTP debug wildcards and disabled TLS verification block requests before exposing credentials', async () => {
    let calls = 0;
    for (const unsafe of [
      { NODE_DEBUG: 'http*' }, { NODE_DEBUG: 'H*' }, { NODE_DEBUG: '*http*' },
      { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    ]) {
      const complete = createOpenAIResponder({
        env: { ...workerEnvironment, ...unsafe },
        request: async () => { calls++; return response('Unexpected'); },
      });
      await assert.rejects(() => complete(modelMessage, { model: 'gpt-5.4-mini' }), error => {
        assertSafe(error.message);
        return /debug|TLS|verification/i.test(error.message);
      });
    }
    assert.equal(calls, 0);
  });

  await test('worker cancellation is forwarded to the bridge subprocess', async () => {
    const controller = new AbortController();
    let observedSignal;
    const client = createBridgeClient(options('cancellation-ai'), {
      signal: controller.signal,
      run: async (_program, _args, execution) => {
        observedSignal = execution.signal;
        if (execution.signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
        return { stdout: JSON.stringify({ messages: [], pending: 0 }), stderr: '' };
      },
    });
    await client.inbox('cancellation-ai');
    assert.equal(observedSignal, controller.signal);
    controller.abort();
    await assert.rejects(() => client.inbox('cancellation-ai'));
  });

  await test('more than 1000 pending requests are deferred while bounded processing keeps making progress', async () => {
    const incoming = Array.from({ length: 1001 }, (_, index) => ({
      ...modelMessage, id: `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
      to: 'batch-ai', body: `Short pending request ${index}`, acknowledged: false,
    }));
    const completed = new Set();
    const published = [];
    const fakeBridge = {
      async inbox(agent) {
        const messages = agent === 'batch-ai' ? incoming.filter(message => !completed.has(message.id)) : published;
        return { messages, pending: messages.length };
      },
      async send({ from, to, body, replyTo }) {
        const message = { ...modelMessage, id: randomUUID(), from, to, body, replyTo, acknowledged: false };
        published.push(message);
        return { id: message.id, message };
      },
      async ack(agent, id) {
        completed.add(id);
        return { id, agent, acknowledged: true };
      },
    };
    let calls = 0;
    const complete = async () => { calls++; return 'Bounded batch response.'; };
    success(await invoke(options('batch-ai'), { bridge: fakeBridge, complete }), 1);
    assert.equal(calls, 1);
    assert.equal(completed.size, 1);
    success(await invoke(options('batch-ai'), { bridge: fakeBridge, complete }), 1);
    assert.equal(calls, 2);
    assert.equal(completed.size, 2);
    assert.equal(published.length, 2);
  });

  await git(temporary, 'init', '--bare', '--initial-branch=main', mailbox);
  await git(temporary, 'init', '--bare', '--initial-branch=main', website);
  await git(temporary, 'clone', website, local);
  await git(local, 'config', 'user.name', 'AI Bridge Test');
  await git(local, 'config', 'user.email', 'ai-bridge-test@example.invalid');
  await writeFile(path.join(local, 'tracked.txt'), 'Original\n');
  await git(local, 'add', 'tracked.txt');
  await git(local, 'commit', '-m', 'Test fixture');
  await git(local, 'push', 'origin', 'main');
  await git(temporary, 'clone', website, cloud);
  for (const cwd of [local, cloud]) {
    await writeFile(path.join(cwd, 'tracked.txt'), 'Staged user work\n');
    await git(cwd, 'add', 'tracked.txt');
    await writeFile(path.join(cwd, 'tracked.txt'), 'Staged and unstaged user work\n');
    await writeFile(path.join(cwd, 'user-notes.txt'), 'Untracked user notes\n');
  }
  const initialLocal = await snapshot(local);
  const initialCloud = await snapshot(cloud);
  const initialWebsiteHeads = await git(local, 'ls-remote', '--heads', 'origin');

  await test('missing API credentials fail before reading or processing mailbox messages', async () => {
    let calls = 0;
    const unexpected = async () => { calls++; throw new Error('Unexpected operation'); };
    const outcome = await invoke(options('missing-key-ai'), {
      bridge: { inbox: unexpected, send: unexpected, ack: unexpected, status: unexpected },
      complete: unexpected, env: {},
    });
    assert.ok(outcome.failure || outcome.errors.length > 0);
    assert.equal(calls, 0);
  });

  await test('check mode validates transport without a paid call or message mutation', async () => {
    let completeCalls = 0;
    let statusCalls = 0;
    const outcome = await invoke({ ...options('check-ai'), check: true }, {
      bridge: {
        status: async () => { statusCalls++; return { branch: 'codex-bridge-v1', messages: 0, acknowledgements: 0, tip: null }; },
        inbox: async () => assert.fail('Check mode read inbox'),
        send: async () => assert.fail('Check mode sent a message'),
        ack: async () => assert.fail('Check mode acknowledged a message'),
      },
      complete: async () => { completeCalls++; return 'Unexpected'; },
    });
    success(outcome, 0);
    assert.equal(statusCalls, 1);
    assert.equal(completeCalls, 0);
  });

  await test('a mocked API draft becomes one durable Git reply and acknowledgement while loop sources are skipped', async () => {
    const original = (await localBridge.send({ from: 'local', to: 'cloud-ai', body: 'Bitte formuliere eine kurze Übergabe.' })).message;
    const ignored = [
      (await localBridge.send({ from: 'local', to: 'all', body: 'Broadcast für Menschen und Helfer.' })).message,
      (await cloudBridge.send({ from: 'cloud-ai', to: 'cloud-ai', body: 'Eigene Nachricht.' })).message,
      (await localBridge.send({ from: 'helper-ai', to: 'cloud-ai', body: `${marker}\nSchon automatisch beantwortet.` })).message,
      (await localBridge.send({ from: 'local', to: 'cloud-ai', body: 'Antwort innerhalb eines vorhandenen Threads.', replyTo: original.id })).message,
    ];
    let modelCalls = 0;
    const complete = createOpenAIResponder({ env: workerEnvironment, request: async () => {
      modelCalls++;
      return response('Übergabe: Die lokale Arbeit ist bereit zur Prüfung.');
    } });
    success(await invoke(options('cloud-ai'), { complete }), 1);
    const delivered = await replies(original);
    assert.equal(delivered.length, 1);
    assert.ok(delivered[0].body.startsWith(marker));
    assert.ok(delivered[0].body.includes('Die lokale Arbeit ist bereit zur Prüfung.'));
    assert.equal(await acknowledged(original), true);
    for (const skipped of ignored) {
      const recipient = skipped.to === 'all' ? 'cloud-ai' : skipped.to;
      assert.equal((await localBridge.inbox(recipient, { all: true })).messages.find(message => message.id === skipped.id)?.acknowledged, false);
    }
    success(await invoke(options('cloud-ai'), { complete }), 0);
    assert.equal(modelCalls, 1);
    assert.equal((await replies(original)).length, 1);
  });

  await test('provider failure leaves the source pending and needs explicit permission to retry the model', async () => {
    const original = (await localBridge.send({ from: 'local', to: 'provider-failure-ai', body: 'Bitte beantworte diese Anfrage.' })).message;
    let modelCalls = 0;
    await invoke(options('provider-failure-ai'), { complete: async () => {
      modelCalls++;
      throw new Error(upstreamSecret);
    } });
    assert.equal(await acknowledged(original), false);
    assert.equal((await replies(original)).length, 0);
    const recovering = async () => { modelCalls++; return 'Antwort nach bewusster Wiederholung.'; };
    success(await invoke(options('provider-failure-ai'), { complete: recovering }), 0);
    assert.equal(modelCalls, 1);
    success(await invoke(options('provider-failure-ai', ['--retry-failed']), { complete: recovering }), 1);
    assert.equal(modelCalls, 2);
    assert.equal(await acknowledged(original), true);
    assert.equal((await replies(original)).length, 1);
  });

  await test('a failed publication retains the draft and restart uses it without another model request', async () => {
    const original = (await localBridge.send({ from: 'local', to: 'publication-ai', body: 'Eine zwischengespeicherte Antwort benötigt einen Retry.' })).message;
    let modelCalls = 0;
    const complete = async () => { modelCalls++; return 'Diesen Entwurf bitte beim Neustart wiederverwenden.'; };
    await invoke(options('publication-ai'), {
      complete,
      bridge: { ...cloudBridge, send: async () => { throw new Error('Publication unavailable'); } },
    });
    assert.equal(modelCalls, 1);
    assert.equal(await acknowledged(original), false);
    assert.equal((await replies(original)).length, 0);
    success(await invoke(options('publication-ai'), { complete }), 1);
    assert.equal(modelCalls, 1);
    assert.equal((await replies(original)).length, 1);
    assert.equal(await acknowledged(original), true);
  });

  await test('an uncertain successful send is reconciled on restart rather than duplicated', async () => {
    const original = (await localBridge.send({ from: 'local', to: 'uncertain-ai', body: 'Bestätige einen Versand mit ungewissem Ergebnis.' })).message;
    let modelCalls = 0;
    let sendCalls = 0;
    const complete = async () => { modelCalls++; return 'Einmalige Antwort trotz verlorener Versandbestätigung.'; };
    await invoke(options('uncertain-ai'), {
      complete,
      bridge: { ...cloudBridge, send: async fields => {
        sendCalls++;
        await cloudBridge.send(fields);
        throw new Error('Connection dropped after successful publication');
      } },
    });
    const resumed = await invoke(options('uncertain-ai'), { complete, bridge: { ...cloudBridge, send: async fields => {
      sendCalls++;
      return cloudBridge.send(fields);
    } } });
    assert.equal(resumed.failure, undefined, resumed.failure?.message);
    assert.equal(modelCalls, 1);
    assert.equal(sendCalls, 1);
    assert.equal((await replies(original)).length, 1);
    assert.equal(await acknowledged(original), true);
  });

  await test('acknowledgement failure is retried without regenerating or publishing a second reply', async () => {
    const original = (await localBridge.send({ from: 'local', to: 'acknowledgement-ai', body: 'Die Bestätigung soll beim Neustart erfolgen.' })).message;
    let modelCalls = 0;
    let sendCalls = 0;
    const complete = async () => { modelCalls++; return 'Bereits erfolgreich veröffentlichte Antwort.'; };
    const countedSend = async fields => { sendCalls++; return cloudBridge.send(fields); };
    await invoke(options('acknowledgement-ai'), {
      complete, bridge: { ...cloudBridge, send: countedSend, ack: async () => { throw new Error('Acknowledgement unavailable'); } },
    });
    assert.equal((await replies(original)).length, 1);
    assert.equal(await acknowledged(original), false);
    success(await invoke(options('acknowledgement-ai'), { complete, bridge: { ...cloudBridge, send: countedSend } }), 1);
    assert.equal(modelCalls, 1);
    assert.equal(sendCalls, 1);
    assert.equal((await replies(original)).length, 1);
    assert.equal(await acknowledged(original), true);
  });

  await test('the default per-run limit bounds model requests and leaves remaining messages pending', async () => {
    const originals = [
      (await localBridge.send({ from: 'local', to: 'limited-ai', body: 'Erste Anfrage.' })).message,
      (await localBridge.send({ from: 'local', to: 'limited-ai', body: 'Zweite Anfrage.' })).message,
    ];
    const configuration = options('limited-ai');
    assert.equal(configuration.maxMessages, 1);
    let modelCalls = 0;
    const complete = async () => { modelCalls++; return 'Kurze Antwort innerhalb des Limits.'; };
    success(await invoke(configuration, { complete }), 1);
    assert.equal(modelCalls, 1);
    assert.equal((await Promise.all(originals.map(acknowledged))).filter(Boolean).length, 1);
    success(await invoke(options('limited-ai'), { complete }), 1);
    assert.equal(modelCalls, 2);
    assert.ok((await Promise.all(originals.map(acknowledged))).every(Boolean));
  });

  await test('a received request acknowledged manually before restart does not trigger a model call', async () => {
    const original = (await localBridge.send({ from: 'local', to: 'manual-cancellation-ai', body: 'Manuell zurückgezogene Anfrage.' })).message;
    const configuration = options('manual-cancellation-ai');
    const controller = new AbortController();
    let modelCalls = 0;
    const complete = async () => { modelCalls++; return 'Unexpected after cancellation'; };
    success(await invoke(configuration, {
      complete, signal: controller.signal,
      bridge: { ...cloudBridge, inbox: async (...args) => {
        const pending = await cloudBridge.inbox(...args);
        controller.abort();
        return pending;
      } },
    }), 0);
    const receivedState = JSON.parse(await readFile(configuration.state, 'utf8'));
    assert.equal(receivedState.records.find(record => record.source.id === original.id)?.stage, 'received');
    assert.equal(modelCalls, 0);
    await localBridge.ack(configuration.agent, original.id);
    success(await invoke(options('manual-cancellation-ai'), { complete }), 0);
    assert.equal(modelCalls, 0);
    assert.equal((await replies(original)).length, 0);
    assert.equal(await acknowledged(original), true);
  });

  await test('corrupt durable state refuses processing instead of silently spending again', async () => {
    const original = (await localBridge.send({ from: 'local', to: 'corrupt-state-ai', body: 'Beschädigter Zustand darf keine erneute Ausgabe verursachen.' })).message;
    const configuration = options('corrupt-state-ai');
    await writeFile(configuration.state, '{ corrupted state');
    let modelCalls = 0;
    const outcome = await invoke(configuration, { complete: async () => { modelCalls++; return 'Unexpected'; } });
    assert.ok(outcome.failure || outcome.errors.length > 0);
    assert.equal(modelCalls, 0);
    assert.equal(await acknowledged(original), false);
    assert.equal((await replies(original)).length, 0);
  });

  await test('invalid completion values and oversized sources cannot publish or acknowledge', async () => {
    for (const [agent, body, draft] of [
      ['invalid-output-ai', 'Normale Anfrage.', { text: 'Unexpected object' }],
      ['oversized-output-ai', 'Normale Anfrage.', 'x'.repeat(100_000)],
      ['oversized-input-ai', 'ä'.repeat(8_193), 'Unexpected'],
    ]) {
      const original = (await localBridge.send({ from: 'local', to: agent, body })).message;
      let modelCalls = 0;
      await invoke(options(agent), { complete: async () => { modelCalls++; return draft; } });
      if (agent === 'oversized-input-ai') assert.equal(modelCalls, 0);
      assert.equal(await acknowledged(original), false);
      assert.equal((await replies(original)).length, 0);
    }
  });

  await test('a lone surrogate completion is rejected before publication and leaves no stuck draft', async () => {
    const original = (await localBridge.send({ from: 'local', to: 'surrogate-ai', body: 'Die Antwort muss gültiges UTF-8 enthalten.' })).message;
    const configuration = options('surrogate-ai');
    let modelCalls = 0;
    await invoke(configuration, { complete: async () => { modelCalls++; return '\ud800'; } });
    assert.equal(modelCalls, 1);
    assert.equal(await acknowledged(original), false);
    assert.equal((await replies(original)).length, 0);
    const state = JSON.parse(await readFile(configuration.state, 'utf8'));
    const saved = state.records.find(record => record.source.id === original.id);
    assert.equal(saved.stage, 'failed');
    assert.equal(saved.draft, null);
    success(await invoke(options('surrogate-ai'), { complete: async () => { modelCalls++; return 'Unexpected automatic retry'; } }), 0);
    assert.equal(modelCalls, 1);
  });

  await test('API automation preserves user files, staging and the public website origin', async () => {
    assert.deepEqual(await snapshot(local), initialLocal);
    assert.deepEqual(await snapshot(cloud), initialCloud);
    assert.equal(await git(local, 'ls-remote', '--heads', 'origin'), initialWebsiteHeads);
  });

  console.log(`Codex bridge AI tests passed (${passed} checks; no network or paid API calls).`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
