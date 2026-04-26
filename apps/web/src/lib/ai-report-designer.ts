/**
 * ai-report-designer.ts
 *
 * Uses the existing Gemini API (same fetch pattern as gemini.ts) to generate
 * a fully-styled HTML report from workspace intelligence data.
 * Falls back to OpenAI if Gemini fails.
 */

// Default model matches the project's existing DEFAULT_GEMINI_MODEL constant.
const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-pro';

export interface ReportWorkspaceData {
  companyName: string;
  websiteUrl: string | null;
  reportDate: string;
  brandSummary: any;
  competitors: any[];
  matrices: any;
  keywords: any;
  offerings: any;
}

/**
 * Calls the Gemini REST API with the same low-level fetch pattern used
 * throughout the existing gemini.ts — avoids adding a new SDK dependency.
 */
async function callGemini(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          // Large output needed for a full HTML report page
          maxOutputTokens: 16384,
          temperature: 0.4,
        },
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini API error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

/**
 * Falls back to OpenAI GPT if Gemini is unavailable.
 * Uses the existing OPENAI_API_KEY already in the project.
 */
async function callOpenAiFallback(prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const model = process.env.OPENAI_DEFAULT_MODEL || 'gpt-4.1';

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      temperature: 0.4,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI API error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? '';
}

/**
 * Strips markdown code fences that the model sometimes wraps its HTML output in.
 */
function stripCodeFences(text: string): string {
  return text
    .replace(/^```html\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

/**
 * Normalises raw DB matrix data into a clean shape for the AI prompt.
 * The DB uses `chart_name`, `axes.x/y`, and `x_score/y_score` — previous
 * code was passing `chart.name`, `chart.xAxis`, and `c.x` which were all
 * undefined, causing the AI to output "undefined" in every table cell.
 */
function normaliseMatrices(matrices: any): any[] {
  return (matrices?.charts ?? []).map((chart: any) => ({
    chartName: chart.chart_name,           // e.g. "Price vs Value Depth"
    xAxis: chart.axes?.x ?? 'X',           // e.g. "Price"
    yAxis: chart.axes?.y ?? 'Y',           // e.g. "Value Depth"
    summary: chart.summary,
    companies: (chart.companies ?? []).map((c: any) => ({
      name: c.name,
      type: c.type,                         // "TARGET" | "DIRECT" | "INDIRECT"
      xScore: c.x_score,                   // numeric 1-10
      yScore: c.y_score,
      xReason: c.x_reason,
      yReason: c.y_reason,
    })),
  }));
}

/**
 * Normalises raw DB keyword data.
 * The DB field is `primary_keywords` (snake_case), not `primaryKeywords`.
 */
function normaliseKeywords(keywords: any): any[] {
  return (keywords?.competitors ?? []).slice(0, 6).map((c: any) => ({
    name: c.competitor,                           // competitor display name
    domain: c.domain,
    primaryKeywords: c.primary_keywords ?? [],    // string[]
    secondaryKeywords: c.secondary_keywords ?? [],
    contentStrategyGoal: c.content_strategy?.main_goal,
    contentFocus: c.content_strategy?.content_focus,
    strategySignals: c.strategy_signals,
  }));
}

/**
 * Builds the prompt sent to the AI.
 * All data is pre-normalised so the AI never receives an `undefined` value.
 */
function buildPrompt(data: ReportWorkspaceData): string {
  const matrices = normaliseMatrices(data.matrices);
  const keywords = normaliseKeywords(data.keywords);
  const contentGaps = (data.keywords?.content_gaps ?? []).slice(0, 4);
  const offerings = (data.offerings?.client_offerings?.offerings ?? []).slice(0, 6);
  const competitorOfferings = (data.offerings?.competitor_offerings ?? []).slice(0, 4);
  const brand = data.brandSummary ?? {};

  return `You are an expert strategic consultant creating a professional market intelligence report for ${data.companyName}.

=== BRAND IDENTITY ===
Primary color: #DC2626 (vibrant red)
Secondary color: #1F2937 (dark charcoal)
Background: #F9FAFB (light gray)
Cover gradient: from #DC2626 to #991B1B

=== COMPANY DATA ===
Name: ${data.companyName}
Website: ${data.websiteUrl ?? 'N/A'}
Report Date: ${data.reportDate}
Competitors Analyzed: ${data.competitors.length}

=== BRAND SUMMARY ===
${JSON.stringify(brand, null, 2)}

=== COMPETITIVE MATRICES (${matrices.length} charts) ===
${JSON.stringify(matrices, null, 2)}

=== COMPETITOR KEYWORDS (${keywords.length} competitors) ===
${JSON.stringify(keywords, null, 2)}

=== CONTENT GAPS ===
${JSON.stringify(contentGaps, null, 2)}

=== PRODUCTS & SERVICES (${offerings.length} offerings) ===
${JSON.stringify(offerings, null, 2)}

=== COMPETITOR OFFERINGS ===
${JSON.stringify(competitorOfferings, null, 2)}

---

YOUR TASK: Generate a single, complete, print-ready HTML report (A4, 20mm margins).

CRITICAL OUTPUT RULES:
- Return ONLY raw HTML starting with <!DOCTYPE html> — no markdown fences
- Do NOT include <script src="https://cdn.tailwindcss.com"> (injected separately)
- Never output the word "undefined" — use only actual values from the JSON above
- No empty pages: only insert a page-break class when a major section truly needs a new page

SECTIONS (in order):

### 1. COVER PAGE
- Full-height red gradient div (from-red-700 to-red-900)
- ${data.companyName} in 5xl white bold
- "Strategic Market Intelligence Report" subtitle
- Date: ${data.reportDate}
- "Prepared by Contivo AI" in footer
- Add class="page-break" only at the END of this cover div

### 2. EXECUTIVE SUMMARY (flows directly, no empty page before it)
- 3 KPI stat cards in a row: Competitors (${data.competitors.length}), Matrices (${matrices.length}), Keywords analyzed (${keywords.reduce((n: number, k: any) => n + k.primaryKeywords.length + k.secondaryKeywords.length, 0)})
- Numbers in red (#DC2626), dark text descriptions
- 2-paragraph strategic overview derived from the brand summary data above

### 3. BRAND PROFILE
- Mission (icon 🎯), Value Proposition (💎), Brand Voice (🎙️)
- Differentiators as checkmark bullet list ✓
- Target Audience (👥)
- All pulled verbatim from the BRAND SUMMARY JSON above

### 4. COMPETITIVE LANDSCAPE
- Table: Company | Domain | Type | Confidence
- One row per competitor from the matrices data
- Highlight TARGET row with bg-red-50 and a red left border
- Alternating bg-gray-50 / white rows for non-target rows

### 5. MARKET POSITIONING MATRICES
For EACH of the ${matrices.length} matrices (chartName, xAxis, yAxis, companies with xScore/yScore):

A) Section header: chartName in bold red
B) CSS SCATTER PLOT — do this exactly:
   - Outer div: relative w-full h-80 bg-white border border-gray-200 rounded-lg mx-auto
   - X-axis label bottom-center, Y-axis label rotated left-center
   - For each company, place an absolutely-positioned div:
     * left = (xScore / 10 * 85 + 5)% — maps 0-10 score to 5%-90% of width
     * bottom = (yScore / 10 * 85 + 5)% — maps 0-10 score to 5%-90% of height
     * TARGET type: w-5 h-5 bg-red-600 rounded-full with red label below
     * DIRECT type: w-3 h-3 bg-blue-500 rounded-full with small label
     * INDIRECT type: w-3 h-3 bg-gray-400 rounded-full with small label
   - Company name label: text-xs font-semibold below each dot
C) Data table below the chart:
   Company | ${'{'}xAxis{'}'} Score | ${'{'}yAxis{'}'} Score | Type
   (use actual xScore and yScore numbers from the JSON)

### 6. COMPETITOR KEYWORD INTELLIGENCE
For each of the ${keywords.length} competitors:
- Subheading: competitor name + domain in gray
- Primary keywords as red pill badges (bg-red-100 text-red-700 rounded-full px-2 py-0.5 text-xs)
- Secondary keywords as gray pill badges
- Content strategy goal as italic paragraph
- DO NOT write "No data" — all competitors have keywords in the JSON above

Below the competitors:
- "Content Gap Opportunities" section with the contentGaps data as numbered cards

### 7. PRODUCTS & SERVICES
For each of the ${offerings.length} client offerings, a card (2-column grid):
- Pick a relevant emoji icon based on the name (🏗️ 🎨 🔧 🏢 📐 🔩)
- Product name in bold red (text-red-600 font-bold text-lg)
- Description paragraph
- Feature tags derived from the description as small gray badges
- No "Learn More" button needed

Below: "What Competitors Offer" comparison table using competitorOfferings data.

### 8. STRATEGIC RECOMMENDATIONS
Three columns side by side:
- Immediate (0–3 months) — red header
- Medium-term (3–12 months) — orange header
- Long-term (12+ months) — gray header
Each with 3 numbered action items derived from the gaps and competitive data above.

Footer: "Generated by Contivo AI · ${data.reportDate} · Confidential"

DESIGN CHECKLIST (verify before outputting):
✅ Red (#DC2626) used for all primary headings, borders, highlights
✅ Every scatter plot has actual numeric positions (not 50%/50% for all)
✅ Every table cell has a real value — zero "undefined" strings
✅ No consecutive page-break divs (would cause blank pages)
✅ Flows from section to section without gaps

HTML:`;
}

/**
 * Main export: generate a professional HTML report using Gemini (OpenAI fallback).
 * Returns a raw HTML string ready to be saved or converted to PDF.
 */
export async function generateReportHTML(data: ReportWorkspaceData): Promise<string> {
  const prompt = buildPrompt(data);

  let raw: string;
  try {
    raw = await callGemini(prompt);
  } catch (geminiErr) {
    console.warn('[ai-report-designer] Gemini failed, trying OpenAI fallback:', geminiErr);
    raw = await callOpenAiFallback(prompt);
  }

  const html = stripCodeFences(raw);

  if (!html.includes('<html') && !html.includes('<body')) {
    throw new Error('AI did not return valid HTML — output too short or malformed');
  }

  return html;
}
