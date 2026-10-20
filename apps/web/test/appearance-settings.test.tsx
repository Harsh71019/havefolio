import { render, screen, waitFor, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { AppearanceSettings } from '../components/appearance-settings';
import { ThemeProvider } from '../components/theme-provider';
import {
  getStoredPalette,
  setStoredPalette,
  parsePalette,
  isPalettePreset,
  paletteKey,
  legacyPaletteKey,
} from '../components/theme-palette-config';

describe('PER-76: Theme Palette Config & Safe Storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-palette');
  });

  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-palette');
    vi.restoreAllMocks();
  });

  it('validates palette preset identifiers strictly', () => {
    expect(isPalettePreset('neutral')).toBe(true);
    expect(isPalettePreset('ocean')).toBe(true);
    expect(isPalettePreset('forest')).toBe(true);
    expect(isPalettePreset('random')).toBe(false);
    expect(isPalettePreset('')).toBe(false);
    expect(isPalettePreset(null)).toBe(false);
    expect(isPalettePreset(undefined)).toBe(false);
  });

  it('safely parses valid presets and safely falls back to neutral on invalid or missing values', () => {
    expect(parsePalette('neutral')).toBe('neutral');
    expect(parsePalette('ocean')).toBe('ocean');
    expect(parsePalette('forest')).toBe('forest');
    expect(parsePalette('unknown_theme')).toBe('neutral');
    expect(parsePalette('')).toBe('neutral');
    expect(parsePalette(null)).toBe('neutral');
    expect(parsePalette(undefined)).toBe('neutral');
    expect(parsePalette(123)).toBe('neutral');
    expect(parsePalette({})).toBe('neutral');
  });

  it('reads stored palette from primary key or legacy key, defaulting to neutral', () => {
    expect(getStoredPalette()).toBe('neutral');

    window.localStorage.setItem(legacyPaletteKey, 'ocean');
    expect(getStoredPalette()).toBe('ocean');

    window.localStorage.setItem(paletteKey, 'forest');
    expect(getStoredPalette()).toBe('forest');

    window.localStorage.setItem(paletteKey, 'corrupt-string');
    expect(getStoredPalette()).toBe('neutral');
  });

  it('gracefully handles localStorage exceptions (unavailable storage or private mode)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError: The operation is insecure.', 'SecurityError');
    });

    expect(getStoredPalette()).toBe('neutral');
  });

  it('persists palette choice to DOM and storage, handling setItem errors gracefully', () => {
    setStoredPalette('ocean');
    expect(document.documentElement.dataset.palette).toBe('ocean');
    expect(window.localStorage.getItem(paletteKey)).toBe('ocean');

    // Simulate quota exceeded
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError');
    });

    // Should not throw, but in-memory DOM attribute remains updated
    expect(() => setStoredPalette('forest')).not.toThrow();
    expect(document.documentElement.dataset.palette).toBe('forest');
  });

  it('never modifies or clears unrelated settings (sidebar, density, capture drafts)', () => {
    window.localStorage.setItem('havefolio:sidebar:v1', 'collapsed');
    window.localStorage.setItem('havefolio:store-density:v1', 'large');
    window.localStorage.setItem(
      'havefolio:capture-draft:v1:item-1',
      JSON.stringify({ name: 'Watch' }),
    );

    setStoredPalette('ocean');

    expect(window.localStorage.getItem('havefolio:sidebar:v1')).toBe('collapsed');
    expect(window.localStorage.getItem('havefolio:store-density:v1')).toBe('large');
    expect(window.localStorage.getItem('havefolio:capture-draft:v1:item-1')).toBeTruthy();
  });
});

describe('PER-76: AppearanceSettings Component', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-palette');
  });

  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-palette');
    vi.restoreAllMocks();
  });

  function renderAppearance(): RenderResult {
    return render(
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <AppearanceSettings />
      </ThemeProvider>,
    );
  }

  it('renders display modes (System, Light, Dark) and palette presets (Neutral, Ocean, Forest)', () => {
    renderAppearance();

    expect(
      screen.getByRole('heading', { level: 2, name: /appearance & themes/i }),
    ).toBeInTheDocument();

    // Mode options
    expect(screen.getByRole('radio', { name: /system mode/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /light mode/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /dark mode/i })).toBeInTheDocument();

    // Palette options
    expect(screen.getByRole('radio', { name: /neutral palette/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /ocean palette/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /forest palette/i })).toBeInTheDocument();

    // Reassurance notice
    expect(
      screen.getByText(/appearance choices are stored locally on this device only/i),
    ).toBeInTheDocument();
  });

  it('allows selecting a palette preset and updates document attribute and localStorage', async () => {
    const user = userEvent.setup();
    renderAppearance();

    const oceanRadio = screen.getByRole('radio', { name: /ocean palette/i });
    await user.click(oceanRadio);

    await waitFor(() => {
      expect(document.documentElement.dataset.palette).toBe('ocean');
      expect(window.localStorage.getItem(paletteKey)).toBe('ocean');
    });

    const forestRadio = screen.getByRole('radio', { name: /forest palette/i });
    await user.click(forestRadio);

    await waitFor(() => {
      expect(document.documentElement.dataset.palette).toBe('forest');
      expect(window.localStorage.getItem(paletteKey)).toBe('forest');
    });
  });

  it('allows independent switching of display mode without altering palette preset', async () => {
    const user = userEvent.setup();
    renderAppearance();

    // Select Ocean palette
    await user.click(screen.getByRole('radio', { name: /ocean palette/i }));
    expect(document.documentElement.dataset.palette).toBe('ocean');

    // Switch to Dark mode
    await user.click(screen.getByRole('radio', { name: /dark mode/i }));
    expect(document.documentElement.dataset.palette).toBe('ocean');

    // Switch back to System mode
    await user.click(screen.getByRole('radio', { name: /system mode/i }));
    expect(document.documentElement.dataset.palette).toBe('ocean');
  });

  it('is fully keyboard operable with visible focus', async () => {
    const user = userEvent.setup();
    renderAppearance();

    const oceanRadio = screen.getByRole('radio', { name: /ocean palette/i });
    oceanRadio.focus();
    expect(oceanRadio).toHaveFocus();

    await user.keyboard(' ');
    await waitFor(() => {
      expect(document.documentElement.dataset.palette).toBe('ocean');
      expect(oceanRadio).toHaveAttribute('aria-checked', 'true');
    });

    const darkRadio = screen.getByRole('radio', { name: /dark mode/i });
    darkRadio.focus();
    expect(darkRadio).toHaveFocus();

    await user.keyboard(' ');
    await waitFor(() => {
      expect(darkRadio).toHaveAttribute('aria-checked', 'true');
    });
  });

  it('allows reselecting System mode after explicit light/dark choice', async () => {
    const user = userEvent.setup();
    renderAppearance();

    const darkRadio = screen.getByRole('radio', { name: /dark mode/i });
    await user.click(darkRadio);
    expect(darkRadio).toHaveAttribute('aria-checked', 'true');

    const systemRadio = screen.getByRole('radio', { name: /system mode/i });
    await user.click(systemRadio);

    await waitFor(() => {
      expect(systemRadio).toHaveAttribute('aria-checked', 'true');
      expect(darkRadio).toHaveAttribute('aria-checked', 'false');
    });
  });

  it('survives reloads by reading persisted palette from storage on initialization', () => {
    window.localStorage.setItem(paletteKey, 'forest');

    const { unmount } = renderAppearance();
    expect(document.documentElement.dataset.palette).toBe('forest');

    unmount();

    // Re-mount (simulating page reload)
    renderAppearance();
    expect(document.documentElement.dataset.palette).toBe('forest');
    expect(screen.getByRole('radio', { name: /forest palette/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('safely recovers to Neutral when invalid or corrupt palette data exists in storage', () => {
    window.localStorage.setItem(paletteKey, 'invalid_theme_preset_123');

    renderAppearance();
    expect(document.documentElement.dataset.palette).toBe('neutral');
    expect(screen.getByRole('radio', { name: /neutral palette/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});
