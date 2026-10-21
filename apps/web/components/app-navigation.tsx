'use client';

import {
  Archive,
  Heart,
  House,
  LockKeyhole,
  Settings,
  Target,
  ChartNoAxesCombined,
  Ellipsis,
  PanelLeftClose,
  PanelLeftOpen,
  Tags,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@havefolio/ui/components/dropdown-menu';
import { Button } from '@havefolio/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@havefolio/ui/components/tooltip';
import { toggleSidebar, useSidebarState } from './sidebar-state';

const navigationItems = [
  { href: '/', icon: House, label: 'Home' },
  { href: '/store', icon: Archive, label: 'My Store' },
  { href: '/insights', icon: ChartNoAxesCombined, label: 'Insights' },
  { href: '/wants', icon: Heart, label: 'Wants' },
  { href: '/goals', icon: Target, label: 'Goals' },
  { href: '/settings/taxonomy', icon: Tags, label: 'Categories' },
  { href: '/settings', icon: Settings, label: 'Settings' },
] as const;

const sidebarId = 'primary-sidebar';

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !==
      null
  );
}

/** Names an icon-only control on hover and keyboard focus; silent while labels are visible. */
function SidebarTooltip({
  children,
  enabled,
  label,
}: {
  children: ReactElement;
  enabled: boolean;
  label: string;
}): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={enabled && open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function AppNavigation(): ReactElement {
  const pathname = usePathname();
  const collapsed = useSidebarState() === 'collapsed';
  const [moreOpen, setMoreOpen] = useState(false);
  const isNavigatingRef = useRef(false);
  const isNavFocusedRef = useRef(false);
  const lastFocusedNavHref = useRef<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'b' || !(event.metaKey || event.ctrlKey)) return;
      if (event.altKey || event.shiftKey || event.repeat || isEditable(event.target)) return;
      // The bottom navigation has no sidebar to collapse.
      if (!window.matchMedia('(min-width: 768px)').matches) return;
      event.preventDefault();
      toggleSidebar();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // PER-90: responsive breakpoint synchronization.
  // When viewport crosses between mobile (<768px) and desktop (>=768px):
  // 1. Close mobile More menu immediately so no stale overlay or backdrop remains.
  // 2. Transfer focus from the hidden navigation surface to the visible one
  //    so focus is never stranded on a display:none element or dropped to body.
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 768px)');
    const onChange = (event: MediaQueryListEvent | MediaQueryList): void => {
      if (event.matches) {
        setMoreOpen(false);
        const active = document.activeElement;
        const mobileNav = document.querySelector('.mobile-navigation');
        const isInsideMobileNav = Boolean(active && mobileNav && mobileNav.contains(active));
        const isInsideMoreMenu = Boolean(
          active?.closest('[data-slot="dropdown-menu-content"], [role="menu"]') ||
          document.querySelector('[data-slot="dropdown-menu-content"]'),
        );
        const shouldTransfer = isNavFocusedRef.current || isInsideMobileNav || isInsideMoreMenu;
        const targetHref =
          lastFocusedNavHref.current ??
          active?.getAttribute('href') ??
          active?.closest('a')?.getAttribute('href') ??
          null;

        if (shouldTransfer) {
          const transferToDesktop = (): void => {
            const sidebar = document.getElementById(sidebarId);
            if (sidebar) {
              const match = targetHref
                ? sidebar.querySelector<HTMLElement>(`a[href="${targetHref}"]`)
                : null;
              if (match) {
                match.focus();
              } else {
                sidebar.querySelector<HTMLElement>('a[aria-current="page"]')?.focus();
              }
            }
          };
          transferToDesktop();
          window.requestAnimationFrame(transferToDesktop);
        }
      } else {
        const active = document.activeElement;
        const sidebar = document.getElementById(sidebarId);
        const isInsideSidebar = Boolean(active && sidebar && sidebar.contains(active));
        const shouldTransfer = isNavFocusedRef.current || isInsideSidebar;
        const targetHref =
          lastFocusedNavHref.current ??
          active?.getAttribute('href') ??
          active?.closest('a')?.getAttribute('href') ??
          null;

        if (shouldTransfer) {
          const transferToMobile = (): void => {
            const mobileNav = document.querySelector('.mobile-navigation');
            if (mobileNav) {
              const match = targetHref
                ? mobileNav.querySelector<HTMLElement>(`a[href="${targetHref}"]`)
                : null;
              if (match) {
                match.focus();
              } else {
                const moreButton = mobileNav.querySelector<HTMLElement>(
                  'button[aria-label*="More destinations"]',
                );
                if (moreButton) {
                  moreButton.focus();
                } else {
                  mobileNav.querySelector<HTMLElement>('a[aria-current="page"]')?.focus();
                }
              }
            }
          };
          transferToMobile();
          window.requestAnimationFrame(transferToMobile);
        }
      }
    };

    if (typeof mql?.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    if (typeof (mql as unknown as { addListener?: unknown })?.addListener === 'function') {
      const legacyMql = mql as unknown as {
        addListener: (cb: typeof onChange) => void;
        removeListener: (cb: typeof onChange) => void;
      };
      legacyMql.addListener(onChange);
      return () => legacyMql.removeListener(onChange);
    }
  }, []);

  function isItemActive(href: string): boolean {
    if (!pathname) return false;
    if (
      href === '/settings' &&
      (pathname === '/settings/taxonomy' || pathname.startsWith('/settings/taxonomy/'))
    )
      return false;
    if (href === '/store' && (pathname === '/items' || pathname.startsWith('/items/'))) {
      return true;
    }
    return pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));
  }

  return (
    <>
      <aside
        id={sidebarId}
        onFocusCapture={(e) => {
          isNavFocusedRef.current = true;
          const a = e.target instanceof Element ? e.target.closest('a') : null;
          lastFocusedNavHref.current = a?.getAttribute('href') ?? null;
        }}
        onBlurCapture={(e) => {
          if (
            e.relatedTarget &&
            !e.currentTarget.contains(e.relatedTarget) &&
            !document.querySelector('.mobile-navigation')?.contains(e.relatedTarget)
          ) {
            isNavFocusedRef.current = false;
            lastFocusedNavHref.current = null;
          }
        }}
        className="sticky top-0 hidden h-svh w-68 flex-col overflow-x-hidden border-r bg-background px-5 py-6 transition-[width,padding] duration-200 ease-out motion-reduce:transition-none md:flex sidebar-collapsed:w-16 sidebar-collapsed:px-2"
      >
        {/* The rail keeps only the toggle; Home is already the first destination. */}
        <div className="flex items-center justify-between gap-2 sidebar-collapsed:justify-center">
          <Link
            className="flex min-h-12 min-w-0 items-center gap-3 px-2 sidebar-collapsed:hidden"
            href="/"
          >
            <House aria-hidden="true" className="size-5 shrink-0" />
            <span className="whitespace-nowrap">
              <span className="block text-lg font-semibold leading-none">Havefolio</span>
              <span className="mt-1 block text-xs text-muted-foreground">Your household index</span>
            </span>
          </Link>
          <SidebarTooltip
            enabled
            label={collapsed ? 'Expand sidebar (Ctrl/⌘ B)' : 'Collapse sidebar (Ctrl/⌘ B)'}
          >
            <Button
              aria-controls={sidebarId}
              aria-expanded={!collapsed}
              aria-keyshortcuts="Control+B Meta+B"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="shrink-0"
              onClick={toggleSidebar}
              size="icon-lg"
              type="button"
              variant="ghost"
            >
              <PanelLeftClose aria-hidden="true" className="size-5 sidebar-collapsed:hidden" />
              <PanelLeftOpen aria-hidden="true" className="hidden size-5 sidebar-collapsed:block" />
            </Button>
          </SidebarTooltip>
        </div>

        <nav aria-label="Primary" className="mt-10 grid gap-2">
          {navigationItems.map((item) => {
            const active = isItemActive(item.href);
            const Icon = item.icon;

            return (
              <SidebarTooltip key={item.href} enabled={collapsed} label={item.label}>
                <Button
                  asChild
                  className="h-12 justify-start gap-3 px-3 text-base sidebar-collapsed:justify-center sidebar-collapsed:px-0"
                  variant={active ? 'secondary' : 'ghost'}
                >
                  <Link aria-current={active ? 'page' : undefined} href={item.href}>
                    <Icon aria-hidden="true" className="size-5" />
                    <span className="sidebar-collapsed:sr-only">{item.label}</span>
                  </Link>
                </Button>
              </SidebarTooltip>
            );
          })}
        </nav>

        <div className="mt-auto flex items-start gap-2 rounded-lg border p-3 text-xs leading-relaxed text-muted-foreground sidebar-collapsed:hidden">
          <LockKeyhole aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <p>Your inventory stays private. Havefolio has no marketplace or public storefront.</p>
        </div>
      </aside>

      {/* PER-87: a modal overlay hides a classic scrollbar and gives the body a matching right
          margin; `width-before-scroll-bar` gives this fixed bar the same margin so it does not
          widen meanwhile. It is a no-op with overlay scrollbars. */}
      <nav
        aria-label="Primary"
        onFocusCapture={(e) => {
          isNavFocusedRef.current = true;
          const a = e.target instanceof Element ? e.target.closest('a') : null;
          lastFocusedNavHref.current = a?.getAttribute('href') ?? null;
        }}
        onBlurCapture={(e) => {
          if (
            e.relatedTarget &&
            !e.currentTarget.contains(e.relatedTarget) &&
            !document.getElementById(sidebarId)?.contains(e.relatedTarget)
          ) {
            isNavFocusedRef.current = false;
            lastFocusedNavHref.current = null;
          }
        }}
        className="mobile-navigation width-before-scroll-bar fixed right-(--mobile-nav-inset-right) bottom-(--mobile-nav-offset) left-(--mobile-nav-inset-left) z-50 grid h-(--mobile-nav-height) grid-cols-5 rounded-lg border bg-background p-1.5 shadow-sm md:hidden"
      >
        {navigationItems.slice(0, 4).map((item) => {
          const active = isItemActive(item.href);
          const Icon = item.icon;

          return (
            <Button
              key={item.href}
              asChild
              className="h-14 flex-col gap-1 px-1 text-xs"
              variant={active ? 'secondary' : 'ghost'}
            >
              <Link aria-current={active ? 'page' : undefined} href={item.href}>
                <Icon aria-hidden="true" className="size-5" />
                {item.label}
              </Link>
            </Button>
          );
        })}
        <DropdownMenu open={moreOpen} onOpenChange={setMoreOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant={
                navigationItems.slice(4).some((item) => isItemActive(item.href))
                  ? 'secondary'
                  : 'ghost'
              }
              className="h-14 flex-col gap-1 px-1 text-xs"
              aria-label={
                navigationItems.slice(4).some((item) => isItemActive(item.href))
                  ? 'More destinations, current page'
                  : 'More destinations'
              }
            >
              <Ellipsis aria-hidden="true" className="size-5" />
              More
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            side="top"
            // PER-85: clear the bar's border and padding (7px) as well as the usual 4px gap.
            sideOffset={11}
            className="min-w-48 motion-reduce:animate-none motion-reduce:transition-none"
            onCloseAutoFocus={(event) => {
              if (window.matchMedia('(min-width: 768px)').matches) {
                event.preventDefault();
                const sidebar = document.getElementById(sidebarId);
                const current =
                  sidebar?.querySelector<HTMLElement>('a[aria-current="page"]') ??
                  sidebar?.querySelector<HTMLElement>('a');
                current?.focus();
              } else if (isNavigatingRef.current) {
                event.preventDefault();
                isNavigatingRef.current = false;
              }
            }}
          >
            {navigationItems.slice(4).map((item) => {
              const active = isItemActive(item.href);
              const Icon = item.icon;
              return (
                <DropdownMenuItem key={item.href} asChild className="min-h-11">
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => {
                      isNavigatingRef.current = true;
                      setMoreOpen(false);
                    }}
                  >
                    <Icon aria-hidden="true" className="size-4" />
                    {item.label}
                  </Link>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>
    </>
  );
}
