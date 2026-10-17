import type { Metadata } from 'next';
import type { ReactElement, ReactNode } from 'react';
import { Toaster } from '@havefolio/ui/components/sonner';
import { ThemeProvider } from '@/components/theme-provider';
import { densityBootstrap } from '@/components/store-density-config';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Havefolio',
    template: '%s | Havefolio',
  },
  description: 'Shop your own home before buying something new.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>): ReactElement {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: densityBootstrap }} />
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
