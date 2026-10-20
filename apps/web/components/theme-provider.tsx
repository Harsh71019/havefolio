'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ThemeProvider as NextThemesProvider, useTheme } from 'next-themes';
import {
  getStoredPalette,
  setStoredPalette,
  palettes,
  type PalettePreset,
  paletteKey,
  legacyPaletteKey,
} from './theme-palette-config';

export interface PaletteContextValue {
  palette: PalettePreset;
  setPalette: (preset: PalettePreset) => void;
  availablePalettes: readonly PalettePreset[];
}

export type AppearanceValue = PaletteContextValue & ReturnType<typeof useTheme>;

const PaletteContext = createContext<PaletteContextValue>({
  palette: 'neutral',
  setPalette: () => {},
  availablePalettes: palettes,
});

export function PaletteProvider({ children }: { children: ReactNode }): ReactElement {
  const [palette, setPaletteState] = useState<PalettePreset>(() => getStoredPalette());

  useEffect(() => {
    // Ensure the document attribute reflects current state on mount
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.palette = palette;
    }

    // Synchronise changes across tabs
    const handleStorage = (event: StorageEvent): void => {
      if (event.key === paletteKey || event.key === legacyPaletteKey) {
        const next = getStoredPalette();
        setPaletteState(next);
        if (typeof document !== 'undefined') {
          document.documentElement.dataset.palette = next;
        }
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }, [palette]);

  const handleSetPalette = useCallback((next: PalettePreset) => {
    setStoredPalette(next);
    setPaletteState(next);
  }, []);

  const value = useMemo<PaletteContextValue>(
    () => ({
      palette,
      setPalette: handleSetPalette,
      availablePalettes: palettes,
    }),
    [palette, handleSetPalette],
  );

  return <PaletteContext.Provider value={value}>{children}</PaletteContext.Provider>;
}

export function usePalette(): PaletteContextValue {
  return useContext(PaletteContext);
}

export function useAppearance(): AppearanceValue {
  const themeProps = useTheme();
  const paletteProps = usePalette();

  return {
    ...themeProps,
    ...paletteProps,
  };
}

export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>): ReactElement {
  return (
    <NextThemesProvider {...props}>
      <PaletteProvider>{children}</PaletteProvider>
    </NextThemesProvider>
  );
}
