import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createHandler } from '../api/codex-bridge.mjs';
import { createAckHandler } from '../api/codex-bridge-ack.mjs';
import { bridgeAppendCapacity, isBridgeTimestamp, nativeReplyId } from '../lib/codex-bridge-protocol.mjs';
import { parseSmokeArgs, PROOF, runSmoke } from './smoke-codex-bridge-action.mjs';

// Every GitHub HTTP response is injected. The interoperability check uses local Git only.
const repository = 'RalRue/VIVEDEUTSCHMX-CODEX-BRIDGE';
const branch = 'codex-bridge-v1';
const apiRoot = `https://api.github.com/repos/${repository}`;
const actionToken = `action-fixture-${'a'.repeat(64)}`;
const githubToken = `github-fixture-${'b'.repeat(64)}`;
const env = { VIVE_BRIDGE_ACTION_TOKEN: actionToken, VIVE_BRIDGE_GITHUB_TOKEN: githubToken };
const taskId = 'a1111111-1111-4111-8111-111111111111';
const otherId = 'b2222222-2222-4222-8222-222222222222';
const replyId = nativeReplyId(taskId, 'cloud', 'local');
const now = () => new Date('2026-10-12T00:00:00.000Z');
const marker = '[codex-bridge-run/v1]\n';
let passed = 0;

function sha(value) { return createHash('sha1').update(value).digest('hex'); }
function blobSha(bytes) { return sha(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])); }
function response(status, value) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }); }
function message(id, body, overrides = {}) {
  return { schema: 'codex-bridge/v1', type: 'message', id, from: 'local', to: 'cloud',
    createdAt: now().toISOString(), replyTo: null, body, ...overrides };
}

class FakeGitHub {
  constructor() {
    this.calls = [];
    this.blobs = new Map();
    this.trees = new Map();
    this.commits = new Map();
    this.privateRecord = { full_name: repository, private: true };
    this.treeOverride = null;
    this.metadataStatus = 200;
    this.beforeFetch = null;
    this.afterPatch = null;
    this.counter = 0;
    this.install(new Map());
  }
  install(files) {
    const tree = sha(`fixture-tree-${++this.counter}`);
    const tip = sha(`fixture-commit-${this.counter}`);
    this.trees.set(tree, new Map(files));
    this.commits.set(tip, { tree, parents: [] });
    this.tip = tip;
  }
  get files() { return this.trees.get(this.commits.get(this.tip).tree); }
  storeBlob(raw) {
    const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'utf8');
    const id = blobSha(bytes);
    this.blobs.set(id, bytes);
    return id;
  }
  seedRecord(record, filename = `messages/${record.id}.json`) {
    return this.seedRaw(`${JSON.stringify(record, null, 2)}\n`, filename);
  }
  seedRaw(raw, filename) {
    const files = new Map(this.files);
    files.set(filename, this.storeBlob(raw));
    this.install(files);
  }
  read(filename) {
    const id = this.files.get(filename);
    return id ? JSON.parse(this.blobs.get(id).toString('utf8')) : null;
  }
  mutations() { return this.calls.filter(call => call.method !== 'GET'); }
  fetch = async (target, options = {}) => {
    const url = new URL(target);
    const method = options.method || 'GET';
    const body = options.body === undefined ? undefined : JSON.parse(options.body);
    this.calls.push({ method, url: url.href, pathname: url.pathname, body });
    assert.equal(url.origin, 'https://api.github.com');
    assert.ok(url.href.startsWith(apiRoot));
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Bearer ${githubToken}`);
    assert.ok(options.signal instanceof AbortSignal);
    assert.ok(!url.href.includes(actionToken) && !url.href.includes(githubToken));
    const relative = url.pathname.slice(new URL(apiRoot).pathname.length);
    const injected = await this.beforeFetch?.({ method, relative, body, fake: this });
    if (injected) return injected;
    if (method === 'GET' && relative === '') return response(this.metadataStatus, this.privateRecord);
    if (method === 'GET' && relative.startsWith('/contents/')) {
      const ref = url.searchParams.get('ref');
      const snapshot = ref === branch ? this.files : this.trees.get(this.commits.get(ref)?.tree);
      assert.ok(snapshot, 'Read must use the fixed branch or an observed immutable commit');
      const filename = decodeURIComponent(relative.slice('/contents/'.length));
      const id = snapshot.get(filename);
      if (!id) return response(404, { message: 'Not Found' });
      const raw = this.blobs.get(id);
      return response(200, { type: 'file', path: filename, sha: id, size: raw.length, encoding: 'base64', content: raw.toString('base64') });
    }
    if (method === 'GET' && relative === `/git/ref/heads/${branch}`) {
      return response(200, { ref: `refs/heads/${branch}`, object: { type: 'commit', sha: this.tip } });
    }
    if (method === 'GET' && relative.startsWith('/git/commits/')) {
      const id = relative.slice('/git/commits/'.length);
      const commit = this.commits.get(id);
      assert.ok(commit, 'Unknown commit read');
      return response(200, { sha: id, tree: { sha: commit.tree }, parents: commit.parents.map(value => ({ sha: value })) });
    }
    if (method === 'GET' && relative.startsWith('/git/trees/')) {
      const id = relative.slice('/git/trees/'.length);
      assert.equal(url.searchParams.get('recursive'), '1');
      const files = this.trees.get(id);
      assert.ok(files, 'Budget must be tied to a known immutable tree');
      const tree = [...files].map(([filename, blob]) => ({ path: filename, mode: '100644', type: 'blob', sha: blob, size: this.blobs.get(blob).length }));
      return response(200, { sha: id, truncated: false, tree, ...this.treeOverride });
    }
    if (method === 'POST' && relative === '/git/blobs') {
      assert.equal(body.encoding, 'base64');
      return response(201, { sha: this.storeBlob(Buffer.from(body.content, 'base64')) });
    }
    if (method === 'POST' && relative === '/git/trees') {
      const files = new Map(this.trees.get(body.base_tree));
      assert.ok(this.trees.has(body.base_tree));
      assert.equal(body.tree.length, 1);
      for (const entry of body.tree) {
        assert.equal(entry.type, 'blob');
        assert.equal(entry.mode, '100644');
        assert.ok(this.blobs.has(entry.sha));
        assert.match(entry.path, /^(?:messages\/[0-9a-f-]+|acknowledgements\/local\/[0-9a-f-]+)\.json$/);
        files.set(entry.path, entry.sha);
      }
      const id = sha(`new-tree-${++this.counter}`);
      this.trees.set(id, files);
      return response(201, { sha: id });
    }
    if (method === 'POST' && relative === '/git/commits') {
      assert.ok(this.trees.has(body.tree));
      assert.equal(body.parents.length, 1);
      assert.ok(this.commits.has(body.parents[0]));
      const id = sha(`new-commit-${++this.counter}`);
      this.commits.set(id, { tree: body.tree, parents: [...body.parents] });
      return response(201, { sha: id, tree: { sha: body.tree }, parents: body.parents.map(value => ({ sha: value })) });
    }
    if (method === 'PATCH' && relative === `/git/refs/heads/${branch}`) {
      assert.equal(body.force, false);
      const candidate = this.commits.get(body.sha);
      assert.ok(candidate);
      if (candidate.parents[0] !== this.tip) return response(409, { message: 'Concurrent ref update' });
      this.tip = body.sha;
      await this.afterPatch?.({ fake: this, body });
      return response(200, { ref: `refs/heads/${branch}`, object: { type: 'commit', sha: body.sha } });
    }
    assert.fail(`Unexpected fake GitHub operation: ${method} ${relative}`);
  };
}

function handlers(fake, configuration = env) {
  return { task: createHandler({ fetchImpl: fake.fetch, env: configuration, now }),
    ack: createAckHandler({ fetchImpl: fake.fetch, env: configuration, now }) };
}

async function call(handler, { method = 'POST', body = { taskId, body: 'Kurze Aufgabe.' }, query,
  authorization = `Bearer ${actionToken}`, contentType = 'application/json', url = '/api/codex-bridge' } = {}) {
  const headers = {};
  const req = { method, body, query, url, headers: { authorization, 'content-type': contentType } };
  const result = { code: null, body: null, headers };
  const res = {
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    status(code) { result.code = code; return this; },
    json(value) { result.body = value; return this; },
  };
  await handler(req, res);
  assert.equal(headers['cache-control'], 'no-store');
  assert.match(headers['content-type'], /application\/json/);
  assert.equal(headers['x-content-type-options'], 'nosniff');
  const serialized = JSON.stringify(result.body);
  assert.ok(!serialized.includes(actionToken) && !serialized.includes(githubToken), 'Credential leaked in HTTP response');
  return result;
}

async function get(handler, id = taskId, overrides = {}) {
  return call(handler, { method: 'GET', body: undefined, query: { taskId: id }, ...overrides });
}

function seedReply(fake, id = taskId, overrides = {}) {
  const deterministic = nativeReplyId(id, 'cloud', 'local');
  fake.seedRecord(message(deterministic, `${marker}Aufgabe geprüft und beantwortet.`, {
    from: 'cloud', to: 'local', replyTo: id, ...overrides,
  }), `messages/${deterministic}.json`);
  return deterministic;
}

function completedExchanges(fake, count) {
  const files = new Map();
  const add = (filename, value) => files.set(filename, fake.storeBlob(`${JSON.stringify(value, null, 2)}\n`));
  for (let index = 0; index < count; index++) {
    const id = `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
    const resultId = nativeReplyId(id, 'cloud', 'local');
    add(`messages/${id}.json`, message(id, 'Completed archived task'));
    add(`messages/${resultId}.json`, message(resultId, `${marker}Completed archived result`, { from: 'cloud', to: 'local', replyTo: id }));
    for (const [agent, target] of [['cloud', id], ['local', resultId]]) {
      add(`acknowledgements/${agent}/${target}.json`, { schema: 'codex-bridge/v1', type: 'acknowledgement',
        id: target, agent, createdAt: now().toISOString() });
    }
  }
  return files;
}

async function test(name, run) { await run(); passed++; console.log(`PASS: ${name}`); }

await test('authentication and missing configuration reject requests before any GitHub call', async () => {
  for (const authorization of [null, '', 'Bearer wrong', `Basic ${actionToken}`, [`Bearer ${actionToken}`]]) {
    const fake = new FakeGitHub();
    const result = await call(handlers(fake).task, { authorization });
    assert.equal(result.code, 401);
    assert.equal(fake.calls.length, 0);
  }
  for (const configuration of [{}, { VIVE_BRIDGE_ACTION_TOKEN: actionToken }, { ...env, VIVE_BRIDGE_ACTION_TOKEN: 'too-short' }]) {
    const fake = new FakeGitHub();
    assert.equal((await call(handlers(fake, configuration).task)).code, 503);
    assert.equal(fake.calls.length, 0);
  }
});

await test('invalid IDs, request shapes, UTF-8, sizes and content types never reach GitHub', async () => {
  const invalid = [
    { taskId: '../escape', body: 'x' }, { taskId: taskId.toUpperCase(), body: 'x' },
    { taskId: taskId.replace('-4111-', '-1111-'), body: 'x' }, { taskId: [], body: 'x' },
    { taskId, body: '' }, { taskId, body: '   ' }, { taskId, body: {} },
    { taskId, body: '\ud800' }, { taskId, body: 'ä'.repeat(8193) },
    { taskId, body: 'x\0y' }, { taskId, body: 'x', to: 'all' },
    '{ invalid JSON', Buffer.from([0xc3, 0x28]), [], null,
  ];
  for (const body of invalid) {
    const fake = new FakeGitHub();
    const result = await call(handlers(fake).task, { body });
    assert.ok([400, 413].includes(result.code), `Unexpected invalid-input status ${result.code}`);
    assert.equal(fake.calls.length, 0);
  }
  const fake = new FakeGitHub();
  assert.equal((await call(handlers(fake).task, { contentType: 'text/plain' })).code, 415);
  assert.equal(fake.calls.length, 0);
});

await test('reserved machine prefixes are rejected before storage, including leading whitespace', async () => {
  for (const body of [`${marker}Review a previous report`, ' \n\t[codex-bridge-ai/v1]\nReview this reply']) {
    const fake = new FakeGitHub();
    const result = await call(handlers(fake).task, { body: { taskId, body } });
    assert.equal(result.code, 400);
    assert.equal(result.body.error, 'reserved_task_prefix');
    assert.equal(fake.calls.length, 0);
  }
  const fake = new FakeGitHub();
  assert.equal((await call(handlers(fake).task, { body: { taskId, body: `Review this quoted marker: ${marker}` } })).code, 202);
});

await test('only the exact private repository may receive a task', async () => {
  for (const metadata of [{ ...new FakeGitHub().privateRecord, private: false },
    { full_name: repository, private: 'true' }, { full_name: 'another-owner/mailbox', private: true }]) {
    const fake = new FakeGitHub();
    fake.privateRecord = metadata;
    assert.equal((await call(handlers(fake).task)).code, 503);
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.mutations().length, 0);
  }
});

await test('submission creates one fixed immutable record and reuses it for an identical task ID', async () => {
  const fake = new FakeGitHub();
  const handler = handlers(fake).task;
  const first = await call(handler, { body: { taskId, body: 'Originale unveränderliche Aufgabe.' } });
  assert.equal(first.code, 202);
  assert.deepEqual(first.body, { taskId, status: 'queued' });
  assert.deepEqual(fake.read(`messages/${taskId}.json`), message(taskId, 'Originale unveränderliche Aufgabe.'));
  const originalSha = fake.files.get(`messages/${taskId}.json`);
  const mutations = fake.mutations().length;
  assert.equal((await call(handler, { body: { taskId, body: 'Originale unveränderliche Aufgabe.' } })).code, 202);
  assert.equal(fake.mutations().length, mutations);
  assert.equal(fake.files.get(`messages/${taskId}.json`), originalSha);
  assert.equal((await call(handler, { body: { taskId, body: 'Geänderte Aufgabe mit derselben ID.' } })).code, 409);
  assert.equal(fake.files.get(`messages/${taskId}.json`), originalSha);
  assert.equal(fake.mutations().length, mutations);
});

await test('the exact 16384-byte UTF-8 limit is accepted', async () => {
  const fake = new FakeGitHub();
  const body = 'ä'.repeat(8192);
  assert.equal((await call(handlers(fake).task, { body: { taskId, body } })).code, 202);
  assert.ok(fake.read(`messages/${taskId}.json`).body === body);
});

await test('concurrent different tasks reconcile Git ref conflicts without losing either record', async () => {
  const fake = new FakeGitHub();
  const handler = handlers(fake).task;
  const results = await Promise.all([
    call(handler, { body: { taskId, body: 'Concurrent task A' } }),
    call(handler, { body: { taskId: otherId, body: 'Concurrent task B' } }),
  ]);
  assert.ok(results.every(result => result.code === 202));
  assert.equal(fake.read(`messages/${taskId}.json`).body, 'Concurrent task A');
  assert.equal(fake.read(`messages/${otherId}.json`).body, 'Concurrent task B');
  assert.equal(fake.files.size, 2);
  assert.ok(fake.calls.filter(value => value.method === 'PATCH').length >= 3, 'Fixture did not exercise a ref conflict');
});

await test('concurrent submissions of the same ID cannot overwrite a different original body', async () => {
  const fake = new FakeGitHub();
  const handler = handlers(fake).task;
  const bodies = ['Immutable concurrent original A', 'Immutable concurrent original B'];
  const results = await Promise.all(bodies.map(body => call(handler, { body: { taskId, body } })));
  assert.deepEqual(results.map(result => result.code).sort(), [202, 409]);
  const winner = results.findIndex(result => result.code === 202);
  assert.equal(fake.read(`messages/${taskId}.json`).body, bodies[winner]);
  assert.equal(fake.files.size, 1);
});

await test('a lost successful ref-update response is reconciled without a duplicate task', async () => {
  const fake = new FakeGitHub();
  let interrupted = false;
  fake.afterPatch = async () => { if (!interrupted) { interrupted = true; throw new Error(`Lost response ${githubToken}`); } };
  assert.equal((await call(handlers(fake).task)).code, 202);
  assert.equal(fake.files.size, 1);
  assert.equal(fake.read(`messages/${taskId}.json`).id, taskId);
});

await test('concurrent admission reserves the last result and both ACK slots within 10000 records', async () => {
  const fake = new FakeGitHub();
  fake.install(completedExchanges(fake, 2499));
  const handler = handlers(fake).task;
  const results = await Promise.all([
    call(handler, { body: { taskId, body: 'Last available record A' } }),
    call(handler, { body: { taskId: otherId, body: 'Last available record B' } }),
  ]);
  assert.deepEqual(results.map(value => value.code).sort(), [202, 503]);
  assert.equal(fake.files.size, 9997);
  const winner = [taskId, otherId][results.findIndex(value => value.code === 202)];
  seedReply(fake, winner);
  assert.equal((await call(handlers(fake).ack, { body: { taskId: winner, replyId: nativeReplyId(winner, 'cloud', 'local') } })).code, 200);
  assert.equal(fake.files.size, 9999);
});

await test('legacy overbooked mailboxes reject new tasks but still accept pending result ACKs up to the hard limit', async () => {
  const fake = new FakeGitHub();
  const files = new Map();
  for (let index = 0; index < 9997; index++) {
    const id = `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
    files.set(`messages/${id}.json`, fake.storeBlob(JSON.stringify(message(id, 'Legacy coordination'))));
  }
  fake.install(files);
  fake.seedRecord(message(taskId, 'Existing native task'));
  seedReply(fake);
  assert.equal(fake.files.size, 9999);
  assert.equal((await call(handlers(fake).task, { body: { taskId: otherId, body: 'New task must wait for migration' } })).code, 503);
  assert.equal((await call(handlers(fake).ack, { body: { taskId, replyId } })).code, 200);
  assert.equal(fake.files.size, 10000);
  assert.equal((await call(handlers(fake).ack, { body: { taskId, replyId } })).code, 200);
  assert.equal((await call(handlers(fake).task, { body: { taskId: otherId, body: 'Still no new work' } })).code, 503);
});

await test('legacy generic completions cannot steal compliant native reserves or exceed either hard limit', async () => {
  const entries = (count, size = 300) => new Map(Array.from({ length: count }, (_, index) =>
    [`messages/00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}.json`, { size }]));
  const sourceId = '00000000-0000-4000-8000-000000000000';
  const result = message(taskId, '[codex-bridge-ai/v1]\nExisting cached result', { from: 'legacy-ai', to: 'local', replyTo: sourceId });
  const resultPath = `messages/${taskId}.json`;
  assert.equal(bridgeAppendCapacity(entries(169), resultPath, result, 300).allowed, false,
    'A generic result must not consume another admitted task\'s native guarantee');
  assert.equal(bridgeAppendCapacity(entries(171), resultPath, result, 300).allowed, true,
    'A previously overbooked legacy AI task must still be able to publish');
  assert.equal(bridgeAppendCapacity(entries(171), resultPath, { ...result, replyTo: null }, 300).allowed, false);
  assert.equal(bridgeAppendCapacity(entries(10_000), resultPath, result, 300).allowed, false);
  assert.equal(bridgeAppendCapacity(entries(96, 349_525), resultPath, result, 300).allowed, false);
});

await test('worst-case JSON escaping is reserved within 32 MiB before admitting a task', async () => {
  const fake = new FakeGitHub();
  const files = completedExchanges(fake, 200);
  // Complete historical exchanges may contain much larger coordination records
  // than native results. Their actual serialized bytes still count in full.
  for (const [filename, blob] of files) {
    if (!filename.startsWith('messages/')) continue;
    const value = JSON.parse(fake.blobs.get(blob));
    value.body = '\u0001'.repeat(13_900);
    files.set(filename, fake.storeBlob(`${JSON.stringify(value, null, 2)}\n`));
  }
  fake.install(files);
  const occupied = [...files.values()].reduce((sum, id) => sum + fake.blobs.get(id).length, 0);
  assert.ok(occupied < 32 * 1024 * 1024 && occupied > 32 * 1024 * 1024 - 196_608);
  const before = fake.mutations().length;
  assert.equal((await call(handlers(fake).task)).code, 503);
  assert.equal(fake.mutations().length, before);
  for (const [filename, blob] of files) {
    if (!filename.startsWith('messages/')) continue;
    const value = JSON.parse(fake.blobs.get(blob));
    value.body = '\u0001'.repeat(13_800);
    files.set(filename, fake.storeBlob(`${JSON.stringify(value, null, 2)}\n`));
  }
  fake.install(files);
  assert.equal((await call(handlers(fake).task)).code, 202);
  seedReply(fake, taskId, { body: `${marker}${'\u0001'.repeat(32_768)}` });
  assert.equal((await get(handlers(fake).task)).code, 200);
  assert.equal((await call(handlers(fake).ack, { body: { taskId, replyId } })).code, 200);
  fake.seedRecord({ schema: 'codex-bridge/v1', type: 'acknowledgement', id: taskId, agent: 'cloud',
    createdAt: now().toISOString() }, `acknowledgements/cloud/${taskId}.json`);
  assert.ok([...fake.files.values()].reduce((sum, id) => sum + fake.blobs.get(id).length, 0) <= 32 * 1024 * 1024);
});

await test('a new task cannot consume an existing task\'s deterministic result reservation', async () => {
  const fake = new FakeGitHub();
  fake.seedRecord(message(taskId, 'Existing source'));
  const result = await call(handlers(fake).task, { body: { taskId: replyId, body: 'Conflicting initial task' } });
  assert.equal(result.code, 409);
  assert.equal(fake.mutations().length, 0);
  const occupied = new FakeGitHub();
  occupied.seedRecord(message(replyId, 'An older independent initial task'));
  assert.equal((await call(handlers(occupied).task)).code, 409);
  assert.equal(occupied.mutations().length, 0);
});

await test('unknown or truncated capacity never permits a write', async () => {
  const fake = new FakeGitHub();
  fake.treeOverride = { truncated: true };
  assert.equal((await call(handlers(fake).task)).code, 503);
  assert.equal(fake.mutations().length, 0);
  const duplicate = new FakeGitHub();
  const entry = { path: `messages/${otherId}.json`, mode: '100644', type: 'blob', size: 1, sha: sha('duplicate fixture') };
  duplicate.treeOverride = { tree: [entry, entry] };
  assert.equal((await call(handlers(duplicate).task)).code, 502);
  assert.equal(duplicate.mutations().length, 0);
});

await test('GET remains queued until the deterministic native reply exists and reads no history', async () => {
  const fake = new FakeGitHub();
  fake.seedRecord(message(taskId, 'Requested task'));
  fake.seedRecord(message(otherId, 'PRIVATE_UNRELATED_TASK'));
  fake.seedRecord(message('c3333333-3333-4333-8333-333333333333', `${marker}PRIVATE_UNRELATED_REPLY`, { from: 'cloud', to: 'local', replyTo: otherId }));
  const result = await get(handlers(fake).task);
  assert.equal(result.code, 200);
  assert.deepEqual(result.body, { taskId, status: 'queued' });
  assert.equal(fake.mutations().length, 0);
  assert.deepEqual(fake.calls.map(value => value.url), [apiRoot,
    `${apiRoot}/contents/messages/${taskId}.json?ref=${branch}`,
    `${apiRoot}/contents/messages/${replyId}.json?ref=${branch}`]);
  assert.ok(!JSON.stringify(result.body).includes('PRIVATE_UNRELATED'));
});

await test('GET returns only the exact correlated native result and keeps it readable after ACK', async () => {
  const fake = new FakeGitHub();
  fake.seedRecord(message(taskId, 'Requested task'));
  seedReply(fake);
  const handler = handlers(fake);
  const result = await get(handler.task);
  assert.equal(result.code, 200);
  assert.deepEqual(result.body, { taskId, status: 'completed', replyId, result: 'Aufgabe geprüft und beantwortet.' });
  assert.equal(fake.mutations().length, 0);
  assert.equal((await call(handler.ack, { url: '/api/codex-bridge-ack', body: { taskId, replyId } })).code, 200);
  assert.deepEqual((await get(handler.task)).body, result.body);
});

await test('existing UTC-second tasks, results and ACKs remain readable and immutable across API retries', async () => {
  for (const times of [
    { task: '2026-10-12T00:00:00Z', reply: '2026-10-12T00:00:00.001Z', ack: '2026-10-12T00:00:01Z' },
    { task: '2024-02-29T23:59:58.000Z', reply: '2024-02-29T23:59:59Z', ack: '2024-03-01T00:00:00.000Z' },
  ]) {
    const fake = new FakeGitHub();
    fake.seedRecord(message(taskId, 'Existing immutable timestamp fixture', { createdAt: times.task }));
    seedReply(fake, taskId, { createdAt: times.reply });
    const acknowledgement = { schema: 'codex-bridge/v1', type: 'acknowledgement', id: replyId,
      agent: 'local', createdAt: times.ack };
    const ackPath = `acknowledgements/local/${replyId}.json`;
    fake.seedRecord(acknowledgement, ackPath);
    const originalFiles = [...fake.files];
    const handler = handlers(fake);
    assert.deepEqual((await get(handler.task)).body,
      { taskId, status: 'completed', replyId, result: 'Aufgabe geprüft und beantwortet.' });
    assert.equal((await call(handler.task, { body: { taskId, body: 'Existing immutable timestamp fixture' } })).code, 202);
    assert.deepEqual((await call(handler.ack, { url: '/api/codex-bridge-ack', body: { taskId, replyId } })).body,
      { taskId, replyId, acknowledged: true });
    assert.equal(fake.mutations().length, 0);
    assert.deepEqual([...fake.files], originalFiles);
    assert.deepEqual(fake.read(ackPath), acknowledgement);
    assert.equal(fake.read(`messages/${taskId}.json`).createdAt, times.task);
    assert.equal(fake.read(`messages/${replyId}.json`).createdAt, times.reply);
  }
});

await test('invalid calendar dates and unsupported timestamp syntax cannot complete or acknowledge API tasks', async () => {
  const invalidDates = [
    '2026-02-30T00:00:00Z', '2025-02-29T00:00:00.000Z',
    '2026-01-01T24:00:00Z', '2026-01-01T00:00:60.000Z',
    '2026-01-01T00:00:00.0Z', '2026-01-01T00:00:00.00Z', '2026-01-01T00:00:00.0000Z',
    '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00',
  ];
  for (const createdAt of invalidDates) {
    assert.equal(isBridgeTimestamp(createdAt), false, createdAt);
    for (const invalidType of ['task', 'reply', 'acknowledgement']) {
      const fake = new FakeGitHub();
      fake.seedRecord(message(taskId, 'Requested task', invalidType === 'task' ? { createdAt } : {}));
      seedReply(fake, taskId, invalidType === 'reply' ? { createdAt } : {});
      if (invalidType === 'acknowledgement') {
        fake.seedRecord({ schema: 'codex-bridge/v1', type: 'acknowledgement', id: replyId,
          agent: 'local', createdAt }, `acknowledgements/local/${replyId}.json`);
      }
      const handler = handlers(fake);
      if (invalidType !== 'acknowledgement') {
        const result = await get(handler.task);
        assert.equal(result.code, 502);
        assert.deepEqual(result.body, { error: 'mailbox_invalid_record' });
      }
      const acknowledgement = await call(handler.ack, { url: '/api/codex-bridge-ack', body: { taskId, replyId } });
      assert.equal(acknowledgement.code, invalidType === 'acknowledgement' ? 409 : 502);
      assert.equal(fake.mutations().length, 0);
    }
  }
});

await test('wrong sender, recipient, task correlation, path identity or machine marker cannot complete a task', async () => {
  const mismatches = [
    { from: 'another-helper' }, { to: 'all' }, { replyTo: otherId }, { id: otherId },
    { body: '[codex-bridge-ai/v1]\nDifferent model reply' }, { body: 'Unmarked result' },
    { schema: 'different-schema' }, { body: `${marker}\ud800` },
  ];
  for (const override of mismatches) {
    const fake = new FakeGitHub();
    fake.seedRecord(message(taskId, 'Requested task'));
    seedReply(fake, taskId, override);
    const result = await get(handlers(fake).task);
    assert.ok(result.code >= 400);
    assert.ok(!Object.hasOwn(result.body, 'result'));
    assert.equal(fake.mutations().length, 0);
  }
});

await test('unknown tasks and malformed queries cannot reveal unrelated mailbox contents', async () => {
  const fake = new FakeGitHub();
  assert.equal((await get(handlers(fake).task)).code, 404);
  for (const query of [{ taskId: ['duplicate', taskId] }, { taskId: '../escape' }, { taskId, path: 'messages' }, { taskId, branch: 'main' }]) {
    const isolated = new FakeGitHub();
    assert.equal((await get(handlers(isolated).task, taskId, { query })).code, 400);
    assert.equal(isolated.calls.length, 0);
  }
});

await test('ACK validates the correlated reply and creates only one recipient-specific acknowledgement', async () => {
  const fake = new FakeGitHub();
  fake.seedRecord(message(taskId, 'Requested task'));
  seedReply(fake);
  const handler = handlers(fake).ack;
  const expected = { taskId, replyId, acknowledged: true };
  const request = { url: '/api/codex-bridge-ack', body: { taskId, replyId } };
  const first = await call(handler, request);
  assert.equal(first.code, 200);
  assert.deepEqual(first.body, expected);
  const filename = `acknowledgements/local/${replyId}.json`;
  assert.deepEqual(fake.read(filename), { schema: 'codex-bridge/v1', type: 'acknowledgement', id: replyId, agent: 'local', createdAt: now().toISOString() });
  assert.equal(fake.read(`acknowledgements/cloud/${taskId}.json`), null);
  const mutations = fake.mutations().length;
  assert.deepEqual((await call(handler, request)).body, expected);
  assert.equal(fake.mutations().length, mutations);
});

await test('ACK refuses arbitrary IDs and pending replies without writing', async () => {
  const fake = new FakeGitHub();
  fake.seedRecord(message(taskId, 'Pending task'));
  const handler = handlers(fake).ack;
  for (const body of [{ taskId, replyId: otherId }, { taskId, replyId: '../escape' }, { taskId, replyId, agent: 'cloud' }]) {
    fake.calls = [];
    const result = await call(handler, { url: '/api/codex-bridge-ack', body });
    assert.ok([400, 409].includes(result.code));
    assert.equal(fake.calls.length, 0);
  }
  const pending = await call(handler, { url: '/api/codex-bridge-ack', body: { taskId, replyId } });
  assert.equal(pending.code, 409);
  assert.equal(fake.mutations().length, 0);
});

await test('unsupported methods, content types and injected repository paths cannot change routing', async () => {
  const fake = new FakeGitHub();
  const handler = handlers(fake);
  for (const method of ['DELETE', 'PATCH', 'OPTIONS', 'HEAD']) assert.equal((await call(handler.task, { method })).code, 405);
  assert.equal((await call(handler.ack, { method: 'GET', url: '/api/codex-bridge-ack' })).code, 405);
  const injected = await call(handler.task, { body: { taskId, body: 'Attempt routing injection', repository: 'public/repo', branch: 'main', path: '../file' } });
  assert.equal(injected.code, 400);
  assert.equal(fake.calls.length, 0);
});

await test('GitHub denial, malformed replies and raw transport diagnostics never expose credentials', async () => {
  for (const mode of ['denied', 'network', 'invalid-json']) {
    const fake = new FakeGitHub();
    fake.beforeFetch = async () => {
      if (mode === 'denied') return response(403, { message: `${actionToken} ${githubToken}` });
      if (mode === 'network') throw new Error(`${actionToken} ${githubToken}`);
      return new Response(`${githubToken} not JSON`, { status: 200 });
    };
    const result = await call(handlers(fake).task);
    assert.ok(result.code >= 400);
    assert.equal(fake.mutations().length, 0);
  }
  for (const secret of [actionToken, githubToken]) {
    const fake = new FakeGitHub();
    assert.equal((await call(handlers(fake).task, { body: { taskId, body: `Accidentally supplied ${secret}` } })).code, 400);
    assert.equal(fake.mutations().length, 0);
  }
});

await test('API-produced tasks, deterministic CLI replies and API ACKs interoperate through a real local Git mailbox', async () => {
  const fake = new FakeGitHub();
  fake.install(completedExchanges(fake, 2499));
  const handler = handlers(fake);
  assert.equal((await call(handler.task, { body: { taskId, body: 'Interoperability task' } })).code, 202);
  const temporary = await mkdtemp(path.join(tmpdir(), 'vive-codex-action-test-'));
  const writer = path.join(temporary, 'writer');
  const remote = path.join(temporary, 'mailbox.git');
  const client = path.join(temporary, 'client');
  const execute = promisify(execFile);
  const environment = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(temporary, 'empty.gitconfig'), GIT_TERMINAL_PROMPT: '0', CODEX_BRIDGE_REMOTE: remote };
  await writeFile(environment.GIT_CONFIG_GLOBAL, '');
  async function run(program, args, cwd = temporary) { return (await execute(program, args, { cwd, env: environment, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 })).stdout; }
  const cli = fileURLToPath(new URL('./codex-bridge.mjs', import.meta.url));
  try {
    await run('git', ['init', '--bare', '--initial-branch=main', remote]);
    await run('git', ['init', '--initial-branch', branch, writer]);
    await run('git', ['config', 'user.name', 'Action Protocol Test'], writer);
    await run('git', ['config', 'user.email', 'action-protocol-test@example.invalid'], writer);
    for (const [filename, id] of fake.files) {
      await mkdir(path.dirname(path.join(writer, filename)), { recursive: true });
      await writeFile(path.join(writer, filename), fake.blobs.get(id));
    }
    await run('git', ['add', '.'], writer);
    await run('git', ['commit', '-m', 'API task fixture'], writer);
    await run('git', ['remote', 'add', 'origin', remote], writer);
    await run('git', ['push', 'origin', branch], writer);
    await run('git', ['init', '--initial-branch=main', client]);
    await writeFile(path.join(client, 'user-work.txt'), 'Untracked user work remains intact.');
    const bodyFile = path.join(temporary, 'native-result.txt');
    await writeFile(bodyFile, `${marker}Der native CLI-Worker hat geantwortet.`);
    const sent = JSON.parse(await run(process.execPath, [cli, 'send', '--from', 'cloud', '--to', 'local', '--reply-to', taskId, '--id', replyId, '--file', bodyFile], client));
    assert.equal(sent.id, replyId);
    const replyRaw = await run('git', ['show', `${branch}:messages/${replyId}.json`], remote);
    fake.seedRaw(replyRaw, `messages/${replyId}.json`);
    await run(process.execPath, [cli, 'ack', '--agent', 'cloud', '--id', taskId], client);
    const taskAckPath = `acknowledgements/cloud/${taskId}.json`;
    fake.seedRaw(await run('git', ['show', `${branch}:${taskAckPath}`], remote), taskAckPath);
    const result = await get(handler.task);
    assert.equal(result.code, 200);
    assert.deepEqual(result.body, { taskId, status: 'completed', replyId, result: 'Der native CLI-Worker hat geantwortet.' });
    assert.equal((await call(handler.ack, { url: '/api/codex-bridge-ack', body: { taskId, replyId } })).code, 200);
    assert.equal(fake.files.size, 10000);
    assert.equal((await call(handler.task, { body: { taskId: otherId, body: 'Cannot steal a completion slot' } })).code, 503);
    await run('git', ['pull', '--ff-only', 'origin', branch], writer);
    const ackPath = `acknowledgements/local/${replyId}.json`;
    await mkdir(path.dirname(path.join(writer, ackPath)), { recursive: true });
    await writeFile(path.join(writer, ackPath), fake.blobs.get(fake.files.get(ackPath)));
    await run('git', ['add', ackPath], writer);
    await run('git', ['commit', '-m', 'API acknowledgement fixture'], writer);
    await run('git', ['push', 'origin', branch], writer);
    await assert.rejects(run(process.execPath, [cli, 'send', '--from', 'local', '--to', 'cloud',
      '--file', path.join(client, 'user-work.txt')], client), error => {
      assert.match(error.stderr, /capacity/i);
      return true;
    });
    const inbox = JSON.parse(await run(process.execPath, [cli, 'inbox', '--agent', 'local', '--all', '--json'], client));
    assert.equal(inbox.messages.find(value => value.id === replyId)?.acknowledged, true);
    const pending = JSON.parse(await run(process.execPath, [cli, 'inbox', '--agent', 'cloud', '--all', '--json'], client));
    assert.equal(pending.messages.find(value => value.id === taskId)?.body, 'Interoperability task');
    assert.equal(await readFile(path.join(client, 'user-work.txt'), 'utf8'), 'Untracked user work remains intact.');
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

await test('an uncertain smoke submission preserves its task ID and never submits another task automatically', async () => {
  const output = [];
  let submits = 0;
  let lookups = 0;
  let acknowledgements = 0;
  const code = await runSmoke(parseSmokeArgs(['--run']), {
    uuid: () => taskId,
    output: record => output.push(record),
    client: {
      submit: async id => { submits++; assert.equal(id, taskId); throw new Error(`Uncertain transport ${actionToken}`); },
      get: async () => { lookups++; assert.fail('Submission failure must not start polling'); },
      acknowledge: async () => { acknowledgements++; assert.fail('Submission failure must not ACK'); },
    },
  });
  assert.equal(code, 1);
  assert.equal(submits, 1);
  assert.equal(lookups, 0);
  assert.equal(acknowledgements, 0);
  assert.equal(output[0].taskId, taskId);
  assert.deepEqual(output.at(-1).resumeArgs, ['--run', '--task-id', taskId]);
  assert.equal(output.at(-1).acknowledged, false);
  assert.ok(!JSON.stringify(output).includes(actionToken));
});

await test('resuming a completed smoke task verifies its fixed proof and ACKs without a new submission', async () => {
  let submits = 0;
  let acknowledgements = 0;
  const output = [];
  const code = await runSmoke(parseSmokeArgs(['--run', '--task-id', taskId]), {
    output: record => output.push(record),
    client: {
      submit: async () => { submits++; assert.fail('Resume must not submit an already completed task'); },
      get: async id => ({ status: 200, value: { taskId: id, status: 'completed', result: PROOF, replyId } }),
      acknowledge: async (id, responseId) => {
        acknowledgements++;
        assert.equal(id, taskId);
        assert.equal(responseId, replyId);
        return { status: 200, value: { taskId: id, replyId: responseId, acknowledged: true } };
      },
    },
  });
  assert.equal(code, 0);
  assert.equal(submits, 0);
  assert.equal(acknowledgements, 1);
  assert.equal(output.at(-1).event, 'verified');
  assert.equal(output.at(-1).result, PROOF);
});

await test('pending smoke polling is bounded and an unexpected result is never acknowledged', async () => {
  let clock = 0;
  let polls = 0;
  let submits = 0;
  let acknowledgements = 0;
  const output = [];
  const pending = await runSmoke(parseSmokeArgs(['--run']), {
    uuid: () => taskId, now: () => clock,
    pause: async milliseconds => { clock += milliseconds; },
    output: record => output.push(record),
    client: {
      submit: async id => { submits++; return { status: 202, value: { taskId: id, status: 'queued' } }; },
      get: async id => { polls++; return { status: 200, value: { taskId: id, status: 'queued' } }; },
      acknowledge: async () => { acknowledgements++; assert.fail('Pending work must not ACK'); },
    },
  });
  assert.equal(pending, 1);
  assert.equal(submits, 1);
  assert.equal(polls, 8);
  assert.ok(clock <= 120_000);
  assert.equal(acknowledgements, 0);
  assert.deepEqual(output.at(-1).resumeArgs, ['--run', '--task-id', taskId]);
  const mismatch = await runSmoke(parseSmokeArgs(['--run', '--task-id', taskId]), {
    output: record => output.push(record),
    client: {
      submit: async () => assert.fail('Unexpected completed result must not cause resubmission'),
      get: async () => ({ status: 200, value: { taskId, status: 'completed', result: 'Different result', replyId } }),
      acknowledge: async () => { acknowledgements++; assert.fail('Unexpected proof must not ACK'); },
    },
  });
  assert.equal(mismatch, 1);
  assert.equal(acknowledgements, 0);
  assert.equal(output.at(-1).event, 'result_mismatch');
});

console.log(`Codex bridge Action tests passed (${passed} checks; no external requests or paid calls).`);
