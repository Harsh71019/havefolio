'use client';

import { useSyncExternalStore, type ReactElement } from 'react';
import { Laptop, Moon, Sun, Palette, Check } from 'lucide-react';
import { cn } from '@havefolio/ui/lib/utils';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@havefolio/ui/components/card';
import { Label } from '@havefolio/ui/components/label';
import { RadioGroup, RadioGroupItem } from '@havefolio/ui/components/radio-group';
import { Badge } from '@havefolio/ui/components/badge';
import { palettes, paletteMetadata, type PalettePreset } from './theme-palette-config';
import { useAppearance } from './theme-provider';

const themeModes = [
  {
    id: 'system',
    label: 'System',
    description: 'Follows your operating system preference automatically.',
    icon: Laptop,
  },
  {
    id: 'light',
    label: 'Light',
    description: 'Crisp light surfaces with high-contrast dark text.',
    icon: Sun,
  },
  {
    id: 'dark',
    label: 'Dark',
    description: 'Low-light dark surfaces with comfortable bright text.',
    icon: Moon,
  },
] as const;

const emptySubscribe = (): (() => void) => () => {};

function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

export function AppearanceSettings(): ReactElement {
  const { theme, setTheme, resolvedTheme, palette, setPalette } = useAppearance();
  const mounted = useMounted();

  // Use graceful fallback values during SSR to avoid hydration mismatches
  const currentTheme = mounted ? (theme ?? 'system') : 'system';
  const currentPalette = mounted ? palette : 'neutral';
  const currentResolved = mounted ? resolvedTheme : 'light';

  return (
    <Card aria-labelledby="appearance-settings-title" data-testid="appearance-settings">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Palette className="size-5 text-muted-foreground" aria-hidden="true" />
          <CardTitle>
            <h2 id="appearance-settings-title">Appearance & Themes</h2>
          </CardTitle>
        </div>
        <CardDescription>
          Personalise your display with accessible theme palettes and independent light or dark
          modes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* 1. Independent Mode Selection (System, Light, Dark) */}
        <div className="space-y-3">
          <div className="space-y-0.5">
            <Label className="text-sm font-semibold">Display mode</Label>
            <p className="text-xs text-muted-foreground">
              Choose whether Havefolio matches your system theme or stays in light or dark mode.
            </p>
          </div>

          <RadioGroup
            value={currentTheme}
            onValueChange={(val) => setTheme(val)}
            className="grid grid-cols-1 gap-3 sm:grid-cols-3"
            aria-label="Display mode"
          >
            {themeModes.map((mode) => {
              const Icon = mode.icon;
              const isSelected = currentTheme === mode.id;

              return (
                <label
                  key={mode.id}
                  htmlFor={`theme-mode-${mode.id}`}
                  className={cn(
                    'relative flex cursor-pointer flex-col justify-between rounded-lg border p-4 transition-colors',
                    'hover:bg-muted/40 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
                    isSelected ? 'border-primary bg-accent/40 font-medium' : 'border-border',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <RadioGroupItem
                        id={`theme-mode-${mode.id}`}
                        value={mode.id}
                        aria-label={`${mode.label} mode`}
                      />
                      <div className="flex items-center gap-1.5">
                        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                        <span className="text-sm font-medium">{mode.label}</span>
                      </div>
                    </div>
                    {isSelected && (
                      <Badge variant="secondary" className="text-[11px] font-normal">
                        {mode.id === 'system'
                          ? `Auto (${currentResolved === 'dark' ? 'Dark' : 'Light'})`
                          : 'Active'}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                    {mode.description}
                  </p>
                </label>
              );
            })}
          </RadioGroup>
        </div>

        {/* 2. Semantic Palette Preset Selection (Neutral, Ocean, Forest) */}
        <div className="space-y-3 border-t pt-6">
          <div className="space-y-0.5">
            <Label className="text-sm font-semibold">Palette preset</Label>
            <p className="text-xs text-muted-foreground">
              Select an accessible color palette. Palettes work independently in both Light and Dark
              modes.
            </p>
          </div>

          <RadioGroup
            value={currentPalette}
            onValueChange={(val) => setPalette(val as PalettePreset)}
            className="grid grid-cols-1 gap-4 sm:grid-cols-3"
            aria-label="Color palette preset"
          >
            {palettes.map((preset) => {
              const meta = paletteMetadata[preset];
              const isSelected = currentPalette === preset;

              return (
                <label
                  key={preset}
                  htmlFor={`palette-${preset}`}
                  className={cn(
                    'relative flex cursor-pointer flex-col justify-between rounded-lg border p-4 transition-colors',
                    'hover:bg-muted/40 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
                    isSelected ? 'border-primary bg-accent/40 font-medium' : 'border-border',
                  )}
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <RadioGroupItem
                          id={`palette-${preset}`}
                          value={preset}
                          aria-label={`${meta.name} palette`}
                        />
                        <span className="text-sm font-medium">{meta.name}</span>
                      </div>
                      {isSelected && (
                        <span
                          className="flex items-center gap-1 text-xs font-medium text-primary"
                          aria-label="Selected"
                        >
                          <Check className="size-3.5" aria-hidden="true" />
                          <span>Active</span>
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {meta.description}
                    </p>

                    {/* Named Palette Preview Mockup */}
                    <div
                      data-palette={preset}
                      className="rounded-md border border-border bg-background p-3 text-foreground shadow-xs"
                      aria-hidden="true"
                    >
                      <div className="flex items-center justify-between pb-1.5">
                        <span className="text-xs font-semibold tracking-tight">{meta.name}</span>
                        <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium bg-primary text-primary-foreground">
                          {meta.accentLabel}
                        </span>
                      </div>
                      <div className="space-y-1.5 pt-1">
                        <div className="h-1.5 w-3/4 rounded bg-muted-foreground/30" />
                        <div className="flex gap-1.5 pt-1">
                          <div className="flex-1 rounded bg-secondary px-2 py-1 text-center text-[10px] font-medium text-secondary-foreground">
                            Surface
                          </div>
                          <div className="flex-1 rounded bg-muted px-2 py-1 text-center text-[10px] font-medium text-foreground">
                            Muted
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </label>
              );
            })}
          </RadioGroup>
        </div>

        {/* 3. Non-sensitive persistence explanation */}
        <div className="rounded-lg border border-border/80 bg-muted/20 p-3.5 text-xs text-muted-foreground leading-relaxed">
          <p>
            Appearance choices are stored locally on this device only. They do not alter inventory
            items, filters, financial calculations, or account records, and are never sent to
            external servers.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
