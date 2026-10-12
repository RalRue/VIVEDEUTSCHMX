#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { hostname, homedir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const CORE_PATH = fileURLToPath(new URL('./codex-bridge.mjs', import.meta.url));
const STATE_SCHEMA = 'codex-bridge-watch/v1';
const MAX_MESSAGES = 10_000;
const MAX_STATE_BYTES = 2 * 1024 * 1024;

const HELP = `Usage: node scripts/codex-bridge-watch.mjs [options]

  --agent NAME       Inbox agent (default: local; "all" is reserved)
  --interval SECONDS Poll interval (default: 30; minimum: 5)
  --state PATH       Notification state (default: ~/.local/state/vive-codex-bridge/NAME.json)
  --remote URL|PATH  Pass an explicit private mailbox remote to the bridge CLI
  --once             Poll once, then exit (suitable for cron)
  --json             Emit JSON Lines instead of readable notifications
  --help             Show this help

Messages are data: this watcher never runs commands or acknowledges messages.
It cannot wake an inactive Codex chat. Keep one watcher per agent/state file.
CODEX_BRIDGE_REMOTE is inherited by the bridge CLI when --remote is omitted.
`;

function isAgent(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9._-]{0,63}$/.test(value) && value !== 'all';
}

export function parseWatchArgs(argv, { cwd = process.cwd(), home = homedir() } = {}) {
  const options = { agent: 'local', interval: 30, once: false, json: false, help: false, cwd };
  let state;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const equals = argument.indexOf('=');
    const flag = equals < 0 ? argument : argument.slice(0, equals);
    if (['--once', '--json', '--help'].includes(flag)) {
      if (equals >= 0) throw new Error(`${flag} does not accept a value.`);
      options[flag.slice(2)] = true;
      continue;
    }
    if (!['--agent', '--interval', '--state', '--remote'].includes(flag)) {
      throw new Error(`Unknown option: ${flag}`);
    }
    const value = equals < 0 ? argv[++index] : argument.slice(equals + 1);
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
    if (flag === '--agent') options.agent = value;
    if (flag === '--interval') options.interval = Number(value);
    if (flag === '--state') state = value;
    if (flag === '--remote') options.remote = value;
  }
  if (!isAgent(options.agent)) throw new Error('Invalid agent name; use lowercase letters, digits, ., _, or -, starting with a letter.');
  if (!Number.isFinite(options.interval) || options.interval < 5 || options.interval > 86_400) {
    throw new Error('--interval must be between 5 and 86400 seconds.');
  }
  options.state = path.resolve(cwd, state ?? path.join(home, '.local', 'state', 'vive-codex-bridge', `${options.agent}.json`));
  return options;
}

export async function readState(filename, agent) {
  let raw;
  try {
    const metadata = await fs.stat(filename);
    if (!metadata.isFile() || metadata.size > MAX_STATE_BYTES) throw new Error('State must be a regular file smaller than 2 MiB.');
    raw = await fs.readFile(filename, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return new Set();
    throw new Error(`Cannot read watcher state at ${filename}: ${error.message}`, { cause: error });
  }
  let state;
  try {
    state = JSON.parse(raw);
  } catch {
    throw new Error(`Watcher state at ${filename} is invalid JSON; preserve it before repairing or moving it.`);
  }
  if (state?.schema !== STATE_SCHEMA || state.agent !== agent || !Array.isArray(state.seen)
      || state.seen.length > MAX_MESSAGES || state.seen.some(id => typeof id !== 'string' || !id || id.length > 128)
      || new Set(state.seen).size !== state.seen.length) {
    throw new Error(`Watcher state at ${filename} has an invalid schema or belongs to a different agent.`);
  }
  return new Set(state.seen);
}

export async function writeState(filename, agent, seen) {
  await writeJsonAtomic(filename, { schema: STATE_SCHEMA, agent, seen: [...seen], updatedAt: new Date().toISOString() });
}

export async function writeJsonAtomic(filename, value) {
  const directory = path.dirname(filename);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.${path.basename(filename)}.${process.pid}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temporary, filename);
  } finally {
    await handle?.close().catch(() => {});
    await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

// A random owner filename lets only one contender remove a dead owner's marker.
// Contenders never remove an empty directory: the winner removes it after unlink.
export async function acquireStateLock(filename, { once, signal }) {
  const directory = `${filename}.lock`;
  await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + (once ? 60_000 : 2_000);
  while (!signal.aborted) {
    try {
      await fs.mkdir(directory, { mode: 0o700 });
      const ownerPath = path.join(directory, `owner-${randomUUID()}.json`);
      try {
        await fs.writeFile(ownerPath, JSON.stringify({ pid: process.pid, host: hostname() }), { flag: 'wx', mode: 0o600 });
      } catch (error) {
        await fs.rmdir(directory).catch(() => {});
        throw error;
      }
      return async () => {
        await fs.unlink(ownerPath);
        await fs.rmdir(directory);
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    let owners;
    try {
      owners = await fs.readdir(directory);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (owners.length === 1 && /^owner-[a-f0-9-]+\.json$/.test(owners[0])) {
      const ownerPath = path.join(directory, owners[0]);
      let owner;
      try {
        owner = JSON.parse(await fs.readFile(ownerPath, 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw new Error(`Cannot read watcher lock at ${directory}; check for a running watcher before repairing it.`);
      }
      if (!Number.isInteger(owner.pid) || owner.pid <= 0 || typeof owner.host !== 'string') {
        throw new Error(`Invalid watcher lock at ${directory}; check for a running watcher before repairing it.`);
      }
      if (owner.host === hostname() && !processIsAlive(owner.pid)) {
        try {
          await fs.unlink(ownerPath);
          await fs.rmdir(directory);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        continue;
      }
    } else if (owners.length !== 0) {
      throw new Error(`Unexpected files in watcher lock at ${directory}; preserve them before investigating.`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`Watcher state is locked at ${directory}. Check for a running watcher; remove a leftover lock only after confirming it is inactive.`);
    }
    await delay(100, undefined, { signal });
  }
  return null;
}

function validateInbox(inbox) {
  if (!inbox || !Array.isArray(inbox.messages) || inbox.messages.length > MAX_MESSAGES
      || !Number.isInteger(inbox.pending) || inbox.pending !== inbox.messages.length) {
    throw new Error('Bridge returned an invalid or incomplete pending inbox.');
  }
  const ids = new Set();
  for (const message of inbox.messages) {
    if (typeof message?.id !== 'string' || !message.id || message.id.length > 128 || ids.has(message.id)
        || typeof message.body !== 'string' || !isAgent(message.from)
        || typeof message.createdAt !== 'string' || message.acknowledged !== false) {
      throw new Error('Bridge returned an invalid or duplicate pending message.');
    }
    ids.add(message.id);
  }
  return ids;
}

async function fetchInbox(options, signal) {
  const args = [CORE_PATH, 'inbox', '--agent', options.agent, '--json'];
  if (options.remote) args.push('--remote', options.remote);
  let result;
  try {
    result = await execFileAsync(process.execPath, args, {
      cwd: options.cwd,
      timeout: 150_000,
      maxBuffer: 40 * 1024 * 1024,
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    // Child error.message contains command arguments; never echo remote credentials.
    const reason = error.killed ? 'timeout' : (error.signal ?? `exit code ${error.code ?? 'unknown'}`);
    throw new Error(`Bridge inbox failed (${reason}); run the bridge inbox command directly for its diagnostic.`, { cause: error });
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error('Bridge inbox did not return valid JSON.');
  }
}

function readable(value) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,
    character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export async function runWatcher(options, dependencies = {}) {
  const writeLine = (stream, line) => new Promise((resolve, reject) => {
    stream.write(`${line}\n`, error => error ? reject(error) : resolve());
  });
  const output = dependencies.stdout ?? (line => writeLine(process.stdout, line));
  const errors = dependencies.stderr ?? (line => writeLine(process.stderr, line));
  const controller = new AbortController();
  const signal = dependencies.signal ?? controller.signal;
  const stop = () => controller.abort();
  if (!dependencies.signal) {
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  }
  const emit = (event, fields = {}, error = false) => {
    const record = { event, agent: options.agent, ...fields };
    const target = error ? errors : output;
    if (options.json) return target(JSON.stringify(record));
    else if (event === 'message') {
      const message = fields.message;
      return target(`[${readable(message.createdAt)}] ${readable(message.from)} -> ${readable(options.agent)} (${readable(message.id)})\n${readable(message.body)}`);
    } else if (event === 'poll_error') {
      return target(`Inbox poll failed: ${fields.message}${options.once ? '' : ` Retrying in ${options.interval}s.`}`);
    }
    else if (event === 'poll') return target(`Pending: ${fields.pending}; new notifications: ${fields.newMessages}.`);
    else if (event === 'started') return target(`Watching inbox for ${options.agent} every ${options.interval}s. Messages require human handling.`);
    else if (event === 'stopped') return target(`Watcher for ${options.agent} stopped.`);
  };
  let release;
  try {
    release = await acquireStateLock(options.state, { once: options.once, signal });
    if (!release) return 0;
    let seen = await readState(options.state, options.agent);
    if (!options.once) await emit('started');
    while (!signal.aborted) {
      let inbox;
      let currentIds;
      try {
        inbox = await (dependencies.fetchInbox ?? fetchInbox)(options, signal);
        currentIds = validateInbox(inbox);
      } catch (error) {
        if (signal.aborted) break;
        await emit('poll_error', { message: error.message }, true);
        if (options.once) return 1;
        await delay(options.interval * 1000, undefined, { signal });
        continue;
      }
      const fresh = inbox.messages.filter(message => !seen.has(message.id));
      for (const message of fresh) await emit('message', { message });
      // Output precedes persistence: a crash can repeat a notification, but cannot
      // mark an unseen message as delivered. The watcher never acknowledges it.
      await writeState(options.state, options.agent, currentIds);
      seen = currentIds;
      if (options.once) {
        await emit('poll', { pending: inbox.pending, newMessages: fresh.length });
        return 0;
      }
      await delay(options.interval * 1000, undefined, { signal });
    }
    if (!options.once) await emit('stopped');
    return 0;
  } catch (error) {
    if (signal.aborted && error.name === 'AbortError') {
      if (!options.once) await emit('stopped');
      return 0;
    }
    throw error;
  } finally {
    await release?.();
    if (!dependencies.signal) {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseWatchArgs(process.argv.slice(2));
    if (options.help) process.stdout.write(HELP);
    else process.exitCode = await runWatcher(options);
  } catch (error) {
    process.stderr.write(`codex-bridge-watch: ${error.message}\n`);
    process.exitCode = 1;
  }
}
