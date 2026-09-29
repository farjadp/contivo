import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';

/** Keep in step with REQUIRED_MATRIX_CHARTS in apps/web/src/lib/report-readiness.ts. */
const REQUIRED_MATRIX_CHARTS = 3;

/**
 * A local copy of isFabricatedLegacyMatrices in
 * apps/web/src/lib/report-readiness.ts (the API has no shared import path);
 * keep the two in step. The old matrix generator filled points it had no
 * evidence for with this reason and a 0.42 confidence, and charts with this
 * pattern. A legacy blob (no run_id) carrying either is invented data and must
 * not count as completed matrices (spec M3).
 */
const FABRICATED_REASON = 'Score estimated from limited evidence and public positioning signals.';
const FABRICATED_CONFIDENCE = 0.42;
const FABRICATED_PATTERN = 'Estimated pattern from limited public signals.';

function isFabricatedLegacyMatrices(matrices: unknown): boolean {
  if (!matrices || typeof matrices !== 'object' || Array.isArray(matrices)) return false;
  const m = matrices as Record<string, any>;
  if (m.run_id || !Array.isArray(m.charts)) return false;
  return m.charts.some((chart: any) => {
    if (!chart || typeof chart !== 'object') return false;
    if (chart.summary?.market_pattern === FABRICATED_PATTERN) return true;
    return (
      Array.isArray(chart.companies) &&
      chart.companies.some(
        (company: any) =>
          company?.x_reason === FABRICATED_REASON && company?.confidence_score === FABRICATED_CONFIDENCE,
      )
    );
  });
}

@Injectable()
export class StrategicReportEligibilityService {
  constructor(private prisma: PrismaService) {}

  private readonly MONTHLY_LIMIT = 5;

  async checkEligibility(workspaceId: string, userId: string): Promise<{
    canGenerate: boolean;
    reason?: string;
    reportsThisMonth: number;
    sectionsCompleted: string[];
    missingData: string[];
  }> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const reportsThisMonth = await this.prisma.strategicReport.count({
      where: {
        userId,
        reportDate: { gte: startOfMonth },
      },
    });

    if (reportsThisMonth >= this.MONTHLY_LIMIT) {
      return {
        canGenerate: false,
        reason: `Monthly limit reached (${this.MONTHLY_LIMIT} reports)`,
        reportsThisMonth,
        sectionsCompleted: [],
        missingData: [],
      };
    }

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        brandSummary: true,
        audienceInsights: true,
        competitors: {
          where: { userDecision: 'ACCEPTED' },
          select: { id: true },
        },
      },
    });

    if (!workspace) {
      return {
        canGenerate: false,
        reason: 'Workspace not found',
        reportsThisMonth,
        sectionsCompleted: [],
        missingData: [],
      };
    }

    const insights = workspace.audienceInsights as any;
    const sectionsCompleted: string[] = [];
    const missingData: string[] = [];

    if (workspace.brandSummary) {
      sectionsCompleted.push('Brand Memory');
    } else {
      missingData.push('Brand Memory');
    }

    if (
      insights?.competitiveMatrices?.charts?.length >= REQUIRED_MATRIX_CHARTS &&
      !isFabricatedLegacyMatrices(insights.competitiveMatrices)
    ) {
      sectionsCompleted.push('Market Matrices');
    } else {
      missingData.push(`Market Matrices (need ${REQUIRED_MATRIX_CHARTS} charts)`);
    }

    if (insights?.competitorKeywordsIntel?.competitors?.length > 0) {
      sectionsCompleted.push('Competitor Keywords');
    } else {
      missingData.push('Competitor Keywords');
    }

    if (insights?.productsServicesIntel?.client_offerings?.offerings?.length > 0) {
      sectionsCompleted.push('Products & Services');
    } else {
      missingData.push('Products & Services');
    }

    const canGenerate = missingData.length === 0;

    return {
      canGenerate,
      reason: canGenerate ? undefined : 'Missing required data sections',
      reportsThisMonth,
      sectionsCompleted,
      missingData,
    };
  }

  async getReportHistory(workspaceId: string) {
    return this.prisma.strategicReport.findMany({
      where: { workspaceId },
      orderBy: { reportDate: 'desc' },
      take: 20,
      select: {
        id: true,
        reportDate: true,
        fileSize: true,
        sectionsIncluded: true,
        competitorsCount: true,
        keywordsAnalyzed: true,
        chartsGenerated: true,
        docxPath: true,
        pdfPath: true,
      },
    });
  }
}
