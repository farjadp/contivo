# Translating Contivo

Contivo ships in English and Persian. Persian is not a skin over an English
product: it has its own direction, its own font, its own digits, and its own AI
prompt language. A change that only swaps words produces something an Iranian
reader screenshots and laughs at.

## Where strings live

One file per area of the product, per locale: `messages/<locale>/<area>.json`.
The areas are listed in `src/i18n/request.ts`, which merges them into one
catalogue at request time. Adding an area means adding it there and creating the
file for **both** locales — a namespace present in one language and missing in
the other throws, on purpose. A missing translation should be loud.

Never put two areas' strings in one file. The split exists so that work on the
admin console never touches the file the marketing page reads from.

## Wiring a component

Server components and non-async client components:

```tsx
import { useTranslations } from 'next-intl';

const t = useTranslations('admin');
// …
<h2>{t('usersTitle')}</h2>
```

Async server components and server actions use the awaited form:

```ts
import { getTranslations } from 'next-intl/server';

const t = await getTranslations('errors');
return { error: t('notAuthenticated') };
```

Emphasis inside a sentence goes through `t.rich`, never through splitting the
sentence across JSX:

```tsx
{t.rich('headline', { accent: (chunks) => <em className="…">{chunks}</em> })}
```

Splitting it in JSX pins the emphasised words to English word order. Persian
puts the stress somewhere else in the sentence, and a translator has to be able
to move it.

## Navigation

Import `Link`, `redirect`, `useRouter` and `usePathname` from `@/i18n/navigation`,
never from `next/link` or `next/navigation`. The Next versions drop the visitor
out of `/fa` on the next click, silently — which is what makes a half-done
translation feel broken rather than untranslated.

Every route is declared in `src/i18n/routing.ts`. A route that is not in that
map will not compile as a link target. Query strings and dynamic segments take
the object form:

```tsx
<Link href={{ pathname: '/growth/[id]', params: { id }, query: { tab: 'ideation' } }} />
```

## Writing the Persian

Load the `persian-writing` skill before writing any Persian. The rules that
apply to this product specifically:

- **Register: formal-but-human** across the whole product, marketing and app
  alike. `است`, never `می‌باشد`. Short sentences. Address the reader as `شما`
  and let the verb carry it. No `لازم به ذکر است`, no `در راستای`, no
  `از اهمیت ویژه‌ای برخوردار است`.
- **No em dashes.** Use `،` or `؛`, or restructure. The English copy is full of
  them; they do not survive the crossing.
- **Persian digits** `۰۱۲۳۴۵۶۷۸۹` in prose. Latin digits stay in URLs, emails,
  API keys, version numbers and code.
- **ZWNJ** (`نیم‌فاصله`): `می‌شود`, `کتاب‌ها`, `به‌عنوان`.
- **`ی` and `ک`**, never the Arabic `ي` / `ك`.
- **Brand and network names stay Latin** — Contivo, LinkedIn, OAuth, API — and
  are wrapped in `<bdi>` when they sit inside Persian prose, so the surrounding
  punctuation does not jump to the wrong side.
- Do not translate a technical term into something no Iranian developer says.
  `اتوپایلت` and `پرامپت` are what people actually use; a coined Persian
  equivalent reads as machine translation.

Run both scripts over any Persian you add before you call it done:

```bash
python3 ~/.claude/skills/persian-writing/scripts/fa_lint.py --check <file>
```

The lint must come back with zero issues. (The companion `persian_cleanup.py`
is useful, but it strips the hamze from `تأیید` and `تأکید`; those are correct
as written here, so do not take that particular edit.)

## Layout

`dir` is set once, on `<html>`, from the locale. Under it, flex and grid mirror
themselves — do not write `row-reverse` to "fix" RTL, that double-flips.

- Use logical spacing: `ms-`/`me-`/`ps-`/`pe-`, `start-`/`end-`, `text-start`.
  Physical `ml-`/`pr-`/`text-left` survive only where the thing really is
  pinned to a physical side in both languages.
- Directional glyphs (arrows, chevrons, back buttons) get `rtl:rotate-180`.
  Symmetric icons get nothing. Do not add a CSS class that sets `transform`
  directly — it overwrites Tailwind's composed transform and kills any
  `translate` on the same element.
- Inputs whose content is Latin by nature (URL, email, password, phone) are
  already forced LTR in `globals.css`. A Latin run inside Persian prose that
  renders backwards — `//:https` is the classic — needs `dir="ltr"` or `<bdi>`.
- Never set `letter-spacing` on Persian. It breaks letter joining. `globals.css`
  zeroes it under `[lang='fa']`, so a tracking class on a shared component is
  harmless, but do not add one that only the Persian side uses.

## Before you call it done

1. `pnpm --filter @contivo/web typecheck` is green.
2. `fa_lint.py --check` reports zero issues on the Persian you wrote.
3. You loaded the page in the browser at `/fa` **and** `/en` and looked at it.
   English must be unchanged. This codebase's recurring failure mode is
   "looked fine, wasn't" — reading the diff is not verification.
