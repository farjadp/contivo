'use client';

import { useActionState, useState } from 'react';
import { saveCompetitors } from '@/app/actions/growth-competitors';
import { Sparkles, Check, X, Plus, Target, Globe } from 'lucide-react';

const initialState = { error: '' };

export default function CompetitorsClient({ workspace, initialCompetitors }: any) {
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
      description: 'Manually added competitor',
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
      <div className="bg-white rounded-3xl border border-gray-200 p-8 shadow-sm">
         <h2 className="text-xl font-bold tracking-tight text-[#121212] mb-6">Market Positioning Map</h2>
         
         <div className="relative w-full h-[300px] sm:h-[400px] border-l-2 border-b-2 border-gray-200 bg-gray-50/50 rounded-tr-lg rounded-bl-lg overflow-visible">
           <span className="absolute -left-12 top-1/2 -translate-y-1/2 -rotate-90 text-[10px] font-bold text-gray-400 uppercase tracking-widest whitespace-nowrap">Product Sophistication</span>
           <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-[10px] font-bold text-gray-400 uppercase tracking-widest whitespace-nowrap">Audience Size</span>

           {/* User Brand Center Node */}
           <div className="absolute left-[50%] top-[50%] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
             <div className="h-8 w-8 rounded-full bg-indigo-600 border-4 border-indigo-200 shadow-xl z-20 flex items-center justify-center animate-pulse">
                <Target className="w-4 h-4 text-white" />
             </div>
             <span className="mt-2 text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded shadow-sm">Your Brand</span>
           </div>

           {/* Competitor Nodes */}
           {competitors.filter((c:any) => c.userDecision !== 'REJECTED').map((c: any) => (
             <div 
               key={c.id} 
               className="absolute flex flex-col items-center group transition-all duration-300 hover:z-40"
               style={{ left: `${c.x}%`, top: `${c.y}%`, transform: 'translate(-50%, -50%)' }}
             >
               <div className={`h-4 w-4 rounded-full border-2 shadow-sm z-10 transition-transform group-hover:scale-150 
                 ${c.type === 'DIRECT' ? 'bg-rose-500 border-rose-200' : 
                   c.type === 'INDIRECT' ? 'bg-amber-400 border-amber-200' : 'bg-emerald-400 border-emerald-200'}`} 
               />
               <span className="mt-1.5 text-[10px] font-bold text-gray-700 bg-white border border-gray-200 px-2 py-1 rounded shadow-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-30">
                 {c.name}
               </span>
             </div>
           ))}
         </div>
         
         <div className="mt-10 flex flex-wrap items-center justify-center gap-6 text-xs font-semibold text-gray-500">
           <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-rose-500 border border-rose-200" /> Direct</div>
           <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-amber-400 border border-amber-200" /> Indirect</div>
           <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-emerald-400 border border-emerald-200" /> Aspirational</div>
         </div>
      </div>

      {/* Manual Add Input */}
      <div className="bg-white rounded-2xl border border-gray-200 p-2 sm:p-2 sm:pl-4 flex flex-col sm:flex-row items-center gap-2 shadow-sm focus-within:ring-2 focus-within:ring-indigo-500 transition-all">
        <Globe className="text-gray-400 h-5 w-5 shrink-0 hidden sm:block" />
        <input 
          type="url" 
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          placeholder="Add a competitor URL (e.g. https://acme.com)..."
          className="flex-1 w-full bg-transparent text-sm font-medium text-[#121212] focus:outline-none placeholder-gray-400 p-3 sm:p-0"
        />
        <button onClick={addManual} type="button" disabled={!newUrl} className="w-full sm:w-auto text-sm font-bold bg-[#121212] text-white px-6 py-3 sm:py-2 rounded-xl hover:bg-black transition shrink-0 disabled:opacity-50">
           Add <Plus className="inline w-4 h-4 ml-1" />
        </button>
      </div>

      {/* Competitor List */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {competitors.map((c: any) => (
           <div key={c.id} className={`bg-white rounded-2xl border p-5 shadow-sm transition-all duration-300 ${c.userDecision === 'REJECTED' ? 'border-red-200 opacity-50 bg-red-50/20 grayscale' : 'border-gray-200 hover:border-gray-300 hover:shadow-md'}`}>
              <div className="flex justify-between items-start mb-3">
                 <h3 className="font-bold text-[#121212] truncate pr-2" title={c.name}>{c.name}</h3>
                 
                 <div className="flex bg-gray-100/80 rounded-lg p-0.5 shrink-0">
                   <button 
                     type="button" 
                     onClick={() => handleDecision(c.id, 'ACCEPTED')}
                     className={`p-1.5 rounded-md transition ${c.userDecision === 'ACCEPTED' ? 'bg-white shadow text-emerald-600' : 'text-gray-400 hover:text-gray-600'}`}
                   >
                     <Check className="w-4 h-4" />
                   </button>
                   <button 
                     type="button"
                     onClick={() => handleDecision(c.id, 'REJECTED')}
                     className={`p-1.5 rounded-md transition ${c.userDecision === 'REJECTED' ? 'bg-white shadow text-red-600' : 'text-gray-400 hover:text-gray-600'}`}
                   >
                     <X className="w-4 h-4" />
                   </button>
                 </div>
              </div>

              <div className="text-xs text-gray-500 mb-4 line-clamp-2 h-8 leading-relaxed">
                {c.description || 'No description provided.'}
              </div>

              {c.userDecision === 'ACCEPTED' && (
                <div className="pt-4 border-t border-gray-100">
                  <label className="text-[10px] uppercase font-bold text-gray-400 tracking-wider mb-2 block">Competitor Type</label>
                  <select 
                    value={c.type}
                    onChange={(e) => handleType(c.id, e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg text-xs font-semibold text-[#121212] px-3 py-2.5 outline-none focus:border-indigo-500 focus:bg-white transition-colors cursor-pointer appearance-none"
                    style={{ backgroundImage: 'url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3e%3cpolyline points=\'6 9 12 15 18 9\'%3e%3c/polyline%3e%3c/svg%3e")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', backgroundSize: '16px' }}
                  >
                    <option value="DIRECT">Direct Competitor</option>
                    <option value="INDIRECT">Indirect Alternative</option>
                    <option value="ASPIRATIONAL">Aspirational Brand</option>
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
          className="w-full sm:w-auto rounded-xl min-w-[240px] bg-brand-gradient py-4 xl:py-5 px-8 text-base font-bold text-white shadow-lg shadow-indigo-500/20 hover:shadow-xl hover:scale-[1.02] transition-all disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-2"
        >
          {pending ? 'Saving & Generating...' : <><Sparkles className="h-5 w-5" /> Save Competitors ({acceptedCount})</>}
        </button>
      </form>
    </div>
  );
}
