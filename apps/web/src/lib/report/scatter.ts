/**
 * scatter.ts — the positioning matrix, drawn by us.
 *
 * The previous report asked the model to place each company itself, with
 * `left: (xScore / 10 * 85 + 5)%` and a label under every dot. Two things went
 * wrong every single time:
 *
 *   1. Scores in real data sit between 4 and 7 on a 1–10 axis, so mapping the
 *      full 0–10 range put every company inside the middle fifth of the chart.
 *   2. Nothing checked whether two labels overlapped, so they did — the last
 *      report printed "Official web…Startup CTO C…herschberg)" as one run of
 *      unreadable text.
 *
 * So the axes are scaled to the data that exists, and labels are placed by
 * trying candidate positions and keeping the first that collides with nothing.
 * The output is deterministic: the same workspace renders the same chart twice.
 */

import { REPORT_COLORS } from './theme';
import { formatNumber } from './format';
import type { ContentLanguage } from '@/lib/content-language';

export interface ScatterCompany {
  name: string;
  /** "TARGET" is the workspace itself; everything else is a competitor. */
  type: string;
  xScore: number;
  yScore: number;
}

export interface ScatterChart {
  chartName: string;
  xAxis: string;
  yAxis: string;
  companies: ScatterCompany[];
}

const W = 660;
const H = 390;
const PAD = { top: 22, right: 26, bottom: 46, left: 58 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

/** Rough text metrics — good enough to keep two labels off each other. */
const CHAR_W = 5.0;
const LABEL_H = 11;

export function escapeXml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Long competitor names ("Startup CTO Consulting (by John Saddington)") are the
 * reason labels collided. On a competitor the parenthetical is attribution, not
 * identity, so it goes; the reader loses nothing.
 *
 * The target keeps its parenthetical, because that string is the name the user
 * gave their own workspace — "Official web (ME)" shortened to "Official web" is
 * us editing their words on their own chart.
 */
function shortName(name: string, isYou: boolean): string {
  const base = isYou ? name.trim() : name.replace(/\s*\([^)]*\)\s*$/, '').trim() || name;
  return base.length > 26 ? `${base.slice(0, 25)}…` : base;
}

interface Box { x1: number; y1: number; x2: number; y2: number }

function overlaps(a: Box, b: Box): boolean {
  return !(a.x2 < b.x1 || a.x1 > b.x2 || a.y2 < b.y1 || a.y1 > b.y2);
}

/**
 * Scales one axis to the values present, padded by 15% of the spread so no
 * point sits on the frame. A flat axis (every company identical) falls back to
 * a ±1 window so the points land in the middle rather than dividing by zero.
 */
function makeScale(values: number[], size: number, invert: boolean) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min;
  const pad = spread === 0 ? 1 : spread * 0.15;
  const lo = min - pad;
  const hi = max + pad;
  return {
    lo,
    hi,
    to(value: number): number {
      const t = (value - lo) / (hi - lo);
      return invert ? size - t * size : t * size;
    },
  };
}

export function renderScatter(chart: ScatterChart, language: ContentLanguage): string {
  const c = REPORT_COLORS;
  const companies = chart.companies.filter(
    (co) => Number.isFinite(co.xScore) && Number.isFinite(co.yScore),
  );
  if (companies.length === 0) return '';

  const xs = makeScale(companies.map((co) => co.xScore), PLOT_W, false);
  const ys = makeScale(companies.map((co) => co.yScore), PLOT_H, true);

  // Gridlines at the quartiles of the visible window — enough to read a
  // position against, few enough not to become the loudest thing on the page.
  const gridlines: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const gx = PAD.left + (PLOT_W / 4) * i;
    const gy = PAD.top + (PLOT_H / 4) * i;
    gridlines.push(
      `<line x1="${gx.toFixed(1)}" y1="${PAD.top}" x2="${gx.toFixed(1)}" y2="${PAD.top + PLOT_H}" stroke="${c.rule}" stroke-width="0.5"/>`,
      `<line x1="${PAD.left}" y1="${gy.toFixed(1)}" x2="${PAD.left + PLOT_W}" y2="${gy.toFixed(1)}" stroke="${c.rule}" stroke-width="0.5"/>`,
    );
  }

  const placed: Box[] = [];
  const dots: string[] = [];
  const labels: string[] = [];
  // Held back and appended after the competitors so the saffron dot is never
  // painted over by a rival that happens to share its coordinates.
  const targetDots: string[] = [];

  // The target is placed first, so its label always gets the position it wants
  // and a competitor is the one that moves.
  const ordered = [...companies].sort((a, b) =>
    (a.type === 'TARGET' ? -1 : 0) - (b.type === 'TARGET' ? -1 : 0),
  );

  for (const co of ordered) {
    const isYou = co.type === 'TARGET';
    const isIndirect = co.type === 'INDIRECT';
    const cx = PAD.left + xs.to(co.xScore);
    const cy = PAD.top + ys.to(co.yScore);
    const r = isYou ? 6 : 4.5;

    // Reserve the dot itself so no label is written across another dot.
    placed.push({ x1: cx - r, y1: cy - r, x2: cx + r, y2: cy + r });

    const text = shortName(co.name, isYou);
    const tw = text.length * CHAR_W;

    /*
      Candidates are generated rather than listed, because a listed handful ran
      out: this data has three companies on the exact same coordinates, so their
      candidate sets are identical and the first two consume every slot. Rings
      at growing vertical distance give the third somewhere to go.
    */
    const candidates: { x: number; y: number; anchor: string }[] = [];
    for (const dy of [10, -5, 21, -16, 32, -27, 43, -38]) {
      const below = dy > 0;
      candidates.push({ x: cx, y: cy + (below ? r + dy : -r + dy + 5), anchor: 'middle' });
      candidates.push({ x: cx + r + 5, y: cy + (below ? dy - 6 : dy + 11), anchor: 'start' });
      candidates.push({ x: cx - r - 5, y: cy + (below ? dy - 6 : dy + 11), anchor: 'end' });
    }

    const boxFor = (cand: { x: number; y: number; anchor: string }): Box => {
      const x1 = cand.anchor === 'middle' ? cand.x - tw / 2 : cand.anchor === 'start' ? cand.x : cand.x - tw;
      // A 1px skirt keeps two labels from sitting flush against each other,
      // which reads as overlapping even when the boxes technically do not.
      return { x1: x1 - 1, y1: cand.y - LABEL_H, x2: x1 + tw + 1, y2: cand.y + 3 };
    };

    let chosen = candidates[0];
    let chosenBox = boxFor(chosen);
    let found = false;
    for (const cand of candidates) {
      const box = boxFor(cand);
      // Keep labels inside the frame as well as off each other.
      const inside = box.x1 >= 2 && box.x2 <= W - 2 && box.y1 >= 2 && box.y2 <= H - PAD.bottom + 16;
      if (inside && !placed.some((p) => overlaps(p, box))) {
        chosen = cand;
        chosenBox = box;
        found = true;
        break;
      }
    }
    if (!found) {
      // Nothing was free. Take the last ring below the dot and keep going down
      // until something is — and reserve it either way. The previous version
      // fell back to candidate zero without reserving it, so every later label
      // was free to land on top of this one.
      let y = cy + r + 54;
      while (y < H - PAD.bottom + 14) {
        const cand = { x: cx, y, anchor: 'middle' };
        const box = boxFor(cand);
        if (!placed.some((p) => overlaps(p, box))) {
          chosen = cand;
          chosenBox = box;
          break;
        }
        y += 11;
      }
    }
    placed.push(chosenBox);

    const fill = isYou ? c.saffron : isIndirect ? 'none' : c.rival;
    const stroke = isYou ? c.saffronInk : c.rival;
    (isYou ? targetDots : dots).push(
      `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${isIndirect ? 1.6 : 1}"/>`,
    );
    labels.push(
      `<text x="${chosen.x.toFixed(1)}" y="${chosen.y.toFixed(1)}" text-anchor="${chosen.anchor}" font-size="8.5" font-weight="${isYou ? 600 : 400}" fill="${isYou ? c.saffronInk : c.mossMuted}">${escapeXml(text)}</text>`,
    );
  }

  const axisLabel = (v: number) => escapeXml(formatNumber(Math.round(v * 10) / 10, language));

  /*
    The chart is a coordinate space, not prose, so it stays left-to-right even
    in a Persian report: X still increases to the right. Without this the page's
    `dir="rtl"` inverts what `text-anchor="start"` means and throws every axis
    label to the opposite end of the axis it belongs to.
  */
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" style="direction:ltr" xmlns="http://www.w3.org/2000/svg">
  <rect x="${PAD.left}" y="${PAD.top}" width="${PLOT_W}" height="${PLOT_H}" fill="#FFFFFF" stroke="${c.rule}"/>
  ${gridlines.join('\n  ')}
  <line x1="${PAD.left}" y1="${PAD.top + PLOT_H}" x2="${PAD.left + PLOT_W}" y2="${PAD.top + PLOT_H}" stroke="${c.ruleStrong}"/>
  <line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top + PLOT_H}" stroke="${c.ruleStrong}"/>
  <text x="${PAD.left - 6}" y="${PAD.top + PLOT_H + 4}" text-anchor="end" font-size="8" fill="${c.mossMuted}">${axisLabel(ys.lo)}</text>
  <text x="${PAD.left - 6}" y="${PAD.top + 8}" text-anchor="end" font-size="8" fill="${c.mossMuted}">${axisLabel(ys.hi)}</text>
  <text x="${PAD.left}" y="${PAD.top + PLOT_H + 15}" text-anchor="start" font-size="8" fill="${c.mossMuted}">${axisLabel(xs.lo)}</text>
  <text x="${PAD.left + PLOT_W}" y="${PAD.top + PLOT_H + 15}" text-anchor="end" font-size="8" fill="${c.mossMuted}">${axisLabel(xs.hi)}</text>
  <text x="${PAD.left + PLOT_W / 2}" y="${H - 12}" text-anchor="middle" font-size="9.5" font-weight="500" fill="${c.moss}">${escapeXml(chart.xAxis)}</text>
  <text x="14" y="${PAD.top + PLOT_H / 2}" text-anchor="middle" font-size="9.5" font-weight="500" fill="${c.moss}" transform="rotate(-90 14 ${PAD.top + PLOT_H / 2})">${escapeXml(chart.yAxis)}</text>
  ${dots.join('\n  ')}
  ${targetDots.join('\n  ')}
  ${labels.join('\n  ')}
</svg>`;
}
