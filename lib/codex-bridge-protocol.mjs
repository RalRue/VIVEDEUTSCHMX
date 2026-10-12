import { createHash } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const AGENT = /^[a-z][a-z0-9._-]{0,63}$/;

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
