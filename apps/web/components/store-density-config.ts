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
 * From 1024px the grid auto-fills 11rem, 13rem or 18rem minimum columns with 1rem gaps. Even the
 * narrowest desktop canvas (1280px beside the navigation and filter column) fits three compact or
 * comfortable columns and two large ones, so a card stays under 4/3 (3/2 for large) of its
 * minimum. Below that, two columns share the space left by the navigation (17rem, or 4rem
 * collapsed) and the 2rem gutters.
 */
function imageSizes(nav: number): Record<StoreDensity, string> {
  const mobile = `(min-width: 768px) calc((100vw - ${nav + 80}px) / 2), (min-width: 640px) calc((100vw - 80px) / 2), (min-width: 520px) calc((100vw - 48px) / 2), calc(100vw - 32px)`;
  return {
    compact: `(min-width: 1024px) 240px, ${mobile}`,
    comfortable: `(min-width: 1024px) 283px, ${mobile}`,
    large: `(min-width: 1024px) 440px, ${mobile}`,
  };
}
export const densityImageSizes = imageSizes(272);
export const collapsedDensityImageSizes = imageSizes(64);
