/**
 * UUIDv7 for earn batches and shop orders. UUIDv5 for quest rewards so the
 * same quest always resends the same key. The quest name format lives in
 * `questEarnName`; this file only turns that name into a UUID.
 */

import { formatUuid } from '../server/uuid';

export { QUEST_EARN_NAMESPACE, questEarnWireKey, uuidv5 } from '../server/uuid';

export function uuidv7(now = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const ts = BigInt(now);
  bytes[0] = Number((ts >> 40n) & 0xffn);
  bytes[1] = Number((ts >> 32n) & 0xffn);
  bytes[2] = Number((ts >> 24n) & 0xffn);
  bytes[3] = Number((ts >> 16n) & 0xffn);
  bytes[4] = Number((ts >> 8n) & 0xffn);
  bytes[5] = Number(ts & 0xffn);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  return formatUuid(bytes);
}
