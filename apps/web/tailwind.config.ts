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
