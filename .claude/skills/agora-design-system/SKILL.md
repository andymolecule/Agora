---
name: agora-design-system
description: "Agora frontend design system and component guidelines. Use when building or modifying any frontend component in apps/web, styling UI, or reviewing frontend code for design consistency."
allowed-tools: Read, Grep, Glob
---

# Design System: The Digital Curator

## Creative North Star

Editorial, gallery-like experience. Not a warehouse — a high-end boutique. Visual language balances the technical precision of **JetBrains Mono** with the expressive geometry of **Space Grotesk**. Intentional asymmetry, expansive negative space, "paper-on-glass" layering. The marketplace should feel curated, authoritative, and whisper-quiet.

---

## Color Strategy & Tonal Depth

Sophisticated palette of architectural greys and "parchment" neutrals.

### The "No-Line" Rule

**Strict Mandate:** No 1px solid borders for sectioning or containment. Structure is defined solely through background color shifts. A `surface-container-low` (`#f6f3ed`) section on a `surface` (`#fcf9f3`) background provides all containment. If you feel the need to draw a line, increase padding or shift the background tone instead.

### Surface Hierarchy

| Layer | Stitch Token | Hex | CSS Property | Tailwind |
|---|---|---|---|---|
| Base | `surface` | `#fcf9f3` | `--surface-base` | `bg-surface-base` |
| Secondary sections | `surface-container-low` | `#f6f3ed` | `--surface-inset` | `bg-surface-inset` |
| Interactive cards | `surface-container-lowest` | `#ffffff` | `--surface-default` | `bg-surface-default` |
| Elevated cards | `surface-container-lowest` | `#ffffff` | `--surface-elevated` | `bg-surface-elevated` |
| Persistent overlays | `surface-container-high` | `#ebe8e2` | — | `bg-warm-200` |

### Glass & Gradient Rule

Floating elements (Modals, Hover Menus, Navigation Bars) must use **Glassmorphism**:
- `surface-container-lowest` at 80% opacity (`--glass-bg`)
- `backdrop-blur: 12px` (codebase uses 16px via `.glass-panel`)
- Main CTAs: subtle linear gradient from `primary` (`#111519`) to `primary-container` (`#25292e`) at 145 degrees

---

## Typography

| Level | Stitch Token | Font | Size | Tailwind Class | Character |
|---|---|---|---|---|---|
| Display | `display-lg` | Space Grotesk | 3.5rem | `font-display` | Tight tracking (-2%), Bold |
| Headline | `headline-md` | Space Grotesk | 1.75rem | `font-display` | Categories, brand moments |
| Title | `title-md` | Inter | 1.125rem | `font-sans` | High readability for names |
| Code/Label | `label-md` | JetBrains Mono | 0.75rem | `font-mono` | Prices, scores, technical metadata |
| Body | `body-md` | Inter | 0.875rem | `font-sans` | Descriptions |

**Rules:**
- Use `JetBrains Mono` for all price points and technical metadata (e.g., "Weight: 1.2kg") — "spec-sheet" aesthetic.
- Use `Space Grotesk` for headings and brand-heavy storytelling moments only.
- **Never** use Space Grotesk for cards, tabs, labels, buttons, or tables.

---

## Elevation & Depth

Depth via **Tonal Layering** and ambient light, never heavy drop shadows.

- **Layering Principle:** Lift a card by placing `surface-container-lowest` (#ffffff) on `surface-container` (#f0eee8). No shadow needed.
- **Ambient Shadows:** Floating elements only: `box-shadow: 0 20px 40px rgba(28, 28, 24, 0.06)`. Shadow color is tinted `on-surface`, never pure black.
- **Ghost Border:** If accessibility requires a container edge, use `outline-variant` (`#c5c6cb`) at **15% opacity**. Felt, not seen.

---

## Components

### Buttons
- **Primary:** Gradient fill (`primary` → `primary-container`). `0.25rem` radius. White text. No border.
- **Secondary:** `surface-container-highest` background. Dark text.
- **Tertiary:** Text-only, `JetBrains Mono` with 1px underline of `primary` spaced 4px from baseline.

### Cards
- **No Divider Lines.** Separate image from details using `spacing-6` (1.5rem) gap.
- Images: `0.375rem` corner radius — "finished" but not "bubbly."

### Input Fields
- Resting: `surface-container-low` background.
- Focus: shift to `surface-container-lowest` + Ghost Border at 20% `outline`.
- Labels: `label-md` (JetBrains Mono).

### Chips (Filters)
- Pill-shaped (`rounded-full`).
- Active: `primary` background, `on-primary` text.
- Inactive: `surface-container-high` background, no border.

### Editorial Grid
Asymmetric Mosaic — every 3rd item spans 2 columns and 2 rows for discovery-driven layouts.

---

## Do's and Don'ts

- **DO** use `spacing-20` (5rem) for section margins.
- **DO** align mono-spaced text top-left ("ledger" look).
- **DON'T** use 100% opaque black for borders or shadows.
- **DON'T** use standard "Blue" for links — use `primary` with weight increase or subtle underline.
- **DON'T** crowd CTAs — at least `spacing-8` clearance from other interactive elements.
- **DON'T** use `<hr>` dividers — use background color shifts.

---

## Interaction Patterns

- **Hover:** Card background shifts from `surface-container-low` → `surface-container-lowest`.
- **Micro-animations:** 300ms `cubic-bezier(0.16, 1, 0.3, 1)` (Ease Out Expo). Smooth and weighted, never bouncy.

---

## Implementation

- Next.js 14 (app router), SSR enabled
- `ClientLayout` wraps children in `WebProviders` (wagmi/RainbowKit, client-only)
- Tailwind CSS 4 + CSS custom properties (no separate tailwind.config — uses `@theme` in globals.css)
- Animation: `motion/react` (Framer Motion) for hero entrances only; CSS transitions for hover/focus
- Icons: Lucide React
- Desktop-first, responsive at `md` breakpoint
- Themes: Light (default), Dark — all semantic tokens swap via CSS custom properties in globals.css
- Status styles shared via `lib/status-styles.ts`

## Gotchas

1. **No raw hex in shadows.** `shadow-[4px_4px_0px_#16a34a]` breaks theme switching. Use CSS vars: `shadow-[4px_4px_0px_var(--color-emerald-600)]`.
2. **No `role="radio"` on `<button>`.** Biome rejects it. Use `aria-pressed` instead.
3. **No `#000` anywhere.** Use `warm-900` (`#1E1B18`) for near-black — text, borders, shadows, backgrounds.
4. **Select-type inputs use predefined options**, not free-form. Deadline, distribution, dispute window use curated lists from `guided-prompts.ts`.
5. **Nav closing tags.** Changing `<div>` to `<nav>` requires updating both tags. Mismatched tags cause silent hydration errors.
6. **Biome-ignore comments are positional.** Move or remove them when refactoring the targeted line.
7. **Compute deadlines at publish time, not draft time.** Use `computeDeadlineIso()` from `lib/post-submission-window.ts`.
