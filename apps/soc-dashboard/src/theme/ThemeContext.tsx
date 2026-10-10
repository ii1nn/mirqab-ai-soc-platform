import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export type ThemePreference = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

const THEME_STORAGE_KEY = 'mirqab.theme';
const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

interface ThemeContextValue {
  /** What the user picked — 'system' means "follow the OS", not a fixed theme. */
  preference: ThemePreference;
  /** What's actually applied right now (system resolved to dark/light). */
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function resolveInitialPreference(): ThemePreference {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'dark' || stored === 'light' || stored === 'system') return stored;
  return 'system';
}

function systemPrefersDark(): boolean {
  return window.matchMedia(DARK_MEDIA_QUERY).matches;
}

function resolve(preference: ThemePreference): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return preference;
}

/** Applies the resolved theme the same way the anti-flash inline script in
 * index.html does on first paint — keeps both code paths in sync. */
function applyResolvedTheme(resolved: ResolvedTheme) {
  document.documentElement.setAttribute('data-theme', resolved);
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(resolveInitialPreference);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolve(preference));

  useEffect(() => {
    const next = resolve(preference);
    setResolvedTheme(next);
    applyResolvedTheme(next);

    if (preference !== 'system') return undefined;

    // Live-follow OS theme changes while "system" is selected.
    const media = window.matchMedia(DARK_MEDIA_QUERY);
    const onChange = () => {
      const followed = systemPrefersDark() ? 'dark' : 'light';
      setResolvedTheme(followed);
      applyResolvedTheme(followed);
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    localStorage.setItem(THEME_STORAGE_KEY, next);
    setPreferenceState(next);
  }, []);

  const value = useMemo(
    () => ({ preference, resolvedTheme, setPreference }),
    [preference, resolvedTheme, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
