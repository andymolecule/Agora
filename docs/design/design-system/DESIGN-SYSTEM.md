# Agora Visual Identity

**Platform:** Agora · **Themes:** Light (default), Dark

> Colour, type, spacing, and component reference for the Agora product.

---

## Colour Palette

Warm-neutral base with Ink Blue accent. Colour is used sparingly — mostly neutral with accent only where it matters.

### Warm Neutrals

| Token | Hex | Use |
|-------|-----|-----|
| `warm-50` | `#FBFAF7` | Inset wells, lightest tint |
| `warm-100` | `#F5F3EE` | **Page background** |
| `warm-200` | `#E8E3DA` | Subtle borders, dividers |
| `warm-300` | `#D8D1C5` | Default borders |
| `warm-400` | `#B7B0A4` | Muted / placeholder text |
| `warm-500` | `#8F887D` | Tertiary text |
| `warm-600` | `#6D675E` | Secondary text |
| `warm-700` | `#4F4A43` | Primary body text |
| `warm-800` | `#2F2B27` | Headings, hover states |
| `warm-900` | `#1E1B18` | **Primary CTA / near-black** |

### Ink Blue Accent

| Token | Hex | Use |
|-------|-----|-----|
| `accent-50` | `#EEF3FA` | Soft accent background |
| `accent-500` | `#2F4F7F` | **Primary accent** — links, focus, active |
| `accent-600` | `#243F67` | Hover accent |
| `accent-400` | `#5B82B5` | Dark mode accent |

### Status

| State | Text | Background |
|-------|------|------------|
| Success | `#16A34A` | `#F0FDF4` |
| Warning | `#D97706` | `#FFFBEB` |
| Error | `#DC2626` | `#FEF2F2` |

---

## Typography Scale

| Role | Font | Size/Line-height | Weight | Tracking |
|------|------|-------------------|--------|----------|
| H1 | Space Grotesk | 40/44 (2.5rem) | 600 | -0.02em |
| H2 | Space Grotesk | 30/36 (1.875rem) | 600 | -0.02em |
| H3 | Space Grotesk | 24/30 (1.5rem) | 600 | -0.01em |
| H4 | Inter | 18/26 (1.125rem) | 600 | — |
| Body L | Inter | 16/26 (1rem) | 400 | — |
| Body M | Inter | 15/24 (0.9375rem) | 400 | — |
| Body S | Inter | 14/22 (0.875rem) | 400 | — |
| Label | Inter | 13/18 (0.8125rem) | 500 | — |
| Mono | JetBrains Mono | 13/18 (0.8125rem) | 500 | — |

**Rules:** Space Grotesk for headings and stat highlights only. Let Inter do the heavy lifting. `font-variant-numeric: tabular-nums` on all numeric data.

---

## Spacing Scale

```
--space-1:  4px    tight inline gaps
--space-2:  8px    label-to-input, tight inline
--space-3:  12px   small gaps
--space-4:  16px   standard gaps
--space-6:  24px   card padding
--space-8:  32px   section gaps
--space-12: 48px   large section gaps
--space-16: 64px   page-level spacing
```

---

## Border Radius

| Token | Value | Use |
|-------|-------|-----|
| `--radius-sm` | `4px` | Tags, badges |
| `--radius-md` | `8px` | Buttons, inputs |
| `--radius-lg` | `12px` | Cards |
| `--radius-xl` | `16px` | Panels, dialogs |
| `--radius-full` | `999px` | Pills, avatars |

---

## Shadows & Elevation

| Token | Value | Use |
|-------|-------|-----|
| `--shadow-sm` | `0 1px 3px rgba(30,27,24,0.04)` | Button hover |
| `--shadow-md` | `0 2px 12px rgba(30,27,24,0.06)` | Card hover |
| `--shadow-lg` | `0 8px 30px rgba(30,27,24,0.10)` | Modal, dropdown |
| `--shadow-inner` | `inset 0 1px 3px rgba(30,27,24,0.05)` | Inset fields |

Cards default: border only, no shadow. Hover: `--shadow-md`.

---

## Buttons

| Variant | Background | Text | Border | Radius | Height |
|---------|-----------|------|--------|--------|--------|
| Primary | `warm-900` | `#FFF` | `warm-900` | 8px | 40px |
| Secondary | transparent | `warm-900` | 1.5px `warm-300` | 8px | 40px |
| Disabled | `warm-200` | `warm-500` | `warm-200` | 8px | 40px |

Hover: lift -1px + `--shadow-sm`. No raw `#000`.

---

## Semantic Tokens

### Surfaces
| Token | Light | Dark |
|-------|-------|------|
| `--surface-base` | `warm-100` | `blue-1100` |
| `--surface-default` | `#FFF` | `blue-1000` |
| `--surface-elevated` | `#FFF` | `blue-900` |
| `--surface-inset` | `warm-50` | `blue-800` |

### Text
| Token | Light | Dark |
|-------|-------|------|
| `--text-primary` | `warm-900` | `#F1F1F1` |
| `--text-secondary` | `warm-700` | `warm-300` |
| `--text-tertiary` | `warm-600` | `warm-400` |
| `--text-muted` | `warm-500` | `warm-500` |
| `--text-accent` | `accent-500` | `accent-200` |

### Borders
| Token | Light | Dark |
|-------|-------|------|
| `--border-default` | `warm-300` | `blue-700` |
| `--border-subtle` | `warm-200` | `blue-800` |
| `--border-strong` | `warm-500` | `blue-600` |
| `--border-focus` | `accent-500` | `accent-400` |

---

*Agora Visual Identity · Last updated March 2026*
