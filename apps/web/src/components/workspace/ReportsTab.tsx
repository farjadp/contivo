'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Download, FileText, AlertCircle, CheckCircle } from 'lucide-react';
import {
  checkReportEligibility,
  generateStrategicReport,
  getReportHistory,
} from '@/app/actions/strategic-reports';
import { ReportGeneratingModal } from './ReportGeneratingModal';

/* The server action enforces the same ceiling; it is shown here so the
   counter and the quota cannot drift apart. */
const MONTHLY_REPORT_LIMIT = 5;

interface ReportsTabProps {
  workspaceId: string;
  initialEligibility: any;
  initialHistory: any[];
}

export function ReportsTab({
  workspaceId,
  initialEligibility,
  initialHistory,
}: ReportsTabProps) {
  const t = useTranslations('tabsB.reports');
  const format = useFormatter();
  const [eligibility, setEligibility] = useState(initialEligibility);
  const [history, setHistory] = useState(initialHistory);

  // Modal state — three distinct phases: idle → generating → done/error
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    // Open modal and reset previous outcome
    setIsGenerating(true);
    setIsDone(false);
    setError('');

    try {
      const result = await generateStrategicReport(workspaceId);

      // Mark done so the modal shows the success state and snaps bar to 100%
      setIsDone(true);

      // Refresh eligibility counter and history table
      const [newEligibility, newHistory] = await Promise.all([
        checkReportEligibility(workspaceId),
        getReportHistory(workspaceId),
      ]);
      setEligibility(newEligibility);
      setHistory(newHistory);

      // Auto-open PDF in a new tab; brief delay so user sees the ✅ state
      setTimeout(() => {
        window.open(result.pdfUrl, '_blank');
        // Close modal after the PDF tab opens
        setIsGenerating(false);
        setIsDone(false);
      }, 1_800);
    } catch (err: any) {
      // Surface the error inside the modal, then let the user dismiss it
      setError(err.message || t('failed'));
      // Close modal after a moment so the user can read the error in the card below
      setTimeout(() => setIsGenerating(false), 3_000);
    }
  };

  return (
    <>
      {/* Progress modal — rendered in a portal above everything */}
      <ReportGeneratingModal
        isOpen={isGenerating}
        isDone={isDone}
        error={error}
      />

      <div className="space-y-6">
        {/* ── Eligibility / Generate card ── */}
        <div className="bg-white rounded-lg border p-6">
          <h2 className="text-xl font-semibold mb-4">{t('title')}</h2>

          <div className="flex items-start gap-4 mb-6">
            <div className="flex-1">
              <p className="text-gray-600 mb-4">{t('subtitle')}</p>

              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-600">{t('reportsThisMonth')}</span>
                <span className="font-semibold">
                  {t('quota', {
                    used: format.number(eligibility.reportsThisMonth),
                    max: format.number(MONTHLY_REPORT_LIMIT),
                  })}
                </span>
                <span className="text-green-600">
                  {t('remaining', { count: format.number(eligibility.remainingReports) })}
                </span>
              </div>
            </div>

            <button
              onClick={handleGenerate}
              disabled={!eligibility.canGenerate || isGenerating}
              className={`px-6 py-3 rounded-lg font-semibold flex items-center gap-2 ${
                eligibility.canGenerate && !isGenerating
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              <FileText className="w-5 h-5" />
              {isGenerating ? t('generating') : t('generate')}
            </button>
          </div>

          {/* Missing data warnings */}
          {eligibility.missingData && eligibility.missingData.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5" />
                <div>
                  <p className="font-semibold text-amber-900 mb-1">{t('missingTitle')}</p>
                  <ul className="text-sm text-amber-800 space-y-1">
                    {/* Codes from lib/report-readiness, turned into words here.
                        They arrive from the server, which does not know the
                        reader's language at the point it decides the list. */}
                    {eligibility.missingData.map((item: string) => (
                      <li key={item}>• {t(`missing.${item}`)}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Error shown after modal closes */}
          {!isGenerating && error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mt-4">
              <p className="text-red-800">{error}</p>
            </div>
          )}
        </div>

        {/* ── Report History Table ── */}
        <div className="bg-white rounded-lg border">
          <div className="p-6 border-b">
            <h3 className="text-lg font-semibold">{t('historyTitle')}</h3>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase">
                    {t('colGenerated')}
                  </th>
                  <th className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase">
                    {t('colData')}
                  </th>
                  <th className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase">
                    {t('colAnalytics')}
                  </th>
                  <th className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase">
                    {t('colSize')}
                  </th>
                  <th className="px-6 py-3 text-end text-xs font-medium text-gray-500 uppercase">
                    {t('colDownloads')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                      {t('historyEmpty')}
                    </td>
                  </tr>
                ) : (
                  history.map((report) => (
                    <tr key={report.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {/* Through next-intl, so Persian gets the Persian
                            calendar, Persian digits and Tehran time. */}
                        {format.dateTime(new Date(report.reportDate), {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1">
                          {(report.sectionsIncluded as string[]).map((section) => (
                            <span
                              key={section}
                              className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-800 text-xs rounded"
                            >
                              <CheckCircle className="w-3 h-3" />
                              {section}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {t('competitors', { count: format.number(report.competitorsCount) })}
                        <br />
                        {t('charts', { count: format.number(report.chartsGenerated) })}
                        <br />
                        {t('keywords', { count: format.number(report.keywordsAnalyzed) })}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {t('megabytes', {
                          value: format.number(report.fileSize / 1024 / 1024, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          }),
                        })}
                      </td>
                      <td className="px-6 py-4 text-end">
                        <div className="flex justify-end gap-2">
                          <a
                            href={report.pdfPath}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
                          >
                            <Download className="w-4 h-4" />
                            PDF
                          </a>
                          <a
                            href={report.docxPath}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                          >
                            <Download className="w-4 h-4" />
                            HTML
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
