/**
 * start-reconnect.ts
 *
 * The Reconnect button's flow, shared by the Connections page rows (Publish
 * Queue, Publish History): ask the API to restart the connection, then send
 * the browser to the provider sign-in. The OAuth callback updates the same
 * row back to CONNECTED.
 */

import { reconnectSocialConnection } from '@/app/actions/social';

import { socialActionDetail, type SocialActionDetail } from './social-action-error';

/**
 * Resolves to the error to show, or null once `navigate` was called with the
 * sign-in URL (keep the spinner on: the page is leaving).
 */
export async function startReconnect(
  connectionId: string,
  workspaceId: string,
  navigate: (url: string) => void = (url) => {
    window.location.href = url;
  },
): Promise<SocialActionDetail | null> {
  try {
    const result = await reconnectSocialConnection(connectionId, workspaceId);
    const url = result.data?.url;
    if (!url) return socialActionDetail(result) ?? { kind: 'message', key: 'api_error' };
    navigate(url);
    return null;
  } catch (err) {
    return err instanceof Error && err.message ? { kind: 'raw', text: err.message } : { kind: 'message', key: 'api_error' };
  }
}
