export const paletteKey = 'havefolio:palette-preset:v1';
export const legacyPaletteKey = 'havefolio:palette-preset';

export const palettes = ['neutral', 'ocean', 'forest'] as const;
export type PalettePreset = (typeof palettes)[number];

export interface PaletteMetadata {
  id: PalettePreset;
  name: string;
  description: string;
  accentLabel: string;
}

export const paletteMetadata: Record<PalettePreset, PaletteMetadata> = {
  neutral: {
    id: 'neutral',
    name: 'Neutral',
    description: 'Calm zinc baseline with neutral surfaces and high contrast.',
    accentLabel: 'Zinc',
  },
  ocean: {
    id: 'ocean',
    name: 'Ocean',
    description: 'Marine slate tones with deep sea accents and cool muted surfaces.',
    accentLabel: 'Marine Slate',
  },
  forest: {
    id: 'forest',
    name: 'Forest',
    description: 'Sage and cedar pine tones with natural earthy accents.',
    accentLabel: 'Cedar Pine',
  },
};

/**
 * Validates whether an unknown value is a supported palette preset.
 */
export function isPalettePreset(value: unknown): value is PalettePreset {
  return typeof value === 'string' && (palettes as readonly string[]).includes(value);
}

/**
 * Safely parses any value into a valid PalettePreset.
 * Unknown, missing, obsolete, or invalid values safely fall back to 'neutral'.
 */
export function parsePalette(value: unknown): PalettePreset {
  if (value === 'ocean' || value === 'forest') {
    return value;
  }
  return 'neutral';
}

/**
 * Safely reads the currently stored palette preset from localStorage.
 * Handles storage exceptions (e.g. private browsing or disabled storage) without throwing.
 */
export function getStoredPalette(): PalettePreset {
  if (typeof window === 'undefined') {
    return 'neutral';
  }
  try {
    const raw =
      window.localStorage.getItem(paletteKey) || window.localStorage.getItem(legacyPaletteKey);
    return parsePalette(raw);
  } catch {
    return 'neutral';
  }
}

/**
 * Safely persists the palette choice to localStorage and applies it to the DOM.
 * Handles quota and security errors gracefully.
 */
export function setStoredPalette(palette: PalettePreset): void {
  const safe = parsePalette(palette);
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.palette = safe;
  }
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(paletteKey, safe);
    } catch {
      // Storage unavailable or quota exceeded; in-memory DOM attribute remains applied.
    }
  }
}

/**
 * Head bootstrap script: runs before first paint to apply the saved palette attribute
 * onto <html> without causing hydration warnings or theme flashes.
 */
export const paletteBootstrap = `try{var p=localStorage.getItem('${paletteKey}')||localStorage.getItem('${legacyPaletteKey}');document.documentElement.dataset.palette=(p==='ocean'||p==='forest')?p:'neutral'}catch{document.documentElement.dataset.palette='neutral'}`;
