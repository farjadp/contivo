/**
 * PublishRulesSection.tsx
 *
 * Workspace-level publish rule preferences.
 * Currently display-only in MVP — settings are read from the UI
 * and can be extended to a real settings store in Phase 2.
 *
 * Preferences:
 *   - Auto-add hashtags toggle
 *   - Use platform formatter toggle
 *   - Cross-posting (disabled, Phase 2)
 */

'use client';

import { useState } from 'react';
import { Settings, Hash, Repeat2, AlignLeft } from 'lucide-react';

// ─── Toggle Component ─────────────────────────────────────────────────────────

function Toggle({
  label,
  description,
  checked,
  disabled,
  onChange,
  Icon,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  Icon: React.ElementType;
}) {
  return (
    <div className={`flex items-start gap-4 rounded-2xl border p-4 transition-colors ${
      disabled ? 'bg-gray-50 border-gray-100 opacity-60' : 'bg-white border-gray-100 hover:border-gray-200'
    }`}>
      <div className="w-9 h-9 rounded-xl bg-[#F3F4FF] flex items-center justify-center shrink-0">
        <Icon className="w-4.5 h-4.5 text-[#2B2DFF]" />
      </div>
      <div className="flex-1">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-[#121212]">{label}</p>
          <button
            disabled={disabled}
            onClick={() => !disabled && onChange(!checked)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors ${
              checked ? 'bg-[#2B2DFF]' : 'bg-gray-200'
            } ${disabled ? 'cursor-not-allowed' : ''}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                checked ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-0.5">{description}</p>
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PublishRulesSection() {
  const [autoHashtags, setAutoHashtags]           = useState(false);
  const [usePlatformFormatter, setPlatformFormatter] = useState(true);

  return (
    <div>
      <div className="mb-5">
        <h3 className="text-base font-bold text-[#121212]">Publish Rules</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Default behaviors applied to every publishing action in this workspace.
        </p>
      </div>

      <div className="space-y-3">
        <Toggle
          label="Auto-add hashtags"
          description="Automatically append relevant hashtags based on content topic."
          checked={autoHashtags}
          onChange={setAutoHashtags}
          Icon={Hash}
        />

        <Toggle
          label="Use platform formatter"
          description="Adjust formatting and character limits per platform before publishing."
          checked={usePlatformFormatter}
          onChange={setPlatformFormatter}
          Icon={AlignLeft}
        />

        <Toggle
          label="Cross-posting"
          description="Automatically post to multiple platforms at once. Available in Phase 2."
          checked={false}
          disabled
          onChange={() => {}}
          Icon={Repeat2}
        />
      </div>

      <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
        <p className="text-xs font-semibold text-blue-700 flex items-center gap-1.5">
          <Settings className="w-3.5 h-3.5" />
          Settings are saved per workspace. Individual post settings override these defaults.
        </p>
      </div>
    </div>
  );
}
