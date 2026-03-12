import { InstantForm } from '@/components/instant/instant-form';
import { CreditBalance } from '@/components/shared/credit-balance';

export const metadata = { title: 'Instant Content — Contivo' };

export default function InstantContentPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gradient mb-1">Instant Content</h1>
          <p className="text-muted-foreground text-sm font-medium">
            Enter a topic and channel. Get publish-ready content in seconds.
          </p>
        </div>
        <CreditBalance />
      </div>
      <InstantForm />
    </div>
  );
}
