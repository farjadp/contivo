import { Check } from 'lucide-react';

export const metadata = { title: 'Pricing' };

const plans = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    credits: '100 credits/mo',
    description: 'Try Contivo with no commitment.',
    features: ['100 AI credits per month', 'Instant Content generation', '5 content history items'],
    cta: 'Get started free',
    highlighted: false,
  },
  {
    name: 'Starter',
    price: '$29',
    period: 'per month',
    credits: '1,000 credits/mo',
    description: 'For creators and solo founders.',
    features: [
      '1,000 AI credits per month',
      'Instant Content (all channels)',
      '1 Growth Engine workspace',
      'Content history',
      'Email support',
    ],
    cta: 'Start Starter',
    highlighted: false,
  },
  {
    name: 'Pro',
    price: '$79',
    period: 'per month',
    credits: '5,000 credits/mo',
    description: 'For growing teams and agencies.',
    features: [
      '5,000 AI credits per month',
      'Unlimited Instant Content',
      'Up to 5 Growth Engine workspaces',
      'Content calendar',
      'Priority support',
      'Credit top-ups available',
    ],
    cta: 'Start Pro',
    highlighted: true,
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-[#0E0F1A] text-white py-24 px-6">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <h1 className="text-4xl font-bold mb-4 text-gradient">Simple, honest pricing</h1>
          <p className="text-slate-400 text-lg">Pay for what you use. No hidden token math.</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-2xl p-8 border ${
                plan.highlighted
                  ? 'bg-brand-indigo/10 border-brand-indigo/50 relative overflow-hidden'
                  : 'bg-slate-900/60 border-slate-800'
              }`}
            >
              {plan.highlighted && (
                <div className="absolute top-0 left-0 right-0 h-1 bg-brand-gradient" />
              )}
              <div className="mb-6">
                <p className="text-sm text-slate-400 mb-1">{plan.name}</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold">{plan.price}</span>
                  <span className="text-slate-400 text-sm">/{plan.period}</span>
                </div>
                <p className="text-sm text-brand-cyan mt-1">{plan.credits}</p>
                <p className="text-slate-400 text-sm mt-2">{plan.description}</p>
              </div>
              <ul className="space-y-2 mb-8">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-3 text-sm text-slate-300">
                    <Check className="w-4 h-4 text-brand-cyan flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <button
                className={`w-full py-3 rounded-xl text-sm font-bold transition-all duration-300 ${
                  plan.highlighted
                    ? 'bg-brand-gradient text-white hover:opacity-90 shadow-lg shadow-brand-indigo/20'
                    : 'bg-slate-800 hover:bg-slate-700 text-white'
                }`}
              >
                {plan.cta}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
