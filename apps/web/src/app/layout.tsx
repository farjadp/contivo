/**
 * Root layout.
 *
 * Deliberately thin: `<html>` and `<body>` are emitted by `[locale]/layout.tsx`,
 * because `dir` and the font stack depend on which language is being served and
 * this layout renders before the locale is known. Every visitor-facing path
 * goes through the locale segment, so nothing renders without those tags.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
