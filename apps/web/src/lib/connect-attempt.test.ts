import { describe, expect, it } from 'vitest';

import {
  CONNECT_ATTEMPT_KEY,
  CONNECT_ATTEMPT_MAX_AGE_MS,
  clearConnectAttempt,
  markConnectAttempt,
  readConnectAttempt,
} from './connect-attempt';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const T0 = 1_800_000_000_000;

describe('connect attempt', () => {
  it('round-trips a LinkedIn attempt', () => {
    const s = memoryStorage();
    markConnectAttempt('linkedin', 'ws-1', T0, s);
    expect(readConnectAttempt(T0 + 60_000, s)).toEqual({ platform: 'linkedin', workspaceId: 'ws-1', startedAt: T0 });
  });

  it('does not record platforms that never leave Contivo (Telegram)', () => {
    const s = memoryStorage();
    markConnectAttempt('telegram', 'ws-1', T0, s);
    expect(s.map.size).toBe(0);
  });

  it('expires after the max age and removes the record', () => {
    const s = memoryStorage();
    markConnectAttempt('linkedin', 'ws-1', T0, s);
    expect(readConnectAttempt(T0 + CONNECT_ATTEMPT_MAX_AGE_MS + 1, s)).toBeNull();
    expect(s.map.has(CONNECT_ATTEMPT_KEY)).toBe(false);
  });

  it('drops malformed records', () => {
    const s = memoryStorage();
    s.setItem(CONNECT_ATTEMPT_KEY, '{not json');
    expect(readConnectAttempt(T0, s)).toBeNull();
    expect(s.map.size).toBe(0);
    s.setItem(CONNECT_ATTEMPT_KEY, JSON.stringify({ platform: 'facebook', workspaceId: 'w', startedAt: T0 }));
    expect(readConnectAttempt(T0, s)).toBeNull();
    s.setItem(CONNECT_ATTEMPT_KEY, JSON.stringify({ platform: 'linkedin', workspaceId: '', startedAt: T0 }));
    expect(readConnectAttempt(T0, s)).toBeNull();
  });

  it('ignores a record from the future (clock skew)', () => {
    const s = memoryStorage();
    markConnectAttempt('linkedin', 'ws-1', T0 + 10_000, s);
    expect(readConnectAttempt(T0, s)).toBeNull();
  });

  it('clears', () => {
    const s = memoryStorage();
    markConnectAttempt('linkedin', 'ws-1', T0, s);
    clearConnectAttempt(s);
    expect(readConnectAttempt(T0, s)).toBeNull();
  });

  it('survives blocked storage', () => {
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(() => markConnectAttempt('linkedin', 'ws-1', T0, blocked)).not.toThrow();
    expect(readConnectAttempt(T0, blocked)).toBeNull();
    expect(() => clearConnectAttempt(blocked)).not.toThrow();
    expect(readConnectAttempt(T0, null)).toBeNull();
  });
});
