import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reconnectMock } = vi.hoisted(() => ({ reconnectMock: vi.fn() }));
vi.mock('@/app/actions/social', () => ({ reconnectSocialConnection: reconnectMock }));

import { startReconnect } from './start-reconnect';

describe('startReconnect', () => {
  const navigate = vi.fn();
  beforeEach(() => {
    reconnectMock.mockReset();
    navigate.mockReset();
  });

  it('navigates to the provider sign-in and reports no error', async () => {
    reconnectMock.mockResolvedValueOnce({ data: { url: 'https://provider/auth' } });
    expect(await startReconnect('c1', 'w1', navigate)).toBeNull();
    expect(reconnectMock).toHaveBeenCalledWith('c1', 'w1');
    expect(navigate).toHaveBeenCalledWith('https://provider/auth');
  });

  it('an action error is localised, no navigation', async () => {
    reconnectMock.mockResolvedValueOnce({ error: 'x', code: 'reconnect_unsupported' });
    expect(await startReconnect('c1', 'w1', navigate)).toEqual({ kind: 'message', key: 'reconnect_unsupported' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('no url and no error still shows something', async () => {
    reconnectMock.mockResolvedValueOnce({});
    expect(await startReconnect('c1', 'w1', navigate)).toEqual({ kind: 'message', key: 'api_error' });
  });

  it('a thrown error becomes its message', async () => {
    reconnectMock.mockRejectedValueOnce(new Error('network down'));
    expect(await startReconnect('c1', 'w1', navigate)).toEqual({ kind: 'raw', text: 'network down' });
  });
});
