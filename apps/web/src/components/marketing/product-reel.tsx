'use client';

/**
 * The showreel.
 *
 * Motion graphics drawn in the product's own design system, rendered by
 * scripts/render-showreel.mjs — an explainer of the six-stage loop, which the
 * caption says plainly, because the real screenshots are what the rest of the
 * page uses as evidence.
 *
 * Each language plays its own film. The Persian one is not the English cut
 * with the words swapped: it is a separate piece, one continuous camera move
 * round the loop, written in Persian.
 *
 * It plays when it scrolls into view rather than on mount: the reel sits below
 * the fold, so starting it at mount downloads and decodes half a megabyte for
 * visitors who never reach it — and a play() call made before any scroll is
 * also the one browsers are most likely to refuse.
 *
 * Visitors who asked their system for reduced motion get the poster frame and
 * an explicit control instead, because a looping video is exactly
 * the kind of thing that setting exists to stop. PRODUCT.md makes the fallback
 * required rather than optional.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

const FILMS = {
  en: { src: '/marketing/contivo-showreel.mp4', poster: '/marketing/showreel-poster.webp' },
  fa: { src: '/marketing/contivo-showreel-fa.mp4', poster: '/marketing/showreel-poster-fa.webp' },
} as const;

export function ProductReel() {
  const ref = useRef<HTMLVideoElement>(null);
  const film = FILMS[useLocale() as keyof typeof FILMS] ?? FILMS.en;
  const [reduced, setReduced] = useState(false);
  const t = useTranslations('home.reel');
  const [playing, setPlaying] = useState(false);
  /* Set once the visitor uses the button, after which visibility stops
     deciding: nothing is more annoying than a video that restarts itself. */
  const manual = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const play = useCallback(() => {
    const v = ref.current;
    if (!v) return;
    void v.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }, []);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (reduced) {
      v.pause();
      setPlaying(false);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (manual.current) return;
        if (entry.isIntersecting) play();
        else {
          v.pause();
          setPlaying(false);
        }
      },
      { threshold: 0.4 },
    );
    io.observe(v);
    return () => io.disconnect();
  }, [reduced, play]);

  function toggle() {
    const v = ref.current;
    if (!v) return;
    manual.current = true;
    if (v.paused) play();
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
          className="w-full rounded-2xl border border-rule bg-chalk"
          src={film.src}
          poster={film.poster}
          muted
          loop
          playsInline
          preload="metadata"
          aria-label={t('videoAlt')}
        />
        <button
          type="button"
          onClick={toggle}
          aria-pressed={playing}
          className="absolute bottom-4 end-4 h-11 rounded-full bg-moss/90 px-5 text-[13px] font-semibold text-chalk backdrop-blur-sm transition-colors duration-200 hover:bg-moss"
        >
          {playing ? t('pause') : t('play')}
        </button>
      </div>
      <figcaption className="mt-3 text-[12.5px] text-moss-muted">
        {t('caption')}
        {reduced ? ` ${t('reducedNote')}` : ''}
      </figcaption>
    </figure>
  );
}
