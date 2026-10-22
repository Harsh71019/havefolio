import { gridSizes } from './photos-client';

export const densityKey = 'havefolio:store-density:v1';
export const storeDensities = ['compact', 'comfortable', 'large'] as const;
export type StoreDensity = (typeof storeDensities)[number];
export function parseDensity(value: string | null | undefined): StoreDensity {
  return value === 'compact' || value === 'large' ? value : 'comfortable';
}

// Run in the document head before the store skeleton can paint. No inventory data is read.
// React hydrates against Comfortable; CSS already has the saved geometry, then the control syncs.
export const densityBootstrap = `try{var d=localStorage.getItem('${densityKey}');document.documentElement.dataset.storeDensity=d==='compact'||d==='large'?d:'comfortable'}catch{document.documentElement.dataset.storeDensity='comfortable'}`;

/**
 * From 1024px the grid auto-fills 12rem, 15rem or 20rem minimum columns with 1.5rem gaps. Each
 * slot is the widest a column gets before one more fits — three compact, two comfortable or two
 * large columns at the narrowest desktop canvas — so it always covers the real slot. Below that,
 * two columns share the space left by the navigation (17rem, or 4rem collapsed), the page
 * gutters and the gap between them. `sizes` applies the PER-97 grid policy to these slots.
 */
type Slots = [condition: string | null, slot: string][];
function slots(nav: number): Record<StoreDensity, Slots> {
  const mobile: Slots = [
    ['(min-width: 768px)', `calc((100vw - ${nav + 88}px) / 2)`],
    ['(min-width: 640px)', 'calc((100vw - 88px) / 2)'],
    [null, 'calc((100vw - 48px) / 2)'],
  ];
  return {
    compact: [['(min-width: 1024px)', '264px'], ...mobile],
    comfortable: [['(min-width: 1024px)', '372px'], ...mobile],
    large: [['(min-width: 1024px)', '492px'], ...mobile],
  };
}
function imageSizes(nav: number): Record<StoreDensity, string> {
  const { compact, comfortable, large } = slots(nav);
  return {
    compact: gridSizes(compact),
    comfortable: gridSizes(comfortable),
    large: gridSizes(large),
  };
}
export const densityImageSizes = imageSizes(272);
export const collapsedDensityImageSizes = imageSizes(64);
