# Havefolio Responsive UI Wireframes

Status: **Sprint Blueprint & Design Contract**  
Ticket: **PER-74**  
Parent: **PER-70**  
Implementation Children: **PER-75, PER-77, PER-81, PER-82, PER-85, PER-86, PER-89, PER-91**  

---

## 1. Unified Left-Rail Layout Architecture

The fundamental UI revamp principle across Havefolio is the **Unified Left Rail**. All inventory pages and their headers share an identical left-hand alignment boundary, eliminating floating centered islands (`mx-auto max-w-*`) that cause lateral content jumping across navigation.

```
VIEWPORT GEOMETRY OVERVIEW
================================================================================
Viewport Width | Navigation Shell      | Content Gutter | Main Content Left Rail
---------------+-----------------------+----------------+-----------------------
360 px (Mobile)| Bottom Floating Nav   | 16 px (px-4)   | x = 16 px
768 px (Tablet)| Collapsed Rail (64 px)| 24 px (px-6)   | x = 88 px (64 + 24)
1512 px (Desk) | Expanded Rail (272 px)| 32 px (px-8)   | x = 304 px (272 + 32)
================================================================================
```

---

## 2. Breakpoint 1: Mobile Phone (360 px)

### A. Mobile Add Item (Fast Progressive Capture)
- **Viewport:** 360 × 800 px
- **Gutter:** 16 px (`px-4`) | **Content Width:** 328 px
- **Clearance:** `pb-28` reserving clearance for the 70 px mobile navbar and safe-area inset.

```text
┌──────────────────────────────────────────────┐ 0 px
│ [Logo] Havefolio              [Theme Toggle] │ 56 px (Header)
├──────────────────────────────────────────────┤
│                                              │
│ < Back to Kitchen                            │
│                                              │
│ Add item                                     │ H1 (text-2xl, font-bold)
│ Save a possession to your home.              │ text-sm, text-muted
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │ Item name *                              │ │ Label
│ │ [ Milton Thermosteel Flask             ] │ │ Input (h-11, 44px touch target)
│ └──────────────────────────────────────────┘ │
│                                              │
│ ┌──────────────────────┐ ┌─────────────────┐ │
│ │ Price paid           │ │ Currency        │ │
│ │ [ 899              ] │ │ [ INR (₹)     ▼]│ │
│ └──────────────────────┘ └─────────────────┘ │
│ [ ] Price unknown                            │ Checkbox (min-h-11)
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │ Purchase date                            │ │ Label
│ │ [ 15 ] [ March         ▼] [ 2024       ] │ │ DateInput group (44px)
│ └──────────────────────────────────────────┘ │
│ [ ] Date unknown                             │ Checkbox (min-h-11)
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │ Category (optional)                      │ │ Label
│ │ [ Kitchen                              ▼]│ │ Pre-selected from context
│ └──────────────────────────────────────────┘ │
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │ ▼ Additional details (optional)          │ │ Disclosure button (44px)
│ └──────────────────────────────────────────┘ │
│                                              │
│ [ Save item                              ]   │ Button (Primary, h-11, w-full)
│ [ Cancel and return to Kitchen           ]   │ Button (Ghost, h-11, w-full)
│                                              │
│                                              │ Content scroll space (pb-28)
├──────────────────────────────────────────────┤
│ [Home] [Store] [Wants] [Insights] [More  •••]│ 70 px Floating Nav (fixed bottom-3)
└──────────────────────────────────────────────┘ 800 px
```

### B. Mobile My Store (1–2 Column Catalog)
```text
┌──────────────────────────────────────────────┐
│ [Logo] Havefolio              [Theme Toggle] │
├──────────────────────────────────────────────┤
│                                              │
│ My Store                                     │ H1
│ 42 possessions in your household.            │
│                                              │
│ [ Search catalog...                        ] │ Input (h-11)
│ [ All Items ] [ Kitchen (14) ] [ Electronics]│ Horizontal pill scroller
│                                              │
│ ┌──────────────────────┐┌──────────────────┐ │
│ │ [ Photo ]            ││ [ Photo ]        │ │
│ │                      ││                  │ │
│ │ Electric kettle      ││ Chef knife       │ │
│ │ Kitchen • ₹2,499     ││ Kitchen • ₹1,850 │ │
│ └──────────────────────┘└──────────────────┘ │
│ ┌──────────────────────┐┌──────────────────┐ │
│ │ [ Photo ]            ││ [ Photo ]        │ │
│ │                      ││                  │ │
│ │ Cast iron skillet    ││ Blender          │ │
│ │ Kitchen • ₹3,200     ││ Kitchen • ₹4,500 │ │
│ └──────────────────────┘└──────────────────┘ │
│                                              │
├──────────────────────────────────────────────┤
│ [Home] [Store] [Wants] [Insights] [More  •••]│ Bottom Nav
└──────────────────────────────────────────────┘
```

---

## 3. Breakpoint 2: Tablet / Compact Desktop (768 px)

- **Viewport:** 768 × 1024 px
- **Sidebar:** Collapsed rail (`w-16`, 64 px)
- **Gutter:** 24 px (`px-6`) | **Main Left Rail:** x = 88 px (64 + 24)
- **Form Geometry:** Pinned to left rail, constrained to `max-w-xl` (576 px). Never centered in the remaining 704 px!

```text
┌──────┬────────────────────────────────────────────────────────────────────────┐
│ [Icon│ [ Search catalog or press ⌘K...                  ]       [Theme Toggle]│ (h-14)
├──────┼────────────────────────────────────────────────────────────────────────┤
│      │ x = 88 px (Left Rail)                                                  │
│ [ ⌂ ]│ < Back to Kitchen                                                      │
│ Home │                                                                        │
│      │ Add item                                                               │ H1
│ [ ◫ ]│ Save a possession to your home.                                        │
│ Store│                                                                        │
│      │ ┌────────────────────────────────────────────────────────┐             │
│ [ ♡ ]│ │ Item name *                                            │             │
│ Wants│ │ [ Milton Thermosteel Flask                           ] │             │
│      │ └────────────────────────────────────────────────────────┘             │
│ [ ∿ ]│                                                                        │
│ Ins. │ │ ┌───────────────────────────────────┐ ┌────────────────┐             │
│      │ │ Price paid                          │ │ Currency       │             │
│ [ ◎ ]│ │ [ 899                             ] │ │ [ INR (₹)    ▼]│             │
│ Goals│ │ └───────────────────────────────────┘ └────────────────┘             │
│      │ [ ] Price unknown                                                      │
│ [ ⚙ ]│                                                                        │
│ Sett.│ │ ┌────────────────────────────────────────────────────────┐             │
│      │ │ Purchase date                                          │             │
│      │ │ [ 15      ]  [ March                ▼]  [ 2024       ] │             │
│      │ └────────────────────────────────────────────────────────┘             │
│      │ [ ] Date unknown                                                       │
│      │                                                                        │
│      │ ┌────────────────────────────────────────────────────────┐             │
│      │ │ Category                                               │             │
│      │ │ [ Kitchen                                            ▼]│             │
│      │ └────────────────────────────────────────────────────────┘             │
│      │                                                                        │
│      │ ┌────────────────────────────────────────────────────────┐             │
│      │ │ ▶ Additional details (optional)                        │             │
│      │ └────────────────────────────────────────────────────────┘             │
│      │                                                                        │
│      │ [ Save item ]   [ Cancel and return to Kitchen ]                       │
│      │                                                                        │
│      │ (Width = 576 px, pinned left; right 128 px is calm negative space)     │
└──────┴────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Breakpoint 3: Standard Wide Desktop (1512 px)

### A. Desktop Left-Pinned Capture Form
- **Viewport:** 1512 × 982 px (MacBook Pro 14"/16" display)
- **Sidebar:** Expanded (`w-68`, 272 px)
- **Gutter:** 32 px (`px-8`) | **Main Left Rail:** x = 304 px (272 + 32)
- **Header:** Search bar starts at x = 304 px, perfectly aligned with the page title below!
- **Form:** Pinned to left rail at `max-w-2xl` (672 px, x = 304 px to 976 px).
- **Right Area (x = 1008 px to 1480 px):** Quiet contextual companion (quick tips or photo dropzone), NOT empty dead space caused by centering!

```text
┌─────────────────┬─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Havefolio       │ x = 304 px (Aligned with Header Search)                                                                 │
│ Household index │ [ 🔍 Search catalog, merchants, desires... (⌘K)        ]                                  [Theme Toggle]│
├─────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                 │                                                                                                         │
│ ⌂ Home          │ < Back to Kitchen                                                                                       │
│                 │                                                                                                         │
│ ◫ My Store      │ Add item                                                  ┌───────────────────────────────────────────┐ │
│                 │ Save a possession to your home.                           │ Contextual Guidance                       │ │
│ ♡ Wants         │                                                           │                                           │ │
│                 │ ┌───────────────────────────────────────────────────────┐ │ • Fast capture requires only a name.     │ │
│ ∿ Insights      │ │ Item name *                                           │ │ • Price and date can be left unknown.   │ │
│                 │ │ [ Milton Thermosteel Flask                          ] │ │ • Photos and receipts can be uploaded   │ │
│ ◎ Goals         │ └───────────────────────────────────────────────────────┘ │   immediately after saving.             │ │
│                 │                                                           │ • Everything stays strictly private to    │ │
│ 🏷 Categories    │ ┌──────────────────────────────────┐ ┌────────────────┐ │   your household.                       │ │
│                 │ │ Price paid                       │ │ Currency       │ │                                           │ │
│ ⚙ Settings      │ │ [ 899                          ] │ │ [ INR (₹)    ▼]│ └───────────────────────────────────────────┘ │
│                 │ └──────────────────────────────────┘ └────────────────┘                                               │
│                 │ [ ] Price unknown                                                                                     │
│                 │                                                                                                       │
│                 │ ┌───────────────────────────────────────────────────────┐                                             │
│                 │ │ Purchase date                                         │                                             │
│                 │ │ [ 15       ]   [ March            ▼]   [ 2024       ] │                                             │
│                 │ └───────────────────────────────────────────────────────┘                                             │
│                 │ [ ] Date unknown                                                                                      │
│                 │                                                                                                       │
│                 │ ┌───────────────────────────────────────────────────────┐                                             │
│                 │ │ Category                                              │                                             │
│                 │ │ [ Kitchen                                           ▼]│                                             │
│                 │ └───────────────────────────────────────────────────────┘                                             │
│                 │                                                                                                       │
│                 │ ┌───────────────────────────────────────────────────────┐                                             │
│                 │ │ ▼ Additional details (optional)                       │                                             │
│                 │ └───────────────────────────────────────────────────────┘                                             │
│                 │                                                                                                       │
│ 🔒 Private      │ [ Save item (Primary) ]   [ Cancel and return to Kitchen ]                                            │
│ No marketplace  │                                                                                                       │
│ or ads.         │                                                                                                       │
└─────────────────┴─────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### B. Desktop Wide Catalog Grid (My Store)
- **Grid Layout:** Pinned to left rail at x = 304 px, expanding across available width up to `max-w-7xl` (1280 px).
- **Density:** 5–6 columns responsive (`repeat(auto-fill, minmax(15rem, 1fr))`).

```text
┌─────────────────┬─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Havefolio       │ [ 🔍 Search catalog (⌘K)...                            ]                                  [Theme Toggle]│
├─────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                 │                                                                                                         │
│ ⌂ Home          │ My Store                                                  [ Density: Normal ▼]  [ + Add item in Store ] │
│                 │ 42 possessions cataloged across 6 rooms.                                                                │
│ ◫ My Store      │                                                                                                         │
│                 │ [ All (42) ] [ Kitchen (14) ] [ Electronics (12) ] [ Wardrobe (8) ] [ Tools (5) ] [ Books (3) ]       │
│ ♡ Wants         │ ─────────────────────────────────────────────────────────────────────────────────────────────────────── │
│                 │                                                                                                         │
│ ∿ Insights      │ ┌──────────────┐┌──────────────┐┌──────────────┐┌──────────────┐┌──────────────┐┌──────────────┐         │
│                 │ │ [Photo]      ││ [Photo]      ││ [Photo]      ││ [Photo]      ││ [Photo]      ││ [Photo]      │         │
│ ◎ Goals         │ │ Kettle       ││ Chef Knife   ││ Skillet      ││ Blender      ││ Toaster      ││ Coffee Maker │         │
│                 │ │ ₹2,499       ││ ₹1,850       ││ ₹3,200       ││ ₹4,500       ││ ₹1,299       ││ ₹8,990       │         │
│ 🏷 Categories    │ └──────────────┘└──────────────┘└──────────────┘└──────────────┘└──────────────┘└──────────────┘         │
│                 │ ┌──────────────┐┌──────────────┐┌──────────────┐┌──────────────┐┌──────────────┐┌──────────────┐         │
│ ⚙ Settings      │ │ [Photo]      ││ [Photo]      ││ [Photo]      ││ [Photo]      ││ [Photo]      ││ [Photo]      │         │
│                 │ │ Headphones   ││ Mechanical KB││ Monitor 27"  ││ Mouse        ││ USB-C Hub    ││ Desk Mat     │         │
│                 │ │ ₹14,990      ││ ₹7,499       ││ ₹28,500      ││ ₹3,199       ││ ₹4,200       ││ ₹999         │         │
│                 │ └──────────────┘└──────────────┘└──────────────┘└──────────────┘└──────────────┘└──────────────┘         │
└─────────────────┴─────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### C. Desktop Two-Column Item Details View
- **Left Column (60%):** Core specifications, acquisition, condition, usage, private notes.
- **Right Column (40%):** Media gallery, receipt attachments, lifecycle actions (Sold, Donated, Disposed, Refunded).

```text
┌─────────────────┬─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Havefolio       │ [ 🔍 Search...                                         ]                                  [Theme Toggle]│
├─────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                 │                                                                                                         │
│ ⌂ Home          │ < Back to My Store                                                                                      │
│                 │                                                                                                         │
│ ◫ My Store      │ Milton Thermosteel Flask 1000ml                           [ Edit details ]  [ Lifecycle status: Owned ▼]│
│                 │ Added on 15 March 2024 • ₹899 paid • Kitchen                                                            │
│ ♡ Wants         │                                                                                                         │
│                 │ ┌────────────────────────────────────────┐ ┌──────────────────────────────────────────────────────────┐ │
│ ∿ Insights      │ │ Item Specifications                    │ │ Photos & Receipts (2)               [ + Add photo/doc ]│ │
│                 │ ├────────────────────────────────────────┤ ├──────────────────────────────────────────────────────────┤ │
│ ◎ Goals         │ │ Category:     Kitchen > Drinkware      │ │ ┌────────────────────────┐  ┌────────────────────────┐ │ │
│                 │ │ Merchant:     Amazon India             │ │ │ [ Primary Photo ]      │  │ [ Receipt Scan ]       │ │ │
│ 🏷 Categories    │ │ Acquisition:  Bought new               │ │ │ Flask on kitchen table │  │ Amazon tax invoice     │ │ │
│                 │ │ Condition:    Working well             │ │ └────────────────────────┘  └────────────────────────┘ │ │
│ ⚙ Settings      │ │ Frequency:    Often (daily use)        │ │                                                          │ │
│                 │ │ Brand:        Milton                   │ │ Decision & Refund History                                │ │
│                 │ │ Model:        Thermosteel Flip-Lid 1L  │ │ • 15 Mar 2024: Purchased for ₹899                        │ │
│                 │ ├────────────────────────────────────────┤ │ • No returns or refunds recorded                         │ │
│                 │ │ Private Notes                          │ └──────────────────────────────────────────────────────────┘ │
│                 │ │ Keeps water hot for ~18 hours. Bought  │                                                              │ │
│                 │ │ for winter office commute.             │                                                              │ │
│                 │ └────────────────────────────────────────┘                                                              │ │
└─────────────────┴─────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
