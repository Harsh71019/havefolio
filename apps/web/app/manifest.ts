import type { MetadataRoute } from 'next';

/**
 * PER-47 installability: a static manifest only. There is deliberately no service worker, so
 * nothing (private API responses, media, exports or financial data) is cached for offline use.
 * Browsers offer installation only over HTTPS or localhost; the trusted-LAN HTTP deployment
 * remains an ordinary website with unchanged sign-in.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Havefolio',
    short_name: 'Havefolio',
    description: 'Shop your own home before buying something new.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#171717',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
