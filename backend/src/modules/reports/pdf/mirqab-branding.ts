import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The real Mirqab logo (purple/magenta circular mark, white shield +
 * checkmark) supplied by the user — never redrawn, approximated, or
 * substituted. Lives under `pdf/assets/` and is declared in nest-cli.json's
 * `compilerOptions.assets` so `nest build` copies it into `dist/` alongside
 * the compiled JS (the Docker runtime image only ships `dist/`, not `src/`).
 * Read once at module load and reused for every PDF render.
 */
export const MIRQAB_LOGO_PNG: Buffer = readFileSync(join(__dirname, 'assets', 'mirqab-logo.png'));

/** Mirqab's brand palette for the Weekly SOC Report — white page background,
 * purple/violet primary, deep navy text, muted blue-gray secondary text,
 * very light lavender/blue/gray card fills. Kept local to the weekly report
 * (via PdfWriter's new premium primitives) — the Case-Based Digital
 * Forensics Report is unaffected and keeps its existing plain palette. */
export const BRAND = {
  purple: '#7C3AED',
  purpleDark: '#5B21B6',
  purpleTint: '#F3EEFD',
  navy: '#0F172A',
  blueGray: '#475569',
  muted: '#64748B',
  border: '#E5E7EB',
  cardLavender: '#F5F3FB',
  cardBlue: '#EFF6FF',
  cardGray: '#F8FAFC',
  white: '#FFFFFF',
  severity: {
    CRITICAL: '#DC2626',
    HIGH: '#EA580C',
    MEDIUM: '#D97706',
    LOW: '#16A34A',
  } as const,
  risk: {
    CRITICAL: '#DC2626',
    HIGH: '#EA580C',
    MEDIUM: '#D97706',
    LOW: '#16A34A',
  } as const,
} as const;
