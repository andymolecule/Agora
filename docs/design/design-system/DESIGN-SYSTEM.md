# Design System Specification: The Digital Curator
## 1. Overview & Creative North Star
The "Creative North Star" for this design system is **The Digital Curator**.
In a world of cluttered, "templated" e-commerce, this system rejects the industrial grid in favor of an editorial, gallery-like experience. We are not building a warehouse; we are designing a high-end boutique. The visual language balances the technical precision of **JetBrains Mono** with the expressive, humanistic geometry of **Space Grotesk**.
By leveraging intentional asymmetry, expansive negative space, and a "paper-on-glass" layering philosophy, we move away from standard UI patterns. The goal is a marketplace that feels curated, authoritative, and whisper-quiet—allowing the product photography to serve as the primary emotional driver.
---
## 2. Color Strategy & Tonal Depth
We utilize a sophisticated palette of architectural greys and "parchment" neutrals to create a sense of timelessness.
### The "No-Line" Rule
**Strict Mandate:** Designers are prohibited from using 1px solid borders for sectioning or containment.
Structure is defined solely through background color shifts. A `surface-container-low` (`#f6f3ed`) section sitting on a `surface` (`#fcf9f3`) background provides all the containment necessary. If you feel the need to draw a line, instead increase the padding or shift the background tone.
### Surface Hierarchy & Nesting
Treat the UI as a physical stack of fine materials.
- **Base Layer:** `surface` (`#fcf9f3`)
- **Secondary Sections:** `surface-container-low` (`#f6f3ed`)
- **Interactive Cards:** `surface-container-lowest` (`#ffffff`)
- **Persistent Overlays:** `surface-container-high` (`#ebe8e2`)
### The "Glass & Gradient" Rule
To prevent the UI from feeling "flat" or "web-1.0," floating elements (Modals, Hover Menus, Navigation Bars) must utilize **Glassmorphism**.
- **Token:** `surface-container-lowest` at 80% opacity.
- **Effect:** `backdrop-blur: 12px`.
- **Accent:** Use a subtle linear gradient on main CTAs from `primary` (`#111519`) to `primary-container` (`#25292e`) at a 145-degree angle to add "soul" and depth.
---
## 3. Typography
The typography is a dialogue between technical utility and editorial flair.
| Level | Token | Font Family | Size | Character |
| :--- | :--- | :--- | :--- | :--- |
| **Display** | `display-lg` | Space Grotesk | 3.5rem | Tight tracking (-2%), Bold |
| **Headline** | `headline-md` | Space Grotesk | 1.75rem | Used for product categories |
| **Title** | `title-md` | Inter | 1.125rem | High readability for names |
| **Code/Label** | `label-md` | JetBrains Mono | 0.75rem | Mono for prices/SKUs |
| **Body** | `body-md` | Inter | 0.875rem | Optimised for descriptions |
**Editorial Note:** Use `JetBrains Mono` for all price points and technical metadata (e.g., "Weight: 1.2kg"). This creates a "spec-sheet" aesthetic that signals transparency and precision. Use `Space Grotesk` for storytelling and brand-heavy moments.
---
## 4. Elevation & Depth
Depth is achieved through **Tonal Layering** and ambient light, never through heavy drop shadows.
- **The Layering Principle:** To lift a product card, do not add a shadow. Instead, place a `surface-container-lowest` (`#ffffff`) card onto a `surface-container` (`#f0eee8`) background. This creates a "soft lift" that feels architectural.
- **Ambient Shadows:** For floating elements (e.g., Cart Drawer), use: `box-shadow: 0 20px 40px rgba(28, 28, 24, 0.06)`. The shadow color is a tint of `on-surface`, not pure black.
- **The Ghost Border:** If accessibility requires a container edge (e.g., in high-glare environments), use `outline-variant` (`#c5c6cb`) at **15% opacity**. It should be felt, not seen.
---
## 5. Components
### Buttons
- **Primary:** Gradient fill (`primary` to `primary-container`). `0.25rem` (DEFAULT) radius. White text. No border.
- **Secondary:** `surface-container-highest` background. Dark text.
- **Tertiary:** Text-only, using `JetBrains Mono` with a 1px underline of `primary` spaced 4px from the baseline.
### Cards & Product Listings
- **Rule:** **No Divider Lines.**
- Separate the image from the product details using a `spacing-6` (1.5rem) gap.
- Product images should have a `0.375rem` (md) corner radius to feel "finished" but not "bubbly."
### Input Fields
- **State:** Resting inputs use `surface-container-low` background.
- **Focus:** Shift background to `surface-container-lowest` and add a "Ghost Border" of 20% `outline`.
- **Typography:** Labels must use `label-md` (`Space Grotesk`) for a professional, structured feel.
### Chips (Filters)
- Selection chips should be pill-shaped (`rounded-full`).
- **Active State:** `primary` background with `on-primary` text.
- **Inactive State:** `surface-container-high` background with no border.
### Editorial Product Grid (Unique Component)
Instead of a standard 4x4 grid, use an **Asymmetric Mosaic**.
- Every 3rd item in a list should span 2 columns and 2 rows, featuring a high-quality "Lifestyle" crop of the product. This breaks the monotony of the scroll and encourages discovery.
---
## 6. Do's and Don'ts
### Do
- **DO** use the `spacing-20` (5rem) token for section margins to allow the design to "breathe."
- **DO** use monochromatic imagery where possible to maintain the sophisticated color palette.
- **DO** align all Mono-spaced text to the top-left of its container to emphasize the technical "ledger" look.
### Don't
- **DON'T** use 100% opaque black for borders or shadows.
- **DON'T** use standard "Blue" for links. Use `primary` with a font-weight increase or a subtle underline.
- **DON'T** crowd the "Buy" button. It should always have at least `spacing-8` of clearance from other interactive elements.
- **DON'T** use traditional dividers (`
`). Use a background color shift or `1px` height of `surface-variant` if absolutely necessary for data tables.
---
## 7. Interaction Patterns
- **Hover States:** When hovering over a product card, the background should shift from `surface-container-low` to `surface-container-lowest`.
- **Micro-animations:** Elements should "slide" into place with a 300ms `cubic-bezier(0.16, 1, 0.3, 1)` (Ease Out Expo) transition. Avoid "bouncy" animations; keep it smooth and weighted.
