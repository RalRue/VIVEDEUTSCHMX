import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createCodexRunner, parseCodexArgs, runCodexWorker } from './codex-bridge-codex.mjs';
import { nativeReplyId } from '../lib/codex-bridge-protocol.mjs';

// A fixture executable handles every Codex invocation, including login checks.
// The only Git remotes are local temporary bare repositories. No inference or network.
const execute = promisify(execFile);
const cli = fileURLToPath(new URL('./codex-bridge.mjs', import.meta.url));
const marker = '[codex-bridge-run/v1]';
const rawSecret = 'TEST_CODEX_RAW_DIAGNOSTIC_SECRET';
const temporary = await mkdtemp(path.join(tmpdir(), 'vive-codex-launcher-test-'));
const mailbox = path.join(temporary, 'private-mailbox.git');
const website = path.join(temporary, 'website.git');
const local = path.join(temporary, 'local');
const cloud = path.join(temporary, 'cloud');
const fakeDirectory = path.join(temporary, 'fake-bin');
const auditFile = path.join(temporary, 'codex-audit.jsonl');
const runtimeEnvironment = {
  ...process.env,
  GIT_CONFIG_GLOBAL: path.join(temporary, 'empty.gitconfig'),
  GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', CODEX_BRIDGE_REMOTE: mailbox,
};
const codexEnvironment = {
  ...runtimeEnvironment,
  PATH: `${fakeDirectory}${path.delimiter}${process.env.PATH || ''}`,
  VIVE_CODEX_TEST_AUDIT: auditFile,
  VIVE_CODEX_TEST_RESULT: 'Der lokale Codex hat eine kurze Antwort vorbereitet.',
};
let passed = 0;
let payloadNumber = 0;
await writeFile(runtimeEnvironment.GIT_CONFIG_GLOBAL, '');
await mkdir(fakeDirectory);

const fakeProgram = `#!${process.execPath}
const fs = require('node:fs');
const assert = require('node:assert/strict');
const args = process.argv.slice(2);
const mode = process.env.VIVE_CODEX_TEST_MODE || 'success';
function audit(record) { fs.appendFileSync(process.env.VIVE_CODEX_TEST_AUDIT, JSON.stringify(record) + '\\n'); }
if (args.length === 1 && args[0] === '--version') {
  audit({ kind: 'version', args });
  process.stdout.write('codex-cli 0.159.2\\n');
} else if (args[0] === 'login' && args[1] === 'status') {
  audit({ kind: 'authentication', args });
  process.stderr.write(mode === 'unauthenticated' ? 'Not logged in\\n' : 'Logged in using ChatGPT\\n');
  process.exitCode = mode === 'unauthenticated' ? 1 : 0;
} else if (args[0] === 'exec' && args[1] === '--help') {
  audit({ kind: 'capabilities', args });
  process.stdout.write('--ignore-user-config --ephemeral --sandbox --json --output-last-message --disable\\n');
} else if (args[0] === 'features' && args[1] === 'list') {
  audit({ kind: 'features', args });
  process.stdout.write('hooks beta false\\napps beta false\\nplugins beta false\\nbrowser_use beta false\\ncomputer_use beta false\\n');
} else {
  const chunks = [];
  process.stdin.on('data', chunk => chunks.push(chunk));
  process.stdin.on('end', () => {
    const input = Buffer.concat(chunks).toString('utf8');
    audit({ kind: 'exec', args, input, pid: process.pid });
    try {
      assert.ok(args.includes('exec'), 'Expected a new exec session');
      assert.ok(args.includes('--ignore-user-config'), 'User configuration must be ignored');
      assert.ok(args.includes('--ephemeral'), 'A new ephemeral session is required');
      for (const name of ['hooks', 'apps', 'plugins', 'browser_use', 'computer_use']) {
        assert.ok(args.some((value, index) => value === '--disable' && args[index + 1] === name), 'Tools and extensions must be disabled');
      }
      assert.ok(!args.some(value => ['--dangerously-bypass-approvals-and-sandbox', '--yolo', '--full-auto', '--ignore-rules', '--last', '--worktree', 'resume'].includes(value)), 'Unsafe or resumed session');
      const sandboxIndex = args.indexOf('--sandbox');
      assert.ok(sandboxIndex >= 0 && ['read-only', 'workspace-write'].includes(args[sandboxIndex + 1]), 'Explicit safe sandbox required');
      const policy = args.some((value, index) => ['-c', '--config'].includes(value) && args[index + 1] === 'approval_policy="never"')
        || args.some((value, index) => ['-a', '--ask-for-approval'].includes(value) && args[index + 1] === 'never');
      assert.ok(policy, 'Approval must be never');
      assert.ok(args.includes('-'), 'Prompt must arrive via stdin');
      assert.ok(input.length > 0, 'Empty stdin prompt');
      const outputIndex = args.findIndex(value => ['-o', '--output-last-message'].includes(value));
      assert.ok(outputIndex >= 0 && args[outputIndex + 1], 'Output file required');
      const output = args[outputIndex + 1];
      if (mode === 'hang') {
        process.on('SIGTERM', () => {});
        setInterval(() => {}, 1000);
        setTimeout(() => process.exit(99), 35000);
        return;
      }
      if (mode === 'empty') fs.writeFileSync(output, '');
      else if (mode === 'oversized') fs.writeFileSync(output, 'x'.repeat(100000));
      else if (mode === 'invalid-utf8') fs.writeFileSync(output, Buffer.from([0xc3, 0x28]));
      else if (mode === 'symlink') { fs.writeFileSync(output + '.target', 'Symlink final output'); fs.symlinkSync(output + '.target', output); }
      else fs.writeFileSync(output, process.env.VIVE_CODEX_TEST_RESULT);
      if (mode === 'nonzero-final') { process.stderr.write('${rawSecret}\\n'); process.exitCode = 1; }
      else process.stdout.write('fixture structured event\\n');
    } catch (error) { process.stderr.write(error.message + '\\n'); process.exitCode = 1; }
  });
}
`;
await writeFile(path.join(fakeDirectory, 'codex'), fakeProgram);
await chmod(path.join(fakeDirectory, 'codex'), 0o700);

async function command(program, args, cwd) {
  try {
    return await execute(program, args, { cwd, env: runtimeEnvironment, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`${program} failed: ${error.stderr || error.message}`);
  }
}

async function git(cwd, ...args) { return (await command('git', args, cwd)).stdout; }
async function core(cwd, ...args) { return JSON.parse((await command(process.execPath, [cli, ...args], cwd)).stdout); }

function actualBridge(cwd) {
  return {
    inbox: (agent, { all = false } = {}) => core(cwd, 'inbox', '--agent', agent, '--json', ...(all ? ['--all'] : [])),
    async send({ from, to, body, replyTo = null, id }) {
      const filename = path.join(temporary, `payload-${++payloadNumber}.txt`);
      await writeFile(filename, body);
      return core(cwd, 'send', '--from', from, '--to', to, '--file', filename,
        ...(replyTo ? ['--reply-to', replyTo] : []), ...(id ? ['--id', id] : []));
    },
    ack: (agent, id) => core(cwd, 'ack', '--agent', agent, '--id', id),
    status: () => core(cwd, 'status', '--json'),
  };
}
const localBridge = actualBridge(local);
const cloudBridge = actualBridge(cloud);

function options(agent, { allowed = ['local'], extra = [], cwd = cloud, state } = {}) {
  return parseCodexArgs([
    '--agent', agent, '--once', '--state', state || path.join(temporary, `${agent}.json`), '--remote', mailbox,
    ...allowed.flatMap(sender => ['--allow-from', sender]), ...extra,
  ], { cwd, env: codexEnvironment });
}

function runner(mode = 'success', result = codexEnvironment.VIVE_CODEX_TEST_RESULT) {
  return createCodexRunner({ env: { ...codexEnvironment, VIVE_CODEX_TEST_MODE: mode, VIVE_CODEX_TEST_RESULT: result } });
}

async function invoke(configuration, { bridge = cloudBridge, launch, probe, signal, env = codexEnvironment } = {}) {
  const native = runner();
  const output = [];
  const errors = [];
  let result;
  let failure;
  try {
    result = await runCodexWorker(configuration, {
      bridge, launch: launch || native.launch,
      probe: probe || (async () => ({ version: '0.159.2', authenticated: true, supported: true })),
      signal, env,
      stdout: async value => { output.push(String(value)); },
      stderr: async value => { errors.push(String(value)); },
    });
  } catch (error) { failure = error; }
  assert.ok(![...output, ...errors, failure?.message || ''].join('\n').includes(rawSecret), 'Raw child diagnostic leaked');
  return { result, failure, output, errors };
}

function success(outcome, count) {
  assert.equal(outcome.failure, undefined, outcome.failure?.message);
  assert.equal(outcome.result, count);
}

async function audit() {
  try { return (await readFile(auditFile, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

async function executions(source) {
  return (await audit()).filter(event => event.kind === 'exec' && event.input.includes(source.body));
}

async function replies(source) {
  return (await localBridge.inbox(source.from, { all: true })).messages.filter(message =>
    message.replyTo === source.id && message.from === source.to && message.to === source.from);
}

async function acknowledged(source) {
  return (await localBridge.inbox(source.to, { all: true })).messages.find(message => message.id === source.id)?.acknowledged;
}

async function waitUntilLaunched(source) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if ((await executions(source)).length > 0) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail('Fixture Codex did not start before cancellation deadline');
}

async function snapshot(cwd) {
  return {
    status: await git(cwd, 'status', '--porcelain=v1', '--untracked-files=all'),
    staged: await git(cwd, 'diff', '--cached', '--binary'),
    unstaged: await git(cwd, 'diff', '--binary'), head: await git(cwd, 'rev-parse', 'HEAD'),
    notes: await readFile(path.join(cwd, 'user-notes.txt'), 'utf8'),
  };
}

async function test(name, run) { await run(); passed++; console.log(`PASS: ${name}`); }

try {
  await git(temporary, 'init', '--bare', '--initial-branch=main', mailbox);
  await git(temporary, 'init', '--bare', '--initial-branch=main', website);
  await git(temporary, 'clone', website, local);
  await git(local, 'config', 'user.name', 'Codex Launcher Test');
  await git(local, 'config', 'user.email', 'codex-launcher-test@example.invalid');
  await writeFile(path.join(local, 'tracked.txt'), 'Original\n');
  await git(local, 'add', 'tracked.txt');
  await git(local, 'commit', '-m', 'Fixture');
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

  await test('native replies have stable task-specific UUIDs for constant-cost Action lookup', async () => {
    const taskId = '01234567-89ab-4def-8123-456789abcdef';
    const replyId = nativeReplyId(taskId, 'cloud', 'local');
    assert.match(replyId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(nativeReplyId(taskId, 'cloud', 'local'), replyId);
    assert.notEqual(nativeReplyId(taskId, 'local', 'cloud'), replyId);
    assert.notEqual(nativeReplyId('01234567-89ab-4def-8123-456789abcdee', 'cloud', 'local'), replyId);
    assert.throws(() => nativeReplyId(taskId, 'all', 'local'));
    assert.throws(() => nativeReplyId('../bad', 'cloud', 'local'));
  });

  await test('authentication checks report readiness without launching inference', async () => {
    const before = (await audit()).filter(event => event.kind === 'exec').length;
    const authenticated = await runner().probe();
    assert.equal(authenticated.authenticated, true);
    assert.equal(authenticated.version, '0.159.2');
    assert.equal(authenticated.supported, true);
    const notAuthenticated = await runner('unauthenticated').probe();
    assert.equal(notAuthenticated.authenticated, false);
    assert.equal((await audit()).filter(event => event.kind === 'exec').length, before);
    const native = runner();
    success(await invoke({ ...options('check-run'), check: true }, { probe: native.probe }), 0);
    assert.equal((await audit()).filter(event => event.kind === 'exec').length, before);
  });

  await test('a permitted arrival spawns a safe new Codex exec using stdin and publishes its result before ACK', async () => {
    const shellMarker = path.join(temporary, 'shell-injection-was-executed');
    const body = `Launcher fixture request: $(touch ${shellMarker}); --sandbox danger-full-access; bitte eine kurze Übergabe.`;
    const original = (await localBridge.send({ from: 'local', to: 'arrival-run', body })).message;
    const configuration = options('arrival-run');
    assert.equal(configuration.sandbox, 'read-only');
    success(await invoke(configuration), 1);
    const calls = await executions(original);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].input.includes(body));
    assert.ok(!calls[0].args.join(' ').includes(body));
    const sandboxIndex = calls[0].args.indexOf('--sandbox');
    assert.equal(calls[0].args[sandboxIndex + 1], 'read-only');
    const directoryIndex = calls[0].args.findIndex(value => ['-C', '--cd'].includes(value));
    assert.equal(calls[0].args[directoryIndex + 1], cloud);
    await assert.rejects(readFile(shellMarker), { code: 'ENOENT' });
    const delivered = await replies(original);
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].id, nativeReplyId(original.id, 'arrival-run', 'local'));
    assert.ok(delivered[0].body.startsWith(marker));
    assert.ok(delivered[0].body.includes(codexEnvironment.VIVE_CODEX_TEST_RESULT));
    assert.equal(await acknowledged(original), true);
    success(await invoke(options('arrival-run')), 0);
    assert.equal((await executions(original)).length, 1);
    assert.equal((await replies(original)).length, 1);
  });

  await test('no sender permission or failed authentication can launch a request', async () => {
    const original = (await localBridge.send({ from: 'local', to: 'blocked-run', body: 'Blocked launcher request.' })).message;
    let failure;
    try { failure = await invoke(options('blocked-run', { allowed: [] })); } catch (error) { failure = { failure: error }; }
    assert.ok(failure.failure || failure.errors?.length);
    assert.equal((await executions(original)).length, 0);
    assert.equal(await acknowledged(original), false);
    await invoke(options('blocked-run'), { probe: async () => ({ version: '0.159.2', authenticated: false }) });
    assert.equal((await executions(original)).length, 0);
    assert.equal(await acknowledged(original), false);
  });

  await test('broadcasts, untrusted senders, self messages, replies and machine-marked messages are filtered', async () => {
    const base = (await localBridge.send({ from: 'local', to: 'filter-base', body: 'Referenced message for launcher filter.' })).message;
    const ignored = [
      (await localBridge.send({ from: 'local', to: 'all', body: 'Launcher broadcast must not execute.' })).message,
      (await localBridge.send({ from: 'other-helper', to: 'filtered-run', body: 'Untrusted sender request.' })).message,
      (await cloudBridge.send({ from: 'filtered-run', to: 'filtered-run', body: 'Own launcher request.' })).message,
      (await localBridge.send({ from: 'local', to: 'filtered-run', body: 'Thread reply must not execute.', replyTo: base.id })).message,
      (await localBridge.send({ from: 'local', to: 'filtered-run', body: '\n  [codex-bridge-ai/v1]\nAutomatic model reply.' })).message,
      (await localBridge.send({ from: 'local', to: 'filtered-run', body: `\n  ${marker}\nAutomatic Codex reply.` })).message,
    ];
    success(await invoke(options('filtered-run', { allowed: ['local', 'filtered-run'] })), 0);
    for (const source of ignored) assert.equal((await executions(source)).length, 0);
    const all = await localBridge.inbox('filtered-run', { all: true });
    for (const source of ignored) assert.equal(all.messages.find(message => message.id === source.id)?.acknowledged, false);
  });

  await test('mailbox transport failure never starts Codex inference', async () => {
    let calls = 0;
    const outcome = await invoke(options('transport-run'), {
      bridge: { ...cloudBridge, inbox: async () => { throw new Error('Offline mailbox'); } },
      launch: async () => { calls++; return 'Unexpected'; },
    });
    assert.ok(outcome.failure || outcome.errors.length);
    assert.equal(calls, 0);
  });

  await test('failed publication retains the final result so restart never relaunches Codex', async () => {
    const original = (await localBridge.send({ from: 'local', to: 'publication-run', body: 'Cache this launcher result after publication failure.' })).message;
    await invoke(options('publication-run'), { bridge: { ...cloudBridge, send: async () => { throw new Error('Cannot publish'); } } });
    assert.equal((await executions(original)).length, 1);
    assert.equal((await replies(original)).length, 0);
    assert.equal(await acknowledged(original), false);
    success(await invoke(options('publication-run')), 1);
    assert.equal((await executions(original)).length, 1);
    assert.equal((await replies(original)).length, 1);
    assert.equal(await acknowledged(original), true);
  });

  await test('uncertain successful publication is reconciled without a second reply or Codex session', async () => {
    const original = (await localBridge.send({ from: 'local', to: 'uncertain-run', body: 'Uncertain launcher publication must reconcile.' })).message;
    let publications = 0;
    await invoke(options('uncertain-run'), { bridge: { ...cloudBridge, send: async fields => {
      publications++;
      await cloudBridge.send(fields);
      throw new Error('Connection lost after successful send');
    } } });
    await invoke(options('uncertain-run'), { bridge: { ...cloudBridge, send: async fields => {
      publications++;
      return cloudBridge.send(fields);
    } } });
    assert.equal(publications, 1);
    assert.equal((await executions(original)).length, 1);
    assert.equal((await replies(original)).length, 1);
    assert.equal(await acknowledged(original), true);
  });

  await test('ACK failure retries only acknowledgement, preserving one Codex execution and one reply', async () => {
    const original = (await localBridge.send({ from: 'local', to: 'acknowledgement-run', body: 'Retry only launcher acknowledgement.' })).message;
    await invoke(options('acknowledgement-run'), { bridge: { ...cloudBridge, ack: async () => { throw new Error('Cannot acknowledge'); } } });
    assert.equal((await replies(original)).length, 1);
    assert.equal(await acknowledged(original), false);
    success(await invoke(options('acknowledgement-run')), 1);
    assert.equal((await executions(original)).length, 1);
    assert.equal((await replies(original)).length, 1);
    assert.equal(await acknowledged(original), true);
  });

  await test('an interrupted started session needs explicit retry and is never relaunched automatically', async () => {
    const original = (await localBridge.send({ from: 'local', to: 'interrupted-run', body: 'Interrupted launcher session must not repeat silently.' })).message;
    const configuration = options('interrupted-run');
    const controller = new AbortController();
    const hanging = runner('hang');
    const running = invoke(configuration, { launch: hanging.launch, signal: controller.signal });
    await waitUntilLaunched(original);
    const interruptedState = await readFile(configuration.state);
    assert.equal(JSON.parse(interruptedState).records.find(record => record.source.id === original.id)?.stage, 'started');
    const stoppedAt = Date.now();
    controller.abort();
    await running;
    assert.ok(Date.now() - stoppedAt < 12_000, 'Aborted Codex ignored the bounded TERM/KILL deadline');
    assert.equal(await acknowledged(original), false);
    assert.equal((await replies(original)).length, 0);
    // A real process death skips its catch handler: preserve the on-disk started snapshot.
    await writeFile(configuration.state, interruptedState);
    success(await invoke(options('interrupted-run')), 0);
    assert.equal((await executions(original)).length, 1);
    success(await invoke(options('interrupted-run', { extra: ['--retry-failed'] })), 1);
    assert.equal((await executions(original)).length, 2);
    assert.equal((await replies(original)).length, 1);
    assert.equal(await acknowledged(original), true);
  });

  await test('nonzero exit and unusable final output cannot publish or acknowledge', async () => {
    for (const mode of ['nonzero-final', 'empty', 'oversized', 'invalid-utf8', 'symlink']) {
      const agent = `invalid-${mode}-run`;
      const original = (await localBridge.send({ from: 'local', to: agent, body: `Launcher invalid output fixture ${mode}.` })).message;
      await invoke(options(agent), { launch: runner(mode).launch });
      assert.equal((await executions(original)).length, 1);
      assert.equal((await replies(original)).length, 0);
      assert.equal(await acknowledged(original), false);
      success(await invoke(options(agent)), 0);
      assert.equal((await executions(original)).length, 1);
    }
  });

  await test('an oversized task cannot permanently block a valid request behind it', async () => {
    const oversized = (await localBridge.send({ from: 'local', to: 'input-bound-run', body: 'A'.repeat(16_385) })).message;
    const valid = (await localBridge.send({ from: 'local', to: 'input-bound-run', body: 'Valid launcher request after oversized task.' })).message;
    await invoke(options('input-bound-run'));
    await invoke(options('input-bound-run'));
    assert.equal((await executions(oversized)).length, 0);
    assert.equal(await acknowledged(oversized), false);
    assert.equal((await executions(valid)).length, 1);
    assert.equal(await acknowledged(valid), true);
    assert.equal((await replies(valid)).length, 1);
  });

  await test('a final result of exactly 32768 bytes fits with its mailbox marker and remains valid on restart', async () => {
    const original = (await localBridge.send({ from: 'local', to: 'output-bound-run', body: 'Exact output boundary fixture.' })).message;
    const bounded = 'x'.repeat(32_768);
    success(await invoke(options('output-bound-run'), { launch: runner('success', bounded).launch }), 1);
    const delivered = await replies(original);
    assert.equal(delivered.length, 1);
    assert.equal(Buffer.byteLength(delivered[0].body, 'utf8'), Buffer.byteLength(`${marker}\n`, 'utf8') + 32_768);
    assert.ok(delivered[0].body.endsWith(bounded));
    assert.equal(await acknowledged(original), true);
    success(await invoke(options('output-bound-run')), 0);
    assert.equal((await executions(original)).length, 1);
  });

  await test('a native execution timeout cannot acknowledge the task or retry it automatically', async () => {
    const original = (await localBridge.send({ from: 'local', to: 'timeout-run', body: 'Native Codex timeout fixture must stay pending.' })).message;
    const startedAt = Date.now();
    await invoke(options('timeout-run', { extra: ['--timeout', '10'] }), { launch: runner('hang').launch });
    assert.ok(Date.now() - startedAt < 22_000, 'Timed out Codex ignored the bounded TERM/KILL deadline');
    assert.equal((await executions(original)).length, 1);
    assert.equal((await replies(original)).length, 0);
    assert.equal(await acknowledged(original), false);
    success(await invoke(options('timeout-run')), 0);
    assert.equal((await executions(original)).length, 1);
  });

  await test('configured credentials in tasks or final output cannot reach Codex or durable reply drafts', async () => {
    const secret = 'TEST_AWS_SECRET_ACCESS_KEY_VALUE';
    const protectedEnvironment = { ...codexEnvironment, AWS_SECRET_ACCESS_KEY: secret };
    const input = (await localBridge.send({ from: 'local', to: 'secret-input-run', body: `Never execute this fixture credential: ${secret}` })).message;
    const inputOptions = options('secret-input-run');
    const inputOutcome = await invoke(inputOptions, { env: protectedEnvironment });
    assert.ok(inputOutcome.failure || inputOutcome.errors.length);
    assert.ok(![...inputOutcome.output, ...inputOutcome.errors, inputOutcome.failure?.message || ''].join('\n').includes(secret));
    assert.equal((await executions(input)).length, 0);
    assert.equal((await replies(input)).length, 0);
    assert.equal(await acknowledged(input), false);
    try { assert.ok(!(await readFile(inputOptions.state, 'utf8')).includes(secret)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }

    const output = (await localBridge.send({ from: 'local', to: 'secret-output-run', body: 'Fixture output credential must not be published.' })).message;
    const outputOptions = options('secret-output-run');
    const protectedRunner = createCodexRunner({ env: { ...protectedEnvironment, VIVE_CODEX_TEST_RESULT: secret } });
    const outputOutcome = await invoke(outputOptions, { launch: protectedRunner.launch, env: protectedEnvironment });
    assert.ok(outputOutcome.failure || outputOutcome.errors.length);
    assert.ok(![...outputOutcome.output, ...outputOutcome.errors, outputOutcome.failure?.message || ''].join('\n').includes(secret));
    assert.equal((await executions(output)).length, 1);
    assert.equal((await replies(output)).length, 0);
    assert.equal(await acknowledged(output), false);
    assert.ok(!(await readFile(outputOptions.state, 'utf8')).includes(secret));
  });

  await test('dangerous sandbox, resume, arbitrary executable and unbounded retry flags are refused', async () => {
    const before = (await audit()).filter(event => event.kind === 'exec').length;
    for (const extra of [
      ['--sandbox', 'danger-full-access'], ['--dangerously-bypass-approvals-and-sandbox'],
      ['--resume', 'last'], ['--last'], ['--worktree'], ['--codex', '/tmp/arbitrary'],
      ['--ignore-rules'], ['--timeout', '0'], ['--timeout', '901'],
      ['--allow-from', '*'], ['--allow-from', '../escape'], ['--max-messages', '1000'],
    ]) assert.throws(() => options('invalid-policy-run', { extra }), /option|sandbox|sender|agent|message|allow|invalid|maximum|unknown|timeout/i);
    assert.throws(() => parseCodexArgs(['--allow-from', 'local', '--retry-failed'], { cwd: cloud, env: codexEnvironment }), /once|retry/i);
    assert.equal((await audit()).filter(event => event.kind === 'exec').length, before);
  });

  await test('durable results are scoped to the agent, mailbox, repository and execution policy', async () => {
    const original = (await localBridge.send({ from: 'local', to: 'scoped-run', body: 'Launcher state scope must be preserved.' })).message;
    const configuration = options('scoped-run');
    success(await invoke(configuration), 1);
    const changed = [
      { ...configuration, agent: 'different-run' },
      { ...configuration, remote: path.join(temporary, 'different-mailbox.git') },
      { ...configuration, cwd: local },
      { ...configuration, sandbox: 'workspace-write' },
      { ...configuration, allowFrom: ['local', 'another-helper'] },
    ];
    for (const alteration of changed) {
      let launches = 0;
      const outcome = await invoke(alteration, { launch: async () => { launches++; return 'Unexpected scope reuse'; } });
      assert.ok(outcome.failure || outcome.errors.length, 'Changed state scope was silently reused');
      assert.equal(launches, 0);
    }
    assert.equal((await executions(original)).length, 1);
  });

  await test('launcher fixtures preserve dirty user files and the public website origin', async () => {
    assert.deepEqual(await snapshot(local), initialLocal);
    assert.deepEqual(await snapshot(cloud), initialCloud);
    assert.equal(await git(local, 'ls-remote', '--heads', 'origin'), initialWebsiteHeads);
  });

  console.log(`Codex bridge launcher tests passed (${passed} checks; fixture executable only, no paid calls).`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
