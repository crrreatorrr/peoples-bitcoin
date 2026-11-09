import { describe, expect, it } from 'vitest';
import { LoopbackTransport } from '../../src/net/loopbackTransport';
import { OP } from '../../src/net/protocol';
import { content } from '../helpers';

/** Runs the loopback for `loops` host loops and counts the chat lines we receive. */
async function chatLines(chat: boolean | undefined, loops: number): Promise<number> {
  const transport = new LoopbackTransport({ content: content(), bots: 8, chat, autoLoop: false });
  let lines = 0;
  transport.onMessage((op) => {
    if (op === OP.CHAT_OUT) lines++;
  });
  await transport.join();
  for (let i = 0; i < loops; i++) transport.pump();
  await transport.leave();
  return lines;
}

describe('loopback bots', () => {
  it('quick-chat by default', async () => {
    expect(await chatLines(undefined, 1500)).toBeGreaterThan(0);
  });

  it('never chat with chat: false', async () => {
    expect(await chatLines(false, 1500)).toBe(0);
  });
});
