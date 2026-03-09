# Agora Frontend Design Skill

Use this skill when building or modifying any frontend component in `apps/web`.

## Visual Reference

See @docs/design/design-system/DESIGN-SYSTEM.md for the full colour palette, font stack, and semantic token names.

## Key Choices

- **Palette:** Warm Neutral — a light beige base (`#f4f4f0`) with black text, warm grey borders, and white card surfaces. The UI is typographic and restrained; colour is used sparingly for status and accents.
- **Primary accent:** Black (`#000`) for CTAs and active states. Status colours (green/amber/red) for state feedback.
- **Fonts:** Space Grotesk (headings/display), Inter (body), JetBrains Mono (numeric/crypto data, addresses, scores).
- **Styling:** Tailwind CSS 4 classes + semantic utility classes (`.bg-surface-default`, `.text-primary`, etc.) bridging CSS custom properties defined in `globals.css`.
- **Hover/focus:** CSS-only via `.card-hover`, `.input-focus`, `.btn-primary`, Tailwind `hover:` / `focus:` utilities. Avoid JS `onMouseEnter`/`onMouseLeave` for styling.
- **Animation:** Keep Framer Motion (`motion/react`) to hero entrances and meaningful status feedback. Use CSS transitions for hover/focus states.
- **Icons:** Lucide React.
- **Themes:** Light (default), Dark. Theme set in `<head>` blocking script from `localStorage`.

## Light Theme Tokens (`:root`)

| Token | Value | Notes |
|-------|-------|-------|
| `--surface-base` | `#f4f4f0` | Warm beige page background |
| `--surface-default` | `#FFFFFF` | Card/panel backgrounds |
| `--surface-elevated` | `#FFFFFF` | Elevated cards |
| `--text-primary` | `#000` | Headings, labels |
| `--text-secondary` | `grey-500` (`#464B52`) | Body text |
| `--text-tertiary` | `grey-400` (`#646872`) | Captions, metadata |
| `--text-muted` | `grey-300` (`#A0A5B9`) | Placeholder, disabled |
| `--border-default` | `grey-200` (`#C5C7D9`) | Standard borders |
| `--border-subtle` | `grey-100` (`#F4F6F7`) | Light dividers |

## Buttons

- **Primary CTA:** Black background (`#000`), white text, 1px black border. Hover lifts with `translateY(-2px)`.
- **Secondary:** Transparent background, black text, 2px black border. Hover inverts to black bg / white text.
- **Disabled:** `#d4d4d8` background, `#71717a` text.
- **Border radius:** `4px` (subtle, not rounded).

## Implementation

- Framework: Next.js 14 (app router), SSR enabled
- `ClientLayout` wraps children in `WebProviders` (wagmi/RainbowKit, client-only)
- Status styles shared via `lib/status-styles.ts`
- Desktop-first, responsive with mobile hamburger menu at `md` breakpoint
