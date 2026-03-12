'use server';

import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { scrapeUrl, analyzeWebsiteWithGemini, discoverCompetitorsWithGemini } from '@/lib/gemini';
import { writeActivityLog } from '@/lib/activity-log';
import { createWorkspaceProgressBaseline } from '@/lib/workspace-progress';

export async function createNewWorkspace(_prevState: any, formData: FormData) {
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };

  const name = formData.get('name') as string;
  const url = formData.get('url') as string;

  if (!name || !url) {
    return { error: 'Please provide both Company Name and Website URL.' };
  }

  // Generate real AI extraction
  let brandSummary: any = {};
  let competitorsData: any[] = [];
  
  try {
    const scrapedText = await scrapeUrl(url);
    if (scrapedText) {
       const aiResult = await analyzeWebsiteWithGemini(url, scrapedText);
       if (aiResult) {
          brandSummary = {
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

          // Discover Competitors
          const comps = await discoverCompetitorsWithGemini(brandSummary);
          if (comps) competitorsData = comps;
       }
    }
  } catch (err) {
     console.error("Failed to execute Gemini extraction flow:", err);
     // Proceed with empty defaults if AI fails
  }

  // Fallback defaults if generation failed
  if (!Object.keys(brandSummary).length) {
      brandSummary = {
        industry: 'Unknown',
        businessSummary: 'Could not extract summary.',
        audience: 'Unknown Audience',
        tone: 'Professional',
        pillars: ['Industry Updates', 'Product News']
      };
  }

  const progressBaseline = createWorkspaceProgressBaseline({
    brandSummary,
  });

  const workspace = await prisma.workspace.create({
    data: {
      userId: session.userId as string,
      name,
      websiteUrl: url,
      status: 'PENDING', // Send to analysis
      brandSummary,
      audienceInsights: {
        progressReport: {
          baseline: progressBaseline,
        },
      },
    },
  });

  if (competitorsData.length > 0) {
    await prisma.competitor.createMany({
      data: competitorsData.map(c => ({
        workspaceId: workspace.id,
        name: c.name,
        domain: c.domain,
        description: c.description,
        category: c.category,
        audienceGuess: c.audienceGuess,
        source: 'AI'
      }))
    });
  }

  await writeActivityLog({
    userId: session.userId as string,
    workspaceId: workspace.id,
    action: 'WORKSPACE_BASELINE_SNAPSHOT_CREATED',
    detail: {
      baselineCreatedAt: progressBaseline.created_at,
      baselineScores: progressBaseline.scores,
      baselineMaturityStage: progressBaseline.maturity_stage,
    },
  });

  await writeActivityLog({
    userId: session.userId as string,
    workspaceId: workspace.id,
    action: 'WORKSPACE_CREATED',
    detail: {
      name,
      websiteUrl: url,
      competitorsSeeded: competitorsData.length,
    },
  });

  // Redirect to the analyzing progress screen
  redirect(`/growth/analyzing?id=${workspace.id}`);
}
