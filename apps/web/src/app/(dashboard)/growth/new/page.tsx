'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Sparkles, Globe } from 'lucide-react';
import { createNewWorkspace } from '@/app/actions/growth';

const initialState = {
  error: '',
};

export default function NewWorkspaceUrlFirstPage() {
  const [state, formAction, pending] = useActionState(createNewWorkspace as any, initialState);

  return (
    <div className="max-w-2xl mx-auto py-12 px-4 sm:px-6">
      <Link
        href="/growth"
        className="inline-flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-[#121212] transition-colors mb-10"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Growth Engine
      </Link>

      <div className="text-center mb-10">
        <h1 className="text-4xl font-extrabold tracking-tight text-[#121212] mb-3">Create Workspace</h1>
        <p className="text-gray-500 text-base max-w-md mx-auto">
          Just give us your website URL. Contivo will automatically scan your brand, extract your messaging, and build your content strategy.
        </p>
      </div>

      <div className="bg-white rounded-3xl border border-gray-200 p-8 shadow-xl shadow-brand-indigo/5">
        <form action={formAction as any} className="space-y-6">
          <div>
            <label className="block text-sm font-bold text-[#121212] mb-2">Company / Project Name</label>
            <input
              type="text"
              name="name"
              required
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3.5 text-base text-[#121212] focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition placeholder-gray-400"
              placeholder="e.g. Acme Corp"
            />
          </div>
          
          <div>
            <label className="block text-sm font-bold text-[#121212] mb-2">Website URL</label>
            <div className="relative">
              <Globe className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 h-5 w-5" />
              <input
                type="url"
                name="url"
                required
                className="w-full rounded-xl border border-gray-200 bg-gray-50 pl-12 pr-4 py-3.5 text-base text-[#121212] focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition placeholder-gray-400"
                placeholder="https://acme.com"
              />
            </div>
          </div>

          {state?.error && (
            <div className="rounded-xl bg-red-50 p-4 text-sm font-medium text-red-600 border border-red-100">
              {state.error}
            </div>
          )}

          <div className="pt-4">
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-xl bg-[#121212] py-4 text-base font-bold text-white shadow-lg hover:bg-black hover:shadow-xl hover:scale-[1.01] transition-all disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-2"
            >
              {pending ? (
                'Initializing Analysis...'
              ) : (
                <>
                  Analyze Website <Sparkles className="h-4 w-4" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
      
      <p className="text-center text-xs text-gray-400 mt-8">
        We'll extract your audience, tone, and value prop automatically. You can review and edit everything in the next step.
      </p>
    </div>
  );
}
