#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { nativeReplyId } from '../lib/codex-bridge-protocol.mjs';

export const ACTION_ORIGIN = 'https://vive-deutsch-mx.vercel.app';
export const PROOF = 'VIVE_DOT_ACTION_OK';
export const SMOKE_BODY = `Reply only ${PROOF}. Do not use tools or inspect, read, or change files.`;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_POLLS = 8;
const RUN_BUDGET_MS = 120_000;
const KNOWN_ERRORS = new Set(['unauthorized', 'bridge_not_configured', 'task_not_found',
  'private_mailbox_required', 'mailbox_access_denied', 'mailbox_not_initialized', 'mailbox_unavailable',
  'mailbox_timeout', 'mailbox_busy', 'mailbox_write_unconfirmed', 'mailbox_capacity_reached',
  'mailbox_capacity_unconfirmed', 'task_conflict', 'reply_conflict', 'reply_not_ready']);

const HELP = `Usage: node --use-env-proxy scripts/smoke-codex-bridge-action.mjs [options]

  --check          Read-only hosted API check (default); submits no task
  --run            Submit one fixed technical task, poll, verify and acknowledge
  --task-id UUID    Resume a previous --run using its original task ID
  --help           Show this help

Secure environment binding: VIVE_BRIDGE_ACTION_TOKEN. Never pass its value as an argument.
Node 24 or newer is required. With a configured HTTP proxy, enable --use-env-proxy
or NODE_USE_ENV_PROXY=1. TLS verification stays enabled; redirects are rejected.
Host is fixed: https://vive-deutsch-mx.vercel.app

--run uses at most 8 result polls within 120 seconds. On an uncertain result,
keep the printed task ID and resume with --run --task-id UUID. Do not start a new ID.
The request needs an active Cloud worker; this script cannot wake a Codex chat.
`;

export function parseSmokeArgs(argv) {
  const options = { mode: 'check', help: false };
  let explicitMode;
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (seen.has(flag)) throw new Error('Duplicate option. See --help.');
    seen.add(flag);
    if (flag === '--help') options.help = true;
    else if (flag === '--run' || flag === '--check') {
      if (explicitMode) throw new Error('Use either --check or --run.');
      explicitMode = flag.slice(2);
      options.mode = explicitMode;
    } else if (flag === '--task-id') {
      const value = argv[++index];
      if (typeof value !== 'string' || !ID.test(value)) throw new Error('--task-id requires a lowercase UUID v4.');
      options.taskId = value;
    } else throw new Error('Unknown option. See --help.');
  }
  if (options.taskId && options.mode !== 'run') throw new Error('--task-id is only used with --run.');
  return options;
}

export function validateSmokeRuntime({ env = process.env, version = process.versions.node, execArgv = process.execArgv } = {}) {
  if (Number(version.split('.')[0]) < 24) throw new Error('Use Node 24 or newer for this verification.');
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0' || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('TLS verification must be enabled.');
  const debug = `${env.NODE_DEBUG ?? ''},${process.env.NODE_DEBUG ?? ''}`;
  if (debug.includes('*') || /(?:^|[,\s])(?:http2?|https|tls|net|undici|fetch)(?:[,\s]|$)/i.test(debug)) {
    throw new Error('Disable network NODE_DEBUG diagnostics before using the Action token.');
  }
  const hasProxy = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'].some(name => !!env[name]);
  const enabled = execArgv.includes('--use-env-proxy') || env.NODE_USE_ENV_PROXY === '1'
    || /(?:^|\s)--use-env-proxy(?:\s|$)/.test(env.NODE_OPTIONS ?? '');
  if (hasProxy && !enabled) throw new Error('A proxy is configured. Start Node with --use-env-proxy or NODE_USE_ENV_PROXY=1.');
  const token = env.VIVE_BRIDGE_ACTION_TOKEN;
  if (typeof token !== 'string' || !token || /[\u0000-\u0020\u007f]/.test(token)) {
    throw new Error('Configure VIVE_BRIDGE_ACTION_TOKEN securely in the runtime environment. Its value must not be entered in chat or command arguments.');
  }
}

async function readJson(response) {
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) throw new Error('Hosted API returned a non-JSON response.');
  const declared = response.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_RESPONSE_BYTES) throw new Error('Hosted API response exceeded the size limit.');
  const chunks = [];
  let size = 0;
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Hosted API returned an empty response.');
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('Hosted API response exceeded the size limit.');
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new Error('Hosted API returned invalid JSON.'); }
}

export function createActionClient({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const token = env.VIVE_BRIDGE_ACTION_TOKEN;
  if (typeof token !== 'string' || !token || /[\u0000-\u0020\u007f]/.test(token)) throw new Error('The secure VIVE_BRIDGE_ACTION_TOKEN binding is required.');
  async function request(resource, { method = 'GET', body, timeout = 10_000 } = {}) {
    try {
      const headers = { Accept: 'application/json', Authorization: `Bearer ${token}` };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await fetchImpl(new URL(resource, ACTION_ORIGIN), {
        method, headers, redirect: 'error', cache: 'no-store',
        signal: AbortSignal.timeout(Math.max(1, Math.min(10_000, Math.floor(timeout)))),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, value: await readJson(response) };
    } catch {
      // Fetch errors can contain credentials, URLs or upstream diagnostics.
      throw new Error('Hosted API request could not be confirmed. Keep the task ID; no new task was retried.');
    }
  }
  return {
    get: (taskId, timeout) => request(`/api/codex-bridge?taskId=${taskId}`, { timeout }),
    submit: (taskId, timeout) => request('/api/codex-bridge', { method: 'POST', body: { taskId, body: SMOKE_BODY }, timeout }),
    acknowledge: (taskId, replyId, timeout) => request('/api/codex-bridge-ack', { method: 'POST', body: { taskId, replyId }, timeout }),
  };
}

function apiReason(response) {
  return KNOWN_ERRORS.has(response?.value?.error) ? response.value.error : 'api_error';
}

function validResult(response, taskId) {
  if (response.status !== 200 || response.value?.taskId !== taskId) return false;
  if (response.value.status === 'queued') return Object.keys(response.value).length === 2;
  return response.value.status === 'completed' && Object.keys(response.value).length === 4
    && typeof response.value.result === 'string' && Buffer.byteLength(response.value.result, 'utf8') <= 32_768
    && typeof response.value.replyId === 'string' && response.value.replyId === nativeReplyId(taskId, 'cloud', 'local');
}

export async function runSmoke(options, dependencies = {}) {
  const client = dependencies.client ?? createActionClient();
  const output = dependencies.output ?? (record => new Promise((resolve, reject) => {
    process.stdout.write(`${JSON.stringify(record)}\n`, error => error ? reject(error) : resolve());
  }));
  const now = dependencies.now ?? Date.now;
  const pause = dependencies.pause ?? (milliseconds => delay(milliseconds));
  const taskId = options.taskId ?? (dependencies.uuid ?? randomUUID)();
  if (!ID.test(taskId)) throw new Error('A valid UUID v4 is required.');
  if (options.mode === 'check') {
    let response;
    try { response = await client.get(taskId, 10_000); }
    catch {
      await output({ event: 'check', status: 'unconfirmed', taskSubmitted: false });
      return 1;
    }
    const ready = response.status === 404 && response.value?.error === 'task_not_found';
    await output({ event: 'check', status: ready ? 'ready' : 'blocked', httpStatus: response.status,
      ...(ready ? {} : { reason: apiReason(response) }), taskSubmitted: false, modelVerified: false });
    return ready ? 0 : 1;
  }
  if (options.mode !== 'run') throw new Error('Use --check or --run.');
  const deadline = now() + RUN_BUDGET_MS;
  const remaining = () => Math.max(0, deadline - now());
  const uncertain = async stage => {
    await output({ event: 'uncertain', taskId, stage, resumeArgs: ['--run', '--task-id', taskId], acknowledged: false });
    return 1;
  };
  await output({ event: 'task_selected', taskId, resumed: !!options.taskId });
  let first;
  if (options.taskId) {
    try { first = await client.get(taskId, remaining()); } catch { return uncertain('resume_lookup'); }
    if (first.status !== 404 && !validResult(first, taskId)) return uncertain('resume_lookup');
    if (first.status === 404 && first.value?.error !== 'task_not_found') return uncertain('resume_lookup');
  }
  if (!first || first.status === 404) {
    let submitted;
    try { submitted = await client.submit(taskId, remaining()); }
    catch { return uncertain('submission'); }
    if (submitted.status !== 202 || submitted.value?.taskId !== taskId || submitted.value.status !== 'queued') {
      await output({ event: 'submission_unconfirmed', taskId, httpStatus: submitted.status, reason: apiReason(submitted) });
      return uncertain('submission');
    }
    await output({ event: 'queued', taskId });
    first = undefined;
  }
  for (let poll = 0; poll < MAX_POLLS && remaining() > 0; poll += 1) {
    let response = first;
    first = undefined;
    try { response ??= await client.get(taskId, remaining()); }
    catch { return uncertain('result_lookup'); }
    if (!validResult(response, taskId)) {
      await output({ event: 'result_unconfirmed', taskId, httpStatus: response.status, reason: apiReason(response) });
      return uncertain('result_lookup');
    }
    if (response.value.status === 'completed') {
      if (response.value.result.trim() !== PROOF) {
        await output({ event: 'result_mismatch', taskId, acknowledged: false });
        return 1;
      }
      let ack;
      try { ack = await client.acknowledge(taskId, response.value.replyId, remaining()); }
      catch { return uncertain('acknowledgement'); }
      if (ack.status !== 200 || ack.value?.taskId !== taskId || ack.value.replyId !== response.value.replyId || ack.value.acknowledged !== true) {
        return uncertain('acknowledgement');
      }
      await output({ event: 'verified', taskId, replyId: response.value.replyId, result: PROOF, acknowledged: true });
      return 0;
    }
    await output({ event: 'waiting', taskId, poll: poll + 1 });
    if (poll + 1 < MAX_POLLS && remaining() > 0) await pause(Math.min(15_000, remaining()));
  }
  return uncertain('waiting_for_worker');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseSmokeArgs(process.argv.slice(2));
    if (options.help) process.stdout.write(HELP);
    else {
      validateSmokeRuntime();
      process.exitCode = await runSmoke(options);
    }
  } catch {
    // Never print an arbitrary error containing a token or HTTP diagnostics.
    process.stderr.write('smoke-codex-bridge-action: Configuration or verification failed. Check --help, Node 24, proxy/TLS settings and the secure VIVE_BRIDGE_ACTION_TOKEN binding.\n');
    process.exitCode = 1;
  }
}
