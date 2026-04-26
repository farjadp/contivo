import { Workspace, Competitor } from '@prisma/client';

interface ReportData {
  workspace: Workspace & {
    competitors: Competitor[];
  };
  brandSummary: any;
  audienceInsights: any;
  generatedDate: Date;
}

export function buildStrategicReportContent(data: ReportData): string {
  const { workspace, brandSummary, audienceInsights, generatedDate } = data;
  const matrices = audienceInsights?.competitiveMatrices;
  const keywords = audienceInsights?.competitorKeywordsIntel;
  const offerings = audienceInsights?.productsServicesIntel;

  let content = `# STRATEGIC MARKET INTELLIGENCE REPORT\n\n`;
  content += `**Company:** ${brandSummary?.businessName || 'Your Business'}\n`;
  content += `**Website:** ${workspace.websiteUrl}\n`;
  content += `**Report Date:** ${generatedDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })}\n`;
  content += `**Competitors Analyzed:** ${workspace.competitors.length}\n\n`;
  content += `---\n\n`;

  // 1. EXECUTIVE SUMMARY
  content += `## 1. EXECUTIVE SUMMARY\n\n`;
  content += `### Business Overview\n`;
  content += `${brandSummary?.missionStatement || 'Mission statement not available.'}\n\n`;
  content += `**Value Proposition:** ${brandSummary?.valueProposition || 'Not defined'}\n\n`;
  content += `**Target Audience:** ${brandSummary?.targetAudience || 'Not defined'}\n\n`;

  if (matrices?.insights?.marketPatterns) {
    content += `### Key Market Findings\n`;
    content += `${matrices.insights.marketPatterns}\n\n`;
  }

  if (matrices?.insights?.actionableGaps) {
    content += `### Strategic Opportunities\n`;
    content += `${matrices.insights.actionableGaps}\n\n`;
  }

  content += `---\n\n`;

  // 2. BRAND PROFILE
  content += `## 2. BRAND PROFILE\n\n`;
  content += `### Core Identity\n`;
  content += `**Mission:** ${brandSummary?.missionStatement || 'Not defined'}\n\n`;
  content += `**Vision:** ${brandSummary?.visionStatement || 'Not defined'}\n\n`;
  content += `**Brand Voice:** ${brandSummary?.brandVoice || 'Not defined'}\n\n`;

  if (brandSummary?.keyDifferentiators) {
    content += `### Differentiators\n`;
    brandSummary.keyDifferentiators.forEach((diff: string, i: number) => {
      content += `${i + 1}. ${diff}\n`;
    });
    content += `\n`;
  }

  content += `---\n\n`;

  // 3. COMPETITIVE LANDSCAPE
  content += `## 3. COMPETITIVE LANDSCAPE\n\n`;
  content += `### Analyzed Competitors (${workspace.competitors.length})\n\n`;

  workspace.competitors.forEach((comp, i) => {
    content += `**${i + 1}. ${comp.name}** (${comp.type})\n`;
    content += `   - Domain: ${comp.domain}\n`;
    content += `   - Category: ${comp.category || 'N/A'}\n`;
    content += `   - Description: ${comp.description || 'N/A'}\n\n`;
  });

  if (matrices?.charts) {
    content += `### Market Positioning Matrices\n\n`;
    matrices.charts.forEach((chart: any) => {
      content += `#### ${chart.name}\n`;
      const target = chart.companies.find((c: any) => c.type === 'TARGET');
      content += `**Your Position:** (${target?.x ?? 'N/A'}, ${target?.y ?? 'N/A'})\n\n`;

      content += `| Company | ${chart.xAxis} | ${chart.yAxis} |\n`;
      content += `|---------|--------|--------|\n`;
      chart.companies.forEach((c: any) => {
        content += `| ${c.name} | ${c.x} | ${c.y} |\n`;
      });
      content += `\n`;
    });
  }

  content += `---\n\n`;

  // 4. COMPETITOR KEYWORDS
  if (keywords?.competitors) {
    content += `## 4. COMPETITOR KEYWORD INTELLIGENCE\n\n`;

    keywords.competitors.forEach((comp: any) => {
      content += `### ${comp.name}\n`;
      content += `**Primary Keywords:** ${comp.primaryKeywords?.join(', ') || 'N/A'}\n\n`;

      if (comp.contentStrategy) {
        content += `**Content Strategy Signals:**\n`;
        content += `${comp.contentStrategy}\n\n`;
      }
    });

    if (keywords.strategicGaps) {
      content += `### Strategic Keyword Gaps\n`;
      keywords.strategicGaps.forEach((gap: string) => {
        content += `- ${gap}\n`;
      });
      content += `\n`;
    }
  }

  content += `---\n\n`;

  // 5. PRODUCTS & SERVICES
  if (offerings?.client_offerings?.offerings) {
    content += `## 5. YOUR PRODUCTS & SERVICES\n\n`;

    offerings.client_offerings.offerings.forEach((offer: any, i: number) => {
      content += `### ${i + 1}. ${offer.name}\n`;
      content += `${offer.description}\n`;
      if (offer.pricing) content += `**Pricing:** ${offer.pricing}\n`;
      content += `\n`;
    });
  }

  if (offerings?.competitor_offerings) {
    content += `### Competitor Offerings Comparison\n\n`;
    offerings.competitor_offerings.forEach((comp: any) => {
      content += `**${comp.competitorName}:**\n`;
      comp.offerings?.forEach((off: any) => {
        content += `- ${off.name}: ${off.description}\n`;
      });
      content += `\n`;
    });
  }

  content += `---\n\n`;

  // 6. STRATEGIC RECOMMENDATIONS
  content += `## 6. STRATEGIC RECOMMENDATIONS\n\n`;
  content += `### Immediate Actions (0-30 Days)\n`;
  content += `1. Review competitor positioning and adjust messaging accordingly\n`;
  content += `2. Target identified keyword gaps with new content\n`;
  content += `3. Enhance value proposition based on competitive analysis\n\n`;

  content += `### Strategic Initiatives (30-90 Days)\n`;
  content += `1. Develop content targeting high-opportunity keywords\n`;
  content += `2. Refine product offerings based on market gaps\n`;
  content += `3. Launch competitive differentiation campaign\n\n`;

  content += `### Long-term Goals (90+ Days)\n`;
  content += `1. Establish thought leadership in identified gaps\n`;
  content += `2. Expand service offerings into underserved areas\n`;
  content += `3. Build strategic partnerships to strengthen market position\n\n`;

  content += `---\n\n`;
  content += `**Report generated by Contivo AI** | ${new Date().toISOString()}\n`;

  return content;
}
