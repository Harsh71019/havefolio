'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import type { ReactElement } from 'react';
import { Button } from '@havefolio/ui/components/button';

export function ThemeToggle(): ReactElement {
  const { resolvedTheme, setTheme } = useTheme();

  const toggleTheme = (): void => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  };

  return (
    <Button
      aria-label="Toggle color theme"
      onClick={toggleTheme}
      size="icon-lg"
      title="Toggle color theme"
      type="button"
      variant="outline"
    >
      <Sun aria-hidden="true" className="size-4 dark:hidden" />
      <Moon aria-hidden="true" className="hidden size-4 dark:block" />
      <span className="sr-only">Toggle color theme</span>
    </Button>
  );
}
