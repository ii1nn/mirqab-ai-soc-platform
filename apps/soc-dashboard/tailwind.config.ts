import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Reads from the CSS custom properties defined in
        // src/styles/index.css — the single source of truth for the
        // palette (see that file's header comment). Utility class names
        // (mirqab-primary, mirqab-success, etc.) are kept stable so every
        // existing usage across the app re-skins automatically.
        mirqab: {
          // `rgb(var(--x) / <alpha-value>)` — the token-with-opacity-modifier
          // pattern Tailwind needs so `bg-mirqab-accent/20` etc. keep working
          // (see src/styles/index.css's :root block for why the variables
          // themselves are bare "R G B" triplets, not hex/rgb() strings).
          primary: 'rgb(var(--mirqab-bg) / <alpha-value>)',
          secondary: 'rgb(var(--mirqab-surface) / <alpha-value>)',
          surface: 'rgb(var(--mirqab-surface-elevated) / <alpha-value>)',
          surfaceElevated: 'rgb(var(--mirqab-bg-elevated) / <alpha-value>)',
          accent: 'rgb(var(--mirqab-accent) / <alpha-value>)',
          accentPink: 'rgb(var(--mirqab-accent-pink) / <alpha-value>)',
          blue: 'rgb(var(--mirqab-info) / <alpha-value>)',
          danger: 'rgb(var(--mirqab-critical) / <alpha-value>)',
          warning: 'rgb(var(--mirqab-high) / <alpha-value>)',
          yellow: 'rgb(var(--mirqab-medium) / <alpha-value>)',
          success: 'rgb(var(--mirqab-healthy) / <alpha-value>)',
          border: 'var(--mirqab-border)',
          borderStrong: 'var(--mirqab-border-strong)',
          textPrimary: 'rgb(var(--mirqab-text-primary) / <alpha-value>)',
          textSecondary: 'rgb(var(--mirqab-text-secondary) / <alpha-value>)',
          textMuted: 'rgb(var(--mirqab-text-muted) / <alpha-value>)',
          // Live Network Map / Attack Path canvas surface — opaque, not a
          // translucent wash (see src/styles/index.css for why).
          topology: 'rgb(var(--mirqab-topology-surface) / <alpha-value>)',
        },
        // Theme-reactive stand-ins for Tailwind's own `white`/`slate-*`
        // keywords (see src/styles/index.css's [data-theme="light"] block) —
        // every existing `bg-white/5`, `text-slate-400`, etc. utility across
        // the app re-skins for light mode automatically. Only the shades
        // actually used in this codebase are overridden; everything else
        // (slate-50/700/800/950, black, other palette colors) keeps
        // Tailwind's real static default.
        white: 'rgb(var(--mirqab-white) / <alpha-value>)',
        // NOT a remap of Tailwind's own `black` (Modal.tsx's real page-dim
        // backdrop needs literal black in both themes) — a separate token
        // for the app's "recessed surface" pattern (bg-mirqab-black/20 etc.)
        // used in list rows / tab wells / canvas containers.
        'mirqab-black': 'rgb(var(--mirqab-black) / <alpha-value>)',
        slate: {
          100: 'rgb(var(--mirqab-slate-100) / <alpha-value>)',
          200: 'rgb(var(--mirqab-slate-200) / <alpha-value>)',
          300: 'rgb(var(--mirqab-slate-300) / <alpha-value>)',
          400: 'rgb(var(--mirqab-slate-400) / <alpha-value>)',
          500: 'rgb(var(--mirqab-slate-500) / <alpha-value>)',
          600: 'rgb(var(--mirqab-slate-600) / <alpha-value>)',
          900: 'rgb(var(--mirqab-slate-900) / <alpha-value>)',
        },
      },
      backgroundImage: {
        'mirqab-brand': 'linear-gradient(135deg, #EC4899 0%, #7C3AED 100%)',
        'mirqab-radial': 'radial-gradient(60% 50% at 15% 0%, rgba(124,58,237,0.20) 0%, rgba(11,8,23,0) 60%), radial-gradient(50% 40% at 100% 10%, rgba(236,72,153,0.14) 0%, rgba(11,8,23,0) 60%)',
      },
      boxShadow: {
        glow: '0 0 24px -6px rgba(124, 58, 237, 0.55)',
        'glow-sm': '0 0 12px -2px rgba(124, 58, 237, 0.5)',
        'glow-pink': '0 0 24px -6px rgba(236, 72, 153, 0.55)',
        'glow-red': '0 0 24px -4px rgba(255, 59, 92, 0.6)',
        'glow-orange': '0 0 24px -6px rgba(245, 158, 11, 0.55)',
        'glow-blue': '0 0 24px -6px rgba(59, 130, 246, 0.55)',
        'glow-green': '0 0 24px -6px rgba(20, 224, 196, 0.5)',
      },
      borderRadius: {
        xl2: '18px',
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
        'dash-flow': {
          to: { strokeDashoffset: '-24' },
        },
        'slide-in-start': {
          from: { transform: 'translateX(var(--panel-from, -100%))', opacity: '0' },
          to: { transform: 'translateX(0)', opacity: '1' },
        },
      },
      animation: {
        'pulse-glow': 'pulse-glow 1.8s ease-in-out infinite',
        'dash-flow': 'dash-flow 0.6s linear infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
