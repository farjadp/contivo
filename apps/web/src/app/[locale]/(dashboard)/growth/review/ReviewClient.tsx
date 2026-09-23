'use client';

import { useActionState, useState } from 'react';
import { Sparkles, Edit2, CheckCircle2 } from 'lucide-react';
import { confirmGrowthStrategy } from '@/app/actions/growth-review';

const initialState = {
  error: '',
};

export default function ReviewClient({ workspace, summary }: { workspace: any, summary: any }) {
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
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest">Business Summary</h3>
            <button 
              type="button" 
              onClick={() => toggleEdit('business')}
              className="text-indigo-600 hover:text-indigo-800 transition"
            >
              {isEditing['business'] ? <CheckCircle2 className="h-4 w-4" /> : <Edit2 className="h-4 w-4" />}
            </button>
          </div>
          {isEditing['business'] ? (
            <textarea
              name="businessSummary"
              value={businessSummary}
              onChange={(e) => setBusinessSummary(e.target.value)}
              className="w-full h-24 text-sm text-[#121212] bg-gray-50 border border-gray-200 rounded-lg p-3 focus:outline-none focus:border-indigo-500 transition"
            />
          ) : (
            <p className="text-[#121212] text-base leading-relaxed">
              {businessSummary || 'No summary extracted.'}
              <input type="hidden" name="businessSummary" value={businessSummary} />
            </p>
          )}
        </div>

        {/* Target Audience Card */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest">Target Audience</h3>
            <button 
              type="button" 
              onClick={() => toggleEdit('audience')}
              className="text-indigo-600 hover:text-indigo-800 transition"
            >
              {isEditing['audience'] ? <CheckCircle2 className="h-4 w-4" /> : <Edit2 className="h-4 w-4" />}
            </button>
          </div>
          {isEditing['audience'] ? (
            <textarea
              name="audience"
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              className="w-full h-24 text-sm text-[#121212] bg-gray-50 border border-gray-200 rounded-lg p-3 focus:outline-none focus:border-indigo-500 transition"
            />
          ) : (
            <p className="text-[#121212] text-base leading-relaxed">
              {audience || 'No audience extracted.'}
              <input type="hidden" name="audience" value={audience} />
            </p>
          )}
        </div>

        {/* Brand Tone Card */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest">Brand Tone</h3>
            <button 
              type="button" 
              onClick={() => toggleEdit('tone')}
              className="text-indigo-600 hover:text-indigo-800 transition"
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
              className="w-full text-sm text-[#121212] bg-gray-50 border border-gray-200 rounded-lg p-3 focus:outline-none focus:border-indigo-500 transition"
            />
          ) : (
            <div className="flex flex-wrap gap-2">
               {tone.split(',').map((t: string, idx: number) => (
                 <span key={idx} className="bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-full text-sm font-medium">
                   {t.trim()}
                 </span>
               ))}
               <input type="hidden" name="tone" value={tone} />
            </div>
          )}
        </div>

        {/* Industry Guess Card */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest">Detected Industry</h3>
            <button 
              type="button" 
              onClick={() => toggleEdit('industry')}
              className="text-indigo-600 hover:text-indigo-800 transition"
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
              className="w-full text-sm text-[#121212] bg-gray-50 border border-gray-200 rounded-lg p-3 focus:outline-none focus:border-indigo-500 transition"
            />
          ) : (
            <p className="text-[#121212] text-base leading-relaxed font-medium">
              {industry || 'Unknown industry.'}
              <input type="hidden" name="industry" value={industry} />
            </p>
          )}
        </div>

        {/* Positioning Opportunity (Optional, from Phase 7) */}
        {summary.positioningOpportunity && (
          <div className="bg-white rounded-2xl border border-indigo-100 p-6 shadow-sm shadow-indigo-100 sm:col-span-2">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-sm font-bold text-indigo-500 flex items-center gap-1.5 uppercase tracking-widest"><Sparkles className="w-4 h-4"/> Positioning Opportunity</h3>
            </div>
            <p className="text-[#121212] text-sm leading-relaxed">
              {summary.positioningOpportunity}
            </p>
            <input type="hidden" name="positioningOpportunity" value={summary.positioningOpportunity} />
          </div>
        )}

        {/* Messaging Differentiation */}
        {summary.messagingDifferentiation && (
          <div className="bg-white rounded-2xl border border-emerald-100 p-6 shadow-sm shadow-emerald-100 sm:col-span-2">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-sm font-bold text-emerald-600 flex items-center gap-1.5 uppercase tracking-widest"><Sparkles className="w-4 h-4"/> Messaging Differentiation</h3>
            </div>
            <p className="text-[#121212] text-sm leading-relaxed">
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
          className="rounded-xl min-w-[200px] bg-brand-gradient py-4 px-8 text-base font-bold text-white shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-2"
        >
          {pending ? 'Saving Changes...' : <><Sparkles className="h-4 w-4" /> Confirm & Generate Strategy</>}
        </button>
      </div>

    </form>
  );
}
