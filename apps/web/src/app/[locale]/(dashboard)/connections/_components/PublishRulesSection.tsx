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
import { useTranslations } from 'next-intl';
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
      disabled ? 'bg-chalk border-rule opacity-60' : 'bg-chalk-raised border-rule hover:border-rule'
    }`}>
      <div className="w-9 h-9 rounded-xl bg-chalk-sunk flex items-center justify-center shrink-0">
        <Icon className="w-4.5 h-4.5 text-moss-700" />
      </div>
      <div className="flex-1">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-moss">{label}</p>
          <button
            disabled={disabled}
            onClick={() => !disabled && onChange(!checked)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors ${
              checked ? 'bg-moss' : 'bg-chalk-sunk'
            } ${disabled ? 'cursor-not-allowed' : ''}`}
          >
            <span
              /* Pinned to the logical start so the knob rests on the correct
                 side in both directions; the travel is mirrored explicitly
                 because Tailwind does not flip translate-x under `rtl`. */
              className={`absolute top-0.5 start-0.5 h-4 w-4 rounded-full bg-chalk-raised shadow-sm transition-transform ${
                checked ? 'translate-x-4 rtl:-translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
        <p className="text-xs text-moss-muted mt-0.5">{description}</p>
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PublishRulesSection() {
  const t = useTranslations('connections.rules');
  const [autoHashtags, setAutoHashtags]           = useState(false);
  const [usePlatformFormatter, setPlatformFormatter] = useState(true);

  return (
    <div>
      <div className="mb-5">
        <h3 className="text-base font-bold text-moss">{t('title')}</h3>
        <p className="text-xs text-moss-muted mt-0.5">{t('subtitle')}</p>
      </div>

      <div className="space-y-3">
        <Toggle
          label={t('hashtagsLabel')}
          description={t('hashtagsDescription')}
          checked={autoHashtags}
          onChange={setAutoHashtags}
          Icon={Hash}
        />

        <Toggle
          label={t('formatterLabel')}
          description={t('formatterDescription')}
          checked={usePlatformFormatter}
          onChange={setPlatformFormatter}
          Icon={AlignLeft}
        />

        <Toggle
          label={t('crossPostingLabel')}
          description={t('crossPostingDescription')}
          checked={false}
          disabled
          onChange={() => {}}
          Icon={Repeat2}
        />
      </div>

      <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
        <p className="text-xs font-semibold text-blue-700 flex items-center gap-1.5">
          <Settings className="w-3.5 h-3.5 shrink-0" />
          {t('note')}
        </p>
      </div>
    </div>
  );
}
