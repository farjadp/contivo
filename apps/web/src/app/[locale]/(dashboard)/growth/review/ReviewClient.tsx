'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Sparkles, Edit2, CheckCircle2 } from 'lucide-react';
import { confirmGrowthStrategy } from '@/app/actions/growth-review';

const initialState = {
  error: '',
};

export default function ReviewClient({ workspace, summary }: { workspace: any, summary: any }) {
  const t = useTranslations('growth.review');
  const [state, formAction, pending] = useActionState(confirmGrowthStrategy as any, initialState);

  // Local state for editable fields
  const [isEditing, setIsEditing] = useState<Record<string, boolean>>({});
  
  const [businessSummary, setBusinessSummary] = useState(summary.businessSummary || '');
  const [audience, setAudience] = useState(summary.audience || '');
  const [tone, setTone] = useState(summary.tone || '');
  const [industry, setIndustry] = useState(summary.industry || '');

  const toggleEdit = (field: string) => {
    setIsEditing(prev => ({ ...prev, [field]: !prev[field] }));
  };

  return (
    <form action={formAction as any} className="space-y-6">
      <input type="hidden" name="id" value={workspace.id} />

      <div className="grid gap-6 md:grid-cols-2">
        
        {/* Business Summary Card */}
        <div className="bg-chalk-raised rounded-2xl border border-rule p-6 shadow-sm">
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-sm font-bold text-moss-muted uppercase tracking-widest">{t('businessSummary')}</h3>
            <button 
              type="button" 
              onClick={() => toggleEdit('business')}
              className="text-moss-700 hover:text-moss transition"
            >
              {isEditing['business'] ? <CheckCircle2 className="h-4 w-4" /> : <Edit2 className="h-4 w-4" />}
            </button>
          </div>
          {isEditing['business'] ? (
            <textarea
              name="businessSummary"
              value={businessSummary}
              onChange={(e) => setBusinessSummary(e.target.value)}
              className="w-full h-24 text-sm text-moss bg-chalk border border-rule rounded-lg p-3 focus:outline-none focus:border-moss transition"
            />
          ) : (
            <p className="text-moss text-base leading-relaxed">
              {businessSummary || t('emptySummary')}
              <input type="hidden" name="businessSummary" value={businessSummary} />
            </p>
          )}
        </div>

        {/* Target Audience Card */}
        <div className="bg-chalk-raised rounded-2xl border border-rule p-6 shadow-sm">
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-sm font-bold text-moss-muted uppercase tracking-widest">{t('targetAudience')}</h3>
            <button 
              type="button" 
              onClick={() => toggleEdit('audience')}
              className="text-moss-700 hover:text-moss transition"
            >
              {isEditing['audience'] ? <CheckCircle2 className="h-4 w-4" /> : <Edit2 className="h-4 w-4" />}
            </button>
          </div>
          {isEditing['audience'] ? (
            <textarea
              name="audience"
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              className="w-full h-24 text-sm text-moss bg-chalk border border-rule rounded-lg p-3 focus:outline-none focus:border-moss transition"
            />
          ) : (
            <p className="text-moss text-base leading-relaxed">
              {audience || t('emptyAudience')}
              <input type="hidden" name="audience" value={audience} />
            </p>
          )}
        </div>

        {/* Brand Tone Card */}
        <div className="bg-chalk-raised rounded-2xl border border-rule p-6 shadow-sm">
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-sm font-bold text-moss-muted uppercase tracking-widest">{t('brandTone')}</h3>
            <button 
              type="button" 
              onClick={() => toggleEdit('tone')}
              className="text-moss-700 hover:text-moss transition"
            >
              {isEditing['tone'] ? <CheckCircle2 className="h-4 w-4" /> : <Edit2 className="h-4 w-4" />}
            </button>
          </div>
          {isEditing['tone'] ? (
            <input
              type="text"
              name="tone"
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              className="w-full text-sm text-moss bg-chalk border border-rule rounded-lg p-3 focus:outline-none focus:border-moss transition"
            />
          ) : (
            <div className="flex flex-wrap gap-2">
               {tone.split(',').map((t: string, idx: number) => (
                 <span key={idx} className="bg-chalk-sunk text-moss px-3 py-1.5 rounded-full text-sm font-medium">
                   {t.trim()}
                 </span>
               ))}
               <input type="hidden" name="tone" value={tone} />
            </div>
          )}
        </div>

        {/* Industry Guess Card */}
        <div className="bg-chalk-raised rounded-2xl border border-rule p-6 shadow-sm">
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-sm font-bold text-moss-muted uppercase tracking-widest">{t('detectedIndustry')}</h3>
            <button 
              type="button" 
              onClick={() => toggleEdit('industry')}
              className="text-moss-700 hover:text-moss transition"
            >
              {isEditing['industry'] ? <CheckCircle2 className="h-4 w-4" /> : <Edit2 className="h-4 w-4" />}
            </button>
          </div>
          {isEditing['industry'] ? (
            <input
              type="text"
              name="industry"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              className="w-full text-sm text-moss bg-chalk border border-rule rounded-lg p-3 focus:outline-none focus:border-moss transition"
            />
          ) : (
            <p className="text-moss text-base leading-relaxed font-medium">
              {industry || t('emptyIndustry')}
              <input type="hidden" name="industry" value={industry} />
            </p>
          )}
        </div>

        {/* Positioning Opportunity (Optional, from Phase 7) */}
        {summary.positioningOpportunity && (
          <div className="bg-chalk-raised rounded-2xl border border-rule p-6 shadow-sm shadow-chalk sm:col-span-2">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-sm font-bold text-moss-700 flex items-center gap-1.5 uppercase tracking-widest"><Sparkles className="w-4 h-4"/> {t('positioning')}</h3>
            </div>
            <p className="text-moss text-sm leading-relaxed">
              {summary.positioningOpportunity}
            </p>
            <input type="hidden" name="positioningOpportunity" value={summary.positioningOpportunity} />
          </div>
        )}

        {/* Messaging Differentiation */}
        {summary.messagingDifferentiation && (
          <div className="bg-chalk-raised rounded-2xl border border-rule p-6 shadow-sm shadow-emerald-100 sm:col-span-2">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-sm font-bold text-moss-700 flex items-center gap-1.5 uppercase tracking-widest"><Sparkles className="w-4 h-4"/> {t('messaging')}</h3>
            </div>
            <p className="text-moss text-sm leading-relaxed">
              {summary.messagingDifferentiation}
            </p>
            <input type="hidden" name="messagingDifferentiation" value={summary.messagingDifferentiation} />
          </div>
        )}

      </div>

      {state?.error && (
        <div className="rounded-xl bg-red-50 p-4 text-sm font-medium text-red-600 border border-red-100">
          {state.error}
        </div>
      )}

      {/* Action Bar */}
      <div className="mt-8 flex justify-end pb-12">
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl min-w-[200px] bg-saffron py-4 px-8 text-base font-bold text-moss shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-2"
        >
          {pending ? t('saving') : <><Sparkles className="h-4 w-4" /> {t('confirm')}</>}
        </button>
      </div>

    </form>
  );
}
