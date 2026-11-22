/**
 * RememberWorkspace.tsx
 *
 * Renders nothing. Records the workspace this page is showing, so the next
 * visit to Connections without a workspaceId opens on it (B2).
 */

'use client';

import { useEffect } from 'react';

import { rememberWorkspace } from '@/lib/last-workspace';

export function RememberWorkspace({ workspaceId }: { workspaceId: string }) {
  useEffect(() => {
    rememberWorkspace(workspaceId);
  }, [workspaceId]);
  return null;
}
