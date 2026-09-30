import type { Metadata } from 'next';
import type { ReactElement, ReactNode } from 'react';
import { AppNavigation } from '@/components/app-navigation';
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
    <html lang="en">
      <body>
        <div className="min-h-svh md:grid md:grid-cols-[17rem_minmax(0,1fr)]">
          <AppNavigation />
          <div className="min-w-0 pb-24 md:pb-0">{children}</div>
        </div>
      </body>
    </html>
  );
}
