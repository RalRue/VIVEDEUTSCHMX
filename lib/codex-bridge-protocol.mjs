import { createHash } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const AGENT = /^[a-z][a-z0-9._-]{0,63}$/;
export const BRIDGE_MAX_RECORDS = 10_000;
export const BRIDGE_MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024;
export const NATIVE_MAX_RESULT_BYTES = 32_768;
export const NATIVE_REPLY_MARKER = '[codex-bridge-run/v1]\n';

export function hasReservedBridgePrefix(body) {
  return typeof body === 'string' && /^\s*\[codex-bridge-(?:ai|run)\/v1\]/.test(body);
}

function recordBytes(value) { return Buffer.byteLength(`${JSON.stringify(value, null, 2)}\n`, 'utf8'); }

const envelope = { schema: 'codex-bridge/v1', type: 'message', id: '00000000-0000-4000-8000-000000000000',
  from: 'cloud', to: 'local', createdAt: '2000-01-01T00:00:00.000Z',
  replyTo: '00000000-0000-4000-8000-000000000000', body: NATIVE_REPLY_MARKER };
// One UTF-8 byte can require six JSON bytes (for example, U+0001).
// The envelope includes indentation, marker, IDs, timestamp and final newline.
const MAX_NATIVE_REPLY_RECORD_BYTES = recordBytes(envelope) + NATIVE_MAX_RESULT_BYTES * 6;
const NATIVE_ACK_RECORD_BYTES = recordBytes({ schema: 'codex-bridge/v1', type: 'acknowledgement',
  id: envelope.id, agent: 'cloud', createdAt: envelope.createdAt });

function reservations(entries) {
  const ids = new Set();
  for (const path of entries.keys()) {
    const match = /^messages\/([0-9a-f-]+)\.json$/.exec(path);
    if (match && UUID.test(match[1])) ids.add(match[1]);
  }
  const replies = new Set([...ids].map(id => nativeReplyId(id, 'cloud', 'local')));
  const missing = new Map();
  const reserve = (path, bytes, sourceId, type) => {
    if (!entries.has(path)) missing.set(path, { bytes, sourceId, type });
  };
  for (const id of ids) {
    if (replies.has(id)) continue;
    const replyId = nativeReplyId(id, 'cloud', 'local');
    reserve(`messages/${replyId}.json`, MAX_NATIVE_REPLY_RECORD_BYTES, id, 'reply');
    reserve(`acknowledgements/cloud/${id}.json`, NATIVE_ACK_RECORD_BYTES, id, 'task-ack');
    reserve(`acknowledgements/local/${replyId}.json`, NATIVE_ACK_RECORD_BYTES, id, 'reply-ack');
  }
  return missing;
}

// Only paths and blob sizes are needed: Actions never scans private message bodies.
// Every non-result message is conservatively a possible local -> cloud task,
// including old coordination messages. Reserve its result and both ACKs.
export function bridgeAppendCapacity(entries, path, record, size) {
  const missing = reservations(entries);
  const reserved = missing.get(path);
  const completesReservation = reserved && (
    (reserved.type === 'reply' && record.type === 'message' && record.from === 'cloud' && record.to === 'local'
      && record.replyTo === reserved.sourceId && record.body.startsWith(NATIVE_REPLY_MARKER)
      && Buffer.byteLength(record.body.slice(NATIVE_REPLY_MARKER.length), 'utf8') <= NATIVE_MAX_RESULT_BYTES)
    || (reserved.type === 'task-ack' && record.type === 'acknowledgement' && record.agent === 'cloud' && record.id === reserved.sourceId)
    || (reserved.type === 'reply-ack' && record.type === 'acknowledgement' && record.agent === 'local'
      && path === `acknowledgements/local/${record.id}.json`));
  // A deliberately chosen task ID must not occupy another task's result path.
  if (reserved && !completesReservation) return { allowed: false, reason: 'reserved_path' };
  if (record.type === 'message' && !completesReservation
    && entries.has(`messages/${nativeReplyId(record.id, 'cloud', 'local')}.json`)) {
    return { allowed: false, reason: 'reserved_path' };
  }
  const projected = new Map(entries);
  projected.set(path, { size });
  const committedBytes = [...projected.values()].reduce((sum, entry) => sum + entry.size, 0);
  if (projected.size > BRIDGE_MAX_RECORDS || committedBytes > BRIDGE_MAX_SNAPSHOT_BYTES) {
    return { allowed: false, reason: 'hard_limit' };
  }
  const remaining = reservations(projected);
  const reservedBytes = [...remaining.values()].reduce((sum, entry) => sum + entry.bytes, 0);
  const fits = projected.size + remaining.size <= BRIDGE_MAX_RECORDS
    && committedBytes + reservedBytes <= BRIDGE_MAX_SNAPSHOT_BYTES;
  const beforeBytes = [...entries.values()].reduce((sum, entry) => sum + entry.size, 0);
  const beforeReservedBytes = [...missing.values()].reduce((sum, entry) => sum + entry.bytes, 0);
  const alreadyOverbooked = entries.size + missing.size > BRIDGE_MAX_RECORDS
    || beforeBytes + beforeReservedBytes > BRIDGE_MAX_SNAPSHOT_BYTES;
  // Legacy AI/other-agent workers also need to publish cached results and ACKs.
  // Only an already overbooked snapshot gets this migration exception; generic
  // replies must never consume guarantees in a quota-compliant snapshot.
  const legacyCompletion = alreadyOverbooked && (
    (record.type === 'message' && record.replyTo !== null && entries.has(`messages/${record.replyTo}.json`))
    || (record.type === 'acknowledgement' && entries.has(`messages/${record.id}.json`)));
  const allowed = fits || !!completesReservation || legacyCompletion;
  return { allowed, reason: allowed ? null : 'completion_reserve' };
}

// Both native ISO milliseconds and immutable UTC-second records are valid.
// Validate the calendar without rewriting the caller's original timestamp.
export function isBridgeTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const canonical = value.length === 20 ? `${value.slice(0, -1)}.000Z` : value;
  const instant = Date.parse(canonical);
  return Number.isFinite(instant) && new Date(instant).toISOString() === canonical;
}

// Stable native result paths let an Action retrieve one task without scanning
// private mailbox history. These IDs are correlation labels, never credentials.
export function nativeReplyId(sourceId, agent, recipient) {
  if (typeof sourceId !== 'string' || typeof agent !== 'string' || typeof recipient !== 'string'
      || !UUID.test(sourceId) || !AGENT.test(agent) || !AGENT.test(recipient)
      || agent === 'all' || recipient === 'all') throw new Error('Invalid native reply identity.');
  const bytes = createHash('sha256')
    .update(JSON.stringify(['codex-bridge-native-reply/v1', sourceId, agent, recipient]))
    .digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
