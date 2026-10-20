import { describe, expect, it } from 'vitest';

/**
 * Recalculates relative luminance and WCAG contrast from OKLCH values.
 * Standard CSS Color 4 OKLCH -> linear sRGB -> relative luminance -> contrast ratio.
 */
function oklchToRgb(l: number, c: number, h: number): { rLin: number; gLin: number; bLin: number } {
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const l3 = l_ * l_ * l_;
  const m3 = m_ * m_ * m_;
  const s3 = s_ * s_ * s_;

  const rLin = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const gLin = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const bLin = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;

  return {
    rLin: Math.max(0, Math.min(1, rLin)),
    gLin: Math.max(0, Math.min(1, gLin)),
    bLin: Math.max(0, Math.min(1, bLin)),
  };
}

function relLuminance(rgb: { rLin: number; gLin: number; bLin: number }): number {
  return 0.2126 * rgb.rLin + 0.7152 * rgb.gLin + 0.0722 * rgb.bLin;
}

function contrast(c1: [number, number, number], c2: [number, number, number]): number {
  const l1 = relLuminance(okklchToRgb(c1[0], c1[1], c1[2]));
  const l2 = relLuminance(okklchToRgb(c2[0], c2[1], c2[2]));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const okklchToRgb = oklchToRgb;

interface ThemePaletteDefinition {
  bg: [number, number, number];
  fg: [number, number, number];
  mutedFg: [number, number, number];
  primary: [number, number, number];
  primaryFg: [number, number, number];
  secondary: [number, number, number];
  secondaryFg: [number, number, number];
  ring: [number, number, number];
}

const palettes: Record<string, ThemePaletteDefinition> = {
  'Neutral Light': {
    bg: [1, 0, 0],
    fg: [0.145, 0, 0],
    mutedFg: [0.556, 0, 0],
    primary: [0.205, 0, 0],
    primaryFg: [0.985, 0, 0],
    secondary: [0.97, 0, 0],
    secondaryFg: [0.205, 0, 0],
    ring: [0.556, 0, 0],
  },
  'Neutral Dark': {
    bg: [0.145, 0, 0],
    fg: [0.985, 0, 0],
    mutedFg: [0.708, 0, 0],
    primary: [0.922, 0, 0],
    primaryFg: [0.205, 0, 0],
    secondary: [0.269, 0, 0],
    secondaryFg: [0.985, 0, 0],
    ring: [0.556, 0, 0],
  },
  'Ocean Light': {
    bg: [0.985, 0.008, 230],
    fg: [0.16, 0.03, 235],
    mutedFg: [0.48, 0.04, 235],
    primary: [0.28, 0.07, 235],
    primaryFg: [0.985, 0.005, 230],
    secondary: [0.94, 0.02, 230],
    secondaryFg: [0.16, 0.03, 235],
    ring: [0.48, 0.06, 235],
  },
  'Ocean Dark': {
    bg: [0.14, 0.03, 235],
    fg: [0.97, 0.01, 230],
    mutedFg: [0.72, 0.03, 230],
    primary: [0.8, 0.08, 225],
    primaryFg: [0.15, 0.04, 235],
    secondary: [0.24, 0.04, 235],
    secondaryFg: [0.97, 0.01, 230],
    ring: [0.65, 0.07, 225],
  },
  'Forest Light': {
    bg: [0.985, 0.01, 145],
    fg: [0.16, 0.03, 145],
    mutedFg: [0.47, 0.04, 145],
    primary: [0.27, 0.06, 145],
    primaryFg: [0.985, 0.005, 145],
    secondary: [0.94, 0.02, 145],
    secondaryFg: [0.16, 0.03, 145],
    ring: [0.45, 0.07, 145],
  },
  'Forest Dark': {
    bg: [0.14, 0.025, 145],
    fg: [0.97, 0.01, 145],
    mutedFg: [0.72, 0.03, 145],
    primary: [0.78, 0.09, 145],
    primaryFg: [0.15, 0.04, 145],
    secondary: [0.24, 0.035, 145],
    secondaryFg: [0.97, 0.01, 145],
    ring: [0.65, 0.08, 145],
  },
};

describe('PER-76: Recalculated OKLCH Theme Contrast Proofs', () => {
  for (const [name, p] of Object.entries(palettes)) {
    describe(`${name} accessibility proofs`, () => {
      it('meets WCAG AAA (>= 7.0:1) for body text on background', () => {
        const ratio = contrast(p.fg, p.bg);
        expect(ratio).toBeGreaterThanOrEqual(7.0);
      });

      it('meets WCAG AA (>= 4.5:1) for muted text on background', () => {
        const ratio = contrast(p.mutedFg, p.bg);
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      });

      it('meets WCAG AA (>= 4.5:1) for primary button foreground on primary background', () => {
        const ratio = contrast(p.primaryFg, p.primary);
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      });

      it('meets WCAG AA (>= 4.5:1) for secondary foreground on secondary surface', () => {
        const ratio = contrast(p.secondaryFg, p.secondary);
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      });

      it('meets WCAG 2.1 UI requirement (>= 3.0:1) for focus ring against background', () => {
        const ratio = contrast(p.ring, p.bg);
        expect(ratio).toBeGreaterThanOrEqual(3.0);
      });
    });
  }
});
