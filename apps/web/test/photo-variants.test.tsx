import { describe, expect, it } from 'vitest';
import { gridSizes, photoSource } from '../components/photos-client';
import { collapsedDensityImageSizes, densityImageSizes } from '../components/store-density-config';

type Screen = { width: number; dpr: number };

// Evaluates the numeric `sizes` lengths used here: px, rem, vw, + - * / and parentheses.
function length(text: string, screen: Screen): number {
  const tokens =
    text
      .replace(/calc/g, '')
      .match(/\d+(?:\.\d+)?(?:px|rem|vw)?|[()+\-*/]/g)
      ?.map((t) =>
        t.endsWith('px')
          ? Number.parseFloat(t)
          : t.endsWith('rem')
            ? Number.parseFloat(t) * 16
            : t.endsWith('vw')
              ? (Number.parseFloat(t) * screen.width) / 100
              : /\d/.test(t)
                ? Number(t)
                : t,
      ) ?? [];
  let at = 0;
  const factor = (): number => {
    const token = tokens[at++];
    if (token !== '(') return token as number;
    const value = sum();
    at++;
    return value;
  };
  const product = (): number => {
    let value = factor();
    while (tokens[at] === '*' || tokens[at] === '/')
      value = tokens[at++] === '*' ? value * factor() : value / factor();
    return value;
  };
  const sum = (): number => {
    let value = product();
    while (tokens[at] === '+' || tokens[at] === '-')
      value = tokens[at++] === '+' ? value + product() : value - product();
    return value;
  };
  return sum();
}

function matches(condition: string, screen: Screen): boolean {
  return [...condition.matchAll(/\((min-width|min-resolution): ([\d.]+)(px|dppx)\)/g)].every(
    ([, feature, value]) =>
      feature === 'min-width' ? screen.width >= Number(value) : screen.dpr >= Number(value),
  );
}

// Browsers pick the smallest width candidate that covers the slot at the device pixel ratio.
function selected(sizes: string, screen: Screen): 'thumbnail' | 'display' {
  const source = photoSource('item', { id: 'photo', width: 1600, height: 1200 }, '', sizes);
  const entry = source
    .sizes!.split(', ')
    .map((part) => {
      const at = part.lastIndexOf(' calc(');
      const value = at >= 0 ? part.slice(at + 1) : part.slice(part.lastIndexOf(' ') + 1);
      return { condition: part.slice(0, part.length - value.length).trim(), value };
    })
    .find(({ condition }) => !condition || matches(condition, screen))!;
  const needed = length(entry.value, screen) * screen.dpr;
  const candidates = source
    .srcSet!.split(', ')
    .map((c) => ({ url: c.split(' ')[0]!, width: Number.parseInt(c.split(' ')[1]!, 10) }));
  const chosen = candidates.find((c) => c.width >= needed) ?? candidates.at(-1)!;
  return chosen.url.endsWith('/thumbnail') ? 'thumbnail' : 'display';
}

describe('PER-97 grid cover variants', () => {
  it('reports each slot under the 2× density cap and 1.25× thumbnail tolerance', () => {
    expect(
      gridSizes([
        ['(min-width: 1024px)', '264px'],
        [null, '45vw'],
      ]),
    ).toBe(
      '(min-width: 1024px) and (min-resolution: 2.5dppx) calc(264px * 0.5333), ' +
        '(min-width: 1024px) calc(264px * 0.8), ' +
        '(min-resolution: 2.5dppx) calc(45vw * 0.5333), calc(45vw * 0.8)',
    );
  });

  it('keeps ordinary Store cards on thumbnails and large slots on display', () => {
    const phone = { width: 390, dpr: 3 };
    const pixel = { width: 412, dpr: 2.625 };
    const desktop = { width: 1280, dpr: 1 };
    for (const sizes of [densityImageSizes, collapsedDensityImageSizes]) {
      // Two-column phone cards (171-182 CSS px) no longer download 1600px files.
      expect(selected(sizes.comfortable, phone)).toBe('thumbnail');
      expect(selected(sizes.comfortable, pixel)).toBe('thumbnail');
      expect(selected(sizes.compact, desktop)).toBe('thumbnail');
      expect(selected(sizes.comfortable, desktop)).toBe('thumbnail');
      // Large density is for seeing photos; its slots still get the display variant.
      expect(selected(sizes.large, desktop)).toBe('display');
      // Documented gap: 2× desktops exceed the tolerance and still need a middle-size variant.
      expect(selected(sizes.compact, { width: 1512, dpr: 2 })).toBe('display');
    }
  });

  it('leaves non-grid large views on their honest sizes', () => {
    const cover = photoSource('item', { id: 'photo', width: 1600, height: 1200 }, '', '24rem', {
      large: true,
    });
    expect(cover.sizes).toBe('24rem');
    expect(cover.src).toMatch(/content\/display$/);
    expect(cover.placeholderSrc).toMatch(/content\/thumbnail$/);
    expect(selected('(min-width: 1024px) 24rem, 92vw', { width: 1280, dpr: 1 })).toBe('display');
  });
});
