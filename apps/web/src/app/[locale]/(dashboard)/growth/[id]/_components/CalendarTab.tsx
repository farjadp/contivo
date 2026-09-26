'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Calendar as CalendarIcon, List, Loader2, AlertCircle } from 'lucide-react';
import { getCalendarItems } from '@/app/actions/calendar';

type ViewMode = 'week' | 'list';

/**
 * `channel` and `status` come off the row as raw enum values. The ids stay
 * Latin; only the label a person reads is translated, and anything the
 * catalogue does not know about falls through to the enum itself.
 */
function channelLabel(t: ReturnType<typeof useTranslations>, channel: string) {
  return t.has(`channels.${channel}`) ? t(`channels.${channel}`) : channel;
}

function statusLabel(t: ReturnType<typeof useTranslations>, status: string) {
  return t.has(`contentStatus.${status}`) ? t(`contentStatus.${status}`) : status;
}

export function CalendarTab({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations('tabsA.calendar');
  const tRoot = useTranslations('tabsA');
  /*
    Every date on this tab goes through next-intl's formatter rather than
    toLocaleDateString: the request config pins `fa` to Asia/Tehran, and the
    `fa` locale carries the Jalali calendar, so month and weekday names come
    back Shamsi with Persian digits without a converter anywhere in here.
  */
  const format = useFormatter();
  const [view, setView] = useState<ViewMode>('list');
  const [items, setItems] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchItems() {
      try {
        setIsLoading(true);
        const data = await getCalendarItems(workspaceId);
        setItems(data);
      } catch (err: any) {
        setError(err.message || t('loadError'));
      } finally {
        setIsLoading(false);
      }
    }
    fetchItems();
  }, [workspaceId, t]);

  // Generate next 7 days for the Week view
  const today = new Date();
  // Midday, not midnight: the column is labelled in the locale's own zone, and
  // an anchor at noon lands on the intended calendar day whichever zone that is.
  today.setHours(12, 0, 0, 0);
  const next7Days = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    return d;
  });

  /*
    The bucket key is the formatted date itself rather than a Gregorian
    year-month-day built by hand. That keeps a post in the column its own label
    names: both sides go through the same calendar and the same time zone, so
    the Persian side buckets by Tehran days and never by the reader's.
  */
  const dayKey = (value: Date) =>
    format.dateTime(value, { year: 'numeric', month: 'numeric', day: 'numeric' });

  const itemsByDate: Record<string, any[]> = {};
  items.forEach((item) => {
    if (!item.scheduledAtUtc) return;
    const key = dayKey(new Date(item.scheduledAtUtc));
    if (!itemsByDate[key]) itemsByDate[key] = [];
    itemsByDate[key].push(item);
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-moss tracking-tight">{t('title')}</h2>
          <p className="text-sm font-bold text-moss-muted mt-1 uppercase tracking-widest">{t('subtitle')}</p>
        </div>

        <div className="flex items-center gap-1 bg-chalk/80 p-1 rounded-[16px] border border-rule shadow-inner">
          <button
            onClick={() => setView('week')}
            className={`flex items-center gap-2 px-4 py-2 rounded-[12px] text-sm font-bold transition-all ${
              view === 'week' 
                ? 'bg-chalk-raised shadow-[0_4px_12px_rgb(0,0,0,0.05)] text-moss-700 border border-rule' 
                : 'text-moss-muted hover:text-moss hover:bg-chalk-sunk/50 border border-transparent'
            }`}
          >
            <CalendarIcon className="w-4 h-4" />
            {t('weekView')}
          </button>
          <button
            onClick={() => setView('list')}
            className={`flex items-center gap-2 px-4 py-2 rounded-[12px] text-sm font-bold transition-all ${
              view === 'list' 
                ? 'bg-chalk-raised shadow-[0_4px_12px_rgb(0,0,0,0.05)] text-moss-700 border border-rule' 
                : 'text-moss-muted hover:text-moss hover:bg-chalk-sunk/50 border border-transparent'
            }`}
          >
            <List className="w-4 h-4" />
            {t('listView')}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center items-center py-32">
          <Loader2 className="w-10 h-10 animate-spin text-moss-700" />
        </div>
      ) : error ? (
        <div className="flex justify-center items-center py-20">
          <div className="flex items-center gap-3 text-red-600 bg-red-50/50 px-6 py-4 rounded-[24px] border border-red-100 text-sm font-bold shadow-sm">
            <AlertCircle className="w-5 h-5 text-red-500" />
            {error}
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 text-center bg-chalk/30 rounded-[32px] border border-dashed border-rule">
          <div className="w-20 h-20 bg-chalk-raised rounded-full flex items-center justify-center mb-6 shadow-xl shadow-forest-muted/50">
            <CalendarIcon className="w-8 h-8 text-moss-muted" />
          </div>
          <h3 className="text-xl font-black text-moss tracking-tight">{t('emptyTitle')}</h3>
          <p className="text-moss-muted text-sm font-medium max-w-sm mt-3">{t('emptyBody')}</p>
        </div>
      ) : (
        <div className="bg-chalk-raised rounded-[32px] border border-rule overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.03)] pb-2">
          {view === 'list' && (
            <div className="divide-y divide-rule/50 p-2">
              {items.map((item) => (
                <div key={item.id} className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-chalk/50 rounded-[24px] transition-colors group">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className="text-[9px] font-black uppercase tracking-widest text-moss bg-chalk-sunk px-2.5 py-1 rounded-lg">
                        <bdi>{channelLabel(tRoot, item.channel)}</bdi>
                      </span>
                      <span className="text-[9px] font-black uppercase tracking-widest text-saffron-ink bg-saffron/10 px-2.5 py-1 rounded-lg">
                        {statusLabel(tRoot, item.status)}
                      </span>
                    </div>
                    <h4 className="font-bold text-moss text-base lg:text-lg group-hover:text-moss-700 transition-colors">{item.topic}</h4>
                    <p className="text-sm font-medium text-moss-muted mt-1.5 line-clamp-1">{item.content}</p>
                  </div>
                  <div className="sm:text-end shrink-0 bg-chalk-raised border border-rule px-5 py-3 rounded-[20px] shadow-sm">
                    <p className="text-sm font-black text-moss">
                      {item.scheduledAtUtc
                        ? format.dateTime(new Date(item.scheduledAtUtc), {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                          })
                        : t('unscheduled')}
                    </p>
                    <p className="text-[11px] font-bold tracking-widest uppercase text-moss-muted mt-0.5">
                      {item.scheduledAtUtc
                        ? format.dateTime(new Date(item.scheduledAtUtc), {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : t('noTime')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {view === 'week' && (
            <div className="grid grid-cols-1 lg:grid-cols-7 gap-px bg-chalk-sunk">
              {next7Days.map((day, idx) => {
                const dateString = dayKey(day);
                const dayItems = itemsByDate[dateString] || [];
                const isToday = idx === 0;

                return (
                  <div key={dateString} className={`flex flex-col bg-chalk-raised min-h-[350px] p-4 ${isToday ? 'bg-chalk-sunk/10 relative' : ''}`}>
                    {isToday && <div className="absolute inset-x-0 top-0 h-1 bg-moss" />}
                    
                    <div className="mb-4">
                      <p className={`text-[10px] uppercase tracking-widest font-black ${isToday ? 'text-moss-700' : 'text-moss-muted'}`}>
                        {format.dateTime(day, { weekday: 'short' })}
                      </p>
                      <p className={`text-2xl font-black tracking-tighter mt-0.5 ${isToday ? 'text-moss' : 'text-moss'}`}>
                        {format.dateTime(day, { day: 'numeric' })}
                      </p>
                    </div>

                    <div className="flex flex-col gap-2 flex-1">
                      {dayItems.length === 0 ? (
                        <div className="flex-1 flex items-center justify-center">
                          <span className="text-xs font-bold text-moss-muted">{t('dayEmpty')}</span>
                        </div>
                      ) : (
                        dayItems.map((item: any) => (
                          <div key={item.id} className="bg-chalk border border-rule p-3 rounded-[16px] hover:border-moss/30 hover:shadow-lg hover:shadow-moss-700/10 transition-all cursor-pointer group">
                            <div className="text-[9px] font-black uppercase tracking-widest text-moss-700 mb-1.5 line-clamp-1">
                              <bdi>{channelLabel(tRoot, item.channel)}</bdi>
                            </div>
                            <h5 className="text-[13px] font-bold text-moss leading-snug line-clamp-2 group-hover:text-moss-700 transition-colors">
                              {item.topic}
                            </h5>
                            <p className="text-[10px] font-bold text-moss-muted mt-2 flex items-center gap-1">
                              <CalendarIcon className="w-3 h-3" />
                              {format.dateTime(new Date(item.scheduledAtUtc!), {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
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
