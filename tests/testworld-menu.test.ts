import { describe, expect, it } from 'vitest';
import { AWAKENING } from '../src/config/balance';
import { choiceFromUrl, leaveTestWorldUrl, testWorldUrl } from '../src/ui/testworld';

const base = 'http://localhost:5173/play/peoples-bitcoin/?hub=1';

describe('test world menu URLs', () => {
  it('builds the loopback URL for each mode and keeps other parameters', () => {
    const awaken = new URL(testWorldUrl(base, { bots: 12, mode: 'awaken', pace: 5 }));
    expect(Object.fromEntries(awaken.searchParams)).toEqual({
      hub: '1',
      net: 'loopback',
      bots: '12',
      awaken: '1',
      pace: '5',
    });
    const silent = new URL(testWorldUrl(base, { bots: 4, mode: 'silent', pace: 5 }));
    expect(silent.searchParams.get('chat')).toBe('0');
    expect(silent.searchParams.has('awaken')).toBe(false);
    expect(silent.searchParams.has('pace')).toBe(false);
    const quick = new URL(testWorldUrl(base, { bots: 3, mode: 'quick', pace: 1 }));
    expect([...quick.searchParams.keys()].sort()).toEqual(['bots', 'hub', 'net']);
  });

  it('clamps the number of AI players to 0–99', () => {
    const at = (n: number) =>
      new URL(testWorldUrl(base, { bots: n, mode: 'quick', pace: 1 })).searchParams.get('bots');
    expect(at(500)).toBe('99');
    expect(at(-3)).toBe('0');
    expect(at(Number.NaN)).toBe('0');
  });

  it('reads the choice back from the URL, and leaving drops every test parameter', () => {
    const url = testWorldUrl(base, { bots: 20, mode: 'awaken', pace: 2 });
    expect(choiceFromUrl(url)).toEqual({ bots: 20, mode: 'awaken', pace: 2 });
    expect(choiceFromUrl(`${base}&net=loopback&awaken=1`)?.bots).toBe(AWAKENING.defaultBots);
    expect(choiceFromUrl(`${base}&net=loopback&chat=0`)?.mode).toBe('silent');
    expect(choiceFromUrl(base)).toBeNull();
    expect(leaveTestWorldUrl(`${url}&act=4`)).toBe(base);
  });
});
