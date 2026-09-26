/**
 * template.ts — assembles the report document.
 *
 * Everything structural lives here: the cover, the order of sections, which
 * figures exist, where the page breaks fall. The model contributes sentences
 * and nothing else, so two reports from the same workspace look the same.
 */

import { isRtlContentLanguage, type ContentLanguage } from '@/lib/content-language';
import { REPORT_COLORS, reportStylesheet } from './theme';
import { renderScatter, escapeXml, type ScatterChart } from './scatter';
import { formatNumber, formatReportDate, reportReference } from './format';
import { reportStrings } from './strings';
import type { ReportNarrative } from './narrative';

export interface ReportDocumentInput {
  reportId: string;
  generatedAt: Date;
  language: ContentLanguage;
  companyName: string;
  websiteUrl: string | null;
  brandSummary: any;
  matrices: ScatterChart[];
  /** The accepted competitor rows. The matrix JSON carries scores but not
   *  domains, so the landscape table is built from these instead. */
  competitors: { name: string; domain: string | null; type: string | null }[];
  keywords: {
    name: string;
    domain?: string;
    primaryKeywords: string[];
    secondaryKeywords: string[];
    contentStrategyGoal?: string;
  }[];
  contentGaps: any[];
  offerings: { name: string; description?: string; pricing?: string }[];
  narrative: ReportNarrative;
  degraded: boolean;
}

const e = escapeXml;

/** Renders only when there is something to render — no "N/A" rows. */
function field(label: string, value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  return `<p><strong>${e(label)}:</strong> ${e(value.trim())}</p>`;
}

function paragraphs(items: string[]): string {
  return items.map((p) => `<p>${e(p)}</p>`).join('\n');
}

function roleLabel(type: string, s: ReturnType<typeof reportStrings>): string {
  switch (type) {
    case 'TARGET': return s.roles.you;
    case 'INDIRECT': return s.roles.indirect;
    case 'ASPIRATIONAL': return s.roles.aspirational;
    default: return s.roles.direct;
  }
}

function coverSection(input: ReportDocumentInput, reference: string): string {
  const s = reportStrings(input.language);
  const date = formatReportDate(input.generatedAt, input.language);
  const site = input.websiteUrl?.replace(/^https?:\/\//, '').replace(/\/$/, '') ?? '';

  return `<div class="cover page-break">
  <div class="wordmark"><span class="dot"></span><span>Contivo</span></div>
  <div>
    <div class="cover-kicker">${e(s.kicker)}</div>
    <h1 class="cover-title">${e(input.companyName)}</h1>
    ${site ? `<div class="cover-site ltr">${e(site)}</div>` : ''}
  </div>
  <div class="cover-meta">
    <dl>
      <div><dt>${e(s.reportDate)}</dt><dd>${e(date)}</dd></div>
      <div><dt>${e(s.reportReference)}</dt><dd class="ltr">${e(reference)}</dd></div>
      <div><dt>${e(s.competitorsAnalysed)}</dt><dd>${e(formatNumber(input.matrices[0]?.companies.filter((c) => c.type !== 'TARGET').length ?? 0, input.language))}</dd></div>
      <div><dt>${e(s.preparedBy)}</dt><dd>Contivo · <span class="ltr">contivo.app</span></dd></div>
    </dl>
  </div>
</div>`;
}

function summarySection(input: ReportDocumentInput, n: number): string {
  const s = reportStrings(input.language);
  const competitors = input.matrices[0]?.companies.filter((c) => c.type !== 'TARGET').length ?? 0;
  const keywordCount = input.keywords.reduce(
    (total, k) => total + k.primaryKeywords.length + k.secondaryKeywords.length,
    0,
  );

  return `<section>
  <h2 class="section-title"><span class="section-number">${formatNumber(n, input.language)}</span>${e(s.sections.summary)}</h2>
  ${input.degraded ? `<div class="note">${e(s.degradedNote)}</div>` : ''}
  <div class="stats">
    <div class="stat"><div class="stat-value">${e(formatNumber(competitors, input.language))}</div><div class="stat-label">${e(s.stats.competitors)}</div></div>
    <div class="stat"><div class="stat-value">${e(formatNumber(input.matrices.length, input.language))}</div><div class="stat-label">${e(s.stats.matrices)}</div></div>
    <div class="stat"><div class="stat-value">${e(formatNumber(keywordCount, input.language))}</div><div class="stat-label">${e(s.stats.keywords)}</div></div>
  </div>
  ${paragraphs(input.narrative.executiveSummary)}
</section>`;
}

function brandSection(input: ReportDocumentInput, n: number): string {
  const s = reportStrings(input.language);
  const b = input.brandSummary ?? {};
  const differentiators: string[] = Array.isArray(b.keyDifferentiators) ? b.keyDifferentiators : [];

  const body = [
    field(s.brand.mission, b.missionStatement),
    field(s.brand.value, b.valueProposition),
    field(s.brand.voice, b.brandVoice),
    field(s.brand.audience, b.targetAudience),
  ].filter(Boolean).join('\n');

  if (!body && differentiators.length === 0) return '';

  return `<section>
  <h2 class="section-title"><span class="section-number">${formatNumber(n, input.language)}</span>${e(s.sections.brand)}</h2>
  ${body}
  ${differentiators.length ? `<p><strong>${e(s.brand.differentiators)}</strong></p><ul>${differentiators.map((d) => `<li>${e(String(d))}</li>`).join('')}</ul>` : ''}
</section>`;
}

function landscapeSection(input: ReportDocumentInput, n: number): string {
  const s = reportStrings(input.language);

  /*
    Prefer the competitor rows, which carry domains; fall back to the matrix
    companies, which do not. Reading the table off the matrix alone printed a
    column of em dashes where every domain should have been.
  */
  const fromRoster = input.competitors.map((co) => ({
    name: co.name,
    domain: co.domain ?? '',
    type: co.type ?? 'DIRECT',
  }));
  const matrixCompanies = (input.matrices[0]?.companies ?? []) as any[];
  const you = matrixCompanies.find((co) => co.type === 'TARGET');
  // The matrix carries no domain for the target, but the workspace knows its
  // own address — without this the reader's own row is the one blank cell.
  const ownDomain = input.websiteUrl?.replace(/^https?:\/\//, '').replace(/\/$/, '') ?? '';
  const companies = fromRoster.length
    ? [...(you ? [{ name: you.name, domain: you.domain ?? ownDomain, type: 'TARGET' }] : []), ...fromRoster]
    : matrixCompanies.map((co) => ({ name: co.name, domain: co.domain ?? '', type: co.type }));

  if (companies.length === 0) return '';

  const showDomain = companies.some((co) => co.domain);

  const rows = companies.map((co) => `<tr${co.type === 'TARGET' ? ' class="is-you"' : ''}>
    <td>${e(co.name)}</td>
    ${showDomain ? `<td class="domain">${e(co.domain)}</td>` : ''}
    <td>${e(roleLabel(co.type, s))}</td>
  </tr>`).join('\n');

  return `<section>
  <h2 class="section-title"><span class="section-number">${formatNumber(n, input.language)}</span>${e(s.sections.landscape)}</h2>
  <table>
    <thead><tr><th>${e(s.table.company)}</th>${showDomain ? `<th>${e(s.table.domain)}</th>` : ''}<th>${e(s.table.role)}</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</section>`;
}

function matricesSection(input: ReportDocumentInput, n: number): string {
  const s = reportStrings(input.language);
  if (input.matrices.length === 0) return '';
  const c = REPORT_COLORS;

  const legend = `<div class="legend">
    <span><i class="swatch" style="background:${c.saffron}"></i>${e(s.legend.you)}</span>
    <span><i class="swatch" style="background:${c.rival}"></i>${e(s.legend.direct)}</span>
    <span><i class="swatch" style="background:#fff;border:1.5px solid ${c.rival}"></i>${e(s.legend.indirect)}</span>
  </div>`;

  const figures = input.matrices.map((chart) => {
    const reading = input.narrative.chartReadings[chart.chartName];
    const rows = chart.companies.map((co: any) => `<tr${co.type === 'TARGET' ? ' class="is-you"' : ''}>
      <td>${e(co.name)}</td>
      <td>${e(formatNumber(co.xScore, input.language))}</td>
      <td>${e(formatNumber(co.yScore, input.language))}</td>
    </tr>`).join('\n');

    return `<div class="figure">
    <h3>${e(chart.chartName)}</h3>
    ${renderScatter(chart, input.language)}
    ${legend}
  </div>
  ${reading ? `<p>${e(reading)}</p>` : ''}
  <table>
    <thead><tr><th>${e(s.table.company)}</th><th>${e(chart.xAxis)}</th><th>${e(chart.yAxis)}</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
  }).join('\n');

  return `<section>
  <h2 class="section-title"><span class="section-number">${formatNumber(n, input.language)}</span>${e(s.sections.matrices)}</h2>
  <div class="note">${e(s.estimateNote)}</div>
  ${figures}
  ${input.narrative.positioningOpportunity ? `<p>${e(input.narrative.positioningOpportunity)}</p>` : ''}
</section>`;
}

function keywordsSection(input: ReportDocumentInput, n: number): string {
  const s = reportStrings(input.language);
  if (input.keywords.length === 0) return '';

  const blocks = input.keywords.map((k) => `<div class="card">
    <h3>${e(k.name)}${k.domain ? ` <span class="domain">${e(k.domain)}</span>` : ''}</h3>
    ${k.primaryKeywords.length ? `<p class="lede">${e(s.primaryKeywords)}</p><p>${k.primaryKeywords.slice(0, 12).map((w) => `<span class="tag">${e(w)}</span>`).join('')}</p>` : ''}
    ${k.contentStrategyGoal ? `<p>${e(k.contentStrategyGoal)}</p>` : ''}
  </div>`).join('\n');

  const gaps = input.contentGaps
    .map((g: any) => (typeof g === 'string' ? g : g?.gap ?? g?.title ?? ''))
    .filter((g: string) => g && g.trim());

  return `<section>
  <h2 class="section-title"><span class="section-number">${formatNumber(n, input.language)}</span>${e(s.sections.keywords)}</h2>
  ${input.narrative.keywordInsight ? `<p>${e(input.narrative.keywordInsight)}</p>` : ''}
  ${blocks}
  ${gaps.length ? `<h3>${e(s.gaps)}</h3><ul>${gaps.map((g: string) => `<li>${e(g)}</li>`).join('')}</ul>` : ''}
</section>`;
}

function offeringsSection(input: ReportDocumentInput, n: number): string {
  const s = reportStrings(input.language);
  if (input.offerings.length === 0) return '';

  const cards = input.offerings.map((o) => `<div class="card">
    <h3>${e(o.name)}</h3>
    ${o.description ? `<p>${e(o.description)}</p>` : ''}
    ${o.pricing ? `<p class="lede">${e(o.pricing)}</p>` : ''}
  </div>`).join('\n');

  return `<section>
  <h2 class="section-title"><span class="section-number">${formatNumber(n, input.language)}</span>${e(s.sections.offerings)}</h2>
  <div class="card-grid">${cards}</div>
</section>`;
}

function recommendationsSection(input: ReportDocumentInput, n: number): string {
  const s = reportStrings(input.language);
  const r = input.narrative.recommendations;
  const groups = [
    { title: s.horizons.immediate, items: r.immediate },
    { title: s.horizons.medium, items: r.mediumTerm },
    { title: s.horizons.long, items: r.longTerm },
  ].filter((g) => g.items.length > 0);

  // No filler: if the model produced nothing, the section does not appear at
  // all. The old report printed the same nine generic sentences for every
  // customer, which looked like advice and was not.
  if (groups.length === 0) return '';

  return `<section>
  <h2 class="section-title"><span class="section-number">${formatNumber(n, input.language)}</span>${e(s.sections.recommendations)}</h2>
  ${groups.map((g) => `<div class="card">
    <h3>${e(g.title)}</h3>
    <ol>${g.items.map((i) => `<li>${e(i)}</li>`).join('')}</ol>
  </div>`).join('\n')}
</section>`;
}

export function renderReportDocument(input: ReportDocumentInput): string {
  const s = reportStrings(input.language);
  const rtl = isRtlContentLanguage(input.language);
  const reference = reportReference(input.reportId, input.generatedAt);
  const date = formatReportDate(input.generatedAt, input.language);

  const sections = [
    summarySection,
    brandSection,
    landscapeSection,
    matricesSection,
    keywordsSection,
    offeringsSection,
    recommendationsSection,
  ];

  let n = 0;
  const body = sections
    .map((render) => {
      const html = render(input, n + 1);
      if (html) n += 1;
      return html;
    })
    .filter(Boolean)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="${rtl ? 'fa' : 'en'}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="UTF-8">
<title>${e(input.companyName)} · ${e(s.kicker)}</title>
<style>${reportStylesheet(input.language)}</style>
</head>
<body>
${coverSection(input, reference)}
<main style="padding: 0 2mm;">
${body}
<div class="footer">
  <span>Contivo · <span class="ltr">contivo.app</span></span>
  <span class="ltr">${e(reference)}</span>
  <span>${e(date)} · ${e(s.confidential)}</span>
</div>
</main>
</body>
</html>`;
}
