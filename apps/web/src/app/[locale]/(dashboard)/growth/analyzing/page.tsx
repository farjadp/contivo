/**
 * Analysing screen — server shell.
 *
 * Exists only to declare the route segment config: the real extraction work
 * (scrape + brand memory + competitor discovery) now runs from this screen
 * via the `enrichWorkspace` server action, and needs more than the default
 * serverless budget. The client component below drives it.
 */
import { AnalyzingRunner } from './_components/AnalyzingRunner';

export const maxDuration = 300; // seconds; Vercel clamps to the plan limit

export default function GrowthAnalyzingPage() {
  return <AnalyzingRunner />;
}
