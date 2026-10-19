export const sidebarKey = 'havefolio:sidebar:v1';
export type SidebarState = 'expanded' | 'collapsed';
export function parseSidebar(value: string | null | undefined): SidebarState {
  return value === 'collapsed' ? 'collapsed' : 'expanded';
}

// PER-66: run in the document head so the desktop navigation paints at its saved width.
// React hydrates against Expanded; CSS already has the saved geometry, then the toggle syncs.
export const sidebarBootstrap = `try{document.documentElement.dataset.sidebar=localStorage.getItem('${sidebarKey}')==='collapsed'?'collapsed':'expanded'}catch{document.documentElement.dataset.sidebar='expanded'}`;
