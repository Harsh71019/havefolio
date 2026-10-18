export const densityKey = 'havefolio:store-density:v1';
export const storeDensities = ['compact', 'comfortable', 'large'] as const;
export type StoreDensity = (typeof storeDensities)[number];
export function parseDensity(value: string | null | undefined): StoreDensity {
  return value === 'compact' || value === 'large' ? value : 'comfortable';
}

// Run in the document head before the store skeleton can paint. No inventory data is read.
// React hydrates against Comfortable; CSS already has the saved geometry, then the control syncs.
export const densityBootstrap = `try{var d=localStorage.getItem('${densityKey}');document.documentElement.dataset.storeDensity=d==='compact'||d==='large'?d:'comfortable'}catch{document.documentElement.dataset.storeDensity='comfortable'}`;

const mobileSizes =
  '(min-width: 768px) calc((100vw - 352px) / 2), (min-width: 640px) calc((100vw - 80px) / 2), (min-width: 520px) calc((100vw - 48px) / 2), calc(100vw - 32px)';
/**
 * Match the 17rem navigation, 2rem gutters, 1rem gaps and 112rem maximum store canvas. From
 * 1280px the 15rem filter column and its 2rem gap (17rem more) sit beside the grid.
 */
export const densityImageSizes: Record<StoreDensity, string> = {
  compact: `(min-width: 2064px) 230px, (min-width: 1920px) calc((100vw - 688px) / 6), (min-width: 1280px) calc((100vw - 640px) / 3), (min-width: 1024px) calc((100vw - 368px) / 3), ${mobileSizes}`,
  comfortable: `(min-width: 2064px) 352px, (min-width: 1920px) calc((100vw - 656px) / 4), (min-width: 1280px) calc((100vw - 624px) / 2), (min-width: 1024px) calc((100vw - 352px) / 2), ${mobileSizes}`,
  large: `(min-width: 2064px) 475px, (min-width: 1920px) calc((100vw - 640px) / 3), (min-width: 1280px) calc(100vw - 608px), (min-width: 1024px) calc(100vw - 336px), ${mobileSizes}`,
};
