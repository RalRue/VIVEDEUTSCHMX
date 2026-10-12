import assert from 'node:assert/strict';
import { createGitHubRequest, ensureMailbox, main } from './codex-bridge-connect.mjs';

// Every GitHub response and CLI execution is injected. This suite never uses the network.
const repository = 'RalRue/VIVEDEUTSCHMX-CODEX-BRIDGE';
const repositoryPath = `repos/${repository}`;
const repositoryUrl = `https://github.com/${repository}`;
const privateRecord = { full_name: repository, private: true, html_url: repositoryUrl };
const readyRecord = { status: 'ready', repository, url: repositoryUrl, private: true, created: false };
const secretMarker = 'CONNECT_TEST_SECRET_MARKER';
let passed = 0;

function httpFailure(status) {
  return Object.assign(new Error(`Upstream diagnostic containing ${secretMarker}`), { status });
}

function requests(sequence) {
  const remaining = [...sequence];
  const calls = [];
  return {
    calls,
    request: async (method, endpoint, fields) => {
      calls.push({ method, endpoint, fields });
      const expected = remaining.shift();
      assert.ok(expected, `Unexpected GitHub request: ${method} ${endpoint}`);
      assert.equal(method, expected.method);
      assert.equal(endpoint, expected.endpoint);
      if (expected.fields) assert.deepEqual(fields, expected.fields);
      if (expected.error) throw expected.error;
      return expected.response;
    },
    done() { assert.equal(remaining.length, 0, 'Expected GitHub requests were not made'); },
  };
}

function getRepository(response = privateRecord) {
  return { method: 'GET', endpoint: repositoryPath, response };
}

function missingRepository() {
  return { method: 'GET', endpoint: repositoryPath, error: httpFailure(404) };
}

function currentUser(login = 'RalRue') {
  return { method: 'GET', endpoint: 'user', response: { login } };
}

const privateCreateFields = {
  name: 'VIVEDEUTSCHMX-CODEX-BRIDGE',
  private: true,
  auto_init: false,
  description: 'Private mailbox for VIVE Codex helpers.',
};

function createRepository(response = privateRecord) {
  return { method: 'POST', endpoint: 'user/repos', fields: privateCreateFields, response };
}

async function rejectsSafely(operation, diagnostic) {
  let caught;
  try { await operation(); } catch (error) { caught = error; }
  assert.ok(caught instanceof Error, 'Operation should have failed');
  assert.match(caught.message, diagnostic);
  assert.ok(!caught.message.includes(secretMarker), 'Error leaked upstream or credential text');
  return caught;
}

async function test(name, run) {
  await run();
  passed++;
  console.log(`PASS: ${name}`);
}

await test('an existing private mailbox is idempotent in normal and check modes', async () => {
  for (const check of [false, true]) {
    const fake = requests([getRepository()]);
    assert.deepEqual(await ensureMailbox({ check, request: fake.request }), readyRecord);
    assert.ok(fake.calls.every(call => call.method === 'GET'));
    fake.done();
  }
});

await test('an existing public repository is refused without changing its visibility', async () => {
  for (const check of [false, true]) {
    const fake = requests([getRepository({ ...privateRecord, private: false })]);
    await rejectsSafely(() => ensureMailbox({ check, request: fake.request }), /private|public|visibility/i);
    fake.done();
  }
});

await test('check mode reports confirmed absence without fetching identity or creating a repository', async () => {
  const fake = requests([missingRepository()]);
  await rejectsSafely(() => ensureMailbox({ check: true, request: fake.request }), /missing|exist|found|404/i);
  fake.done();
});

await test('confirmed absence and the correct owner create a private uninitialized mailbox', async () => {
  const fake = requests([missingRepository(), currentUser(), createRepository()]);
  assert.deepEqual(await ensureMailbox({ request: fake.request }), { ...readyRecord, created: true });
  assert.equal(fake.calls.filter(call => call.method === 'POST').length, 1);
  fake.done();
});

await test('the wrong authenticated GitHub account cannot create the mailbox', async () => {
  const fake = requests([missingRepository(), currentUser('different-account')]);
  await rejectsSafely(() => ensureMailbox({ request: fake.request }), /account|owner|RalRue|user/i);
  assert.ok(fake.calls.every(call => call.method === 'GET'));
  fake.done();
});

await test('403, unexpected HTTP errors and network failures cannot trigger creation', async () => {
  for (const error of [httpFailure(403), httpFailure(500), new Error(`Network failure ${secretMarker}`)]) {
    const fake = requests([{ method: 'GET', endpoint: repositoryPath, error }]);
    await rejectsSafely(() => ensureMailbox({ request: fake.request }), /GitHub|access|read|request|connect|auth|permission/i);
    fake.done();
  }
});

await test('identity lookup failure after 404 cannot trigger creation', async () => {
  const fake = requests([missingRepository(), { method: 'GET', endpoint: 'user', error: httpFailure(403) }]);
  await rejectsSafely(() => ensureMailbox({ request: fake.request }), /GitHub|account|access|auth|identity|user/i);
  fake.done();
});

await test('creation permission or network failures stop after one attempt and keep errors safe', async () => {
  for (const error of [httpFailure(403), new Error(`Ambiguous write failure ${secretMarker}`)]) {
    const fake = requests([missingRepository(), currentUser(), { ...createRepository(), response: undefined, error }]);
    await rejectsSafely(() => ensureMailbox({ request: fake.request }), /GitHub|create|permission|token|access|request/i);
    fake.done();
  }
});

await test('a creation race rechecks the winner and accepts an existing private mailbox', async () => {
  const fake = requests([missingRepository(), currentUser(), { ...createRepository(), error: httpFailure(422) }, getRepository()]);
  assert.deepEqual(await ensureMailbox({ request: fake.request }), readyRecord);
  assert.equal(fake.calls.filter(call => call.method === 'POST').length, 1);
  fake.done();
});

await test('a creation race won by a public repository is refused', async () => {
  const fake = requests([
    missingRepository(), currentUser(), { ...createRepository(), error: httpFailure(422) },
    getRepository({ ...privateRecord, private: false }),
  ]);
  await rejectsSafely(() => ensureMailbox({ request: fake.request }), /private|public|visibility/i);
  fake.done();
});

await test('incomplete or unrelated repository metadata cannot report readiness', async () => {
  for (const record of [
    { ...privateRecord, private: 'true' },
    { ...privateRecord, full_name: 'different-account/VIVEDEUTSCHMX-CODEX-BRIDGE' },
    { ...privateRecord, html_url: 'https://example.invalid/unrelated' },
  ]) {
    const fake = requests([getRepository(record)]);
    await rejectsSafely(() => ensureMailbox({ request: fake.request }), /private|repository|metadata|response|expected|URL|invalid/i);
    fake.done();
  }
});

await test('the CLI prints only safe readiness metadata and rejects unsupported options', async () => {
  const output = [];
  const fake = requests([getRepository({ ...privateRecord, token: secretMarker })]);
  await main(['--check'], { request: fake.request, stdout: value => output.push(value) });
  assert.deepEqual(JSON.parse(output.join('')), readyRecord);
  assert.ok(!output.join('').includes(secretMarker));
  fake.done();
  await rejectsSafely(() => main(['--unknown'], {
    request: async () => assert.fail('Invalid CLI input made a request'), stdout: () => {},
  }), /option|unknown|argument|usage/i);
});

await test('the API adapter passes optional admin authentication only to its child environment', async () => {
  const originalEnvironment = { PATH: '/test-path', GH_TOKEN: 'EXISTING_AUTH_MARKER', VIVE_GITHUB_ADMIN_TOKEN: secretMarker };
  const expectedEnvironment = { ...originalEnvironment };
  let invocation;
  const request = createGitHubRequest({
    env: originalEnvironment,
    run: async (program, args, options) => {
      invocation = { program, args, options };
      return { stdout: JSON.stringify(privateRecord), stderr: '' };
    },
  });
  assert.deepEqual(await request('GET', repositoryPath), privateRecord);
  assert.equal(invocation.program, 'gh');
  assert.equal(invocation.options.env.GH_TOKEN, secretMarker);
  assert.ok(!invocation.args.join(' ').includes(secretMarker));
  assert.deepEqual(originalEnvironment, expectedEnvironment);
});

await test('the API adapter preserves supplied authentication and sanitizes raw gh failures', async () => {
  const environment = { PATH: '/test-path', GH_TOKEN: 'EXISTING_AUTH_MARKER' };
  let childToken;
  const existingRequest = createGitHubRequest({
    env: environment,
    run: async (_program, _args, options) => {
      childToken = options.env.GH_TOKEN;
      return { stdout: JSON.stringify(privateRecord), stderr: '' };
    },
  });
  assert.deepEqual(await existingRequest('GET', repositoryPath), privateRecord);
  assert.equal(childToken, environment.GH_TOKEN);
  const failureRequest = createGitHubRequest({
    env: { ...environment, VIVE_GITHUB_ADMIN_TOKEN: secretMarker },
    run: async () => {
      throw Object.assign(new Error(`Request arguments ${secretMarker}`), {
        code: 1, stdout: secretMarker, stderr: `gh: Resource not accessible (HTTP 403) ${secretMarker}`,
      });
    },
  });
  const error = await rejectsSafely(() => failureRequest('GET', repositoryPath), /GitHub|403|permission|access|request/i);
  assert.equal(error.status, 403);
});

console.log(`Codex bridge connector tests passed (${passed} checks; no network requests).`);
