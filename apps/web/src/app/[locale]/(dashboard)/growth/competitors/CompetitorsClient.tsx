'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { saveCompetitors } from '@/app/actions/growth-competitors';
import { Sparkles, Check, X, Plus, Target, Globe } from 'lucide-react';

const initialState = { error: '' };

export default function CompetitorsClient({ workspace, initialCompetitors }: any) {
  const t = useTranslations('growth.competitors');
  const [state, formAction, pending] = useActionState(saveCompetitors as any, initialState);

  // Initialize state with some pseudo-random coordinates for the map projection
  const [competitors, setCompetitors] = useState(() => 
    initialCompetitors.map((c: any, i: number) => ({
      ...c,
      userDecision: c.userDecision || 'ACCEPTED', // default
      type: c.type || 'DIRECT', // default
      x: 15 + (Math.abs(Math.sin(i + 1)) * 70), // Keep between 15-85% 
      y: 15 + (Math.abs(Math.cos(i + 1)) * 70),
    }))
  );

  const [newUrl, setNewUrl] = useState('');

  const handleDecision = (id: string, decision: string) => {
    setCompetitors((prev: any) => prev.map((c: any) => c.id === id ? { ...c, userDecision: decision } : c));
  };

  const handleType = (id: string, type: string) => {
    setCompetitors((prev: any) => prev.map((c: any) => c.id === id ? { ...c, type } : c));
  };

  const addManual = () => {
    if (!newUrl) return;
    const cleanUrl = newUrl.replace(/^https?:\/\//, '').split('/')[0];
    const newComp = {
      id: `temp-${Date.now()}`,
      workspaceId: workspace.id,
      name: cleanUrl,
      domain: newUrl,
      description: t('manualDescription'),
      category: 'Unknown',
      audienceGuess: 'Unknown',
      type: 'DIRECT',
      userDecision: 'ACCEPTED',
      x: 20 + Math.random() * 60,
      y: 20 + Math.random() * 60,
    };
    setCompetitors([...competitors, newComp]);
    setNewUrl('');
  };

  const acceptedCount = competitors.filter((c: any) => c.userDecision === 'ACCEPTED').length;

  return (
    <div className="space-y-8">
      {/* Visual Map */}
      <div className="bg-chalk-raised rounded-3xl border border-rule p-8 shadow-sm">
         <h2 className="text-xl font-bold tracking-tight text-moss mb-6">{t('mapTitle')}</h2>
         
         {/* A scatter plot is a coordinate space, not prose: its axes keep
             their orientation in both languages, so the container is pinned
             LTR and only the labels are translated. */}
         <div dir="ltr" className="relative w-full h-[300px] sm:h-[400px] border-l-2 border-b-2 border-rule bg-chalk/50 rounded-tr-lg rounded-bl-lg overflow-visible">
           <span className="absolute -left-12 top-1/2 -translate-y-1/2 -rotate-90 text-[10px] font-bold text-moss-muted uppercase tracking-widest whitespace-nowrap">{t('axisY')}</span>
           <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-[10px] font-bold text-moss-muted uppercase tracking-widest whitespace-nowrap">{t('axisX')}</span>

           {/* User Brand Center Node */}
           <div className="absolute left-[50%] top-[50%] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
             <div className="h-8 w-8 rounded-full bg-saffron border-2 border-moss shadow-xl z-20 flex items-center justify-center">
                <Target className="w-4 h-4 text-moss" />
             </div>
             <span className="mt-2 text-xs font-bold text-moss bg-chalk-sunk border border-rule px-2 py-0.5 rounded shadow-sm">{t('yourBrand')}</span>
           </div>

           {/* Competitor Nodes */}
           {competitors.filter((c:any) => c.userDecision !== 'REJECTED').map((c: any) => (
             <div 
               key={c.id} 
               className="absolute flex flex-col items-center group transition-all duration-300 hover:z-40"
               style={{ left: `${c.x}%`, top: `${c.y}%`, transform: 'translate(-50%, -50%)' }}
             >
               <div className={`h-4 w-4 rounded-full border-2 shadow-sm z-10 transition-transform group-hover:scale-150 
                 ${c.type === 'DIRECT' ? 'bg-rival border-rival' : 
                   c.type === 'INDIRECT' ? 'bg-chalk-raised border-rival' : 'bg-moss-700 border-moss-700'}`} 
               />
               <span className="mt-1.5 text-[10px] font-bold text-moss bg-chalk-raised border border-rule px-2 py-1 rounded shadow-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-30">
                 {c.name}
               </span>
             </div>
           ))}
         </div>
         
         <div className="mt-10 flex flex-wrap items-center justify-center gap-6 text-xs font-semibold text-moss-muted">
           <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full border-2 bg-rival border-rival" /> {t('legendDirect')}</div>
           <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full border-2 bg-chalk-raised border-rival" /> {t('legendIndirect')}</div>
           <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full border-2 bg-moss-700 border-moss-700" /> {t('legendAspirational')}</div>
         </div>
      </div>

      {/* Manual Add Input */}
      <div className="bg-chalk-raised rounded-2xl border border-rule p-2 sm:p-2 sm:pl-4 flex flex-col sm:flex-row items-center gap-2 shadow-sm focus-within:ring-2 focus-within:ring-saffron transition-all">
        <Globe className="text-moss-muted h-5 w-5 shrink-0 hidden sm:block" />
        <input 
          type="url" 
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          placeholder={t('addPlaceholder')}
          className="flex-1 w-full bg-transparent text-sm font-medium text-moss focus:outline-none placeholder-moss-muted p-3 sm:p-0"
        />
        <button onClick={addManual} type="button" disabled={!newUrl} className="w-full sm:w-auto text-sm font-bold bg-moss text-chalk px-6 py-3 sm:py-2 rounded-xl hover:bg-moss transition shrink-0 disabled:opacity-50">
           {t('add')} <Plus className="inline w-4 h-4 ms-1" />
        </button>
      </div>

      {/* Competitor List */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {competitors.map((c: any) => (
           <div key={c.id} className={`bg-chalk-raised rounded-2xl border p-5 shadow-sm transition-all duration-300 ${c.userDecision === 'REJECTED' ? 'border-red-200 opacity-50 bg-red-50/20 grayscale' : 'border-rule hover:border-rule-strong hover:shadow-md'}`}>
              <div className="flex justify-between items-start mb-3">
                 <h3 className="font-bold text-moss truncate pr-2" title={c.name}>{c.name}</h3>
                 
                 <div className="flex bg-chalk-sunk/80 rounded-lg p-0.5 shrink-0">
                   <button 
                     type="button" 
                     onClick={() => handleDecision(c.id, 'ACCEPTED')}
                     className={`p-1.5 rounded-md transition ${c.userDecision === 'ACCEPTED' ? 'bg-chalk-raised shadow text-moss-700' : 'text-moss-muted hover:text-moss-muted'}`}
                   >
                     <Check className="w-4 h-4" />
                   </button>
                   <button 
                     type="button"
                     onClick={() => handleDecision(c.id, 'REJECTED')}
                     className={`p-1.5 rounded-md transition ${c.userDecision === 'REJECTED' ? 'bg-chalk-raised shadow text-red-600' : 'text-moss-muted hover:text-moss-muted'}`}
                   >
                     <X className="w-4 h-4" />
                   </button>
                 </div>
              </div>

              <div className="text-xs text-moss-muted mb-4 line-clamp-2 h-8 leading-relaxed">
                {c.description || t('noDescription')}
              </div>

              {c.userDecision === 'ACCEPTED' && (
                <div className="pt-4 border-t border-rule">
                  <label className="text-[10px] uppercase font-bold text-moss-muted tracking-wider mb-2 block">{t('typeLabel')}</label>
                  <select 
                    value={c.type}
                    onChange={(e) => handleType(c.id, e.target.value)}
                    className="w-full bg-chalk border border-rule rounded-lg text-xs font-semibold text-moss px-3 py-2.5 outline-none focus:border-moss focus:bg-chalk-raised transition-colors cursor-pointer appearance-none [background-position:right_12px_center] rtl:[background-position:left_12px_center]"
                    style={{ backgroundImage: 'url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3e%3cpolyline points=\'6 9 12 15 18 9\'%3e%3c/polyline%3e%3c/svg%3e")', backgroundRepeat: 'no-repeat', backgroundSize: '16px' }}
                  >
                    <option value="DIRECT">{t('typeDirect')}</option>
                    <option value="INDIRECT">{t('typeIndirect')}</option>
                    <option value="ASPIRATIONAL">{t('typeAspirational')}</option>
                  </select>
                </div>
              )}
           </div>
        ))}
      </div>

      {state?.error && (
        <div className="rounded-xl bg-red-50 p-4 text-sm font-medium text-red-600 border border-red-100">
          {state.error}
        </div>
      )}

      <form action={formAction as any} className="flex justify-end pt-8 pb-12">
        <input type="hidden" name="id" value={workspace.id} />
        <input type="hidden" name="competitorsData" value={JSON.stringify(competitors)} />

        <button
          type="submit"
          disabled={pending || acceptedCount === 0}
          className="w-full sm:w-auto rounded-xl min-w-[240px] bg-saffron py-4 xl:py-5 px-8 text-base font-bold text-moss shadow-lg shadow-moss-700/20 hover:shadow-xl hover:scale-[1.02] transition-all disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-2"
        >
          {pending ? t('saving') : <><Sparkles className="h-5 w-5" /> {t('save', { count: acceptedCount })}</>}
        </button>
      </form>
    </div>
  );
}
