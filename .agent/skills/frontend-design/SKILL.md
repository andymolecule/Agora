# Agora Frontend Design Skill

Use this skill when building or modifying any frontend component in `apps/web`.

## Visual Reference

See @docs/design/design-system/DESIGN-SYSTEM.md for full specs.

## Design Direction

Warm editorial product UI — calm, premium, intentional. Beige base with muted ink blue accent. Typography-forward. Restrained colour usage.

## Core Rules

| Area | Rule |
|------|------|
| **Palette** | Warm Neutral (`warm-50`–`warm-900`) + Ink Blue accent (`accent-500: #2F4F7F`) |
| **No raw black** | Use `warm-900` (`#1E1B18`) for CTAs, headings. Never `#000` in new code. |
| **Fonts** | Space Grotesk (headings only), Inter (everything else), JetBrains Mono (data) |
| **Radius** | Buttons/inputs: `--radius-md` (8px). Cards: `--radius-lg` (12px). Panels: `--radius-xl` (16px). |
| **Height** | Buttons: 40px. Inputs: 40–44px. |
| **Shadows** | Cards: border only → `--shadow-md` on hover. Modals: `--shadow-lg`. |
| **Spacing** | Use `--space-*` tokens (4/8/12/16/24/32/48/64). Card padding: 20–24px. Section gaps: 32–48px. |
| **Motion** | CSS transitions for hover/focus. Framer Motion for hero entrances only. |
| **Icons** | Lucide React |
| **Themes** | Light (default), Dark. All semantic tokens swap via CSS custom properties. |

## Typography Hierarchy

- **H1–H3:** Space Grotesk, 600 weight, negative tracking
- **H4:** Inter, 600 weight
- **Body:** Inter, 400 weight, 14–16px
- **Label:** Inter, 500 weight, 13px
- **Mono:** JetBrains Mono, 500 weight, 13px

Do NOT use Space Grotesk for cards, tabs, labels, buttons, or tables.

## Implementation

- Next.js 14 (app router), SSR enabled
- `ClientLayout` wraps children in `WebProviders` (wagmi/RainbowKit, client-only)
- Status styles shared via `lib/status-styles.ts`
- Desktop-first, responsive at `md` breakpoint
