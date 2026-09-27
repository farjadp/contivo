/**
 * strings.ts — the report's own labels, in both languages.
 *
 * The Persian is written, not translated. A few of these have an obvious
 * dictionary equivalent that no Iranian consultant would put in a document:
 * "executive summary" is «خلاصهٔ مدیریتی», not «خلاصهٔ اجرایی», which reads as
 * a summary that executes something; and a competitor is «رقیب», never
 * «رقابت‌کننده».
 */

import type { ContentLanguage } from '@/lib/content-language';

export interface ReportStrings {
  kicker: string;
  reportReference: string;
  reportDate: string;
  website: string;
  preparedBy: string;
  competitorsAnalysed: string;
  sections: {
    summary: string;
    brand: string;
    landscape: string;
    matrices: string;
    keywords: string;
    offerings: string;
    recommendations: string;
  };
  stats: { competitors: string; matrices: string; keywords: string };
  brand: { mission: string; value: string; voice: string; audience: string; differentiators: string };
  table: { company: string; domain: string; role: string; score: string };
  roles: { you: string; direct: string; indirect: string; aspirational: string };
  legend: { you: string; direct: string; indirect: string };
  horizons: { immediate: string; medium: string; long: string };
  gaps: string;
  primaryKeywords: string;
  secondaryKeywords: string;
  estimateNote: string;
  degradedNote: string;
  confidential: string;
  page: string;
}

const EN: ReportStrings = {
  kicker: 'Strategic Market Intelligence',
  reportReference: 'Report reference',
  reportDate: 'Report date',
  website: 'Website',
  preparedBy: 'Prepared by',
  competitorsAnalysed: 'Competitors analysed',
  sections: {
    summary: 'Executive summary',
    brand: 'Brand profile',
    landscape: 'Competitive landscape',
    matrices: 'Market positioning',
    keywords: 'Competitor keywords',
    offerings: 'Products and services',
    recommendations: 'Recommendations',
  },
  stats: { competitors: 'Competitors analysed', matrices: 'Positioning matrices', keywords: 'Keywords reviewed' },
  brand: {
    mission: 'Mission',
    value: 'Value proposition',
    voice: 'Brand voice',
    audience: 'Target audience',
    differentiators: 'Differentiators',
  },
  table: { company: 'Company', domain: 'Domain', role: 'Role', score: 'Score' },
  roles: { you: 'You', direct: 'Direct competitor', indirect: 'Indirect', aspirational: 'Aspirational' },
  legend: { you: 'You', direct: 'Direct competitor', indirect: 'Indirect competitor' },
  horizons: { immediate: 'Immediate · 0–3 months', medium: 'Medium term · 3–12 months', long: 'Long term · 12 months+' },
  gaps: 'Content gap opportunities',
  primaryKeywords: 'Primary keywords',
  secondaryKeywords: 'Secondary keywords',
  estimateNote:
    'Competitor positions and keywords on these pages are estimated by AI from public competitor pages and visible signals. They are a reading of the market, not a measurement of it — review before acting on them.',
  degradedNote:
    'The written commentary could not be generated for this report. The figures, tables and charts below are complete and come straight from your workspace data.',
  confidential: 'Confidential',
  page: 'Page',
};

const FA: ReportStrings = {
  kicker: 'گزارش راهبردی بازار',
  reportReference: 'شمارهٔ گزارش',
  reportDate: 'تاریخ گزارش',
  website: 'وب‌سایت',
  preparedBy: 'تهیه‌شده توسط',
  competitorsAnalysed: 'رقبای بررسی‌شده',
  sections: {
    summary: 'خلاصهٔ مدیریتی',
    brand: 'شناسنامهٔ برند',
    landscape: 'میدان رقابت',
    matrices: 'موضع‌یابی در بازار',
    keywords: 'کلیدواژه‌های رقبا',
    offerings: 'محصولات و خدمات',
    recommendations: 'پیشنهادها',
  },
  stats: { competitors: 'رقیب بررسی‌شده', matrices: 'ماتریس موضع‌یابی', keywords: 'کلیدواژهٔ مرورشده' },
  brand: {
    mission: 'مأموریت',
    value: 'ارزش پیشنهادی',
    voice: 'لحن برند',
    audience: 'مخاطب هدف',
    differentiators: 'تمایزها',
  },
  table: { company: 'شرکت', domain: 'دامنه', role: 'نسبت', score: 'امتیاز' },
  roles: { you: 'شما', direct: 'رقیب مستقیم', indirect: 'رقیب غیرمستقیم', aspirational: 'الگو' },
  legend: { you: 'شما', direct: 'رقیب مستقیم', indirect: 'رقیب غیرمستقیم' },
  horizons: { immediate: 'فوری · تا ۳ ماه', medium: 'میان‌مدت · ۳ تا ۱۲ ماه', long: 'بلندمدت · از ۱۲ ماه' },
  gaps: 'شکاف‌های محتوایی',
  primaryKeywords: 'کلیدواژه‌های اصلی',
  secondaryKeywords: 'کلیدواژه‌های فرعی',
  estimateNote:
    'جایگاه رقبا و کلیدواژه‌های این صفحه‌ها را هوش مصنوعی از روی صفحه‌های عمومی رقبا و نشانه‌های در دسترس تخمین زده است. این‌ها خوانشی از بازار است، نه اندازه‌گیری آن؛ پیش از تصمیم‌گیری بازبینی‌شان کنید.',
  degradedNote:
    'متن تحلیلی این گزارش تولید نشد. جدول‌ها، نمودارها و اعداد زیر کامل‌اند و مستقیم از داده‌های ورک‌اسپیس شما می‌آیند.',
  confidential: 'محرمانه',
  page: 'صفحهٔ',
};

export function reportStrings(language: ContentLanguage): ReportStrings {
  return language === 'FA' ? FA : EN;
}
