import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        /* ── Chalk & Saffron: the signed-in system (redesign/loop). ──
           One ground, one ink, one act-now accent. Saffron means "you" on a
           chart and "do this" on a button; rival blue is always a competitor.
           They differ in lightness as well as hue, so they survive greyscale. */
        chalk: {
          DEFAULT: '#EEEDE6',
          raised: '#F8F7F2',
          sunk: '#E2E1D8',
        },
        moss: {
          DEFAULT: '#17201B',
          700: '#2F4A3A',
          /* 6.7:1 on chalk, 7.3:1 on chalk-raised — secondary text, never lighter. */
          muted: '#4A544D',
        },
        forest: {
          DEFAULT: '#1E2E25',
          line: '#3A4C41',
          /* Secondary text on forest, 7:1. */
          muted: '#B9C2B6',
        },
        saffron: {
          DEFAULT: '#E3A21A',
          soft: '#F4DFA8',
          /* Saffron-family text that passes 4.5:1 on chalk. */
          ink: '#6B5410',
        },
        rival: '#3D5F8A',
        rule: {
          DEFAULT: '#D5D4CA',
          strong: '#A9A89C',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        heading: ['var(--font-sora)', 'var(--font-inter)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-inter)', 'system-ui', 'sans-serif'],
        /* The Persian face. Named so a component can ask for it explicitly;
           the [lang='fa'] rules in globals.css already redirect display and
           accent to it, so most code never needs to. */
        vazir: ['var(--font-vazir)', 'Segoe UI', 'Tahoma', 'sans-serif'],
        /* Signed-in UI. Plex has no Persian glyphs, so Persian text falls
           through to Vazirmatn per character instead of to the OS. */
        plex: ['var(--font-plex)', 'var(--font-vazir)', 'system-ui', 'sans-serif'],
        plexmono: ['var(--font-plex-mono)', 'var(--font-vazir)', 'ui-monospace', 'monospace'],
      },
      keyframes: {
        /* Marketing site motion (Chalk & Saffron). Every one of these is
           wrapped in motion-safe: at the call site. */
        rise: {
          from: { opacity: '0', transform: 'translateY(24px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        pop: {
          '0%': { opacity: '0', transform: 'scale(.4)' },
          '70%': { transform: 'scale(1.12)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        sweep: { from: { backgroundSize: '0% 34%' }, to: { backgroundSize: '100% 34%' } },
        draw: { from: { strokeDashoffset: '461' }, to: { strokeDashoffset: '0' } },
        ripple: {
          '0%': { transform: 'scale(1)', opacity: '.7' },
          '100%': { transform: 'scale(1.9)', opacity: '0' },
        },
        shake: {
          '0%, 100%': { transform: 'none' },
          '20%': { transform: 'translateX(-10px) rotate(-2deg)' },
          '40%': { transform: 'translateX(9px) rotate(2deg)' },
          '60%': { transform: 'translateX(-6px)' },
          '80%': { transform: 'translateX(4px)' },
        },
        orbit: {
          '0%': { transform: 'rotate(0deg) translateX(40px) rotate(0deg)' },
          '100%': { transform: 'rotate(360deg) translateX(40px) rotate(-360deg)' },
        },
        'pulse-slow': {
          '0%, 100%': { opacity: '0.3', transform: 'scale(1)' },
          '50%': { opacity: '0.6', transform: 'scale(1.05)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        }
      },
      animation: {
        rise: 'rise .9s cubic-bezier(.2,.7,.2,1) both',
        'fade-in': 'fade-in .5s ease both',
        pop: 'pop .55s cubic-bezier(.2,.7,.2,1) both',
        sweep: 'sweep .8s .9s cubic-bezier(.2,.7,.2,1) both',
        draw: 'draw 1.6s .5s cubic-bezier(.6,0,.2,1) both',
        ripple: 'ripple 1.8s ease-out 2s infinite',
        shake: 'shake .5s cubic-bezier(.36,.07,.19,.97)',
        orbit: 'orbit 20s linear infinite',
        'pulse-slow': 'pulse-slow 6s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        float: 'float 6s ease-in-out infinite',
      }
    },
  },
  plugins: [],
};

export default config;
