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
        ink: {
          950: '#07090C',
          900: '#0B0F14',
          800: '#121820',
          700: '#1B232E',
          600: '#2A3441',
          400: '#5C6878',
          300: '#8A96A6',
          200: '#B7C0CC',
          100: '#E6EAF0',
        },
        signal: {
          DEFAULT: '#3DFF8F',
          dim: '#22B865',
          ink: '#052A15',
        },
        paper: {
          DEFAULT: '#F5F3EE',
          2: '#ECE9E1',
          /* The editorial world, shared with the onboarding screens. */
          warm: '#EFECE5',
          light: '#FDFCF8',
        },
        carbon: {
          DEFAULT: '#121212',
          80: '#3A3A38',
          60: '#6B6B66',
          40: '#9C9C95',
          20: '#D6D3CA',
        },
        brick: {
          DEFAULT: '#C04C36',
          deep: '#A63D29',
          /* Lifted from #FDF2EE: body copy on the red field measured 4.42:1,
             under the 4.5 floor. This clears it without touching the brand red. */
          ink: '#FFF8F4',
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
          /* 7.4:1 on chalk — secondary text, never lighter. */
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
        brand: {
          indigo: '#2B2DFF',
          violet: '#7A5CFF',
          midnight: '#0E0F1A',
          cyan: '#00E5FF',
          purple: '#B8A8FF',
          light: '#F6F7FB',
          gray: '#7C7F93',
          dark: '#1F2235',
        }
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
        accent: ['var(--font-accent)', 'Georgia', 'serif'],
        /* The Persian face. Named so a component can ask for it explicitly;
           the [lang='fa'] rules in globals.css already redirect display and
           accent to it, so most code never needs to. */
        vazir: ['var(--font-vazir)', 'Segoe UI', 'Tahoma', 'sans-serif'],
        /* Signed-in UI. Plex has no Persian glyphs, so Persian text falls
           through to Vazirmatn per character instead of to the OS. */
        plex: ['var(--font-plex)', 'var(--font-vazir)', 'system-ui', 'sans-serif'],
        plexmono: ['var(--font-plex-mono)', 'var(--font-vazir)', 'ui-monospace', 'monospace'],
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(to right, #2B2DFF, #7A5CFF, #00E5FF)',
      },
      keyframes: {
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
        orbit: 'orbit 20s linear infinite',
        'pulse-slow': 'pulse-slow 6s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        float: 'float 6s ease-in-out infinite',
      }
    },
  },
  plugins: [],
};

export default config;
