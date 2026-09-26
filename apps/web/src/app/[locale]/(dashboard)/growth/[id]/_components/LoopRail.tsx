import type { ReactNode } from 'react';
import { Check, Lock } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import type { LoopStage, StageId, StageState } from '@/lib/workspace-loop';

export type LoopTab = {
  key: string;
  label: string;
  /** Tooltip: the helper, or why the tab is locked. */
  title: string;
  icon: ReactNode;
  gated: boolean;
  /** A small live marker, e.g. autopilot running. */
  live?: boolean;
};

type Props = {
  workspaceId: string;
  stages: LoopStage[];
  activeStage: StageId;
  activeTab: string;
  tabs: LoopTab[];
  /** Pre-translated: stage names and one-line subtitles. */
  names: Record<StageId, string>;
  /** Stage numbers in the reader's digits ("01" / "۰۱"). */
  numbers: Record<StageId, string>;
  subs: Record<StageId, string>;
  stateLabels: Record<StageState, string>;
  navLabel: string;
  stagesLabel: string;
};

/**
 * The six-stage loop plus the active stage's own tabs.
 *
 * The top border carries the stage's state so the whole chain reads at a
 * glance: solid = done, dashed = still ahead, saffron = where you are.
 */
export function LoopRail({
  workspaceId,
  stages,
  activeStage,
  activeTab,
  tabs,
  names,
  numbers,
  subs,
  stateLabels,
  navLabel,
  stagesLabel,
}: Props) {
  const current = stages.find((s) => s.id === activeStage);
  const stageTabs = tabs.filter((t) => current?.tabs.includes(t.key));

  return (
    <div className="space-y-3">
      <nav aria-label={stagesLabel} className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <ol className="grid min-w-[720px] grid-cols-6 gap-2">
          {stages.map((stage) => {
            const isActive = stage.id === activeStage;
            return (
              <li key={stage.id}>
                <Link
                  href={{ pathname: '/growth/[id]', params: { id: workspaceId }, query: { tab: stage.landingTab } }}
                  aria-current={isActive ? 'step' : undefined}
                  className={cn(
                    'relative flex h-full min-h-[64px] flex-col gap-0.5 rounded-b-xl border-t-[3px] px-3.5 py-2.5 transition-colors',
                    isActive
                      ? 'border-saffron bg-moss text-chalk'
                      : stage.state === 'done'
                        ? 'border-moss-700 hover:bg-chalk-sunk'
                        : 'border-dashed border-rule-strong hover:bg-chalk-sunk',
                  )}
                >
                  <span
                    className={cn(
                      'flex items-center gap-1.5 whitespace-nowrap font-plexmono text-[12px]',
                      isActive ? 'text-saffron' : 'text-moss-muted',
                    )}
                  >
                    {numbers[stage.id]} · {names[stage.id]}
                    {stage.state === 'done' && <Check aria-hidden className="h-3.5 w-3.5" />}
                    {stage.state === 'locked' && <Lock aria-hidden className="h-3 w-3" />}
                    {stage.state === 'next' && (
                      <span aria-hidden className="h-1.5 w-1.5 rotate-45 bg-saffron" />
                    )}
                    <span className="sr-only">— {stateLabels[stage.state]}</span>
                  </span>
                  <span className={cn('text-[14px] font-semibold', isActive ? 'text-chalk' : 'text-moss')}>
                    {subs[stage.id]}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </nav>

      {stageTabs.length > 1 && (
        <nav aria-label={navLabel} className="flex flex-wrap gap-2">
          {stageTabs.map((tab) => {
            const isActive = tab.key === activeTab;
            return (
              <Link
                key={tab.key}
                href={{ pathname: '/growth/[id]', params: { id: workspaceId }, query: { tab: tab.key } }}
                title={tab.title}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'inline-flex h-10 items-center gap-2 rounded-full px-4 text-[13.5px] font-medium transition-colors',
                  isActive
                    ? 'bg-moss text-chalk'
                    : tab.gated
                      ? 'border border-rule text-moss-muted hover:border-rule-strong'
                      : 'border border-rule text-moss hover:border-rule-strong',
                )}
              >
                <span className={isActive ? 'text-saffron' : 'text-moss-muted'}>{tab.icon}</span>
                {tab.label}
                {tab.gated && <Lock aria-hidden className="h-3 w-3" />}
                {tab.live && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-saffron" />}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
