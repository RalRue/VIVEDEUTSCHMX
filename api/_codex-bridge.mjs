import { createHash, timingSafeEqual } from 'node:crypto';
import { isBridgeTimestamp, nativeReplyId } from '../lib/codex-bridge-protocol.mjs';

export const REPOSITORY = 'RalRue/VIVEDEUTSCHMX-CODEX-BRIDGE';
export const BRANCH = 'codex-bridge-v1';
export const MARKER = '[codex-bridge-run/v1]\n';
export const MAX_TASK_BYTES = 16_384;
const MAX_RESULT_BYTES = 32_768;
const MAX_RECORD_BYTES = 65_536 * 6 + 2_048;
const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024;
const MAX_RECORDS = 10_000;
const API_ROOT = `https://api.github.com/repos/${REPOSITORY}`;
const SCHEMA = 'codex-bridge/v1';
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export class BridgeError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

export function replyIdFor(taskId) { return nativeReplyId(taskId, 'cloud', 'local'); }

export function validId(value) {
  if (typeof value !== 'string' || !ID_RE.test(value)) throw new BridgeError(400, 'invalid_task_id');
  return value;
}

function fields(record, expected) {
  return record !== null && typeof record === 'object' && !Array.isArray(record)
    && Object.keys(record).length === expected.length && expected.every(name => Object.hasOwn(record, name));
}

function text(value, maximum) {
  return typeof value === 'string' && value.trim().length > 0 && !value.includes('\0')
    && Buffer.byteLength(value, 'utf8') <= maximum
    && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
}

function timestamp(value) {
  return isBridgeTimestamp(value);
}

function message(record) {
  if (!fields(record, ['schema', 'type', 'id', 'from', 'to', 'createdAt', 'replyTo', 'body'])
    || record.schema !== SCHEMA || record.type !== 'message' || !ID_RE.test(record.id)
    || !timestamp(record.createdAt) || !text(record.body, 65_536)
    || (record.replyTo !== null && !ID_RE.test(record.replyTo))
    || typeof record.from !== 'string' || !/^[a-z][a-z0-9._-]{0,63}$/.test(record.from) || record.from === 'all'
    || typeof record.to !== 'string' || !/^[a-z][a-z0-9._-]{0,63}$/.test(record.to)) {
    throw new BridgeError(502, 'mailbox_invalid_record');
  }
  return record;
}

function task(record, taskId) {
  message(record);
  if (record.id !== taskId || record.from !== 'local' || record.to !== 'cloud' || record.replyTo !== null
    || !text(record.body, MAX_TASK_BYTES)) throw new BridgeError(409, 'task_conflict');
  return record;
}

function reply(record, taskId, replyId) {
  message(record);
  if (record.id !== replyId || record.from !== 'cloud' || record.to !== 'local' || record.replyTo !== taskId
    || !record.body.startsWith(MARKER) || !text(record.body.slice(MARKER.length), MAX_RESULT_BYTES)) {
    throw new BridgeError(409, 'reply_conflict');
  }
  return record;
}

export function respond(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(status).json(body);
}

export function reportError(res, error) {
  return respond(res, error instanceof BridgeError ? error.status : 503,
    { error: error instanceof BridgeError ? error.code : 'bridge_unavailable' });
}

export function authorize(req, env) {
  const expected = env.VIVE_BRIDGE_ACTION_TOKEN;
  if (typeof expected !== 'string' || !/^[\x21-\x7e]{32,512}$/.test(expected)) throw new BridgeError(503, 'bridge_not_configured');
  const header = req.headers?.authorization;
  const supplied = typeof header === 'string' ? /^Bearer ([\x21-\x7e]{1,512})$/i.exec(header)?.[1] : null;
  if (!supplied || !timingSafeEqual(createHash('sha256').update(supplied).digest(), createHash('sha256').update(expected).digest())) {
    throw new BridgeError(401, 'unauthorized');
  }
  if (typeof env.VIVE_BRIDGE_GITHUB_TOKEN !== 'string' || !/^[\x21-\x7e]{1,512}$/.test(env.VIVE_BRIDGE_GITHUB_TOKEN)) {
    throw new BridgeError(503, 'bridge_not_configured');
  }
}

export function requestBody(req, keys) {
  const contentType = req.headers?.['content-type'];
  if (contentType !== undefined && (typeof contentType !== 'string' || !/^application\/json(?:\s*;.*)?$/i.test(contentType))) {
    throw new BridgeError(415, 'json_required');
  }
  let body = req.body;
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    if (Buffer.byteLength(body, 'utf8') > MAX_TASK_BYTES * 6 + 1_024) throw new BridgeError(413, 'request_too_large');
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(body))); }
    catch { throw new BridgeError(400, 'invalid_json'); }
  }
  if (!fields(body, keys)) throw new BridgeError(400, 'invalid_request');
  return body;
}

export function requestedTask(req) {
  if (req.query && Object.hasOwn(req.query, 'taskId')) {
    if (Object.keys(req.query).some(name => name !== 'taskId')) throw new BridgeError(400, 'invalid_request');
    return validId(req.query.taskId);
  }
  let url;
  try { url = new URL(req.url, 'https://bridge.invalid'); } catch { throw new BridgeError(400, 'invalid_request'); }
  if ([...url.searchParams.keys()].some(name => name !== 'taskId') || url.searchParams.getAll('taskId').length !== 1) throw new BridgeError(400, 'invalid_request');
  return validId(url.searchParams.get('taskId'));
}

export function validateSubmission(taskId, body, env) {
  validId(taskId);
  if (typeof body === 'string' && Buffer.byteLength(body, 'utf8') > MAX_TASK_BYTES) throw new BridgeError(413, 'task_too_large');
  if (!text(body, MAX_TASK_BYTES)) throw new BridgeError(400, 'invalid_task');
  if ([env.VIVE_BRIDGE_ACTION_TOKEN, env.VIVE_BRIDGE_GITHUB_TOKEN].some(secret => secret && body.includes(secret))) throw new BridgeError(400, 'sensitive_task');
}

export function validateAcknowledgement(taskId, replyId) {
  validId(taskId); validId(replyId);
  if (replyId !== replyIdFor(taskId)) throw new BridgeError(409, 'reply_conflict');
}

async function boundedJson(response, maximum) {
  const length = response.headers?.get?.('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > maximum) {
    await response.body?.cancel?.().catch(() => {});
    throw new BridgeError(502, 'mailbox_response_too_large');
  }
  let raw;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maximum) throw new BridgeError(502, 'mailbox_response_too_large');
        chunks.push(Buffer.from(value));
      }
      raw = Buffer.concat(chunks);
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  } else {
    raw = Buffer.from(await response.text(), 'utf8');
    if (raw.length > maximum) throw new BridgeError(502, 'mailbox_response_too_large');
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { throw new BridgeError(502, 'mailbox_invalid_response'); }
}

export function createMailbox({ fetchImpl = globalThis.fetch, env = process.env, now = () => new Date() } = {}) {
  const deadline = Date.now() + 20_000;
  async function github(method, path, body, maximum = 600 * 1024) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new BridgeError(503, 'mailbox_timeout');
    const controller = new AbortController();
    let timer;
    const timedOut = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new BridgeError(503, 'mailbox_timeout')); }, Math.min(5_000, remaining));
    });
    const operation = (async () => { try {
      const response = await fetchImpl(`${API_ROOT}${path}`, { method, redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${env.VIVE_BRIDGE_GITHUB_TOKEN}`,
          'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'VIVE-Codex-Bridge',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) throw new BridgeError(503, 'mailbox_unavailable');
      if (response.status === 404) { await response.body?.cancel?.().catch(() => {}); return { missing: true }; }
      if (response.status === 409 || response.status === 422) { await response.body?.cancel?.().catch(() => {}); return { conflict: true }; }
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel?.().catch(() => {});
        throw new BridgeError(503, 'mailbox_access_denied');
      }
      if (response.status < 200 || response.status >= 300) {
        await response.body?.cancel?.().catch(() => {});
        throw new BridgeError(503, 'mailbox_unavailable');
      }
      return { value: await boundedJson(response, maximum) };
    } catch (error) {
      if (error instanceof BridgeError) throw error;
      throw new BridgeError(503, controller.signal.aborted ? 'mailbox_timeout' : 'mailbox_unavailable');
    } })();
    try { return await Promise.race([operation, timedOut]); }
    finally { clearTimeout(timer); controller.abort(); }
  }

  async function privateRepository() {
    const result = await github('GET', '', undefined, 65_536);
    if (result.missing) throw new BridgeError(503, 'mailbox_access_denied');
    if (!result.value || result.value.full_name !== REPOSITORY || result.value.private !== true) throw new BridgeError(503, 'private_mailbox_required');
  }

  async function record(path, ref = BRANCH) {
    const result = await github('GET', `/contents/${path}?ref=${ref}`);
    if (result.missing) return null;
    const item = result.value;
    if (!item || item.type !== 'file' || item.path !== path || item.encoding !== 'base64'
      || !SHA_RE.test(item.sha) || !Number.isSafeInteger(item.size) || item.size < 0 || item.size > MAX_RECORD_BYTES
      || Object.hasOwn(item, 'target') || Object.hasOwn(item, 'submodule_git_url')
      || typeof item.content !== 'string' || item.content.length > Math.ceil(MAX_RECORD_BYTES / 3) * 4 + 16_384) {
      throw new BridgeError(502, 'mailbox_invalid_record');
    }
    const base64 = item.content.replace(/\n/g, '');
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new BridgeError(502, 'mailbox_invalid_record');
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length !== item.size || bytes.length > MAX_RECORD_BYTES) throw new BridgeError(502, 'mailbox_invalid_record');
    const sha = createHash(item.sha.length === 40 ? 'sha1' : 'sha256').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (sha !== item.sha) throw new BridgeError(502, 'mailbox_invalid_record');
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new BridgeError(502, 'mailbox_invalid_record'); }
  }

  async function budget(treeSha, additionalBytes, targetPath) {
    const result = await github('GET', `/git/trees/${treeSha}?recursive=1`, undefined, 4 * 1024 * 1024);
    const tree = result.value;
    if (result.missing) throw new BridgeError(503, 'mailbox_not_initialized');
    if (!tree || tree.sha !== treeSha || tree.truncated !== false || !Array.isArray(tree.tree) || tree.tree.length > MAX_RECORDS + 1_000) throw new BridgeError(503, 'mailbox_capacity_unconfirmed');
    let records = 0;
    let bytes = 0;
    for (const entry of tree.tree) {
      if (entry.type === 'tree') {
        if (entry.mode !== '040000' || !(entry.path === 'messages' || entry.path === 'acknowledgements'
          || /^acknowledgements\/[a-z][a-z0-9._-]{0,63}$/.test(entry.path))) throw new BridgeError(502, 'mailbox_invalid_tree');
        continue;
      }
      const parts = /^messages\/([0-9a-f-]+)\.json$/.exec(entry.path)
        || /^acknowledgements\/[a-z][a-z0-9._-]{0,63}\/([0-9a-f-]+)\.json$/.exec(entry.path);
      if (!parts || !ID_RE.test(parts[1]) || entry.type !== 'blob' || entry.mode !== '100644'
        || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_RECORD_BYTES) throw new BridgeError(502, 'mailbox_invalid_tree');
      records++; bytes += entry.size;
    }
    if (!tree.tree.some(entry => entry.path === targetPath)
      && (records >= MAX_RECORDS || bytes + additionalBytes > MAX_SNAPSHOT_BYTES)) throw new BridgeError(503, 'mailbox_capacity_reached');
    return tree.tree;
  }

  async function object(method, path, body) {
    const result = await github(method, path, body, 65_536);
    if (!result.value || !SHA_RE.test(result.value.sha)) throw new BridgeError(502, 'mailbox_invalid_response');
    return result.value;
  }

  async function immutable(path, value, same) {
    const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    for (let attempt = 0; attempt < 3; attempt++) {
      const existing = await record(path);
      if (existing !== null) { same(existing); return; }
      const reference = await github('GET', `/git/ref/heads/${BRANCH}`, undefined, 65_536);
      if (reference.missing) throw new BridgeError(503, 'mailbox_not_initialized');
      const ref = reference.value;
      if (!ref || ref.ref !== `refs/heads/${BRANCH}` || ref.object?.type !== 'commit' || !SHA_RE.test(ref.object.sha)) throw new BridgeError(502, 'mailbox_invalid_response');
      const tip = ref.object.sha;
      const parent = await object('GET', `/git/commits/${tip}`);
      if (parent.sha !== tip || !SHA_RE.test(parent.tree?.sha)) throw new BridgeError(502, 'mailbox_invalid_response');
      const tree = await budget(parent.tree.sha, bytes.length, path);
      if (tree.some(entry => entry.path === path)) {
        const pinned = await record(path, tip);
        if (pinned === null) throw new BridgeError(502, 'mailbox_invalid_record');
        same(pinned); return;
      }
      const blob = await object('POST', '/git/blobs', { content: bytes.toString('base64'), encoding: 'base64' });
      const expectedBlob = createHash(blob.sha.length === 40 ? 'sha1' : 'sha256').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      if (blob.sha !== expectedBlob) throw new BridgeError(502, 'mailbox_invalid_response');
      const nextTree = await object('POST', '/git/trees', { base_tree: parent.tree.sha, tree: [{ path, mode: '100644', type: 'blob', sha: blob.sha }] });
      const commit = await object('POST', '/git/commits', { message: `Codex bridge ${value.type} ${value.id}`, tree: nextTree.sha, parents: [tip] });
      if (commit.tree?.sha !== nextTree.sha || !Array.isArray(commit.parents) || commit.parents.length !== 1 || commit.parents[0]?.sha !== tip) {
        throw new BridgeError(502, 'mailbox_invalid_response');
      }
      let written;
      try { written = await github('PATCH', `/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: false }, 65_536); }
      catch (error) {
        // Network loss can hide a completed ref update. Confirm the exact record once.
        const recovered = await record(path);
        if (recovered !== null) { same(recovered); return; }
        throw error;
      }
      if (written.value) {
        if (written.value.ref !== `refs/heads/${BRANCH}` || written.value.object?.type !== 'commit'
          || written.value.object.sha !== commit.sha) throw new BridgeError(502, 'mailbox_invalid_response');
        const verified = await record(path);
        if (verified === null) throw new BridgeError(503, 'mailbox_write_unconfirmed');
        same(verified); return;
      }
      if (!written.conflict) throw new BridgeError(503, 'mailbox_write_unconfirmed');
    }
    throw new BridgeError(503, 'mailbox_busy');
  }

  return {
    privateRepository,
    async submit(taskId, body) {
      validateSubmission(taskId, body, env);
      const value = { schema: SCHEMA, type: 'message', id: taskId, from: 'local', to: 'cloud',
        createdAt: now().toISOString(), replyTo: null, body };
      await immutable(`messages/${taskId}.json`, value, existing => {
        task(existing, taskId);
        if (existing.body !== body) throw new BridgeError(409, 'task_conflict');
      });
    },
    async result(taskId) {
      validId(taskId);
      const source = await record(`messages/${taskId}.json`);
      if (source === null) throw new BridgeError(404, 'task_not_found');
      task(source, taskId);
      const id = replyIdFor(taskId);
      const response = await record(`messages/${id}.json`);
      if (response === null) return { taskId, status: 'queued' };
      reply(response, taskId, id);
      return { taskId, status: 'completed', result: response.body.slice(MARKER.length), replyId: id };
    },
    async acknowledge(taskId, replyId) {
      validateAcknowledgement(taskId, replyId);
      const result = await this.result(taskId);
      if (result.status !== 'completed' || result.replyId !== replyId) throw new BridgeError(409, 'reply_not_ready');
      const value = { schema: SCHEMA, type: 'acknowledgement', id: replyId, agent: 'local', createdAt: now().toISOString() };
      await immutable(`acknowledgements/local/${replyId}.json`, value, existing => {
        if (!fields(existing, ['schema', 'type', 'id', 'agent', 'createdAt']) || existing.schema !== SCHEMA
          || existing.type !== 'acknowledgement' || existing.id !== replyId || existing.agent !== 'local'
          || !timestamp(existing.createdAt)) throw new BridgeError(409, 'acknowledgement_conflict');
      });
    },
  };
}
