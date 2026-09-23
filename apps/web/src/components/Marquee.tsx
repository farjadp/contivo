// components/Marquee.tsx
import React from 'react';

interface MarqueeProps {
  text: string;
  speed?: number;
}

/*
  The separator is a middot rather than an em dash: em dashes do not survive
  the crossing into Persian, and this strip renders the same string in both
  languages. The scroll also flips with the page — a marquee that runs
  left-to-left under an RTL layout reads as broken rather than decorative.
*/
export const Marquee = ({ text, speed = 20 }: MarqueeProps) => {
  return (
    <div className="relative flex overflow-x-hidden border-b border-black bg-white py-4 shadow-[inset_0_-2px_0_0_#000]">
      <div className={`flex whitespace-nowrap animate-marquee`}>
        {[...Array(4)].map((_, i) => (
          <span key={i} className="text-8xl font-black uppercase tracking-tighter mx-4 font-sans italic">
            {text} ·{' '}
          </span>
        ))}
      </div>

      <style jsx>{`
        @keyframes marquee {
          0% { transform: translateX(0%); }
          100% { transform: translateX(-50%); }
        }
        @keyframes marquee-rtl {
          0% { transform: translateX(0%); }
          100% { transform: translateX(50%); }
        }
        .animate-marquee {
          animation: marquee ${speed}s linear infinite;
        }
        :global([dir='rtl']) .animate-marquee {
          animation-name: marquee-rtl;
        }
      `}</style>
    </div>
  );
};
