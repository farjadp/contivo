'use client';

/**
 * The product reel.
 *
 * Autoplays for everyone except visitors who asked their system for reduced
 * motion — they get the poster frame and an explicit control, because a
 * looping 12-second video is exactly the kind of thing that setting exists to
 * stop. PRODUCT.md makes the fallback required rather than optional.
 */

import { useEffect, useRef, useState } from 'react';

export function ProductReel() {
  const ref = useRef<HTMLVideoElement>(null);
  const [reduced, setReduced] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (reduced) {
      v.pause();
      setPlaying(false);
    } else {
      void v.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  }, [reduced]);

  function toggle() {
    const v = ref.current;
    if (!v) return;
    if (v.paused) void v.play().then(() => setPlaying(true)).catch(() => {});
    else {
      v.pause();
      setPlaying(false);
    }
  }

  return (
    <figure className="mt-10">
      <div className="relative">
        <video
          ref={ref}
          className="w-full border border-carbon/15 bg-paper-warm"
          src="/marketing/contivo-reel.mp4"
          poster="/marketing/reel-poster.webp"
          muted
          loop
          playsInline
          preload="metadata"
          aria-label="Screen recording of Contivo: brand memory, the market map, the setup steps still locked, and a post it wrote."
        />
        <button
          type="button"
          onClick={toggle}
          aria-pressed={playing}
          className="absolute bottom-4 right-4 bg-carbon/90 px-4 py-2.5 text-[13px] font-semibold text-paper-warm backdrop-blur-sm transition-colors duration-200 hover:bg-brick"
        >
          {playing ? 'Pause' : 'Play'}
        </button>
      </div>
      <figcaption className="mt-3 text-[12.5px] text-carbon-60">
        Recorded from a running workspace. No narration, no sound.
        {reduced ? ' Paused because your system asks for reduced motion.' : ''}
      </figcaption>
    </figure>
  );
}
