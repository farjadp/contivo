'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Globe, ArrowRight } from 'lucide-react';
import { createNewWorkspace } from '@/app/actions/growth';

const initialState = {
  error: '',
};

export default function NewWorkspaceUrlFirstPage() {
  const [state, formAction, pending] = useActionState(createNewWorkspace as any, initialState);

  return (
    <div className="w-full h-full min-h-[80vh] flex flex-col lg:flex-row bg-[#FDFCF8] text-[#121212] overflow-hidden rounded-[32px] border border-[#121212]/10">
      
      {/* Left Column */}
      <div className="w-full lg:w-[45%] p-8 lg:p-12 xl:p-16 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-[#121212]/10 bg-[#EFECE5]">
        <div>
           <Link
             href="/growth"
             className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase opacity-50 hover:opacity-100 transition-opacity mb-16"
           >
             <ArrowLeft className="h-4 w-4" /> Return
           </Link>

           <h1 className="text-5xl md:text-6xl font-medium tracking-tighter leading-[1] text-[#121212] mb-8">
             <div className="animate-in slide-in-from-bottom duration-700 delay-100 fill-mode-both">Build</div>
             <div className="animate-in slide-in-from-bottom duration-700 delay-200 fill-mode-both">
                 <span className="italic text-[#121212]/50 font-serif font-light">workspace</span>
             </div>
           </h1>
           
           <p className="text-lg text-[#121212]/70 leading-relaxed font-medium max-w-sm animate-in fade-in duration-1000 delay-300 fill-mode-both">
             Provide your domain. We will automatically scan your brand, extract your messaging, and construct your content strategy.
           </p>
        </div>

        <div className="hidden lg:flex items-center gap-3 mt-12 animate-in fade-in duration-1000 delay-500 fill-mode-both">
            <div className="w-3 h-3 bg-[#C04C36]" />
            <span className="text-xs font-bold tracking-widest uppercase opacity-40">System Initialization</span>
        </div>
      </div>

      {/* Right Column: Form */}
      <div className="w-full lg:w-[55%] p-8 lg:p-12 xl:p-24 flex flex-col justify-center bg-[#FDFCF8] animate-in fade-in zoom-in duration-1000 delay-300 fill-mode-both">
        <form action={formAction as any} className="w-full max-w-md mx-auto space-y-10">
          
          <div className="space-y-4">
             <label className="flex items-center gap-3 text-xs font-bold tracking-widest uppercase text-[#121212]/60">
                <span className="text-[#121212]">01</span> &mdash; Company Name
             </label>
             <input
               type="text"
               name="name"
               required
               className="w-full bg-transparent border-b-2 border-[#121212]/20 py-4 text-2xl md:text-3xl text-[#121212] placeholder-[#121212]/20 focus:outline-none focus:border-[#C04C36] transition-colors rounded-none"
               placeholder="Acme Corp"
             />
          </div>

          <div className="space-y-4">
             <label className="flex items-center gap-3 text-xs font-bold tracking-widest uppercase text-[#121212]/60">
                <span className="text-[#121212]">02</span> &mdash; Primary Domain
             </label>
             <div className="relative">
               <Globe className="absolute left-0 top-1/2 -translate-y-1/2 text-[#121212]/20 h-6 w-6 md:h-8 md:w-8" />
               <input
                 type="url"
                 name="url"
                 required
                 className="w-full bg-transparent border-b-2 border-[#121212]/20 py-4 pl-10 md:pl-12 text-2xl md:text-3xl text-[#121212] placeholder-[#121212]/20 focus:outline-none focus:border-[#C04C36] transition-colors rounded-none"
                 placeholder="https://acme.com"
               />
             </div>
          </div>

          {state?.error && (
            <div className="bg-[#C04C36]/10 text-[#C04C36] p-4 text-sm font-medium border border-[#C04C36]/20">
              {state.error}
            </div>
          )}

          <div className="pt-8 inline-block w-full">
            <button
               type="submit"
               disabled={pending}
               className="group w-full bg-[#121212] text-[#FDFCF8] py-5 px-8 flex items-center justify-between hover:bg-[#C04C36] transition-colors duration-500 disabled:opacity-50 rounded-none"
            >
               <span className="text-sm font-bold tracking-widest uppercase">
                 {pending ? 'Initializing...' : 'Analyze Website'}
               </span>
               <div className="w-10 h-10 rounded-full border border-white/20 flex items-center justify-center group-hover:bg-white group-hover:text-[#C04C36] transition-all duration-500">
                  <ArrowRight className="w-5 h-5 group-hover:-rotate-45 transition-transform duration-500" />
               </div>
            </button>
          </div>
          
          <p className="text-xs text-[#121212]/40 font-medium leading-relaxed mt-4">
             You will be able to review and modify all extracted information before finalizing settings.
          </p>
        </form>
      </div>
    </div>
  );
}
