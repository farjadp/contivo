'use client';

import { useActionState, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { rescrapeWorkspace } from '@/app/actions/growth-rescrape';
import { RefreshCw, History, ChevronDown } from 'lucide-react';

const initialState = { error: '', success: false };

export function RescrapeManager({ workspace, maxRuns }: { workspace: any; maxRuns: number }) {
  const t = useTranslations('tabsB.rescrape');
  const format = useFormatter();
  const [state, formAction, pending] = useActionState(rescrapeWorkspace as any, initialState);
  const [showArchive, setShowArchive] = useState(false);

  const remaining = Math.max(0, maxRuns - (workspace.rescrapeCount || 0));
  const archives = workspace.archivedSummaries || [];

  return (
    <div className="flex flex-col items-end gap-3 w-full">
      <div className="flex items-center gap-2">
        {archives.length > 0 && (
           <button 
             onClick={() => setShowArchive(!showArchive)}
             className="flex items-center gap-1.5 text-xs font-bold text-gray-500 bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded-lg transition"
           >
             <History className="w-3.5 h-3.5" /> 
             {t('history', { count: format.number(archives.length) })}
             <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showArchive ? 'rotate-180' : ''}`} />
           </button>
        )}
        
        <form action={formAction as any}>
          <input type="hidden" name="workspaceId" value={workspace.id} />
          <button 
            type="submit" 
            disabled={pending || remaining <= 0}
            className="flex items-center gap-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:hover:bg-indigo-600 px-4 py-2 rounded-lg transition shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${pending ? 'animate-spin' : ''}`} />
            {pending ? t('scraping') : t('rescrape', { remaining: format.number(remaining) })}
          </button>
        </form>
      </div>

      {state?.error && (
        <p className="text-xs text-red-500 font-bold">{state.error}</p>
      )}

      {showArchive && archives.length > 0 && (
         <div className="mt-2 w-full max-w-lg bg-gray-50 border border-gray-200 rounded-xl p-4 shadow-sm animate-in fade-in slide-in-from-top-2">
           <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">{t('previousVersions')}</h4>
           <div className="space-y-3">
             {archives.map((arch: any, idx: number) => {
                /* Through next-intl rather than toLocaleDateString(), so the
                   Persian side gets the Persian calendar and Tehran time. */
                const parsed = new Date(arch.archivedAt);
                const date = Number.isNaN(parsed.getTime())
                  ? String(arch.archivedAt)
                  : format.dateTime(parsed, {
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                    });
                return (
                  <div key={idx} className="bg-white p-3 rounded-lg border border-gray-100 text-sm">
                     <div className="flex justify-between items-center mb-1">
                        <span className="font-bold text-gray-700">{t('archived', { date })}</span>
                     </div>
                     <p className="text-gray-500 text-xs line-clamp-2">{arch.summary?.businessSummary || t('noSummary')}</p>
                     
                     <div className="mt-2 text-xs">
                        <span className="font-semibold text-gray-600">{t('tone')}</span>
                        {arch.summary?.tone || t('na')}
                     </div>
                  </div>
                );
             }).reverse()}
           </div>
         </div>
      )}
    </div>
  );
}
