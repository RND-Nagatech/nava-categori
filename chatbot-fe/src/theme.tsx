import { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type ThemeName = 'amber' | 'blue' | 'purple';

type ThemeClasses = {
  brandIconBg: string;
  titleTextGradient: string;
  tabActiveBtn: string;
  headerBar: string;
  userBubble: string;
  primaryButton: string;
  focusRing: string;
  checkboxColor: string;
  loaderColor: string;
  infoBoxBg: string;
  infoBoxBorder: string;
  infoBoxText: string;
  codeBg: string;
};

const THEME_MAP: Record<ThemeName, ThemeClasses> = {
  amber: {
    brandIconBg: 'bg-gradient-to-br from-amber-500 to-yellow-600',
    titleTextGradient:
      'bg-gradient-to-r from-amber-700 to-yellow-700 bg-clip-text text-transparent',
    tabActiveBtn: 'bg-gradient-to-r from-amber-600 to-yellow-600 text-white shadow-md',
    headerBar: 'bg-gradient-to-r from-amber-600 to-yellow-600',
    userBubble: 'bg-gradient-to-r from-amber-600 to-yellow-600 text-white',
    primaryButton:
      'bg-gradient-to-r from-amber-600 to-yellow-600 text-white hover:from-amber-700 hover:to-yellow-700',
    focusRing: 'focus:ring-amber-600',
    checkboxColor: 'text-amber-600 focus:ring-amber-600',
    loaderColor: 'text-amber-600',
    infoBoxBg: 'bg-amber-50',
    infoBoxBorder: 'border-amber-200',
    infoBoxText: 'text-amber-800',
    codeBg: 'bg-amber-100',
  },
  blue: {
    brandIconBg: 'bg-gradient-to-br from-blue-600 to-blue-700',
    titleTextGradient: 'bg-gradient-to-r from-blue-700 to-blue-800 bg-clip-text text-transparent',
    tabActiveBtn: 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-md',
    headerBar: 'bg-gradient-to-r from-blue-600 to-blue-700',
    userBubble: 'bg-gradient-to-r from-blue-600 to-blue-700 text-white',
    primaryButton:
      'bg-gradient-to-r from-blue-600 to-blue-700 text-white hover:from-blue-700 hover:to-blue-800',
    focusRing: 'focus:ring-blue-600',
    checkboxColor: 'text-blue-600 focus:ring-blue-600',
    loaderColor: 'text-blue-600',
    infoBoxBg: 'bg-blue-100',
    infoBoxBorder: 'border-blue-300',
    infoBoxText: 'text-blue-900',
    codeBg: 'bg-blue-200',
  },
  purple: {
    brandIconBg: 'bg-gradient-to-br from-violet-500 to-fuchsia-500',
    titleTextGradient:
      'bg-gradient-to-r from-violet-600 to-fuchsia-600 bg-clip-text text-transparent',
    tabActiveBtn: 'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-md',
    headerBar: 'bg-gradient-to-r from-violet-500 to-fuchsia-500',
    userBubble: 'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white',
    primaryButton:
      'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:from-violet-600 hover:to-fuchsia-600',
    focusRing: 'focus:ring-violet-500',
    checkboxColor: 'text-violet-500 focus:ring-violet-500',
    loaderColor: 'text-violet-500',
    infoBoxBg: 'bg-violet-50',
    infoBoxBorder: 'border-violet-200',
    infoBoxText: 'text-violet-800',
    codeBg: 'bg-violet-100',
  },
};

type ThemeContextType = {
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
  dark: boolean;
  toggleDark: () => void;
  classes: ThemeClasses;
};

const ThemeContext = createContext<ThemeContextType | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<ThemeName>(() => {
    const saved = localStorage.getItem('app:theme');
    return (saved as ThemeName) || 'blue';
  });
  const [dark, setDark] = useState<boolean>(() => {
    const saved = localStorage.getItem('app:dark');
    return saved ? saved === '1' : false;
  });

  useEffect(() => {
    localStorage.setItem('app:theme', theme);
    // Update body theme class for CSS variable overrides
    document.body.classList.remove('theme-amber', 'theme-blue', 'theme-purple');
    document.body.classList.add(`theme-${theme}`);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('app:dark', dark ? '1' : '0');
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  const classes = useMemo(() => THEME_MAP[theme], [theme]);

  const value: ThemeContextType = {
    theme,
    setTheme,
    dark,
    toggleDark: () => setDark((d) => !d),
    classes,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

export function getAvailableThemes(): ThemeName[] {
  return ['amber', 'blue', 'purple'];
}
