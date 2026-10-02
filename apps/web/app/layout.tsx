import type { Metadata } from 'next';
import type { ReactElement, ReactNode } from 'react';
import { ThemeProvider } from '@/components/theme-provider';
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
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
