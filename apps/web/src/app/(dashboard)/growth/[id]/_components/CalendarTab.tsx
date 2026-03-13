'use client';

import { useEffect, useState } from 'react';
import { Calendar as CalendarIcon, List, Loader2, AlertCircle } from 'lucide-react';
import { getCalendarItems } from '@/app/actions/calendar';
import { ContentItem } from '@prisma/client';

type ViewMode = 'week' | 'list';

export function CalendarTab({ workspaceId }: { workspaceId: string }) {
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

  // Generate next 7 days for the Week view
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const next7Days = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    return d;
  });

  const itemsByDate: Record<string, ContentItem[]> = {};
  items.forEach((item) => {
    if (!item.scheduledAtUtc) return;
    const d = new Date(item.scheduledAtUtc);
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!itemsByDate[dateKey]) itemsByDate[dateKey] = [];
    itemsByDate[dateKey].push(item);
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-gray-900 tracking-tight">Content Calendar</h2>
          <p className="text-sm font-bold text-gray-400 mt-1 uppercase tracking-widest">Schedule & Timeline</p>
        </div>

        <div className="flex items-center gap-1 bg-gray-50/80 p-1 rounded-[16px] border border-gray-100 shadow-inner">
          <button
            onClick={() => setView('week')}
            className={`flex items-center gap-2 px-4 py-2 rounded-[12px] text-sm font-bold transition-all ${
              view === 'week' 
                ? 'bg-white shadow-[0_4px_12px_rgb(0,0,0,0.05)] text-[#2B2DFF] border border-gray-100' 
                : 'text-gray-400 hover:text-gray-900 hover:bg-gray-100/50 border border-transparent'
            }`}
          >
            <CalendarIcon className="w-4 h-4" />
            Week View
          </button>
          <button
            onClick={() => setView('list')}
            className={`flex items-center gap-2 px-4 py-2 rounded-[12px] text-sm font-bold transition-all ${
              view === 'list' 
                ? 'bg-white shadow-[0_4px_12px_rgb(0,0,0,0.05)] text-[#2B2DFF] border border-gray-100' 
                : 'text-gray-400 hover:text-gray-900 hover:bg-gray-100/50 border border-transparent'
            }`}
          >
            <List className="w-4 h-4" />
            List View
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center items-center py-32">
          <Loader2 className="w-10 h-10 animate-spin text-[#2B2DFF]" />
        </div>
      ) : error ? (
        <div className="flex justify-center items-center py-20">
          <div className="flex items-center gap-3 text-red-600 bg-red-50/50 px-6 py-4 rounded-[24px] border border-red-100 text-sm font-bold shadow-sm">
            <AlertCircle className="w-5 h-5 text-red-500" />
            {error}
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 text-center bg-gray-50/30 rounded-[32px] border border-dashed border-gray-200">
          <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mb-6 shadow-xl shadow-gray-200/50">
            <CalendarIcon className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-xl font-black text-gray-900 tracking-tight">Your Calendar is Empty</h3>
          <p className="text-gray-500 text-sm font-medium max-w-sm mt-3">
            Generate new content from the Ideation Station and schedule it to populate your timeline.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-[32px] border border-gray-100 overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.03)] pb-2">
          {view === 'list' && (
            <div className="divide-y divide-gray-50/50 p-2">
              {items.map((item) => (
                <div key={item.id} className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-gray-50/50 rounded-[24px] transition-colors group">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className="text-[9px] font-black uppercase tracking-widest text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-lg">
                        {item.channel}
                      </span>
                      <span className="text-[9px] font-black uppercase tracking-widest text-[#00E5FF] bg-[#00E5FF]/10 px-2.5 py-1 rounded-lg">
                        {item.status}
                      </span>
                    </div>
                    <h4 className="font-bold text-gray-900 text-base lg:text-lg group-hover:text-[#2B2DFF] transition-colors">{item.topic}</h4>
                    <p className="text-sm font-medium text-gray-500 mt-1.5 line-clamp-1">{item.content}</p>
                  </div>
                  <div className="sm:text-right shrink-0 bg-white border border-gray-100 px-5 py-3 rounded-[20px] shadow-sm">
                    <p className="text-sm font-black text-gray-900">
                      {item.scheduledAtUtc ? new Date(item.scheduledAtUtc).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : 'Unscheduled'}
                    </p>
                    <p className="text-[11px] font-bold tracking-widest uppercase text-gray-400 mt-0.5">
                      {item.scheduledAtUtc ? new Date(item.scheduledAtUtc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'No Time'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {view === 'week' && (
            <div className="grid grid-cols-1 lg:grid-cols-7 gap-px bg-gray-100">
              {next7Days.map((day, idx) => {
                const dateString = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
                const dayItems = itemsByDate[dateString] || [];
                const isToday = idx === 0;

                return (
                  <div key={dateString} className={`flex flex-col bg-white min-h-[350px] p-4 ${isToday ? 'bg-indigo-50/10 relative' : ''}`}>
                    {isToday && <div className="absolute top-0 left-0 right-0 h-1 bg-[#2B2DFF]" />}
                    
                    <div className="mb-4">
                      <p className={`text-[10px] uppercase tracking-widest font-black ${isToday ? 'text-[#2B2DFF]' : 'text-gray-400'}`}>
                        {day.toLocaleDateString(undefined, { weekday: 'short' })}
                      </p>
                      <p className={`text-2xl font-black tracking-tighter mt-0.5 ${isToday ? 'text-gray-900' : 'text-gray-700'}`}>
                        {day.getDate()}
                      </p>
                    </div>

                    <div className="flex flex-col gap-2 flex-1">
                      {dayItems.length === 0 ? (
                        <div className="flex-1 flex items-center justify-center">
                          <span className="text-xs font-bold text-gray-300">Empty</span>
                        </div>
                      ) : (
                        dayItems.map((item: any) => (
                          <div key={item.id} className="bg-gray-50 border border-gray-100 p-3 rounded-[16px] hover:border-[#2B2DFF]/30 hover:shadow-lg hover:shadow-indigo-500/10 transition-all cursor-pointer group">
                            <div className="text-[9px] font-black uppercase tracking-widest text-[#2B2DFF] mb-1.5 line-clamp-1">
                              {item.channel}
                            </div>
                            <h5 className="text-[13px] font-bold text-gray-900 leading-snug line-clamp-2 group-hover:text-[#2B2DFF] transition-colors">
                              {item.topic}
                            </h5>
                            <p className="text-[10px] font-bold text-gray-400 mt-2 flex items-center gap-1">
                              <CalendarIcon className="w-3 h-3" />
                              {new Date(item.scheduledAtUtc!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
