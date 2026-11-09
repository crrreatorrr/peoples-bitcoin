import { describe, expect, it, vi } from 'vitest';
import type { HubSdkEnv } from '@metaverse/hub-sdk';
import { createGameHub } from '../src/hub/bridge';

const seen = vi.hoisted(() => ({ env: undefined as HubSdkEnv | undefined }));

vi.mock('@metaverse/hub-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@metaverse/hub-sdk')>();
  return {
    ...actual,
    createHubSdk(env: HubSdkEnv = {}) {
      seen.env = env;
      return actual.createHubSdk({ ...env, useMock: true });
    },
  };
});

describe('createGameHub', () => {
  // The server refuses a ticket redeem without this key, and the game then reports nothing.
  it('passes the Nakama server key to the SDK', () => {
    createGameHub();
    expect(seen.env?.serverKey).toBe('defaultkey');
  });
});
