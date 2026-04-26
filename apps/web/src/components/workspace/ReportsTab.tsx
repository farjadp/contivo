'use client';

import { useState } from 'react';
import { Download, FileText, AlertCircle, CheckCircle } from 'lucide-react';
import {
  checkReportEligibility,
  generateStrategicReport,
  getReportHistory,
} from '@/app/actions/strategic-reports';
import { ReportGeneratingModal } from './ReportGeneratingModal';

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
      setError(err.message || 'Failed to generate report');
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
          <h2 className="text-xl font-semibold mb-4">Strategic Report Generator</h2>

          <div className="flex items-start gap-4 mb-6">
            <div className="flex-1">
              <p className="text-gray-600 mb-4">
                Generate a comprehensive strategic report including competitive analysis,
                keyword intelligence, and market positioning insights.
              </p>

              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-600">Reports this month:</span>
                <span className="font-semibold">{eligibility.reportsThisMonth} / 5</span>
                <span className="text-green-600">({eligibility.remainingReports} remaining)</span>
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
              {isGenerating ? 'Generating…' : 'Generate Report'}
            </button>
          </div>

          {/* Missing data warnings */}
          {eligibility.missingData && eligibility.missingData.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5" />
                <div>
                  <p className="font-semibold text-amber-900 mb-1">Missing Required Data</p>
                  <ul className="text-sm text-amber-800 space-y-1">
                    {eligibility.missingData.map((item: string) => (
                      <li key={item}>• {item}</li>
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
            <h3 className="text-lg font-semibold">Report History</h3>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Generated
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Data Included
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Analytics
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Size
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Downloads
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                      No reports generated yet
                    </td>
                  </tr>
                ) : (
                  history.map((report) => (
                    <tr key={report.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {new Date(report.reportDate).toLocaleDateString('en-US', {
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
                        {report.competitorsCount} competitors
                        <br />
                        {report.chartsGenerated} charts
                        <br />
                        {report.keywordsAnalyzed} keywords
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {(report.fileSize / 1024 / 1024).toFixed(2)} MB
                      </td>
                      <td className="px-6 py-4 text-right">
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
