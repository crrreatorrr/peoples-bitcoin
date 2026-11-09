/**
 * Picks how this page plays. With a hub session (or `?net=loopback` for
 * development) the player sees world select and may join a world; otherwise,
 * or on "Play offline", the game runs standalone as before.
 */
import { realtimeFromSdk } from '@metaverse/hub-sdk';
import { AWAKENING, START_ZONE_ID } from '../config/balance';
import type { HubBridge } from '../hub/bridge';
import { HubTransport } from '../net/hubTransport';
import { SIM_VERSION } from '../net/simVersion';
import type { Transport } from '../net/transport';
import type { Content } from '../sim/content';
import { WorldSelect } from '../ui/worldselect';
import { OnlineDriver } from './onlineDriver';

const HUB_INIT_TIMEOUT_MS = 8000;
const WELCOME_TIMEOUT_MS = 10_000;
const ALREADY_ONLINE_RETRIES = 3;
const RETRY_DELAY_MS = 1500;

export interface OnlineSession {
  driver: OnlineDriver;
  world: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The transport for this page, or null when there is no way online. */
async function transportFor(content: Content, bridge: HubBridge): Promise<Transport | null> {
  const params = new URLSearchParams(window.location.search);
  if (params.get('net') === 'loopback') {
    // &awaken=1: bots play the awakening story (&pace=N speeds it up, &act=1..6 starts later).
    const awaken = params.get('awaken') === '1';
    const fallback = awaken ? AWAKENING.defaultBots : 3;
    const bots = Math.min(99, Math.max(0, Number(params.get('bots') ?? fallback) || 0));
    // &chat=0: bots only walk, so the chat stays empty (players only).
    const chat = params.get('chat') !== '0';
    const pace = Number(params.get('pace') ?? 1) || 1;
    const startAct = Number(params.get('act') ?? 1) || 1;
    // Dev only: the in-page server is its own chunk, so normal play never downloads it.
    const { LoopbackTransport } = await import('../net/loopbackTransport');
    return new LoopbackTransport({
      content,
      bots,
      chat,
      awaken: awaken ? { pace, startAct, seed: Date.now() % 100000 } : false,
    });
  }
  const outcome = await Promise.race([
    bridge.init().then(() => 'ok' as const),
    sleep(HUB_INIT_TIMEOUT_MS).then(() => 'timeout' as const),
  ]);
  if (outcome === 'timeout' || bridge.mode !== 'hub') return null;
  const rt = realtimeFromSdk(bridge.sdk);
  return rt ? new HubTransport(rt) : null;
}

function joinMessage(code: string): string {
  if (code.includes('world_full')) return 'That world is full. Pick another.';
  if (code.includes('already_online'))
    return 'You are still logged in on another world. Try again in a moment.';
  if (code.includes('not_game_session') || code.includes('no_session'))
    return 'Your hub session has ended. Return to the hub and enter again.';
  return `Could not join (${code}).`;
}

/** Joins and waits for WELCOME, retrying a few times while the old world logs us out. */
async function join(
  content: Content,
  transport: Transport,
  matchId: string,
  clock: () => number,
): Promise<OnlineDriver> {
  for (let attempt = 0; ; attempt++) {
    const driver = new OnlineDriver(content, START_ZONE_ID, transport, clock);
    try {
      const welcomed = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), WELCOME_TIMEOUT_MS);
        const stop = driver.kicked.add((reason) => {
          clearTimeout(timer);
          stop();
          reject(new Error(`match_rejected:${reason}`));
        });
        const poll = () => {
          if (driver.welcome) {
            clearTimeout(timer);
            stop();
            resolve();
          } else setTimeout(poll, 50);
        };
        poll();
      });
      await transport.join(matchId);
      await welcomed;
      return driver;
    } catch (err) {
      driver.dispose();
      const code = err instanceof Error ? err.message : String(err);
      if (code.includes('already_online') && attempt < ALREADY_ONLINE_RETRIES) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      throw new Error(code, { cause: err });
    }
  }
}

/** World select until the player joins a world (or picks offline: null). */
export async function chooseOnline(
  content: Content,
  bridge: HubBridge,
  clock: () => number,
): Promise<OnlineSession | null> {
  const transport = await transportFor(content, bridge);
  if (!transport) return null;
  const select = new WorldSelect(() => transport.listWorlds(), SIM_VERSION);
  let message: string | undefined;
  for (;;) {
    const choice = await select.choose(message);
    if (choice.kind === 'offline') {
      select.close();
      if (transport.kind === 'loopback') await transport.leave();
      return null;
    }
    select.setStatus(`Joining world ${choice.world.world}...`);
    try {
      const driver = await join(content, transport, choice.world.matchId, clock);
      select.close();
      return { driver, world: choice.world.world };
    } catch (err) {
      message = joinMessage(err instanceof Error ? err.message : String(err));
    }
  }
}
