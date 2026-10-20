import type { Locator } from '@playwright/test';

/**
 * Deterministic DOM fixture for a pending React HTML segment. React streams completed
 * subtrees in hidden containers before its completion script places them in the page.
 * Clone only the synthetic loading region, so this exercises the real skeleton markup
 * without depending on network/chunk timing or changing the application renderer.
 */
export async function addHiddenStoreSegment(region: Locator): Promise<Locator> {
  await region.evaluate((element) => {
    const segment = document.createElement('div');
    segment.hidden = true;
    segment.dataset.testid = 'pending-store-segment';
    const copy = element.cloneNode(true) as HTMLElement;
    // A wrong target must not accidentally satisfy the desktop geometry expectation.
    copy.querySelectorAll<HTMLElement>('.store-grid').forEach((grid) => {
      grid.style.gridTemplateColumns = '1fr';
    });
    segment.append(copy);
    document.body.prepend(segment);
  });
  return region.page().getByTestId('pending-store-segment');
}
