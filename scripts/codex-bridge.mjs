#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BRANCH = 'codex-bridge-v1';
export const SCHEMA = 'codex-bridge/v1';
export const DEFAULT_REMOTE = 'https://github.com/RalRue/VIVEDEUTSCHMX-CODEX-BRIDGE.git';
export const MAX_BODY_BYTES = 65_536;
const MAX_RECORD_BYTES = MAX_BODY_BYTES * 6 + 2_048;
const MAX_RECORDS = 10_000;
const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024;
const REMOTE_REF = `refs/heads/${BRANCH}`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const AGENT_RE = /^[a-z][a-z0-9._-]{0,63}$/;
const OBJECT_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const decoder = new TextDecoder('utf-8', { fatal: true });
const activeGitProcesses = new Set();
let interruptRequested = false;

export function validateAgent(value, { allowBroadcast = false } = {}) {
  if (typeof value !== 'string' || !AGENT_RE.test(value) || (!allowBroadcast && value === 'all')) {
    throw new Error('Agent names must be 1–64 lowercase letters, numbers, dots, underscores or hyphens, start with a letter; all is reserved for broadcast recipients.');
  }
  return value;
}

export function validateId(value) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw new Error('Message ID must be a lowercase UUID v4.');
  return value;
}

export function validateRemote(value) {
  if (typeof value !== 'string' || !value || value.length > 4_096 || value.startsWith('-') || /[\x00-\x20\x7f]/.test(value) || value.includes('::')) {
    throw new Error('Invalid mailbox remote. Use a Git remote name, HTTPS/SSH URL, or local repository path.');
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/^(?:https|ssh|file):\/\//i.test(value)) {
    throw new Error('Mailbox URLs must use HTTPS, SSH or file transport.');
  }
  if (/^(?:https|ssh|file):\/\//i.test(value)) {
    let url;
    try { url = new URL(value); } catch { throw new Error('Mailbox URL is invalid.'); }
    if (url.password || (url.protocol === 'https:' && url.username)) {
      throw new Error('Do not put credentials in a mailbox URL; use existing Git authentication.');
    }
  }
  return value;
}

function exactFields(record, fields) {
  return record !== null && typeof record === 'object' && !Array.isArray(record)
    && Object.keys(record).length === fields.length && fields.every(key => Object.hasOwn(record, key));
}

function validateDate(value) {
  if (typeof value !== 'string' || value.length !== 24 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error('Mailbox contains an invalid timestamp.');
  }
}

export function validateMessage(record) {
  if (!exactFields(record, ['schema', 'type', 'id', 'from', 'to', 'createdAt', 'replyTo', 'body'])
    || record.schema !== SCHEMA || record.type !== 'message') throw new Error('Mailbox contains an unsupported message record.');
  validateId(record.id);
  validateAgent(record.from);
  validateAgent(record.to, { allowBroadcast: true });
  validateDate(record.createdAt);
  if (record.replyTo !== null) validateId(record.replyTo);
  if (typeof record.body !== 'string' || !record.body.trim() || Buffer.byteLength(record.body, 'utf8') > MAX_BODY_BYTES
    || record.body.includes('\0') || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(record.body)) {
    throw new Error(`Messages must contain nonempty UTF-8 text of at most ${MAX_BODY_BYTES} bytes without NUL characters.`);
  }
  return record;
}

function validateAcknowledgement(record) {
  if (!exactFields(record, ['schema', 'type', 'id', 'agent', 'createdAt'])
    || record.schema !== SCHEMA || record.type !== 'acknowledgement') throw new Error('Mailbox contains an unsupported acknowledgement record.');
  validateId(record.id);
  validateAgent(record.agent);
  validateDate(record.createdAt);
  return record;
}

function encoded(record) {
  return Buffer.from(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

class GitFailure extends Error {
  constructor(code, timedOut = false) {
    super(timedOut ? 'Git operation timed out. Check connectivity and mailbox access, then retry.'
      : 'Git operation failed. Check the mailbox repository, Git authentication, network access and branch permissions.');
    this.code = code;
    this.timedOut = timedOut;
  }
}

function git(args, { input, maxBuffer = MAX_SNAPSHOT_BYTES + 2 * 1024 * 1024, timeout = 30_000, allowAfterInterrupt = false } = {}) {
  if (interruptRequested && !allowAfterInterrupt) return Promise.reject(new Error('Operation interrupted; check mailbox status before retrying.'));
  return new Promise((accept, reject) => {
    const child = execFile('git', ['--no-optional-locks', '-c', 'credential.interactive=false', '-c', 'core.hooksPath=/dev/null',
      '-c', 'commit.gpgsign=false', '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always',
      '-c', 'protocol.http.allow=always', '-c', 'protocol.ssh.allow=always', '-c', 'protocol.file.allow=always',
      '-c', 'protocol.ext.allow=never', ...args], {
      encoding: 'buffer', timeout, killSignal: 'SIGKILL', maxBuffer,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
    }, (error, stdout) => {
      activeGitProcesses.delete(child);
      if (error) reject(new GitFailure(error.code, error.killed === true));
      else accept(stdout);
    });
    activeGitProcesses.add(child);
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

async function remoteTip(remote) {
  let output;
  try {
    output = await git(['ls-remote', '--exit-code', '--heads', remote, REMOTE_REF], { maxBuffer: 16_384 });
  } catch (error) {
    if (error instanceof GitFailure && error.code === 2) return null;
    throw error;
  }
  const lines = output.toString('utf8').trim().split('\n');
  if (lines.length !== 1) throw new Error('Mailbox returned an unexpected branch response.');
  const [tip, ref] = lines[0].split(/\s+/);
  if (!OBJECT_RE.test(tip) || ref !== REMOTE_REF) throw new Error('Mailbox returned an invalid branch reference.');
  return tip;
}

async function readSnapshot(remote, privateRef) {
  const observed = await remoteTip(remote);
  const empty = { tip: null, entries: new Map(), messages: new Map(), acknowledgements: new Map() };
  if (observed === null) return empty;
  await git(['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', remote, `+${REMOTE_REF}:${privateRef}`]);
  const tip = (await git(['rev-parse', '--verify', privateRef], { maxBuffer: 1_024 })).toString('ascii').trim();
  if (!OBJECT_RE.test(tip)) throw new Error('Mailbox returned an invalid commit.');
  const listing = await git(['ls-tree', '-r', '-t', '-l', '-z', '--full-tree', tip], { maxBuffer: 4 * 1024 * 1024 });
  const entries = new Map();
  let totalBytes = 0;
  for (const line of listing.toString('utf8').split('\0').filter(Boolean)) {
    const match = /^(\d{6}) (blob|tree) ([0-9a-f]+)\s+([0-9]+|-)\t(.+)$/.exec(line);
    if (!match || !OBJECT_RE.test(match[3])) throw new Error('Mailbox tree contains an invalid entry.');
    const [, mode, type, oid, sizeText, path] = match;
    if (type === 'tree') {
      if (mode !== '040000' || !(path === 'messages' || path === 'acknowledgements'
        || /^acknowledgements\/[a-z][a-z0-9._-]{0,63}$/.test(path))) throw new Error('Mailbox contains an unexpected directory.');
      continue;
    }
    if (mode !== '100644' || (!/^messages\/[0-9a-f-]+\.json$/.test(path)
      && !/^acknowledgements\/[a-z][a-z0-9._-]{0,63}\/[0-9a-f-]+\.json$/.test(path))) {
      throw new Error('Mailbox contains an unexpected file; refusing to change it.');
    }
    const size = Number(sizeText);
    if (!Number.isSafeInteger(size) || size > MAX_RECORD_BYTES) throw new Error('Mailbox record exceeds the supported size.');
    totalBytes += size;
    entries.set(path, { oid, size });
    if (entries.size > MAX_RECORDS || totalBytes > MAX_SNAPSHOT_BYTES) throw new Error('Mailbox exceeds the supported snapshot limit; archive it before continuing.');
  }
  const messages = new Map();
  const acknowledgements = new Map();
  if (entries.size) {
    const batch = await git(['cat-file', '--batch'], {
      input: Buffer.from([...entries.values()].map(entry => entry.oid).join('\n') + '\n', 'ascii'),
    });
    let offset = 0;
    for (const [path, entry] of entries) {
      const newline = batch.indexOf(10, offset);
      if (newline < 0 || batch.subarray(offset, newline).toString('ascii') !== `${entry.oid} blob ${entry.size}`) {
        throw new Error('Mailbox object response is inconsistent.');
      }
      offset = newline + 1;
      const bytes = batch.subarray(offset, offset + entry.size);
      if (bytes.length !== entry.size || batch[offset + entry.size] !== 10) throw new Error('Mailbox object is incomplete.');
      offset += entry.size + 1;
      let record;
      try { record = JSON.parse(decoder.decode(bytes)); }
      catch { throw new Error('Mailbox contains invalid UTF-8 JSON.'); }
      if (path.startsWith('messages/')) {
        validateMessage(record);
        if (path !== `messages/${record.id}.json`) throw new Error('Mailbox message filename does not match its ID.');
        messages.set(record.id, record);
      } else {
        validateAcknowledgement(record);
        if (path !== `acknowledgements/${record.agent}/${record.id}.json`) throw new Error('Mailbox acknowledgement path does not match its record.');
        acknowledgements.set(`${record.agent}/${record.id}`, record);
      }
    }
    if (offset !== batch.length) throw new Error('Mailbox object response contains unexpected data.');
  }
  for (const acknowledgement of acknowledgements.values()) {
    const message = messages.get(acknowledgement.id);
    if (!message || (message.to !== acknowledgement.agent && message.to !== 'all')) {
      throw new Error('Mailbox contains an acknowledgement for an unrelated recipient or missing message.');
    }
  }
  for (const message of messages.values()) {
    if (message.replyTo !== null && !messages.has(message.replyTo)) throw new Error('Mailbox contains a reply to a missing message.');
  }
  return { tip, entries, messages, acknowledgements };
}

async function makeTree(entries) {
  const root = new Map();
  for (const [path, { oid }] of entries) {
    const parts = path.split('/');
    let directory = root;
    for (const name of parts.slice(0, -1)) {
      if (!directory.has(name)) directory.set(name, new Map());
      directory = directory.get(name);
    }
    directory.set(parts.at(-1), oid);
  }
  async function build(directory) {
    const records = [];
    for (const [name, value] of directory) {
      if (value instanceof Map) records.push(`040000 tree ${await build(value)}\t${name}\0`);
      else records.push(`100644 blob ${value}\t${name}\0`);
    }
    return (await git(['mktree', '-z'], { input: Buffer.from(records.join(''), 'utf8'), maxBuffer: 1_024 })).toString('ascii').trim();
  }
  return build(root);
}

async function makeCommit(snapshot, path, record) {
  const blob = (await git(['hash-object', '-w', '--stdin'], { input: encoded(record), maxBuffer: 1_024 })).toString('ascii').trim();
  const entries = new Map(snapshot.entries);
  entries.set(path, { oid: blob });
  const tree = await makeTree(entries);
  const args = ['-c', 'user.name=Codex Bridge', '-c', 'user.email=codex-bridge@localhost', 'commit-tree', tree];
  if (snapshot.tip) args.push('-p', snapshot.tip);
  args.push('-m', `Codex bridge ${record.type} ${record.id}`);
  return (await git(args, { maxBuffer: 1_024 })).toString('ascii').trim();
}

function sameMessage(left, right, { stableId = false } = {}) {
  const fields = ['schema', 'type', 'id', 'from', 'to', 'replyTo', 'body'];
  if (!stableId) fields.push('createdAt');
  return fields.every(key => left[key] === right[key]);
}

async function appendRecord(remote, privateRef, { path, record, check }) {
  let previousTip = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const snapshot = await readSnapshot(remote, privateRef);
    if (previousTip !== null && snapshot.tip !== previousTip) {
      if (snapshot.tip === null) throw new Error('Mailbox branch was deleted during this operation; retry after checking its history.');
      try { await git(['merge-base', '--is-ancestor', previousTip, snapshot.tip], { maxBuffer: 1_024 }); }
      catch { throw new Error('Mailbox history was rewritten during this operation; refusing to append.'); }
    }
    const existing = check(snapshot);
    if (existing) return existing;
    if (snapshot.entries.size >= MAX_RECORDS) throw new Error('Mailbox record limit reached; archive it before continuing.');
    const snapshotBytes = [...snapshot.entries.values()].reduce((total, entry) => total + entry.size, 0);
    if (snapshotBytes + encoded(record).length > MAX_SNAPSHOT_BYTES) {
      throw new Error('Mailbox snapshot size limit reached; archive it before continuing.');
    }
    const commit = await makeCommit(snapshot, path, record);
    try {
      await git(['push', '--quiet', remote, `${commit}:${REMOTE_REF}`]);
      return { alreadyPresent: false };
    } catch (error) {
      // A push can succeed remotely before its connection fails. Observe its result first.
      const current = await remoteTip(remote);
      if (current === commit) return { alreadyPresent: false };
      if (current === snapshot.tip) throw error;
      previousTip = snapshot.tip;
      // Jitter prevents cooperating writers from repeatedly colliding in lockstep.
      await new Promise(accept => setTimeout(accept, randomInt(20, 101) * (attempt + 1)));
    }
  }
  throw new Error('Mailbox kept changing during eight attempts. No messages were overwritten; retry the operation.');
}

async function readBody(path) {
  if (typeof path !== 'string' || !path || /[\x00-\x1f\x7f]/.test(path)) throw new Error('Provide a valid local message file path.');
  const absolute = resolve(path);
  const before = await lstat(absolute).catch(() => { throw new Error('Message file cannot be read.'); });
  if (!before.isFile()) throw new Error('Message input must be a regular file, not a directory or symbolic link.');
  if (before.size > MAX_BODY_BYTES) throw new Error(`Message file exceeds ${MAX_BODY_BYTES} bytes.`);
  let handle;
  try {
    handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const after = await handle.stat();
    if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino) throw new Error('Message file changed while opening it; retry.');
    const buffer = Buffer.alloc(MAX_BODY_BYTES + 1);
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await handle.read(buffer, count, buffer.length - count, null);
      if (!bytesRead) break;
      count += bytesRead;
    }
    if (count > MAX_BODY_BYTES) throw new Error(`Message file exceeds ${MAX_BODY_BYTES} bytes.`);
    try { return decoder.decode(buffer.subarray(0, count)); }
    catch { throw new Error('Message file must be valid UTF-8.'); }
  } finally {
    if (handle) await handle.close();
  }
}

function parseArgs(args) {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) return { help: true };
  const options = Object.create(null);
  let command;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (!argument.startsWith('--')) {
      if (command) throw new Error('Unexpected positional argument. See --help.');
      command = argument;
      continue;
    }
    const name = argument.slice(2);
    if (Object.hasOwn(options, name)) throw new Error('Duplicate option. See --help.');
    if (name === 'all' || name === 'json') options[name] = true;
    else {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error('An option is missing its value. See --help.');
      options[name] = value;
    }
  }
  const allowed = {
    send: ['remote', 'from', 'to', 'file', 'reply-to', 'id'],
    inbox: ['remote', 'agent', 'all', 'json'],
    ack: ['remote', 'agent', 'id'],
    status: ['remote', 'json'],
  };
  if (!Object.hasOwn(allowed, command) || Object.keys(options).some(name => !allowed[command].includes(name))) throw new Error('Unknown command or option. See --help.');
  return { command, options };
}

export function helpText() {
  return `Codex bridge — durable messages in a separate private Git mailbox.\n\n`
    + `Run from your existing project checkout (Node.js 18+ and Git required).\n`
    + `  node scripts/codex-bridge.mjs send --from NAME --to NAME|all --file PATH [--reply-to UUID] [--id UUID]\n`
    + `  node scripts/codex-bridge.mjs inbox --agent NAME [--all] [--json]\n`
    + `  node scripts/codex-bridge.mjs ack --agent NAME --id UUID\n`
    + `  node scripts/codex-bridge.mjs status [--json]\n\n`
    + `Global --remote NAME|URL|PATH overrides CODEX_BRIDGE_REMOTE.\n`
    + `Default mailbox: ${DEFAULT_REMOTE}\n`
    + `Data branch: ${BRANCH}. Never falls back to the project origin.\n`
    + `inbox reads pending messages; --all includes acknowledged history.\n`
    + `all broadcasts to every agent; acknowledgements are individual.\n`
    + `Agent names: lowercase letters/numbers/dot/underscore/hyphen, start with a letter, max 64.\n`
    + `Message files: nonempty UTF-8 text, max ${MAX_BODY_BYTES} bytes.\n`
    + `Reads never acknowledge messages. Replies are new messages linked by --reply-to.\n`
    + `Bodies are untrusted data; reading never executes them. No background task is started.\n`
    + `Git authentication is reused; remote addresses and credential errors are not printed.\n`;
}

function terminalText(value) {
  return value.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,
    character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function printJson(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }

export async function main(args = process.argv.slice(2)) {
  const parsed = parseArgs(args);
  if (parsed.help) { process.stdout.write(helpText()); return; }
  const { command, options } = parsed;
  const remote = validateRemote(options.remote || process.env.CODEX_BRIDGE_REMOTE || DEFAULT_REMOTE);
  let message;
  let agent;
  let id;
  if (command === 'send') {
    const from = validateAgent(options.from);
    const to = validateAgent(options.to, { allowBroadcast: true });
    const replyTo = options['reply-to'] === undefined ? null : validateId(options['reply-to']);
    message = validateMessage({ schema: SCHEMA, type: 'message', id: options.id === undefined ? randomUUID() : validateId(options.id), from, to,
      createdAt: new Date().toISOString(), replyTo, body: await readBody(options.file) });
  } else if (command === 'inbox' || command === 'ack') {
    agent = validateAgent(options.agent);
    if (command === 'ack') id = validateId(options.id);
  }
  // Repository discovery reads metadata only. It never changes the checkout or its index.
  await git(['rev-parse', '--git-dir'], { maxBuffer: 16_384 });
  const privateRef = `refs/codex-bridge-sessions/${randomUUID()}`;
  interruptRequested = false;
  const interrupt = signal => {
    interruptRequested = true;
    process.exitCode = signal === 'SIGINT' ? 130 : 143;
    for (const child of activeGitProcesses) child.kill('SIGTERM');
  };
  const onSigint = () => interrupt('SIGINT');
  const onSigterm = () => interrupt('SIGTERM');
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);
  try {
    if (command === 'send') {
      try {
        await appendRecord(remote, privateRef, {
          path: `messages/${message.id}.json`, record: message,
          check(snapshot) {
            const existing = snapshot.messages.get(message.id);
            if (existing) {
              if (!sameMessage(existing, message, { stableId: options.id !== undefined })) throw new Error('Message UUID collision; refusing to overwrite a record.');
              message = existing;
              return { alreadyPresent: true };
            }
            if (message.replyTo !== null && !snapshot.messages.has(message.replyTo)) throw new Error('Reply target does not exist in the mailbox.');
            return null;
          },
        });
      } catch (error) {
        const reason = error instanceof GitFailure || (error instanceof Error && error.code === undefined)
          ? error.message : 'Git or local file access failed.';
        throw new Error(`Send could not be confirmed for message ID ${message.id}. After connectivity errors, inspect inbox --all before resending. ${reason}`);
      }
      printJson({ id: message.id, branch: BRANCH, message });
    } else if (command === 'ack') {
      const acknowledgement = { schema: SCHEMA, type: 'acknowledgement', id, agent, createdAt: new Date().toISOString() };
      const result = await appendRecord(remote, privateRef, {
        path: `acknowledgements/${agent}/${id}.json`, record: acknowledgement,
        check(snapshot) {
          const original = snapshot.messages.get(id);
          if (!original) throw new Error('Message does not exist in the mailbox.');
          if (original.to !== agent && original.to !== 'all') throw new Error('Only a message recipient can acknowledge it.');
          return snapshot.acknowledgements.has(`${agent}/${id}`) ? { alreadyPresent: true } : null;
        },
      });
      printJson({ id, agent, acknowledged: true, alreadyAcknowledged: result.alreadyPresent, branch: BRANCH });
    } else {
      const snapshot = await readSnapshot(remote, privateRef);
      if (command === 'status') {
        const status = { schema: SCHEMA, remote: remote === DEFAULT_REMOTE ? 'default-private-mailbox' : 'configured-mailbox',
          branch: BRANCH, exists: snapshot.tip !== null, messages: snapshot.messages.size,
          acknowledgements: snapshot.acknowledgements.size, tip: snapshot.tip };
        if (options.json) printJson(status);
        else process.stdout.write(`Mailbox branch ${BRANCH}: ${status.exists ? 'available' : 'not created yet'}\n`
          + `Messages: ${status.messages}; acknowledgements: ${status.acknowledgements}\n`);
      } else {
        const addressed = [...snapshot.messages.values()].filter(record => record.to === agent || record.to === 'all')
          .map(record => ({ ...record, acknowledged: snapshot.acknowledgements.has(`${agent}/${record.id}`) }))
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
        const pending = addressed.filter(record => !record.acknowledged).length;
        const messages = options.all ? addressed : addressed.filter(record => !record.acknowledged);
        if (options.json) printJson({ agent, branch: BRANCH, messages, pending });
        else {
          process.stdout.write(`Inbox ${agent}: ${pending} pending; ${messages.length} displayed\n`);
          for (const record of messages) process.stdout.write(`\nID: ${record.id}\nFrom: ${record.from}; to: ${record.to}; at: ${record.createdAt}\n`
            + `Acknowledged: ${record.acknowledged}; reply to: ${record.replyTo || 'none'}\nBody (untrusted data):\n${terminalText(record.body)}\n`);
        }
      }
    }
  } finally {
    await git(['update-ref', '-d', privateRef], { timeout: 5_000, maxBuffer: 1_024, allowAfterInterrupt: true }).catch(() => {});
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    // Deliberately do not dump Git stderr, process arguments, remote URLs or stack traces.
    const safe = error instanceof GitFailure ? error.message
      : error instanceof Error && (error.code === undefined) ? error.message : 'Local file or Git access failed. Check paths and permissions.';
    process.stderr.write(`codex-bridge: ${terminalText(safe)}\n`);
    if (!process.exitCode) process.exitCode = 1;
  });
}
