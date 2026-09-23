"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell } from 'recharts';
import { useFormatter, useTranslations } from 'next-intl';

/*
  Recharts lays a chart out in SVG user space, so it does not mirror with the
  page and there is nothing to flip here. What it does do is inherit direction
  for the individual text nodes it draws, which is why the plot area is pinned
  to `ltr`: an axis tick is a bare number and a category tick is a stored code,
  both of which read the same in either language. The numbers themselves still
  come out of the request formatter, so Persian gets Persian digits.
*/

export function AdminBarChart({
  data,
  dataKey,
  nameKey,
  color,
  valueName,
}: {
  data: any[];
  dataKey: string;
  nameKey: string;
  color: string;
  /** Translated name of the measured series, shown in the tooltip. */
  valueName?: string;
}) {
  const format = useFormatter();
  const t = useTranslations('admin');

  return (
    <div className="h-[250px] w-full" dir="ltr">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
          <XAxis
            dataKey={nameKey}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 12, fill: '#64748b' }}
            dy={10}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 12, fill: '#64748b' }}
            tickFormatter={(value: number) =>
              value > 1000
                ? t('units.thousands', {
                    value: format.number(value / 1000, { maximumFractionDigits: 1 }),
                  })
                : format.number(value)
            }
          />
          <Tooltip
            cursor={{ fill: '#f1f5f9' }}
            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
            /* Recharts types the incoming value as possibly undefined, so it is
               taken as `unknown` and narrowed here. */
            formatter={(value: unknown) =>
              typeof value === 'number' ? format.number(value, { maximumFractionDigits: 4 }) : String(value ?? '')
            }
          />
          <Bar dataKey={dataKey} name={valueName ?? dataKey} fill={color} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AdminPieChart({
  data,
  dataKey,
  nameKey,
  valueName,
}: {
  data: any[];
  dataKey: string;
  nameKey: string;
  /** Translated name of the measured series, shown in the tooltip. */
  valueName?: string;
}) {
  const format = useFormatter();
  const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#64748b'];

  return (
    <div className="h-[250px] w-full flex justify-center" dir="ltr">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip
            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
            formatter={(value: unknown) =>
              typeof value === 'number' ? format.number(value) : String(value ?? '')
            }
          />
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={80}
            paddingAngle={5}
            dataKey={dataKey}
            nameKey={nameKey}
            name={valueName}
            stroke="none"
          >
            {data.map((_, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
