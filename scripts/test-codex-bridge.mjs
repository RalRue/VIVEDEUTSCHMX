import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parseWatchArgs, runWatcher } from './codex-bridge-watch.mjs';

// Real Git transport, isolated local repositories: no network or real origin pushes.
const execute = promisify(execFile);
const cli = fileURLToPath(new URL('./codex-bridge.mjs', import.meta.url));
const watcher = fileURLToPath(new URL('./codex-bridge-watch.mjs', import.meta.url));
const branch = 'codex-bridge-v1';
const unknownId = '11111111-1111-4111-8111-111111111111';
const temporary = await mkdtemp(path.join(tmpdir(), 'vive-codex-bridge-test-'));
const environment = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: path.join(temporary, 'empty.gitconfig'),
  GIT_TERMINAL_PROMPT: '0',
};
await writeFile(environment.GIT_CONFIG_GLOBAL, '');

async function command(program, args, cwd, expectSuccess = true) {
  let result;
  try {
    result = { ...(await execute(program, args, {
      cwd,
      env: environment,
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    })), code: 0 };
  } catch (error) {
    result = { stdout: error.stdout || '', stderr: error.stderr || '', code: error.code };
    if (error.killed || typeof error.code !== 'number') throw error;
  }
  if (expectSuccess) {
    assert.equal(result.code, 0, `${program} ${args.join(' ')} failed:\n${result.stderr}\n${result.stdout}`);
  }
  return result;
}

async function git(cwd, ...args) {
  return (await command('git', args, cwd)).stdout;
}

async function bridge(cwd, ...args) {
  const { stdout } = await command(process.execPath, [cli, ...args], cwd);
  try {
    return JSON.parse(stdout);
  } catch {
    assert.fail(`CLI returned invalid JSON: ${stdout}`);
  }
}

async function fails(cwd, args, diagnostic) {
  const result = await command(process.execPath, [cli, ...args], cwd, false);
  assert.notEqual(result.code, 0, `Expected rejection: ${args.join(' ')}`);
  assert.match(result.stderr, diagnostic, `Missing useful error for ${args.join(' ')}`);
}

async function watchOnce(cwd, agent, stateFile) {
  const result = await command(process.execPath, [watcher, '--once', '--json', '--agent', agent, '--state', stateFile], cwd);
  return result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

let payloadNumber = 0;
async function payload(body) {
  const filename = path.join(temporary, `payload-${++payloadNumber}.txt`);
  await writeFile(filename, body);
  return filename;
}

async function send(cwd, from, to, body, replyTo) {
  const args = ['send', '--from', from, '--to', to, '--file', await payload(body)];
  if (replyTo) args.push('--reply-to', replyTo);
  return bridge(cwd, ...args);
}

async function inbox(cwd, agent, all = false) {
  return bridge(cwd, 'inbox', '--agent', agent, '--json', ...(all ? ['--all'] : []));
}

async function snapshot(cwd) {
  return {
    status: await git(cwd, 'status', '--porcelain=v1', '--untracked-files=all'),
    staged: await git(cwd, 'diff', '--cached', '--binary'),
    unstaged: await git(cwd, 'diff', '--binary'),
    tracked: await readFile(path.join(cwd, 'tracked.txt'), 'utf8'),
    stagedFile: await readFile(path.join(cwd, 'staged.txt'), 'utf8'),
    untracked: await readFile(path.join(cwd, 'user-notes.txt'), 'utf8'),
    head: (await git(cwd, 'rev-parse', 'HEAD')).trim(),
  };
}

async function dirty(cwd) {
  await writeFile(path.join(cwd, 'tracked.txt'), 'User worktree change\n');
  await writeFile(path.join(cwd, 'staged.txt'), 'User staged change\n');
  await git(cwd, 'add', 'staged.txt');
  await writeFile(path.join(cwd, 'staged.txt'), 'User staged and unstaged change\n');
  await writeFile(path.join(cwd, 'user-notes.txt'), 'User untracked notes\n');
}

try {
  const remote = path.join(temporary, 'private-mailbox.git');
  const websiteRemote = path.join(temporary, 'public-website.git');
  environment.CODEX_BRIDGE_REMOTE = remote;
  const local = path.join(temporary, 'local');
  const cloud = path.join(temporary, 'cloud');
  await git(temporary, 'init', '--bare', '--initial-branch=main', remote);
  await git(temporary, 'init', '--bare', '--initial-branch=main', websiteRemote);
  await git(temporary, 'clone', websiteRemote, local);
  await git(local, 'config', 'user.name', 'Bridge Test');
  await git(local, 'config', 'user.email', 'bridge-test@example.invalid');
  await writeFile(path.join(local, 'tracked.txt'), 'Original tracked file\n');
  await writeFile(path.join(local, 'staged.txt'), 'Original staged file\n');
  await git(local, 'add', 'tracked.txt', 'staged.txt');
  await git(local, 'commit', '-m', 'Test fixture');
  await git(local, 'push', 'origin', 'main');
  await git(temporary, 'clone', websiteRemote, cloud);
  await git(cloud, 'config', 'user.name', 'Bridge Test');
  await git(cloud, 'config', 'user.email', 'bridge-test@example.invalid');
  await dirty(local);
  await dirty(cloud);
  const initialLocal = await snapshot(local);
  const initialCloud = await snapshot(cloud);
  const initialWebsiteHeads = await git(local, 'ls-remote', '--heads', 'origin');

  const absent = await inbox(cloud, 'cloud');
  assert.deepEqual(absent.messages, []);
  assert.equal(absent.pending, 0);
  await bridge(local, 'status', '--json');
  await fails(local, ['ack', '--agent', 'local', '--id', unknownId], /message|exist|found/i);
  assert.equal((await git(local, 'ls-remote', '--heads', remote, `refs/heads/${branch}`)).trim(), '');
  console.log('PASS: reading an absent inbox does not create the remote branch');

  const firstWriters = await Promise.allSettled([
    send(local, 'local', 'startup.helper', 'First local write to the absent branch'),
    send(cloud, 'cloud', 'startup.helper', 'First cloud write to the absent branch'),
  ]);
  for (const result of firstWriters) {
    assert.equal(result.status, 'fulfilled', result.status === 'rejected' ? String(result.reason) : undefined);
  }
  assert.deepEqual((await inbox(local, 'startup.helper')).messages.map(message => message.id).sort(),
    firstWriters.map(result => result.value.id).sort());
  console.log('PASS: concurrent first writers create one mailbox without losing either message');

  const first = await send(local, 'local', 'cloud', 'Hallo Cloud! Grüße vom lokalen Codex.');
  assert.match(first.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(first.branch, branch);
  assert.equal(first.message.from, 'local');
  assert.equal(first.message.to, 'cloud');
  assert.equal(first.message.body, 'Hallo Cloud! Grüße vom lokalen Codex.');
  const delivered = await inbox(cloud, 'cloud');
  assert.equal(delivered.pending, 1);
  assert.equal(delivered.messages[0].id, first.id);
  assert.equal(delivered.messages[0].acknowledged, false);
  assert.deepEqual((await inbox(cloud, 'helper')).messages, []);
  assert.deepEqual((await inbox(local, 'local')).messages, []);

  const reply = await send(cloud, 'cloud', 'local', 'Hallo Lokal! Nachricht angekommen.', first.id);
  assert.equal(reply.message.replyTo, first.id);
  assert.equal((await inbox(local, 'local')).messages[0].id, reply.id);
  const helper = await send(local, 'local', 'helper.review', 'Bitte prüfe diese Übergabe.');
  assert.equal((await inbox(cloud, 'helper.review')).messages[0].id, helper.id);
  assert.equal((await inbox(cloud, 'cloud')).messages.length, 1);
  console.log('PASS: messages, replies and distinct helper inboxes cross two independent checkouts');

  const acknowledge = await bridge(cloud, 'ack', '--agent', 'cloud', '--id', first.id);
  assert.equal(acknowledge.acknowledged, true);
  assert.equal(acknowledge.alreadyAcknowledged, false);
  assert.deepEqual((await inbox(cloud, 'cloud')).messages, []);
  const history = await inbox(local, 'cloud', true);
  assert.equal(history.messages[0].acknowledged, true);
  const again = await bridge(local, 'ack', '--agent', 'cloud', '--id', first.id);
  assert.equal(again.alreadyAcknowledged, true);
  await fails(local, ['ack', '--agent', 'helper', '--id', first.id], /recipient|address|belong|acknowledg/i);
  console.log('PASS: acknowledgements persist across process restarts and another checkout');


  const broadcast = await send(cloud, 'cloud', 'all', 'Gemeinsame Übergabe für alle Helfer.');
  assert.ok((await inbox(cloud, 'cloud')).messages.some(message => message.id === broadcast.id));
  assert.ok((await inbox(local, 'local')).messages.some(message => message.id === broadcast.id));
  assert.ok((await inbox(local, 'helper.review')).messages.some(message => message.id === broadcast.id));
  await bridge(local, 'ack', '--agent', 'local', '--id', broadcast.id);
  assert.ok(!(await inbox(local, 'local')).messages.some(message => message.id === broadcast.id));
  assert.ok((await inbox(cloud, 'cloud')).messages.some(message => message.id === broadcast.id));
  assert.ok((await inbox(cloud, 'helper.review')).messages.some(message => message.id === broadcast.id));
  console.log('PASS: broadcasts reach helpers and acknowledgement belongs to each individual agent');

  const shortBody = await payload('Valid body');
  const beforeRejected = (await git(remote, 'rev-parse', `refs/heads/${branch}`)).trim();
  await fails(local, ['send', '--from', '../outside', '--to', 'cloud', '--file', shortBody], /from|name|agent|invalid/i);
  await fails(local, ['send', '--from', '-unsafe', '--to', 'cloud', '--file', shortBody], /from|name|agent|invalid|option/i);
  await fails(local, ['send', '--from', 'all', '--to', 'cloud', '--file', shortBody], /from|name|agent|reserved|all/i);
  await fails(local, ['inbox', '--agent', 'all', '--json'], /name|agent|reserved|all/i);
  await fails(local, ['status', '--remote', '-evil', '--json'], /remote|invalid|option/i);
  await fails(local, ['constructor'], /command|unknown|invalid/i);
  await fails(local, ['status', '--__proto__', 'polluted', '--json'], /option|unknown|invalid/i);
  const helperMarker = path.join(temporary, 'unsafe-remote-helper-ran');
  await git(local, 'config', 'protocol.ext.allow', 'always');
  await git(local, 'config', 'remote.unsafe-helper.url', `ext::touch ${helperMarker}`);
  await fails(local, ['status', '--remote', 'unsafe-helper', '--json'], /transport|protocol|denied|not allowed|invalid|remote|git/i);
  await assert.rejects(readFile(helperMarker), { code: 'ENOENT' });
  await fails(local, ['ack', '--agent', 'local', '--id', '../../tracked.txt'], /id|uuid|invalid/i);
  await fails(local, ['send', '--from', 'local', '--to', 'cloud', '--file', shortBody, '--reply-to', '../../tracked.txt'], /id|uuid|invalid|reply/i);
  await fails(local, ['send', '--from', 'local', '--to', 'cloud', '--file', shortBody, '--reply-to', unknownId], /reply|message|exist|found/i);
  await fails(local, ['send', '--from', 'local', '--to', 'cloud', '--file', await payload('ä'.repeat(32_769))], /large|size|65536|65,536|bytes|limit/i);
  await fails(local, ['send', '--from', 'local', '--to', 'cloud', '--file', await payload('')], /empty|body|message/i);
  await fails(local, ['send', '--from', 'local', '--to', 'cloud', '--file', await payload(Buffer.from([0xc3, 0x28]))], /utf.?8|encoding|valid/i);
  assert.equal((await git(remote, 'rev-parse', `refs/heads/${branch}`)).trim(), beforeRejected);
  console.log('PASS: invalid identities, IDs, nonexistent replies and invalid payloads cannot publish');
  const boundaryBody = 'ä'.repeat(32_768);
  const boundaryMessage = await send(local, 'local', 'limits.helper', boundaryBody);
  assert.equal(Buffer.byteLength(boundaryMessage.message.body, 'utf8'), 65_536);
  assert.ok((await inbox(cloud, 'limits.helper')).messages.some(message => message.id === boundaryMessage.id && message.body === boundaryBody), 'Boundary message body was not preserved');
  console.log('PASS: the UTF-8 payload byte limit accepts the exact supported boundary');

  const concurrent = await Promise.allSettled(Array.from({ length: 6 }, (_, index) =>
    send(index % 2 ? cloud : local, index % 2 ? 'cloud' : 'local', 'parallel.helper', `Parallel message ${index}`)));
  for (const result of concurrent) {
    assert.equal(result.status, 'fulfilled', result.status === 'rejected' ? String(result.reason) : undefined);
  }
  const sentIds = concurrent.map(result => result.value.id);
  assert.equal(new Set(sentIds).size, sentIds.length);
  const parallelInbox = await inbox(cloud, 'parallel.helper');
  const parallelMessages = parallelInbox.messages.filter(message => message.to === 'parallel.helper');
  assert.equal(parallelMessages.length, sentIds.length);
  assert.deepEqual(parallelMessages.map(message => message.id).sort(), [...sentIds].sort());
  console.log('PASS: simultaneous sends preserve every message when Git pushes race');

  const mixedWrites = await Promise.allSettled([
    ...Array.from({ length: 4 }, (_, index) => send(index % 2 ? cloud : local, 'local', 'parallel.helper', `Mixed race message ${index}`)),
    bridge(cloud, 'ack', '--agent', 'cloud', '--id', broadcast.id),
    bridge(local, 'ack', '--agent', 'helper.review', '--id', broadcast.id),
  ]);
  for (const result of mixedWrites) {
    assert.equal(result.status, 'fulfilled', result.status === 'rejected' ? String(result.reason) : undefined);
  }
  assert.equal((await inbox(local, 'parallel.helper')).messages.filter(message => message.to === 'parallel.helper').length, sentIds.length + 4);
  assert.ok(!(await inbox(cloud, 'cloud')).messages.some(message => message.id === broadcast.id));
  assert.ok(!(await inbox(local, 'helper.review')).messages.some(message => message.id === broadcast.id));
  console.log('PASS: simultaneous message and acknowledgement writes preserve both mutation types');

  assert.deepEqual(await snapshot(local), initialLocal);
  assert.deepEqual(await snapshot(cloud), initialCloud);
  assert.equal(await git(local, 'ls-remote', '--heads', 'origin'), initialWebsiteHeads);
  console.log('PASS: checkout HEAD, staged changes, worktree changes and untracked user files remain unchanged');
  console.log('PASS: the website origin receives no messages or acknowledgement branch');

  await bridge(local, 'ack', '--agent', 'watch.helper', '--id', broadcast.id);
  const stateFile = path.join(temporary, 'watcher-state.json');
  const watchMessage = await send(local, 'local', 'watch.helper', 'Einmalige Benachrichtigung für den Helfer.');
  const firstPoll = await watchOnce(cloud, 'watch.helper', stateFile);
  const firstNotifications = firstPoll.filter(event => event.event === 'message');
  assert.equal(firstNotifications.length, 1);
  assert.equal(firstNotifications[0].message.id, watchMessage.id);
  assert.ok(firstPoll.some(event => event.event === 'poll' && event.newMessages === 1));
  const nextPoll = await watchOnce(local, 'watch.helper', stateFile);
  assert.equal(nextPoll.filter(event => event.event === 'message').length, 0);
  const watchedInbox = await inbox(local, 'watch.helper');
  assert.equal(watchedInbox.messages.length, 1);
  assert.equal(watchedInbox.messages[0].acknowledged, false);
  const validState = await readFile(stateFile);
  await writeFile(stateFile, '{ corrupted state');
  const brokenState = await command(process.execPath, [watcher, '--once', '--json', '--agent', 'watch.helper', '--state', stateFile], cloud, false);
  assert.notEqual(brokenState.code, 0);
  assert.match(brokenState.stderr, /state|json|invalid|corrupt/i);
  assert.ok(!brokenState.stdout.includes(watchMessage.id));
  await writeFile(stateFile, validState);
  const nextWatchMessage = await send(cloud, 'cloud', 'watch.helper', 'Gleichzeitige Watcher benachrichtigen einmal.');
  const simultaneousPolls = await Promise.allSettled([
    watchOnce(local, 'watch.helper', stateFile),
    watchOnce(cloud, 'watch.helper', stateFile),
  ]);
  for (const result of simultaneousPolls) {
    assert.equal(result.status, 'fulfilled', result.status === 'rejected' ? String(result.reason) : undefined);
  }
  const simultaneousNotifications = simultaneousPolls.flatMap(result => result.value).filter(event => event.event === 'message');
  assert.deepEqual(simultaneousNotifications.map(event => event.message.id), [nextWatchMessage.id]);
  assert.ok((await inbox(cloud, 'watch.helper')).messages.every(message => message.acknowledged === false));
  console.log('PASS: watcher notifications survive restart, reject corrupt state, serialize concurrent polls and never auto-ack');

  const deliveryState = path.join(temporary, 'watcher-output-failure.json');
  const deliveryOptions = parseWatchArgs(['--once', '--json', '--agent', 'watch.helper', '--state', deliveryState], { cwd: cloud });
  const deliveryInbox = { messages: [{ ...watchMessage.message, acknowledged: false }], pending: 1 };
  await assert.rejects(runWatcher(deliveryOptions, {
    fetchInbox: async () => deliveryInbox,
    stdout: async () => { throw new Error('EPIPE: simulated closed output stream'); },
    stderr: async () => {},
  }), /EPIPE/);
  await assert.rejects(readFile(deliveryState), { code: 'ENOENT' });
  const recoveredNotifications = [];
  assert.equal(await runWatcher(deliveryOptions, {
    fetchInbox: async () => deliveryInbox,
    stdout: async line => { recoveredNotifications.push(JSON.parse(line)); },
    stderr: async () => {},
  }), 0);
  assert.deepEqual(recoveredNotifications.filter(event => event.event === 'message').map(event => event.message.id), [watchMessage.id]);
  console.log('PASS: failed notification output cannot silently mark the message as delivered');

  // Corrupt the isolated transport branch explicitly, then verify strict remote validation.
  const corrupt = path.join(temporary, 'corrupt');
  await git(temporary, 'clone', '--single-branch', '--branch', branch, remote, corrupt);
  await git(corrupt, 'config', 'user.name', 'Bridge Test');
  await git(corrupt, 'config', 'user.email', 'bridge-test@example.invalid');
  await mkdir(path.join(corrupt, 'messages'), { recursive: true });
  const corruptFile = path.join(corrupt, 'messages', `${unknownId}.json`);
  await writeFile(corruptFile, '{ invalid json');
  await git(corrupt, 'add', `messages/${unknownId}.json`);
  await git(corrupt, 'commit', '-m', 'Inject malformed remote fixture');
  await git(corrupt, 'push', 'origin', branch);
  await fails(local, ['inbox', '--agent', 'cloud', '--json'], /invalid|malformed|json|message/i);

  await writeFile(corruptFile, JSON.stringify({ ...first.message, id: first.id }));
  await git(corrupt, 'add', `messages/${unknownId}.json`);
  await git(corrupt, 'commit', '-m', 'Inject remote path and ID mismatch');
  await git(corrupt, 'push', 'origin', branch);
  await fails(cloud, ['inbox', '--agent', 'cloud', '--json'], /invalid|mismatch|id|path|message/i);
  await rm(corruptFile);
  const orphanAcknowledgement = path.join(corrupt, 'acknowledgements', 'helper', `${unknownId}.json`);
  await mkdir(path.dirname(orphanAcknowledgement), { recursive: true });
  await writeFile(orphanAcknowledgement, JSON.stringify({
    schema: 'codex-bridge/v1', type: 'acknowledgement', id: unknownId, agent: 'helper', createdAt: new Date().toISOString(),
  }));
  await git(corrupt, 'add', '--all');
  await git(corrupt, 'commit', '-m', 'Inject acknowledgement without a message');
  await git(corrupt, 'push', 'origin', branch);
  await fails(local, ['inbox', '--agent', 'cloud', '--json'], /acknowledg|exist|unknown|message/i);
  assert.deepEqual(await snapshot(local), initialLocal);
  assert.deepEqual(await snapshot(cloud), initialCloud);
  console.log('PASS: malformed remote records and filename/ID mismatches are rejected safely');
  console.log('Codex bridge integration tests passed.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
