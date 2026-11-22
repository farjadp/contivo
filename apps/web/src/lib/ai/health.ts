/**
 * Per-process provider health (spec §2 "Error classification", Health column).
 *
 * billing / auth / model_gone  → unhealthy 15 min
 * rate_limit                   → cool-down = retry-after, capped at 60 s (30 s when not given)
 * server / overloaded / timeout / network → 30 s cool-down after 3 in a row
 * bad_request / invalid_output / refusal  → no change (the provider answered)
 *
 * After a cool-down ends the next call is the probe; while one probe is in
 * flight other calls still skip the provider. Any answer from the provider
 * (even a 400) ends the cool-down.
 */

import type { AiErrorClass, ProviderId } from './types';

export const CRITICAL_COOLDOWN_MS = 15 * 60_000;
export const RATE_LIMIT_COOLDOWN_CAP_MS = 60_000;
export const RATE_LIMIT_DEFAULT_COOLDOWN_MS = 30_000;
export const TRANSIENT_COOLDOWN_MS = 30_000;
export const TRANSIENT_STRIKES = 3;

export const CRITICAL_CLASSES: ReadonlySet<AiErrorClass> = new Set(['billing', 'auth', 'model_gone']);
const TRANSIENT_CLASSES: ReadonlySet<AiErrorClass> = new Set(['server', 'overloaded', 'timeout', 'network']);

interface ProviderState {
  coolingDownUntil: number;
  reason: AiErrorClass | null;
  lastErrorClass: AiErrorClass | null;
  lastErrorAt: number | null;
  transientStrikes: number;
  probeInFlight: boolean;
}

export interface HealthTransition {
  provider: ProviderId;
  /** The class that made it unhealthy, or 'recovered'. */
  change: AiErrorClass | 'recovered';
  coolingDownUntil: number | null;
}

export interface ProviderHealthView {
  healthy: boolean;
  coolingDownUntil: Date | null;
  reason: AiErrorClass | null;
  lastErrorClass: AiErrorClass | null;
  lastErrorAt: Date | null;
}

function freshState(): ProviderState {
  return {
    coolingDownUntil: 0,
    reason: null,
    lastErrorClass: null,
    lastErrorAt: null,
    transientStrikes: 0,
    probeInFlight: false,
  };
}

export class ProviderHealth {
  private readonly states = new Map<ProviderId, ProviderState>();

  constructor(private readonly now: () => number = Date.now) {}

  private state(provider: ProviderId): ProviderState {
    let s = this.states.get(provider);
    if (!s) {
      s = freshState();
      this.states.set(provider, s);
    }
    return s;
  }

  /** No side effects: is the provider usable right now (cool-down over, no probe running)? */
  isAvailable(provider: ProviderId): boolean {
    const s = this.state(provider);
    if (s.coolingDownUntil > this.now()) return false;
    return !(s.reason && s.probeInFlight);
  }

  /**
   * Claim the provider for an attempt. Returns false when it must be skipped.
   * After a cool-down the first claim becomes the probe.
   */
  claim(provider: ProviderId): boolean {
    if (!this.isAvailable(provider)) return false;
    const s = this.state(provider);
    if (s.reason) s.probeInFlight = true;
    return true;
  }

  view(provider: ProviderId): ProviderHealthView {
    const s = this.state(provider);
    const cooling = s.coolingDownUntil > this.now();
    return {
      healthy: !cooling,
      coolingDownUntil: cooling ? new Date(s.coolingDownUntil) : null,
      reason: cooling ? s.reason : null,
      lastErrorClass: s.lastErrorClass,
      lastErrorAt: s.lastErrorAt ? new Date(s.lastErrorAt) : null,
    };
  }

  /** The provider answered (success, or a 4xx/invalid output that proves it is reachable). */
  recordReachable(provider: ProviderId): HealthTransition | null {
    const s = this.state(provider);
    s.transientStrikes = 0;
    s.probeInFlight = false;
    if (!s.reason) return null;
    s.reason = null;
    s.coolingDownUntil = 0;
    return { provider, change: 'recovered', coolingDownUntil: null };
  }

  recordFailure(provider: ProviderId, errorClass: AiErrorClass, retryAfterMs?: number): HealthTransition | null {
    const now = this.now();
    const s = this.state(provider);
    s.lastErrorClass = errorClass;
    s.lastErrorAt = now;
    s.probeInFlight = false;

    if (!CRITICAL_CLASSES.has(errorClass) && !TRANSIENT_CLASSES.has(errorClass) && errorClass !== 'rate_limit') {
      return this.recordReachableKeepingError(provider);
    }

    let cooldownMs = 0;
    if (CRITICAL_CLASSES.has(errorClass)) {
      cooldownMs = CRITICAL_COOLDOWN_MS;
    } else if (errorClass === 'rate_limit') {
      cooldownMs = Math.min(retryAfterMs ?? RATE_LIMIT_DEFAULT_COOLDOWN_MS, RATE_LIMIT_COOLDOWN_CAP_MS);
    } else {
      s.transientStrikes += 1;
      if (s.transientStrikes >= TRANSIENT_STRIKES) {
        cooldownMs = TRANSIENT_COOLDOWN_MS;
        s.transientStrikes = 0;
      }
    }

    if (cooldownMs <= 0) {
      // Not (yet) unhealthy; a failed probe still restarts the cool-down below.
      if (!s.reason) return null;
      cooldownMs = TRANSIENT_COOLDOWN_MS;
    }

    const wasReason = s.reason;
    const wasUntil = s.coolingDownUntil;
    s.reason = errorClass;
    s.coolingDownUntil = Math.max(now + cooldownMs, wasUntil > now ? wasUntil : 0);
    if (wasReason === errorClass && wasUntil > now) return null; // already known, no new transition
    return { provider, change: errorClass, coolingDownUntil: s.coolingDownUntil };
  }

  private recordReachableKeepingError(provider: ProviderId): HealthTransition | null {
    const s = this.state(provider);
    const { lastErrorClass, lastErrorAt } = s;
    const transition = this.recordReachable(provider);
    s.lastErrorClass = lastErrorClass;
    s.lastErrorAt = lastErrorAt;
    return transition;
  }

  /** Restore a critical failure seen by an earlier process (DB event). Never shortens a cool-down. */
  restore(provider: ProviderId, errorClass: AiErrorClass, at: Date): void {
    const until = at.getTime() + CRITICAL_COOLDOWN_MS;
    const s = this.state(provider);
    if (until <= this.now() || until <= s.coolingDownUntil) return;
    s.reason = errorClass;
    s.coolingDownUntil = until;
    s.lastErrorClass = errorClass;
    s.lastErrorAt = at.getTime();
  }

  reset(): void {
    this.states.clear();
  }
}
