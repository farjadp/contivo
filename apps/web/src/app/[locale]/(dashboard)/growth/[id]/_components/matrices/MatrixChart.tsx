'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Pencil } from 'lucide-react';

import { bandRect, cornerLabels, scoreToPercent, type AxisEnds } from './chart-geometry';
import { companyKey, type ChartView, type CompanyView } from './matrix-view';

type CompanyType = CompanyView['type'];

/**
 * You are saffron with a moss outline; rivals are rival blue, told apart by
 * fill rather than hue so the three kinds survive greyscale. An estimated
 * point (nothing citable behind it) is drawn hollow.
 */
function dotClasses(type: CompanyType, estimated: boolean): string {
  if (type === 'TARGET') return estimated ? 'bg-chalk-raised border-moss text-moss' : 'bg-saffron border-moss text-moss';
  if (type === 'INDIRECT') return 'bg-chalk-raised border-rival text-rival';
  if (type === 'ASPIRATIONAL') return estimated ? 'bg-chalk-raised border-moss-700 text-moss-700' : 'bg-moss-700 border-moss-700 text-chalk';
  return estimated ? 'bg-chalk-raised border-rival text-rival' : 'bg-rival border-rival text-chalk';
}

export function legendKeyForType(type: CompanyType): 'target' | 'direct' | 'indirect' | 'aspirational' {
  if (type === 'TARGET') return 'target';
  if (type === 'INDIRECT') return 'indirect';
  if (type === 'ASPIRATIONAL') return 'aspirational';
  return 'direct';
}

export { dotClasses };

/**
 * The plot is laid out in percentages off the physical left and bottom edges,
 * the way a scatter chart is: the x axis runs low-to-high left-to-right in
 * either language, so mirroring it would move every point without moving its
 * meaning. Only the frame is pinned LTR; text inside it takes its own
 * direction. The percentage offsets are the one place a style attribute is
 * unavoidable — Tailwind cannot generate a class per score.
 */
export function MatrixChart({
  chart,
  axisEnds,
  selectedKey,
  onSelect,
}: {
  chart: ChartView;
  /** Low/high wording for the four corners; absent on older charts, which then show none. */
  axisEnds: AxisEnds | null;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const t = useTranslations('tabsB.matrices');
  const format = useFormatter();
  const corners = axisEnds ? cornerLabels(axisEnds) : null;
  const whiteSpace = chart.white_space ?? null;
  const cell = whiteSpace ? { x: bandRect(whiteSpace.xBand), y: bandRect(whiteSpace.yBand) } : null;

  const moved = chart.companies.filter((company) => company.override);

  return (
    <div
      dir="ltr"
      role="group"
      aria-label={t('chart.plotLabel', { x: chart.axes.x, y: chart.axes.y })}
      className="relative h-[560px] w-full rounded-2xl border border-rule bg-chalk-raised md:h-[640px]"
    >
      <span className="absolute start-2 top-1/2 -translate-y-1/2 -rotate-90 whitespace-nowrap text-[10px] font-bold uppercase tracking-widest text-moss-muted">
        <bdi>{chart.axes.y}</bdi>
      </span>
      <span className="absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-bold uppercase tracking-widest text-moss-muted">
        <bdi>{chart.axes.x}</bdi>
      </span>

      <div className="absolute inset-x-9 bottom-10 top-4 rounded-xl bg-chalk ring-1 ring-inset ring-rule">
        <div className="absolute inset-x-0 top-1/2 h-px bg-rule" />
        <div className="absolute inset-y-0 left-1/2 w-px bg-rule" />

        {cell ? (
          <div
            className="hatch-saffron absolute rounded-md border border-dashed border-saffron bg-saffron-soft/40"
            style={{
              left: `${cell.x.start}%`,
              width: `${cell.x.size}%`,
              // y grows upward: the top of the cell is measured from the top of the plot.
              top: `${100 - (cell.y.start + cell.y.size)}%`,
              height: `${cell.y.size}%`,
            }}
          >
            <span className="absolute bottom-1 start-1 rounded bg-chalk-raised/90 px-1.5 py-0.5 text-[10px] font-bold text-saffron-ink" dir="auto">
              {t('chart.openGround')}
            </span>
          </div>
        ) : null}

        {corners ? (
          <>
            <CornerLabel className="left-2 top-2" x={corners.topLeft.x} y={corners.topLeft.y} />
            <CornerLabel className="right-2 top-2 text-right" x={corners.topRight.x} y={corners.topRight.y} />
            <CornerLabel className="bottom-2 left-2" x={corners.bottomLeft.x} y={corners.bottomLeft.y} />
            <CornerLabel className="bottom-2 right-2 text-right" x={corners.bottomRight.x} y={corners.bottomRight.y} />
          </>
        ) : null}

        {moved.length > 0 ? (
          <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full overflow-visible text-moss-muted/60">
            {moved.map((company) => {
              const from = company.override!;
              return (
                <g key={companyKey(company)}>
                  <line
                    x1={`${scoreToPercent(from.ai_x_score)}%`}
                    y1={`${100 - scoreToPercent(from.ai_y_score)}%`}
                    x2={`${scoreToPercent(company.x_score)}%`}
                    y2={`${100 - scoreToPercent(company.y_score)}%`}
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeDasharray="4 4"
                  />
                  <circle
                    cx={`${scoreToPercent(from.ai_x_score)}%`}
                    cy={`${100 - scoreToPercent(from.ai_y_score)}%`}
                    r="4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                </g>
              );
            })}
          </svg>
        ) : null}

        {chart.companies.map((company, index) => {
          const key = companyKey(company);
          const isTarget = company.type === 'TARGET';
          const selected = selectedKey === key;
          const estimated = company.estimated === true;
          const label = t(company.override ? 'chart.pointLabelEdited' : 'chart.pointLabel', {
            name: company.name,
            xAxis: chart.axes.x,
            yAxis: chart.axes.y,
            x: format.number(company.x_score),
            y: format.number(company.y_score),
          });
          return (
            <div
              key={key}
              className="group absolute z-10"
              style={{
                left: `${scoreToPercent(company.x_score)}%`,
                top: `${100 - scoreToPercent(company.y_score)}%`,
                transform: 'translate(-50%, -50%)',
              }}
            >
              <button
                type="button"
                aria-label={label}
                aria-pressed={selected}
                onClick={() => onSelect(key)}
                className={`relative flex h-8 w-8 items-center justify-center rounded-full border-2 text-[10px] font-black shadow-sm ring-4 transition-transform duration-150 hover:scale-110 focus-visible:outline-none focus-visible:ring-moss ${
                  selected ? 'ring-moss' : 'ring-chalk-raised'
                } ${dotClasses(company.type, estimated)}`}
              >
                {isTarget ? 'T' : format.number(index + 1)}
                {company.override ? (
                  <span className="absolute -right-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full border border-moss bg-chalk-raised text-moss">
                    <Pencil aria-hidden className="h-2.5 w-2.5" />
                  </span>
                ) : null}
              </button>
              <span
                dir="auto"
                className={`pointer-events-none absolute left-1/2 top-9 -translate-x-1/2 whitespace-nowrap rounded-md border border-rule bg-chalk-raised px-2 py-0.5 text-[11px] font-bold text-moss shadow-sm ${
                  isTarget || selected ? 'block' : 'hidden group-hover:block group-focus-within:block'
                }`}
              >
                {isTarget ? t('yourBrand') : <bdi>{company.name}</bdi>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CornerLabel({ className, x, y }: { className: string; x: string; y: string }) {
  return (
    <span
      dir="auto"
      className={`pointer-events-none absolute z-0 max-w-[30%] text-[10px] font-semibold leading-tight text-moss-muted ${className}`}
    >
      <span className="block">{y}</span>
      <span className="block">{x}</span>
    </span>
  );
}
