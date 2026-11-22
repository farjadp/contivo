/**
 * The transport the mocked `@/lib/ai` `runAiTask` delegates to during a unit.
 * Null between units, so a stray call fails loudly instead of reaching a
 * provider through the default (DB-backed) runner.
 */

import type { RunAiTask } from './types';

export const active: { route: RunAiTask | null } = { route: null };

export function setRoute(route: RunAiTask | null): void {
  active.route = route;
}
