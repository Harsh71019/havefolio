'use client';

import { useSyncExternalStore } from 'react';
import { parseSidebar, sidebarKey, type SidebarState } from './sidebar-config';

const changedEvent = 'havefolio-sidebar-changed';
const serverSnapshot = (): SidebarState => 'expanded';
function snapshot(): SidebarState {
  const current = document.documentElement.dataset.sidebar;
  if (current) return parseSidebar(current);
  try {
    return parseSidebar(window.localStorage.getItem(sidebarKey));
  } catch {
    return 'expanded';
  }
}
function subscribe(callback: () => void): () => void {
  const storage = (event: StorageEvent): void => {
    if (event.key !== sidebarKey && event.key !== null) return;
    document.documentElement.dataset.sidebar = parseSidebar(event.newValue);
    callback();
  };
  window.addEventListener(changedEvent, callback);
  window.addEventListener('storage', storage);
  return () => {
    window.removeEventListener(changedEvent, callback);
    window.removeEventListener('storage', storage);
  };
}
export function selectSidebar(value: SidebarState): void {
  // Keep the current session usable even when storage is disabled or full.
  document.documentElement.dataset.sidebar = value;
  try {
    window.localStorage.setItem(sidebarKey, value);
  } catch {
    // Preferences must never block inventory or navigation.
  }
  window.dispatchEvent(new Event(changedEvent));
}
export function toggleSidebar(): void {
  selectSidebar(snapshot() === 'collapsed' ? 'expanded' : 'collapsed');
}
export function useSidebarState(): SidebarState {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
