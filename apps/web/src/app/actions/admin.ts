'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { getSession } from '@/lib/auth';
import {
  getContentWordCountLimits,
  getIdeationMaxContentCount,
  PLATFORM_LIMIT_MAX,
  PLATFORM_LIMIT_MIN,
  setBrandMemoryRescrapeLimit,
  setContentWordCountLimits,
  setCompetitiveLandscapeLimit,
  setGeminiModel,
  setIdeationMaxContentCount,
} from '@/lib/app-settings';
import {
  WORD_COUNT_LIMIT_ABSOLUTE_MAX,
  WORD_COUNT_LIMIT_ABSOLUTE_MIN,
  WORD_COUNT_PLATFORMS,
  type ContentWordCountLimits,
} from '@/lib/content-word-count';

const MODEL_PATTERN = /^[a-zA-Z0-9._-]+$/;

export async function updateGeminiModel(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    redirect('/dashboard');
  }

  const model = String(formData.get('geminiModel') || '').trim();
  if (!model) {
    redirect('/admin?settings=empty');
  }

  if (model.length > 120 || !MODEL_PATTERN.test(model)) {
    redirect('/admin?settings=invalid');
  }

  try {
    await setGeminiModel(model);
  } catch (error) {
    console.error('Failed to update Gemini model from admin:', error);
    redirect('/admin?settings=failed');
  }

  revalidatePath('/admin');
  redirect('/admin?settings=saved');
}

function parseLimit(value: FormDataEntryValue | null): number | null {
  const parsed = Number(String(value || '').trim());
  if (!Number.isInteger(parsed)) return null;
  if (parsed < PLATFORM_LIMIT_MIN || parsed > PLATFORM_LIMIT_MAX) return null;
  return parsed;
}

function parseWordCount(value: FormDataEntryValue | null): number | null {
  const parsed = Number(String(value || '').trim());
  if (!Number.isInteger(parsed)) return null;
  if (parsed < WORD_COUNT_LIMIT_ABSOLUTE_MIN || parsed > WORD_COUNT_LIMIT_ABSOLUTE_MAX) return null;
  return parsed;
}

export async function updatePlatformLimits(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    redirect('/dashboard');
  }

  const redirectToRaw = String(formData.get('redirectTo') || '/admin');
  const redirectBase = redirectToRaw === '/settings' ? '/settings' : '/admin';

  const competitiveLimit = parseLimit(formData.get('competitiveLandscapeLimit'));
  const brandMemoryLimit = parseLimit(formData.get('brandMemoryLimit'));
  const ideationMaxContentCountRaw = formData.get('ideationMaxContentCount');
  const ideationMaxContentCountParsed = ideationMaxContentCountRaw == null ? null : parseLimit(ideationMaxContentCountRaw);

  if (
    competitiveLimit == null ||
    brandMemoryLimit == null ||
    (ideationMaxContentCountRaw != null && ideationMaxContentCountParsed == null)
  ) {
    redirect(`${redirectBase}?limits=invalid`);
  }

  const ideationMaxContentCount =
    ideationMaxContentCountParsed == null
      ? await getIdeationMaxContentCount()
      : ideationMaxContentCountParsed;

  const currentWordCountLimits = await getContentWordCountLimits();
  const nextWordCountLimits: ContentWordCountLimits = { ...currentWordCountLimits };
  for (const platform of WORD_COUNT_PLATFORMS) {
    const minRaw = formData.get(`wordMin_${platform}`);
    const maxRaw = formData.get(`wordMax_${platform}`);

    if (minRaw == null && maxRaw == null) continue;

    const min = parseWordCount(minRaw);
    const max = parseWordCount(maxRaw);
    if (min == null || max == null || min > max) {
      redirect(`${redirectBase}?limits=invalid`);
    }
    nextWordCountLimits[platform] = { min, max };
  }

  try {
    await Promise.all([
      setCompetitiveLandscapeLimit(competitiveLimit),
      setBrandMemoryRescrapeLimit(brandMemoryLimit),
      setIdeationMaxContentCount(ideationMaxContentCount),
      setContentWordCountLimits(nextWordCountLimits),
    ]);
  } catch (error) {
    console.error('Failed to update platform limits from admin:', error);
    redirect(`${redirectBase}?limits=failed`);
  }

  revalidatePath('/admin');
  revalidatePath('/settings');
  revalidatePath('/growth');
  redirect(`${redirectBase}?limits=saved`);
}
