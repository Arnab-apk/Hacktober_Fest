// ─── Theme Hook ─────────────────────────────────────────────────────────
// Provides theme state with localStorage persistence and <html> class sync.

import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { Theme } from '../types';
import { getStoredTheme, setStoredTheme } from '../services/storageService';

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  toggleTheme: () => {},
  isDark: true,
});

export function useThemeProvider(): ThemeContextValue {
  const [theme, setTheme] = useState<Theme>(getStoredTheme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.remove('dark');
      root.classList.add('light');
    }
    setStoredTheme(theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, toggleTheme, isDark: theme === 'dark' };
}

export { ThemeContext };

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
