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
 * Match the navigation (17rem, or 4rem collapsed), 2rem gutters, 1rem gaps and 112rem maximum
 * store canvas. From 1280px the 15rem filter column and its 2rem gap (17rem more) sit beside the
 * grid. Below 1920px a collapsed rail can reach the canvas cap with fewer columns, so the fixed
 * widths wait for 1920px and the slight over-estimate in between only fetches a larger image.
 */
function imageSizes(nav: number): Record<StoreDensity, string> {
  const cap = Math.max(nav + 1792, 1920);
  const mobile = `(min-width: 768px) calc((100vw - ${nav + 80}px) / 2), (min-width: 640px) calc((100vw - 80px) / 2), (min-width: 520px) calc((100vw - 48px) / 2), calc(100vw - 32px)`;
  return {
    compact: `(min-width: ${cap}px) 230px, (min-width: 1920px) calc((100vw - ${nav + 416}px) / 6), (min-width: 1280px) calc((100vw - ${nav + 368}px) / 3), (min-width: 1024px) calc((100vw - ${nav + 96}px) / 3), ${mobile}`,
    comfortable: `(min-width: ${cap}px) 352px, (min-width: 1920px) calc((100vw - ${nav + 384}px) / 4), (min-width: 1280px) calc((100vw - ${nav + 352}px) / 2), (min-width: 1024px) calc((100vw - ${nav + 80}px) / 2), ${mobile}`,
    large: `(min-width: ${cap}px) 475px, (min-width: 1920px) calc((100vw - ${nav + 368}px) / 3), (min-width: 1280px) calc(100vw - ${nav + 336}px), (min-width: 1024px) calc(100vw - ${nav + 64}px), ${mobile}`,
  };
}
export const densityImageSizes = imageSizes(272);
export const collapsedDensityImageSizes = imageSizes(64);
