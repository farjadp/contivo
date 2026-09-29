/**
 * features.ts — the catalogue of everything Contivo does, as a customer sees it.
 *
 * The wording lives in the `features` message namespace, keyed by id; only the
 * facts live here.
 *
 * `status` is a promise about today, and it is the reason this file exists:
 *   live  — built, and a customer can use it
 *   soon  — designed, not built. Never listed as included.
 * Anything with a caveat the customer would care about carries `note`, whose
 * copy sits under `features.notes.<note>`.
 *
 * Which plan each feature lands on belongs with billing, which is not live;
 * it is added back here when the plan grid ships, not before.
 */

/** The six stages of the loop, the same spine as the app and the home page. */
export type Stage = 'know' | 'watch' | 'think' | 'make' | 'ship' | 'learn';

export const STAGES: readonly Stage[] = ['know', 'watch', 'think', 'make', 'ship', 'learn'];

export interface FeatureEntry {
  id: string;
  stage: Stage;
  status: 'live' | 'soon';
  /** Key under `features.notes` for a caveat worth saying out loud. */
  note?: string;
}

export const FEATURES: readonly FeatureEntry[] = [
  // 01 · Know
  { id: 'brandMemory', stage: 'know', status: 'live' },
  { id: 'brandAssets', stage: 'know', status: 'live' },
  { id: 'language', stage: 'know', status: 'live' },
  { id: 'brands', stage: 'know', status: 'live' },

  // 02 · Watch
  { id: 'discovery', stage: 'watch', status: 'live', note: 'discoveryChecked' },
  { id: 'validation', stage: 'watch', status: 'live' },
  { id: 'matrices', stage: 'watch', status: 'live', note: 'estimated' },
  { id: 'keywords', stage: 'watch', status: 'live' },
  { id: 'offerings', stage: 'watch', status: 'live' },
  { id: 'monitoring', stage: 'watch', status: 'soon' },

  // 03 · Think
  { id: 'lock', stage: 'think', status: 'live' },
  { id: 'narrative', stage: 'think', status: 'live' },
  { id: 'ideation', stage: 'think', status: 'live' },

  // 04 · Make
  { id: 'drafts', stage: 'make', status: 'live' },
  { id: 'sources', stage: 'make', status: 'live' },
  { id: 'humanize', stage: 'make', status: 'live' },
  { id: 'gate', stage: 'make', status: 'live' },
  { id: 'images', stage: 'make', status: 'live' },
  { id: 'imageTemplate', stage: 'make', status: 'soon' },
  { id: 'imageQuality', stage: 'make', status: 'soon' },
  { id: 'instant', stage: 'make', status: 'live' },

  // 05 · Ship
  { id: 'pipeline', stage: 'ship', status: 'live' },
  { id: 'calendar', stage: 'ship', status: 'live' },
  { id: 'website', stage: 'ship', status: 'live' },
  { id: 'social', stage: 'ship', status: 'live' },
  { id: 'socialMore', stage: 'ship', status: 'soon' },
  { id: 'autopilot', stage: 'ship', status: 'live' },
  { id: 'video', stage: 'ship', status: 'soon' },

  // 06 · Learn
  { id: 'runLog', stage: 'learn', status: 'live' },
  { id: 'report', stage: 'learn', status: 'live', note: 'reportTime' },
  { id: 'whiteLabel', stage: 'learn', status: 'soon' },
  { id: 'shareLinks', stage: 'learn', status: 'soon' },
];

export function featuresForStage(stage: Stage): FeatureEntry[] {
  return FEATURES.filter((f) => f.stage === stage);
}
