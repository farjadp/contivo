'use server';

import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import { scrapeUrl, analyzeWebsiteWithGemini } from '@/lib/gemini';
import { writeActivityLog } from '@/lib/activity-log';
import { getBrandMemoryRescrapeLimit } from '@/lib/app-settings';

export async function rescrapeWorkspace(_prevState: any, formData: FormData) {
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };
  const userId = session.userId as string;

  const workspaceId = formData.get('workspaceId') as string;

  if (!workspaceId) {
    return { error: 'Missing workspace ID' };
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId, userId },
  });

  if (!workspace) return { error: 'Workspace not found' };

  const maxRuns = await getBrandMemoryRescrapeLimit();

  if (workspace.rescrapeCount >= maxRuns) {
    await writeActivityLog({
      userId,
      workspaceId,
      action: 'BRAND_MEMORY_RESCRAPE_BLOCKED',
      detail: {
        reason: 'MAX_ATTEMPTS_REACHED',
        usedAttempts: workspace.rescrapeCount,
        maxAttempts: maxRuns,
      },
    });
    return { error: `You have reached the maximum number of rescraping attempts (${maxRuns}/${maxRuns}).` };
  }

  if (!workspace.websiteUrl) {
    return { error: 'Workspace has no website URL to scrape.' };
  }

  let newBrandSummary: any = {};
  
  try {
    const scrapedText = await scrapeUrl(workspace.websiteUrl);
    if (!scrapedText) {
       await writeActivityLog({
         userId,
         workspaceId,
         action: 'BRAND_MEMORY_RESCRAPE_FAILED',
         detail: { reason: 'SCRAPE_FAILED' },
       });
       return { error: 'Could not fetch data from the website.' };
    }

    const aiResult = await analyzeWebsiteWithGemini(workspace.websiteUrl, scrapedText);
    if (!aiResult) {
       await writeActivityLog({
         userId,
         workspaceId,
         action: 'BRAND_MEMORY_RESCRAPE_FAILED',
         detail: { reason: 'AI_ANALYSIS_FAILED' },
       });
       return { error: 'AI failed to analyze the website.' };
    }

    newBrandSummary = {
       heroMessage: aiResult.heroMessage,
       extractedCta: aiResult.extractedCta,
       industry: aiResult.industry,
       businessSummary: aiResult.businessSummary,
       audience: aiResult.audience,
       tone: aiResult.tone,
       valueProposition: aiResult.valueProposition,
       pillars: aiResult.pillars || [],
       persona: aiResult.persona || { title: '', description: '' }
    };

    // Preserve existing positioning from the old summary if we have it, to avoid losing it.
    // Conditionally apply them to avoid passing `undefined` to Prisma JSON
    const oldSum = workspace.brandSummary as any;
    if (oldSum?.positioningOpportunity) newBrandSummary.positioningOpportunity = oldSum.positioningOpportunity;
    if (oldSum?.messagingDifferentiation) newBrandSummary.messagingDifferentiation = oldSum.messagingDifferentiation;

  } catch (err) {
     console.error("Failed to execute Gemini rescrape flow:", err);
     await writeActivityLog({
       userId,
       workspaceId,
       action: 'BRAND_MEMORY_RESCRAPE_FAILED',
       detail: { reason: 'UNEXPECTED_ERROR' },
     });
     return { error: 'An unexpected error occurred during rescraping.' };
  }

  // Archive old summary
  const currentSummary = workspace.brandSummary as any || {};
  const currentArchive = workspace.archivedSummaries as any[] || [];
  
  const archiveEntry = {
    summary: currentSummary,
    archivedAt: new Date().toISOString()
  };

  const newArchive = [...currentArchive, archiveEntry];

  await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      brandSummary: newBrandSummary,
      archivedSummaries: newArchive,
      rescrapeCount: { increment: 1 },
      status: 'READY' // ensure it's ready
    },
  });

  revalidatePath(`/growth/${workspaceId}`);

  await writeActivityLog({
    userId,
    workspaceId,
    action: 'BRAND_MEMORY_RESCRAPE_SUCCEEDED',
    detail: {
      attemptsUsed: workspace.rescrapeCount + 1,
      archiveCount: newArchive.length,
    },
  });

  return { success: true };
}
