import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parseWatchArgs, runWatcher } from './codex-bridge-watch.mjs';
import { nativeReplyId } from '../lib/codex-bridge-protocol.mjs';

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

  const stableId = '91919191-9191-4191-8191-919191919191';
  const stableFile = await payload('Stable correlated result.');
  const stableArgs = ['send', '--from', 'cloud', '--to', 'local', '--reply-to', first.id,
    '--id', stableId, '--file', stableFile];
  const stable = await bridge(cloud, ...stableArgs);
  const stableTip = (await bridge(cloud, 'status', '--json')).tip;
  const repeated = await bridge(local, ...stableArgs);
  assert.equal(repeated.id, stableId);
  assert.deepEqual(repeated.message, stable.message);
  assert.equal((await bridge(local, 'status', '--json')).tip, stableTip);
  await fails(local, [...stableArgs.slice(0, -1), await payload('Different result for same ID.')], /collision|overwrite/i);
  await fails(local, ['send', '--from', 'cloud', '--to', 'local', '--id', '../bad', '--file', stableFile], /UUID/i);
  console.log('PASS: stable IDs preserve immutable content and timestamp across retries and reject collisions');

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

  // Preserve completion of existing AI and differently named native workers
  // during migration from a snapshot that predates conservative reservations.
  const legacyWriter = path.join(temporary, 'legacy-writer');
  const legacyRemote = path.join(temporary, 'legacy-mailbox.git');
  await git(temporary, 'init', '--bare', '--initial-branch=main', legacyRemote);
  await git(temporary, 'init', '--initial-branch', branch, legacyWriter);
  await git(legacyWriter, 'config', 'user.name', 'Legacy Fixture');
  await git(legacyWriter, 'config', 'user.email', 'legacy@example.invalid');
  await mkdir(path.join(legacyWriter, 'messages'));
  const legacyIds = [];
  for (let index = 0; index < 171; index++) {
    const id = `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
    legacyIds.push(id);
    await writeFile(path.join(legacyWriter, 'messages', `${id}.json`), `${JSON.stringify({ ...first.message,
      id, from: 'local', to: index === 1 ? 'legacy-native' : 'legacy-ai', replyTo: null, body: 'Existing pending task' })}\n`);
  }
  await git(legacyWriter, 'add', '.');
  await git(legacyWriter, 'commit', '-m', 'Legacy overbooked mailbox fixture');
  await git(legacyWriter, 'push', legacyRemote, branch);
  const initialLegacyTip = await git(legacyRemote, 'rev-parse', branch);
  await fails(local, ['send', '--remote', legacyRemote, '--from', 'local', '--to', 'legacy-ai',
    '--file', await payload('New initial work must wait for migration')], /capacity/i);
  assert.equal(await git(legacyRemote, 'rev-parse', branch), initialLegacyTip);
  for (const [index, agent, marker] of [[0, 'legacy-ai', '[codex-bridge-ai/v1]'], [1, 'legacy-native', '[codex-bridge-run/v1]']]) {
    const sourceId = legacyIds[index];
    const result = await bridge(local, 'send', '--remote', legacyRemote, '--from', agent, '--to', 'local',
      '--reply-to', sourceId, '--file', await payload(`${marker}\nCached result without another model call`),
      ...(index === 1 ? ['--id', nativeReplyId(sourceId, agent, 'local')] : []));
    assert.equal((await bridge(local, 'ack', '--remote', legacyRemote, '--agent', agent, '--id', sourceId)).acknowledged, true);
    assert.equal((await bridge(local, 'ack', '--remote', legacyRemote, '--agent', 'local', '--id', result.id)).acknowledged, true);
  }
  assert.equal((await bridge(local, 'status', '--remote', legacyRemote, '--json')).messages, 173);
  await fails(local, ['send', '--remote', legacyRemote, '--from', 'local', '--to', 'legacy-ai',
    '--file', await payload('New initial work still requires migration')], /capacity/i);
  console.log('PASS: overbooked legacy AI and native tasks finish without admitting new work or changing old records');

  // Edit only the isolated transport branch to exercise existing immutable records.
  const corrupt = path.join(temporary, 'corrupt');
  await git(temporary, 'clone', '--single-branch', '--branch', branch, remote, corrupt);
  await git(corrupt, 'config', 'user.name', 'Bridge Test');
  await git(corrupt, 'config', 'user.email', 'bridge-test@example.invalid');
  await mkdir(path.join(corrupt, 'messages'), { recursive: true });
  const timestampRecords = [
    { id: 'e1111111-1111-4111-8111-111111111111', createdAt: '2026-10-13T01:31:00.001Z' },
    { id: 'f2222222-2222-4222-8222-222222222222', createdAt: '2026-10-13T01:31:00Z' },
    { id: 'd3333333-3333-4333-8333-333333333333', createdAt: '2026-10-13T01:31:00.000Z' },
  ].map(record => ({ ...first.message, ...record, from: 'cloud-control', to: 'zoohaus',
    replyTo: null, body: 'Synthetic Zoohaus coordination fixture.' }));
  const timestampAcknowledgements = [
    { schema: 'codex-bridge/v1', type: 'acknowledgement', id: timestampRecords[0].id,
      agent: 'zoohaus', createdAt: '2026-10-13T01:59:45.001Z' },
    { schema: 'codex-bridge/v1', type: 'acknowledgement', id: timestampRecords[1].id,
      agent: 'zoohaus', createdAt: '2026-10-13T01:59:45Z' },
  ];
  const timestampPaths = timestampRecords.map(record => `messages/${record.id}.json`);
  const acknowledgementPaths = timestampAcknowledgements.map(record => `acknowledgements/zoohaus/${record.id}.json`);
  await mkdir(path.join(corrupt, 'acknowledgements', 'zoohaus'), { recursive: true });
  for (const [index, record] of timestampRecords.entries()) {
    await writeFile(path.join(corrupt, timestampPaths[index]), `${JSON.stringify(record)}\n`);
  }
  for (const [index, record] of timestampAcknowledgements.entries()) {
    await writeFile(path.join(corrupt, acknowledgementPaths[index]), `${JSON.stringify(record)}\n`);
  }
  async function publishFixture(description) {
    await git(corrupt, 'add', '--all');
    await git(corrupt, 'commit', '-m', description);
    await git(corrupt, 'push', 'origin', branch);
  }
  await publishFixture('Inject mixed UTC-second and millisecond fixtures');
  const timestampIds = new Set(timestampRecords.map(record => record.id));
  const timestampInbox = (await inbox(local, 'zoohaus', true)).messages.filter(record => timestampIds.has(record.id));
  assert.deepEqual(timestampInbox.map(record => record.id),
    [timestampRecords[2].id, timestampRecords[1].id, timestampRecords[0].id],
    'Equal instants sort by ID, and the UTC-second instant precedes its .001Z successor');
  for (const record of timestampRecords) {
    assert.equal(timestampInbox.find(value => value.id === record.id)?.createdAt, record.createdAt);
  }
  assert.deepEqual(timestampInbox.map(record => record.acknowledged), [false, true, true]);
  assert.deepEqual((await inbox(cloud, 'zoohaus')).messages.filter(record => timestampIds.has(record.id)).map(record => record.id),
    [timestampRecords[2].id]);
  await inbox(cloud, 'cloud'); // A valid Zoohaus record must not block another agent's whole mailbox.
  const beforeTimestampRetry = (await git(remote, 'rev-parse', `refs/heads/${branch}`)).trim();
  const preserved = await bridge(local, 'send', '--from', 'cloud-control', '--to', 'zoohaus',
    '--id', timestampRecords[1].id, '--file', await payload(timestampRecords[1].body));
  assert.equal(preserved.message.createdAt, timestampRecords[1].createdAt);
  assert.equal((await bridge(cloud, 'ack', '--agent', 'zoohaus', '--id', timestampRecords[1].id)).alreadyAcknowledged, true);
  assert.equal((await git(remote, 'rev-parse', `refs/heads/${branch}`)).trim(), beforeTimestampRetry);
  assert.deepEqual(JSON.parse(await git(remote, 'show', `${branch}:${acknowledgementPaths[1]}`)), timestampAcknowledgements[1]);
  console.log('PASS: mixed UTC-second messages and ACKs preserve Zoohaus routing, immutable retries and chronological order');

  // Both message and ACK dates still reject impossible calendar days, without repairing remote data.
  for (const [filename, original] of [[timestampPaths[1], timestampRecords[1]],
    [acknowledgementPaths[1], timestampAcknowledgements[1]]]) {
    for (const createdAt of ['2026-02-30T01:31:00Z', '2025-02-29T01:31:00.000Z']) {
      await writeFile(path.join(corrupt, filename), `${JSON.stringify({ ...original, createdAt })}\n`);
      await publishFixture('Inject impossible calendar timestamp fixture');
      await fails(cloud, ['inbox', '--agent', 'cloud', '--json'], /invalid timestamp/i);
    }
    await writeFile(path.join(corrupt, filename), `${JSON.stringify(original)}\n`);
    await publishFixture('Restore valid timestamp fixture');
  }
  assert.equal((await inbox(local, 'zoohaus', true)).messages.filter(record => timestampIds.has(record.id)).length, 3);
  console.log('PASS: impossible calendar dates in messages and ACKs still reject the complete mailbox safely');

  // Corrupt the isolated transport branch explicitly, then verify strict remote validation.
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
