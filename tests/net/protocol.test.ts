import { describe, expect, it } from 'vitest';
import { ChatInSchema, IntentSchema, TradeInSchema, decode } from '../../src/net/protocol';
import { checkText, maskProfanity, reservedName } from '../../src/server/chatfilter';
import { questEarnWireKey, utf8 } from '../../src/server/uuid';

describe('protocol', () => {
  it('accepts every legal intent shape and rejects forged ones', () => {
    expect(IntentSchema.safeParse({ type: 'walk', x: 3, y: 4 }).success).toBe(true);
    expect(IntentSchema.safeParse({ type: 'withdraw', index: 0, qty: 'all' }).success).toBe(true);
    expect(IntentSchema.safeParse({ type: 'setState', hp: 99 }).success).toBe(false);
    expect(IntentSchema.safeParse({ type: 'walk', x: 3, y: 4, hp: 99 }).success).toBe(false);
    expect(IntentSchema.safeParse({ type: 'walk', x: -1, y: 4 }).success).toBe(false);
    // Chat goes through the CHAT op online, never as an intent.
    expect(IntentSchema.safeParse({ type: 'chat', text: 'hi' }).success).toBe(false);
  });

  it('validates chat and trade bodies', () => {
    expect(ChatInSchema.safeParse({ ch: 'public', text: 'hello' }).success).toBe(true);
    expect(ChatInSchema.safeParse({ ch: 'public', text: '' }).success).toBe(false);
    expect(TradeInSchema.safeParse({ op: 'offer', slot: 0, qty: 'all' }).success).toBe(true);
    expect(TradeInSchema.safeParse({ op: 'give', tickets: 5 }).success).toBe(false);
  });

  it('decode returns null for non-JSON', () => {
    expect(decode('{nope')).toBeNull();
  });
});

describe('chat filter', () => {
  it('folds leetspeak, spacing and stretching', () => {
    expect(checkText('you f a g g 0 t').ok).toBe(false);
    expect(checkText('r3t4rd').ok).toBe(false);
    expect(checkText('niiiggerrr').ok).toBe(false);
  });

  it('does not block innocent words', () => {
    for (const ok of [
      'Niger is a country',
      'raccoon',
      'cocoon',
      'japan',
      'jet ski',
      "It's not $BITCON",
      'model citizen',
    ]) {
      expect(checkText(ok)).toEqual({ ok: true, text: ok });
    }
  });

  it('blocks links and wallet-shaped strings', () => {
    expect(checkText('go to example.com now')).toEqual({ ok: false, reason: 'link' });
    expect(checkText('www.something')).toEqual({ ok: false, reason: 'link' });
    expect(checkText('send to 0x52908400098527886E0F7030069857D2E4169EE7').ok).toBe(false);
    expect(checkText('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq').ok).toBe(false);
    expect(checkText('vitalik.eth').ok).toBe(false);
  });

  it('reserves the President, staff and cast names', () => {
    expect(reservedName('Obama')).toBe(true);
    expect(reservedName('0bama123')).toBe(true);
    expect(reservedName('President X')).toBe(true);
    expect(reservedName('Mod')).toBe(true);
    expect(reservedName('Modest')).toBe(false);
    expect(reservedName('GremlinFan')).toBe(false);
  });

  it('masks profanity on the client', () => {
    expect(maskProfanity('oh shit')).toBe('oh s***');
  });
});

describe('pure uuid', () => {
  it('matches TextEncoder for unicode', () => {
    for (const s of ['abc', 'héllo', '日本', '🙂 ok']) {
      expect([...utf8(s)]).toEqual([...new TextEncoder().encode(s)]);
    }
  });

  it('quest keys are stable UUIDv5', () => {
    expect(questEarnWireKey('pb:quest:quest_tutorial')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
