import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  getUgerodTheme,
  UGEROD_THEME_MODES,
} from '../constants/uxTheme';

const STORAGE_KEY = 'ugerod.ui.theme.mode.v1';

const UgerodThemeContext = createContext(null);

function normalizeThemeMode(value) {
  return value === UGEROD_THEME_MODES.LIGHT
    ? UGEROD_THEME_MODES.LIGHT
    : UGEROD_THEME_MODES.DARK;
}

export function UgerodThemeProvider({ children }) {
  const [mode, setModeState] = useState(UGEROD_THEME_MODES.DARK);

  useEffect(() => {
    let mounted = true;

    AsyncStorage.getItem(STORAGE_KEY)
      .then((storedMode) => {
        if (mounted && storedMode) {
          setModeState(normalizeThemeMode(storedMode));
        }
      })
      .catch((error) => {
        console.warn('UGEROD theme load', error);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const setThemeMode = useCallback((nextMode) => {
    const normalizedMode = normalizeThemeMode(nextMode);

    setModeState(normalizedMode);

    AsyncStorage.setItem(STORAGE_KEY, normalizedMode).catch((error) => {
      console.warn('UGEROD theme save', error);
    });
  }, []);

  const value = useMemo(() => {
    const theme = getUgerodTheme(mode);

    return {
      mode,
      theme,
      colors: theme.colors,
      isDark: theme.isDark,
      setThemeMode,
    };
  }, [mode, setThemeMode]);

  return (
    <UgerodThemeContext.Provider value={value}>
      {children}
    </UgerodThemeContext.Provider>
  );
}

export function useUgerodTheme() {
  const context = useContext(UgerodThemeContext);

  if (!context) {
    throw new Error(
      'useUgerodTheme doit être utilisé dans UgerodThemeProvider.'
    );
  }

  return context;
}
