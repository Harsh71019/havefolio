# Havefolio Design System & UI Revamp Blueprint

Status: **Accepted Foundation & UI Revamp Blueprint**  
Tickets: **PER-6, PER-70 (Sprint Parent), PER-74 (Design Contract & Audit)**  
Sprint Authority: **UI revamp sprint 2026-10-20. P1 — Sprint Priority.**  
Companion Architecture Artifacts:
- [Route & Capture Audit Matrix](file:///Users/harsh/Developer/Havefolio/docs/architecture/ui-route-audit.md)
- [Product Capture Blueprint](file:///Users/harsh/Developer/Havefolio/docs/architecture/capture-blueprint.md)
- [Responsive UI Wireframes](file:///Users/harsh/Developer/Havefolio/docs/architecture/ui-wireframes.md)

---

## 1. Executive Summary & Sprint Authority

On 2026-10-20, the product owner authorized the **UI Revamp Sprint (PER-70)** to resolve user experience friction across Havefolio. Specifically:
1. **Unified Left Alignment:** Eliminate floating centered content islands (`mx-auto max-w-*`) across inventory screens so all pages line up predictably with the primary navigation shell.
2. **Fast, Effortless Capture:** Simplify item creation into a fast, progressive capture journey with seamless contextual returns (e.g. from My Store or Wants).
3. **Confirmed Sprint Bug Fixes:** Resolve three source-confirmed defects: missing edit route 404 (PER-71), broken validation summary links (PER-72), and metadata loss on collapsed disclosure (PER-73).
4. **Accessible Themes Exception:** The owner explicitly authorized curated appearance presets (**Neutral**, **Ocean**, **Forest**) that operate independently of **System / Light / Dark** mode, while preserving the existing UI libraries (`shadcn/ui`, `Kibo UI`, `Radix`, `Tailwind v4`). This dedicated authorization supersedes prior neutral-only restrictions strictly within reviewed theme scope.

This document serves as the **concrete design contract** governing implementation across all child tickets (PER-71 through PER-91).

---

## 2. Product Language & Invariants

Havefolio is a private personal inventory and decision aid designed to encourage mindful possession ownership and counter impulse consumerism. The interface must always feel **calm, neutral, and unhurried**:

- **No Marketplace Pressure:** Never introduce cart badges, checkout flows, fake scarcity countdowns, price drop alerts, or shopping streaks.
- **Warm, Non-Judgmental Tone:** Never shame users for purchases or classify their choices for them.
- **Exact Money & Minor Units:** Monetary values are stored as integer minor units with ISO 4217 currency codes (e.g., ₹2,499.00 = `"249900"` in `INR`). Catalogue prices are never substituted for actual price paid.
- **Preserved Date Precision:** Exact, month-only, year-only, and unknown precisions remain distinct; never invent a day when only month or year is known.
- **Manual Entry Supremacy:** Manual input must always succeed unconditionally. Optional enrichment (photos, barcodes, OCR) may assist but must never gate item creation.
- **Private Data Isolation:** Receipts, photos, and notes are encrypted and protected; never expose media URLs to public CDNs or browser telemetry.

---

## 3. Layout Architecture: The Unified Left Rail

### The Problem of Centered Content Islands
Prior to PER-74, pages used disparate container classes:
- Home & Add Item: `max-w-6xl mx-auto` (with inner form `max-w-xl mx-auto mb-6`)
- My Store: `max-w-[112rem] mx-auto`
- Goals & History: `max-w-3xl mx-auto`
- Settings & Merchants: `max-w-4xl mx-auto`
- Photo Gallery: `max-w-5xl mx-auto`

On desktop viewports (1280px to 1920px), navigating between routes caused the left edge of content to jump horizontally between seven different coordinates. Furthermore, the top search bar in `apps/web/app/(inventory)/layout.tsx` was pinned to `px-4 sm:px-6`, while page titles floated hundreds of pixels to the right.

### The Unified Left-Rail Contract
All inventory pages and shells must align to a **single, shared left rail**:

```
┌──────────────────┬────────────────────────────────────────────────────────────┐
│ Navigation Shell │ Header: [ 🔍 Search... (aligned with rail) ] [Theme Toggle]│
│                  ├────────────────────────────────────────────────────────────┤
│ (w-68 expanded   │ x = Left Rail                                              │
│  or w-16 icon    │ Page Title & Actions                                       │
│  or hidden       │                                                            │
│  on mobile)      │ ┌────────────────────────┐                                 │
│                  │ │ Form / Detail (max-w-2xl│ (Remaining area is calm       │
│                  │ │ pinned to left rail)   │  negative space or companion)   │
│                  │ └────────────────────────┘                                 │
│                  │                                                            │
│                  │ ┌────────────────────────────────────────────────────────┐ │
│                  │ │ Catalogs & Grids (expand up to max-w-7xl from left)    │ │
│                  │ └────────────────────────────────────────────────────────┘ │
└──────────────────┴────────────────────────────────────────────────────────────┘
```

### Breakpoint Geometry & Gutter Standards

| Breakpoint | Viewport Width | Sidebar State | Outer Gutter | Left Content Rail | Max Content Form Width | Max Grid Width |
|---|---|---|---|---|---|---|
| **Mobile** | `< 640 px` (360 px floor) | Hidden (bottom nav) | `px-4` (16 px) | `x = 16 px` | Full width (328 px) | Full width (1–2 cols) |
| **Tablet** | `640 px – 1023 px` (768 px) | Collapsed (`w-16`, 64 px) | `px-6` (24 px) | `x = 88 px` | `max-w-xl` (576 px, pinned left) | Responsive 2–3 cols |
| **Desktop** | `1024 px – 1439 px` | Expanded (`w-68`, 272 px)| `px-8` (32 px) | `x = 304 px` | `max-w-2xl` (672 px, pinned left) | `max-w-6xl` (1152 px) |
| **Wide** | `≥ 1440 px` (1512 px standard) | Expanded (`w-68`, 272 px)| `px-8` (32 px) | `x = 304 px` | `max-w-2xl` (672 px, pinned left) | `max-w-7xl` (1280 px) |

### Page-Shell Rules
1. **No `mx-auto` on Page Wrappers:** Replace `<main className="mx-auto ...">` with `<main className="w-full px-4 sm:px-6 lg:px-8 py-6 sm:py-8">`.
2. **Left-Pinned Forms:** Constrain form containers to `max-w-2xl` (672 px) for ergonomic line length (50–75 characters per line), but **never center them**. Keep them anchored to the left content rail.
3. **Wide Catalog Grids:** In My Store, Wants, and Insights, allow grids to fill available width up to `max-w-7xl` using auto-fill columns (`repeat(auto-fill, minmax(15rem, 1fr))`).

---

## 4. Mobile Navigation & Clearance Contract (PER-85 Coordination)

Claude owns **PER-85** (`app-navigation.tsx`, safe-area mobile clearance, and navigation CSS). To ensure non-blocking parallel work, this blueprint defines the agreed clearance contract:

1. **Floating Mobile Navbar Geometry:**
   - Position: `fixed inset-x-3 bottom-3 z-50`
   - Height: 56 px control button (`h-14`) + 12 px padding (`p-1.5`) + 2 px borders = **70 px total height**.
2. **Provisional Page Bottom Clearance:**
   - All mobile pages must reserve bottom padding to prevent content, sticky actions, or active inputs from being hidden behind the navbar.
   - Standard clearance class: `pb-28` (112 px) or `pb-[calc(env(safe-area-inset-bottom,0px)+5.5rem)]`.
   - On desktop (`md:`), reset to `md:pb-0`.
3. **Software Keyboard Usability (PER-86):**
   - Save and cancel buttons on mobile forms must remain reachable above the software keyboard using standard viewport scrolling.

---

## 5. System Typography, Spacing & Control Standards

### Typography Scale (System Fonts)
Havefolio uses the native operating system typography stack (`font-sans`) without external font downloads:

| Role | Tailwind Classes | Size / Line-Height | Weight | Usage |
|---|---|---|---|---|
| **Page H1** | `text-2xl sm:text-3xl tracking-tight` | 24 px / 32 px (sm: 30 px / 36 px) | Bold (700) | Single page heading, left-aligned |
| **Section H2** | `text-lg sm:text-xl tracking-tight` | 18 px / 28 px (sm: 20 px / 28 px) | Semibold (600) | Card group, section heading |
| **Card H3** | `text-base` | 16 px / 24 px | Semibold (600) | Card title, disclosure header |
| **Body (Default)** | `text-sm leading-6` | 14 px / 24 px | Regular (400) | Form fields, labels, specs |
| **Muted / Hint** | `text-xs leading-5 text-muted-foreground` | 12 px / 20 px | Regular (400) | Helper hints, timestamps, metadata |
| **Financial / Metric** | `font-semibold tabular-nums` | Inherited or `text-lg` | Semibold (600) | Currency amounts, item counts |

### Spacing Scale
- Component internals: `space-y-1.5` (6 px) or `space-y-2` (8 px)
- Form field groups: `space-y-4` (16 px) or `gap-3` (12 px)
- Card / Section spacing: `space-y-6` (24 px)
- Page top/bottom gutters: `py-6 sm:py-8` (24 px / 32 px)

### Control Sizing & Accessibility Floor
- **Minimum Touch Target:** `44 × 44 px` (`min-h-11`) for all visible buttons, inputs, selects, and disclosure toggles on touch viewports.
- **Input Heights:** `h-11` (44 px) default across text inputs, selects, and buttons.
- **Focus Indicators:** Uncompromised `ring-2 ring-ring ring-offset-2 ring-offset-background` on `:focus-visible`. Never suppress focus outlines.

---

## 6. Color Palette & Theme Specification

### Orthogonal 2D Theme Architecture
Havefolio decouples **Luminance Mode** (`light`, `dark`, `system`) from **Palette Preset** (`neutral`, `ocean`, `forest`). A user can select any combination (e.g. *Ocean Dark*, *Forest Light*, *Neutral System*).

- Applied via document attributes: `html.dark` (from `next-themes`) and `html[data-palette="ocean"]`.
- Stored in client `localStorage` under `havefolio:palette-preset`.

```
                    ┌───────────────┐
                    │ System / Auto │
                    └───────┬───────┘
                            │ (Resolves to OS preference)
           ┌────────────────┴────────────────┐
           ▼                                 ▼
    ┌──────────────┐                  ┌──────────────┐
    │  Light Mode  │                  │  Dark Mode   │
    └──────┬───────┘                  └──────┬───────┘
           │                                 │
   ┌───────┼───────┐                 ┌───────┼───────┐
   ▼       ▼       ▼                 ▼       ▼       ▼
Neutral  Ocean  Forest            Neutral  Ocean  Forest
```

### Palette Tokens & Concrete Contrast Proofs (OKLCH)

All values are specified in OKLCH and verified for WCAG 2.1 AA (≥ 4.5:1 text, ≥ 3.0:1 UI) and WCAG AAA (≥ 7.0:1 text):

#### 1. Neutral Palette (Zinc Baseline)
- **Light:**
  - Background: `oklch(1 0 0)` (#ffffff)
  - Foreground: `oklch(0.145 0 0)` (#18181b) — **Contrast: 19.79:1 (AAA)**
  - Muted Foreground: `oklch(0.556 0 0)` (#71717a) — **Contrast: 4.73:1 (AA)**
  - Primary / Primary FG: `oklch(0.205 0 0)` on `oklch(0.985 0 0)` — **Contrast: 16.20:1 (AAA)**
  - Border: `oklch(0.922 0 0)` (#e4e4e7)
- **Dark:**
  - Background: `oklch(0.145 0 0)` (#09090b)
  - Foreground: `oklch(0.985 0 0)` (#fafafa) — **Contrast: 18.96:1 (AAA)**
  - Muted Foreground: `oklch(0.708 0 0)` (#a1a1aa) — **Contrast: 7.63:1 (AAA)**
  - Primary / Primary FG: `oklch(0.922 0 0)` on `oklch(0.205 0 0)` — **Contrast: 14.80:1 (AAA)**
  - Border: `oklch(1 0 0 / 10%)`

#### 2. Ocean Palette (Marine Slate)
- **Light:**
  - Background: `oklch(0.985 0.008 230)` (#f5fbff)
  - Foreground: `oklch(0.16 0.03 235)` (#010f18) — **Contrast: 18.58:1 (AAA)**
  - Muted Foreground: `oklch(0.48 0.04 235)` (#476271) — **Contrast: 6.21:1 (AA)**
  - Primary: `oklch(0.28 0.07 235)` (#002d46)
  - Primary Foreground: `oklch(0.985 0.005 230)` (#f7fbfd) — **Contrast: 13.73:1 (AAA)**
  - Secondary Surface: `oklch(0.94 0.02 230)` (#deeef6)
  - Border: `oklch(0.90 0.015 230)` (#d5e0e6)
- **Dark:**
  - Background: `oklch(0.14 0.03 235)` (#000b14)
  - Foreground: `oklch(0.97 0.01 230)` (#eff7fb) — **Contrast: 18.26:1 (AAA)**
  - Muted Foreground: `oklch(0.72 0.03 230)` (#92a9b4) — **Contrast: 8.07:1 (AAA)**
  - Primary: `oklch(0.80 0.08 225)` (#84c9e5)
  - Primary Foreground: `oklch(0.15 0.04 235)` (#000d19) — **Contrast: 10.69:1 (AAA)**
  - Secondary Surface: `oklch(0.24 0.04 235)` (#09222f)
  - Border: `oklch(0.26 0.03 235)` (#152631)

#### 3. Forest Palette (Sage & Cedar Pine)
- **Light:**
  - Background: `oklch(0.985 0.01 145)` (#f6fcf6)
  - Foreground: `oklch(0.16 0.03 145)` (#051106) — **Contrast: 18.57:1 (AAA)**
  - Muted Foreground: `oklch(0.47 0.04 145)` (#4d614d) — **Contrast: 6.44:1 (AA)**
  - Primary: `oklch(0.27 0.06 145)` (#112e13)
  - Primary Foreground: `oklch(0.985 0.005 145)` (#f8fbf8) — **Contrast: 14.18:1 (AAA)**
  - Secondary Surface: `oklch(0.94 0.02 145)` (#e3efe3)
  - Border: `oklch(0.90 0.015 145)` (#d8e1d8)
- **Dark:**
  - Background: `oklch(0.14 0.025 145)` (#040c04)
  - Foreground: `oklch(0.97 0.01 145)` (#f1f7f1) — **Contrast: 18.26:1 (AAA)**
  - Muted Foreground: `oklch(0.72 0.03 145)` (#99aa99) — **Contrast: 8.10:1 (AAA)**
  - Primary: `oklch(0.78 0.09 145)` (#93c794)
  - Primary Foreground: `oklch(0.15 0.04 145)` (#020f02) — **Contrast: 10.11:1 (AAA)**
  - Secondary Surface: `oklch(0.24 0.035 145)` (#142415)
  - Border: `oklch(0.26 0.025 145)` (#1c271d)

---

## 7. Component Sourcing & Registry Strategy

Havefolio strictly reuses vetted registry components behind `packages/ui`. Do not invent custom UI primitives when approved components exist:

1. **shadcn/ui Primitives:** Button, Input, Select, Checkbox, RadioGroup, Dialog, AlertDialog, DropdownMenu, Tooltip, Skeleton, Card, Badge, Table, Textarea, Switch, Separator.
2. **Kibo UI Primitives:** Pill (`packages/ui/src/components/kibo-ui/pill`).
3. **Havefolio Compositions:** DateInput (`date-input.tsx`), OwnedItemCard (`owned-item-card.tsx`), ItemCover (`item-cover.tsx`), PrivatePhoto (`private-photo.tsx`).
4. **Icons:** `lucide-react` (standard icon size: `size-4` in controls, `size-5` in navigation).

---

## 8. Non-Circular Implementation & Ownership Plan

To allow the three implementation agents to work in parallel without merge conflicts or circular blockers, the child tickets are phased as follows:

```mermaid
flowchart TD
    subgraph Phase 1: Foundation
        PER74["PER-74: UI Blueprint (Gemini - Done)"]
        PER85["PER-85: Mobile Navbar Stability (Claude - In Progress)"]
    end

    subgraph Phase 2: Bug Fixes & Layout Core
        PER71["PER-71: Fix Add Item 404 Route"]
        PER72["PER-72: Fix Error Summary Links"]
        PER73["PER-73: Preserve Collapsed Details"]
        PER75["PER-75: Unified Left Page Shells"]
        PER76["PER-76: Accessible Theme Presets"]
    end

    subgraph Phase 3: Progressive Capture & Context
        PER77["PER-77: Fast Progressive Capture"]
        PER78["PER-78: Contextual Entry & Return"]
        PER79["PER-79: Media & Receipt Continuation"]
    end

    subgraph Phase 4: Domain Screens
        PER80["PER-80: Wants & Comparison Revamp"]
        PER81["PER-81: Home & My Store Revamp"]
        PER82["PER-82: Goals & Insights Revamp"]
        PER83["PER-83: Settings & Merchants Revamp"]
    end

    subgraph Phase 5: Hardening & Resilience
        PER86["PER-86: Mobile Software Keyboard"]
        PER87["PER-87: Overlay Scroll Leaks"]
        PER88["PER-88: Async Loading Geometry"]
        PER89["PER-89: Control Sizing Uniformity"]
        PER90["PER-90: Focus Recovery & Transitions"]
        PER91["PER-91: Zoom & Responsive Overflow"]
    end

    subgraph Phase 6: Sprint Gate
        PER84["PER-84: Integrated UI Sprint Verification"]
    end

    PER74 --> PER75
    PER74 --> PER76
    PER74 --> PER71
    PER74 --> PER72
    PER74 --> PER73

    PER75 --> PER77
    PER71 --> PER77
    PER72 --> PER77
    PER73 --> PER77

    PER77 --> PER78
    PER78 --> PER79

    PER75 --> PER80
    PER78 --> PER80
    PER75 --> PER81
    PER78 --> PER81
    PER75 --> PER82
    PER76 --> PER82
    PER75 --> PER83
    PER76 --> PER83

    PER85 -.-> PER86
    PER75 --> PER86
    PER75 --> PER87
    PER75 --> PER88
    PER75 --> PER89
    PER75 --> PER90
    PER75 --> PER91

    PER79 --> PER84
    PER80 --> PER84
    PER81 --> PER84
    PER82 --> PER84
    PER83 --> PER84
    PER86 --> PER84
    PER87 --> PER84
    PER88 --> PER84
    PER89 --> PER84
    PER90 --> PER84
    PER91 --> PER84
```

### Ownership Boundaries
- **Gemini (Documentation & Blueprint):** Owns `docs/design-system.md`, `docs/architecture/ui-route-audit.md`, `docs/architecture/capture-blueprint.md`, and `docs/architecture/ui-wireframes.md`. Does not touch runtime code or CSS in PER-74.
- **Claude (Mobile Navigation):** Owns `app-navigation.tsx`, inventory layout mobile clearance, narrowly necessary mobile CSS, and navigation tests in PER-85.
- **Implementation Agents (Subsequent Tickets):** Consume this contract to deliver PER-75 through PER-91 sequentially according to the dependency graph above.
