import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Reads from src/styles/index.css's :root tokens — kept in sync
        // with apps/soc-dashboard's palette by hand (see that file's
        // header comment) so both Mirqab apps share one brand identity.
        mirqab: {
          primary: 'rgb(var(--mirqab-bg) / <alpha-value>)',
          secondary: 'rgb(var(--mirqab-surface) / <alpha-value>)',
          surface: 'rgb(var(--mirqab-surface-elevated) / <alpha-value>)',
          accent: 'rgb(var(--mirqab-accent) / <alpha-value>)',
          accentPink: 'rgb(var(--mirqab-accent-pink) / <alpha-value>)',
          blue: 'rgb(var(--mirqab-info) / <alpha-value>)',
          danger: 'rgb(var(--mirqab-critical) / <alpha-value>)',
          warning: 'rgb(var(--mirqab-high) / <alpha-value>)',
          success: 'rgb(var(--mirqab-healthy) / <alpha-value>)',
          border: 'var(--mirqab-border)',
          textSecondary: 'rgb(var(--mirqab-text-secondary) / <alpha-value>)',
          textMuted: 'rgb(var(--mirqab-text-muted) / <alpha-value>)',
        },
      },
      backgroundImage: {
        'mirqab-brand': 'linear-gradient(135deg, #EC4899 0%, #7C3AED 100%)',
      },
      boxShadow: {
        glow: '0 0 24px -6px rgba(124, 58, 237, 0.55)',
        'glow-sm': '0 0 12px -2px rgba(124, 58, 237, 0.5)',
        'glow-red': '0 0 24px -4px rgba(255, 59, 92, 0.6)',
        'glow-green': '0 0 24px -6px rgba(20, 224, 196, 0.5)',
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
      },
      animation: {
        'pulse-glow': 'pulse-glow 1.8s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
