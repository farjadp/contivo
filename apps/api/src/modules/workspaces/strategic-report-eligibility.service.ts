import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

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

    if (insights?.competitiveMatrices?.charts?.length >= 5) {
      sectionsCompleted.push('Market Matrices');
    } else {
      missingData.push('Market Matrices (need 5 charts)');
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
