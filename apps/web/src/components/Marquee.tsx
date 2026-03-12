// components/Marquee.tsx
import React from 'react';

interface MarqueeProps {
  text: string;
  speed?: number;
}

export const Marquee = ({ text, speed = 20 }: MarqueeProps) => {
  return (
    <div className="relative flex overflow-x-hidden border-b border-black bg-white py-4 shadow-[inset_0_-2px_0_0_#000]">
      <div className={`flex whitespace-nowrap animate-marquee`}>
        {[...Array(4)].map((_, i) => (
          <span key={i} className="text-8xl font-black uppercase tracking-tighter mx-4 font-sans italic">
            {text} — 
          </span>
        ))}
      </div>

      <style jsx>{`
        @keyframes marquee {
          0% { transform: translateX(0%); }
          100% { transform: translateX(-50%); }
        }
        .animate-marquee {
          animation: marquee ${speed}s linear infinite;
        }
      `}</style>
    </div>
  );
};