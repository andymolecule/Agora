# Agora Visual Identity

**Platform:** Agora · **Themes:** Light (default), Dark

> A soft reference guide to the Agora visual identity used across the product. Use this for quick colour lookups and font choices — not as a rulebook.

---

## Colour Palette

The palette is warm-neutral: a light beige page background with black typography and restrained use of colour for status and feedback only.

### Core Neutrals (Warm)

| Token | Hex | Typical Use |
|-------|-----|-------------|
| Surface base | `#f4f4f0` | **Page background** (warm beige) |
| Surface default | `#FFFFFF` | Cards, panels, overlays |
| Surface elevated | `#FFFFFF` | Elevated cards |
| Surface inset | `#F4F6FC` | Inset wells, code blocks |

### Grey Scale (A-range)

| Token | Hex | Typical Use |
|-------|-----|-------------|
| `grey-100` | `#F4F6F7` | Subtle borders, dividers |
| `grey-200` | `#C5C7D9` | Default borders, disabled text |
| `grey-300` | `#A0A5B9` | Muted / placeholder text |
| `grey-400` | `#646872` | Tertiary text, captions |
| `grey-500` | `#464B52` | Secondary body text |
| `grey-600` | `#1C2A3E` | Headings (dark) |
| `grey-700–1000` | `#162731`–`#050B0D` | Dark surfaces |

### Primary Accent

| Colour | Hex | Usage |
|--------|-----|-------|
| **Black** | `#000000` | CTAs, primary buttons, headings, active states |
| **White** | `#FFFFFF` | Button text on black, card surfaces |

### Status Colours

| State | Text | Background |
|-------|------|------------|
| Success | `#16A34A` | `#F0FDF4` |
| Warning | `#D97706` | `#FFFBEB` |
| Error | `#DC2626` | `#FEF2F2` |

### Reserved Blue/Cobalt Tokens (Dark Mode)

The following tokens are defined in `@theme` and used primarily for dark mode surfaces and a few accent details. They are **not** part of the light theme identity.

| Range | Example | Light Mode Use |
|-------|---------|----------------|
| Blues (`blue-100`–`blue-1100`) | `#F4F6FC`–`#0D0F20` | `--surface-inset`, `--border-focus` only |
| Cobalts (`cobalt-100`–`cobalt-1000`) | `#E0F3FF`–`#012B31` | `--border-accent` only (hover states) |

---

## Typography

| Role | Font | Fallback | When |
|------|------|----------|------|
| **Display** | Space Grotesk | system-ui, sans-serif | Headings, hero text |
| **Body** | Inter | system-ui, sans-serif | All UI text |
| **Data** | JetBrains Mono | monospace | Addresses, USDC, scores, hashes |

Use `font-variant-numeric: tabular-nums` on all numeric data.

---

## Buttons

| Variant | Background | Text | Border | Hover |
|---------|-----------|------|--------|-------|
| Primary | `#000` | `#FFF` | 1px `#000` | `#18181b`, lift -2px |
| Secondary | transparent | `#000` | 2px `#000` | Invert: `#000` bg, `#FFF` text |
| Disabled | `#d4d4d8` | `#71717a` | `#d4d4d8` | none |

Border radius: `4px`. Height: `36px`. Font weight: 600.

---

## Semantic CSS Tokens

These custom properties are defined in `globals.css` and swap automatically between light/dark themes.

### Surfaces
```
--surface-base       Page background (#f4f4f0 light, blue-1100 dark)
--surface-default    Card / panel backgrounds
--surface-elevated   Elevated cards
--surface-inset      Inset wells, code blocks
```

### Text
```
--text-primary       Headings, labels (#000 light)
--text-secondary     Body text (grey-500)
--text-tertiary      Captions, metadata (grey-400)
--text-muted         Placeholder, disabled (grey-300)
--text-accent        Active items (#000)
```

### Borders
```
--border-default     Standard borders (grey-200)
--border-subtle      Light dividers (grey-100)
--border-strong      Emphasis borders (grey-300)
```

### Glass (Header / Overlays)
```
--glass-bg           Semi-transparent background
--glass-border       Frosted border
```

---

## Quick Reference: Utility Classes

Defined in `globals.css` to bridge CSS custom properties with class-based styling:

```
.bg-surface-default   .text-primary     .border-border-default
.bg-surface-inset     .text-secondary   .border-border-subtle
.bg-surface-elevated  .text-tertiary    .border-border-strong
                      .text-muted
                      .text-accent

.card-hover           Lift + shadow + accent border on hover
.input-focus          Focus ring
.btn-primary          Black CTA button
.row-hover            Table row highlight
```

---

*Agora Visual Identity · Last updated March 2026*
