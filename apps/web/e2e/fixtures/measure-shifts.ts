import type { Page } from '@playwright/test';

export interface ShiftRecord {
  value: number;
  hadRecentInput: boolean;
  sources?:
    | Array<{
        nodeName?: string | undefined;
        className?: string | undefined;
        currentRect?: { top: number; left: number; width: number; height: number } | undefined;
        previousRect?: { top: number; left: number; width: number; height: number } | undefined;
      }>
    | undefined;
}

export interface ShiftMetrics {
  cls: number;
  totalShift: number;
  shifts: ShiftRecord[];
}

export async function attachShiftTracker(page: Page): Promise<() => Promise<ShiftMetrics>> {
  await page.addInitScript(() => {
    (
      window as unknown as {
        __havefolio_shifts: ShiftRecord[];
        __havefolio_cls: number;
        __havefolio_total_shift: number;
      }
    ).__havefolio_shifts = [];
    (
      window as unknown as {
        __havefolio_shifts: ShiftRecord[];
        __havefolio_cls: number;
        __havefolio_total_shift: number;
      }
    ).__havefolio_cls = 0;
    (
      window as unknown as {
        __havefolio_shifts: ShiftRecord[];
        __havefolio_cls: number;
        __havefolio_total_shift: number;
      }
    ).__havefolio_total_shift = 0;

    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as Array<{
          value: number;
          hadRecentInput: boolean;
          sources?: Array<{
            node?: HTMLElement;
            currentRect?: DOMRectReadOnly;
            previousRect?: DOMRectReadOnly;
          }>;
        }>) {
          const rec: ShiftRecord = {
            value: entry.value,
            hadRecentInput: entry.hadRecentInput,
            sources: entry.sources?.map((s) => ({
              nodeName: s.node?.nodeName,
              className: s.node?.className,
              currentRect: s.currentRect
                ? {
                    top: s.currentRect.top,
                    left: s.currentRect.left,
                    width: s.currentRect.width,
                    height: s.currentRect.height,
                  }
                : undefined,
              previousRect: s.previousRect
                ? {
                    top: s.previousRect.top,
                    left: s.previousRect.left,
                    width: s.previousRect.width,
                    height: s.previousRect.height,
                  }
                : undefined,
            })),
          };
          const w = window as unknown as {
            __havefolio_shifts: ShiftRecord[];
            __havefolio_cls: number;
            __havefolio_total_shift: number;
          };
          w.__havefolio_shifts.push(rec);
          w.__havefolio_total_shift += entry.value;
          if (!entry.hadRecentInput) {
            w.__havefolio_cls += entry.value;
          }
        }
      });
      observer.observe({ type: 'layout-shift', buffered: true });
    } catch {
      // PerformanceObserver fallback
    }
  });

  return async (): Promise<ShiftMetrics> => {
    return page.evaluate(() => {
      const w = window as unknown as {
        __havefolio_shifts?: ShiftRecord[];
        __havefolio_cls?: number;
        __havefolio_total_shift?: number;
      };
      return {
        cls: w.__havefolio_cls ?? 0,
        totalShift: w.__havefolio_total_shift ?? 0,
        shifts: w.__havefolio_shifts ?? [],
      };
    });
  };
}
