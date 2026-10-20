# Spacing: golden-ratio (Fibonacci) scale

Default spacing scale for all padding, margin, and gap values, unless the brief or incumbent codebase specifies a different system. Companion to [typography-pretendard.md](typography-pretendard.md) — same φ logic, applied to layout instead of type.

## The scale

Fibonacci numbers are the practical way to apply the golden ratio to spacing: each step is the sum of the previous two, and the ratio between consecutive steps converges to φ (1.618) as the sequence grows — cleaner increments than raw `4 × φⁿ` powers, which round to awkward decimals.

| Token | Value | Typical use |
|---|---|---|
| `space-3xs` | 2px | hairline gaps (icon-to-text in a tight badge) |
| `space-2xs` | 3px | tightest grouping — e.g. a title sitting directly above its own caption |
| `space-xs` | 5px | small internal gaps (icon-to-label in a button) |
| `space-sm` | 8px | compact padding (dense table cell, chip) |
| `space-md` | 13px | standard component padding (button, input, card interior) |
| `space-lg` | 21px | gap between a label/caption group and the component it describes |
| `space-xl` | 34px | generous internal padding (wide button, hero card) |
| `space-2xl` | 55px | page-level padding, section interior spacing |
| `space-3xl` | 89px | gap between unrelated sections/blocks on a page |

## Rules

1. **Every padding, margin, and gap value must be a token from this table.** No arithmetic on tokens (`space-xl * 1.6`, `space-sm + 2px`, `space-xl - space-xs`) — if nothing on the scale fits, that's a signal to pick the nearest token and adjust the layout around it, not to invent an off-scale value. Off-scale numbers are exactly the kind of quiet drift that makes a UI feel unordered even when every individual value "looks fine" in isolation.
2. **Distance encodes relationship (Gestalt proximity).** Elements that belong together sit at a smaller step than elements that don't. A title and its own caption: `space-2xs`–`space-xs`. A caption and the component it describes: `space-lg`. Two independent, unrelated sections on the same page: `space-2xl`–`space-3xl`. If two things are visually the same distance apart as two unrelated things, the hierarchy reads as flat regardless of color or type.
3. **The same role gets the same token everywhere on a surface.** If a component's internal padding is `space-md` vertical / `space-lg` horizontal in one place, an equivalent sibling component (e.g. a variant of the same UI shown for comparison) uses the identical pair — not a nearby-but-different value. This is what makes side-by-side variants read as one system with different parameters, rather than two unrelated builds.
4. **Dashboards (Operate mode) skew toward the smaller half of the scale** (`3xs`–`lg`) to keep information density high; marketing/editorial surfaces (Persuade/Read) can reach further up (`xl`–`3xl`) for breathing room. Pick the register once per surface and stay in it — don't mix a dense dashboard's internals with editorial-scale page padding.
5. **Proportion is a preference, not license to truncate real content — the same principle as the type-size legibility floor.** When a ratio-derived width (or any computed size) would clip, ellipsis, or otherwise mangle actual content, that's the signal to add a `min-width`/`min-height` content floor and let the ratio apply only above it — not to ship the truncation because the math was followed correctly. Check ratio-driven layouts against their longest realistic content string before calling them done.
