'use client';

import { useEffect, useState } from 'react';
import { Calendar as CalendarIcon, List, Loader2, AlertCircle } from 'lucide-react';
import { getCalendarItems } from '@/app/actions/calendar';
import { ContentItem } from '@prisma/client';

type ViewMode = 'week' | 'list';

export function CalendarContent({ workspaceId }: { workspaceId: string }) {
  const [view, setView] = useState<ViewMode>('list');
  const [items, setItems] = useState<ContentItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchItems() {
      try {
        setIsLoading(true);
        const data = await getCalendarItems(workspaceId);
        setItems(data);
      } catch (err: any) {
        setError(err.message || 'Failed to load calendar items');
      } finally {
        setIsLoading(false);
      }
    }
    fetchItems();
  }, [workspaceId]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
        <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-lg">
          <button
            onClick={() => setView('week')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition ${
              view === 'week' ? 'bg-white shadow-sm text-[#121212]' : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <CalendarIcon className="w-4 h-4" />
            Week View
          </button>
          <button
            onClick={() => setView('list')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition ${
              view === 'list' ? 'bg-white shadow-sm text-[#121212]' : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <List className="w-4 h-4" />
            List View
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center items-center py-20 text-gray-400">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      ) : error ? (
        <div className="flex justify-center items-center py-10">
          <div className="flex items-center gap-2 text-red-600 bg-red-50 px-4 py-3 rounded-xl border border-red-200 text-sm font-medium">
            <AlertCircle className="w-5 h-5" />
            {error}
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center bg-white rounded-2xl border border-dashed border-gray-300">
          <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
            <CalendarIcon className="w-8 h-8 text-gray-300" />
          </div>
          <h3 className="text-lg font-bold text-[#121212]">Your Calendar is Empty</h3>
          <p className="text-gray-500 text-sm max-w-sm mt-2">
            Generate new content from your strategy or instantly, and schedule it here to keep your audience engaged.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
          {view === 'list' && (
            <div className="divide-y divide-gray-100">
              {items.map((item) => (
                <div key={item.id} className="p-5 flex items-center justify-between hover:bg-gray-50 transition">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                        {item.channel}
                      </span>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                        {item.status}
                      </span>
                    </div>
                    <h4 className="font-bold text-[#121212] text-base">{item.topic}</h4>
                    <p className="text-sm text-gray-500 mt-1 line-clamp-1">{item.content}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-[#121212]">
                      {item.scheduledAtUtc ? new Date(item.scheduledAtUtc).toLocaleDateString() : 'Unscheduled'}
                    </p>
                    <p className="text-xs text-gray-500 font-medium">
                      {item.scheduledAtUtc ? new Date(item.scheduledAtUtc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
          {view === 'week' && (
             <div className="p-10 text-center text-gray-500 text-sm">
                Week view graph coming soon. Use the List view for this MVP iteration.
             </div>
          )}
        </div>
      )}
    </div>
  );
}
