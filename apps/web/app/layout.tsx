import type { Metadata } from 'next';
import type { ReactElement, ReactNode } from 'react';
import { AppNavigation } from '@/components/app-navigation';
import { ThemeProvider } from '@/components/theme-provider';
import { ThemeToggle } from '@/components/theme-toggle';
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
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          disableTransitionOnChange
          enableSystem
        >
          <div className="min-h-svh md:grid md:grid-cols-[17rem_minmax(0,1fr)]">
            <AppNavigation />
            <div className="min-w-0">
              <div className="flex h-14 items-center justify-end border-b px-4 sm:px-6">
                <ThemeToggle />
              </div>
              <div className="pb-24 md:pb-0">{children}</div>
            </div>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
