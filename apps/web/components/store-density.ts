'use client';

import { useSyncExternalStore } from 'react';
import { densityKey, parseDensity, type StoreDensity } from './store-density-config';

const changedEvent = 'havefolio-store-density-changed';
const serverSnapshot = (): StoreDensity => 'comfortable';
function snapshot(): StoreDensity {
  const current = document.documentElement.dataset.storeDensity;
  if (current) return parseDensity(current);
  try {
    return parseDensity(window.localStorage.getItem(densityKey));
  } catch {
    return 'comfortable';
  }
}
function subscribe(callback: () => void): () => void {
  const storage = (event: StorageEvent): void => {
    if (event.key !== densityKey && event.key !== null) return;
    document.documentElement.dataset.storeDensity = parseDensity(event.newValue);
    callback();
  };
  window.addEventListener(changedEvent, callback);
  window.addEventListener('storage', storage);
  return () => {
    window.removeEventListener(changedEvent, callback);
    window.removeEventListener('storage', storage);
  };
}
export function selectDensity(value: string): void {
  const density = parseDensity(value);
  // Keep the current session usable even when storage is disabled or full.
  document.documentElement.dataset.storeDensity = density;
  try {
    window.localStorage.setItem(densityKey, density);
  } catch {
    // Preferences must never block inventory or navigation.
  }
  window.dispatchEvent(new Event(changedEvent));
}
export function useStoreDensity(): StoreDensity {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
