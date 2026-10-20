import type { Metadata } from 'next';
import type { ReactElement, ReactNode } from 'react';
import { Toaster } from '@havefolio/ui/components/sonner';
import { ThemeProvider } from '@/components/theme-provider';
import { densityBootstrap } from '@/components/store-density-config';
import { sidebarBootstrap } from '@/components/sidebar-config';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Havefolio',
    template: '%s | Havefolio',
  },
  description: 'Shop your own home before buying something new.',
  // PER-47: Add to Home Screen metadata; the manifest is linked automatically from app/manifest.ts.
  appleWebApp: { capable: true, title: 'Havefolio', statusBarStyle: 'default' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>): ReactElement {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: densityBootstrap }} />
        <script dangerouslySetInnerHTML={{ __html: sidebarBootstrap }} />
      </head>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          disableTransitionOnChange
          enableSystem
        >
          {children}
          <Toaster position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
