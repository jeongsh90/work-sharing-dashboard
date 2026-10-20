# Typography: Pretendard + Golden Ratio Scale

Default typeface and type-scale rules for all UI work under this skill. Applies whenever no brief, existing design system, or incumbent codebase specifies a different typeface or scale.

## Font stack

```css
--font-sans:
  'Pretendard Variable',
  Pretendard,
  -apple-system,
  BlinkMacSystemFont,
  system-ui,
  Roboto,
  'Helvetica Neue',
  'Segoe UI',
  'Apple SD Gothic Neo',
  'Noto Sans KR',
  'Malgun Gothic',
  sans-serif;
```

Load Pretendard Variable (preferred, single variable-weight file) via CDN or self-hosted `.woff2`:

```html
<link rel="stylesheet" as="style" crossorigin
  href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css" />
```

Or npm: `pnpm add pretendard` and `@import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';`

## Legibility floor — the ratio is inspiration, not a hard rule below it

Pure `base / φⁿ` math pushes small steps below any practical minimum (14/φ ≈ 8.65px). Don't ship that. Hangul has denser, more complex strokes than Latin letterforms at the same point size, so Pretendard needs a higher minimum than a Latin-only system would: **never set Pretendard UI text below 12px**, full stop — clamp any scale step that would otherwise compute smaller, rather than rounding it down. This applies to both tables below; their `xs` steps are already clamped to 12px (their raw ratio math would give ~10px and ~9px respectively).

## Contrast floor

Every text color must hit **4.5:1 contrast against its background** (WCAG AA for normal text), regardless of how muted/decorative it's meant to look. Before shipping a muted/secondary/caption color, check it — don't pick a gray or a white-with-opacity value by eye and assume it reads as "subtle." Two failure patterns to check for explicitly:
- **Muted text on a light surface**: a warm/cool gray that looks fine in isolation often lands around 2.5–3:1 on a light card — too low. Darken until it clears 4.5:1, then treat that as the token, not the original eyeballed value.
- **White-with-opacity on a dark surface**: `rgba(255,255,255,0.4)` reads as "subtle" in a design tool but is roughly 3.4:1 against a near-black panel — below the floor. Something around 0.6+ opacity is typically needed against a `#1a1a1e`-range background; verify per the specific background color rather than reusing the same opacity value across different dark tones.

## Golden ratio type scale (φ = 1.618)

Base size 16px. Font-size steps use φ; line-height and letter-spacing move inversely — larger text gets tighter leading and tighter (more negative) tracking, smaller text gets looser leading and looser (more positive) tracking, so the whole scale reads as one continuous proportional system rather than arbitrary jumps.

| Token | Font size | Line height (unitless) | Letter spacing | Typical use |
|---|---|---|---|---|
| `text-xs` | 12px (floor — raw ratio gives ~10px) | 1.75 | +0.015em | caption, meta, badges |
| `text-sm` | 13px (16 / √φ) | 1.75 | +0.01em | secondary text, labels |
| `text-base` | 16px | 1.618 (φ) | 0em | body copy (default) |
| `text-lg` | 20px (16 × √φ) | 1.5 | -0.005em | lead paragraph, subheading |
| `text-xl` | 26px (16 × φ) | 1.272 (√φ) | -0.01em | h4/h3 |
| `text-2xl` | 33px (16 × φ × √φ) | 1.176 | -0.015em | h2 |
| `text-3xl` | 42px (16 × φ²) | 1.1 | -0.02em | h1 |
| `text-4xl` | 68px (16 × φ³) | 1.0 | -0.025em | display / hero |

Notes:
- Full φ (1.618) steps between the major stops (`base → xl → 3xl → 4xl`) keep the hierarchy dramatic; the intermediate half-steps (`xs`, `sm`, `lg`, `2xl`) use √φ (≈1.272) for finer control at UI-component scale, so body-adjacent sizes (labels, badges, lead text) don't jump too aggressively.
- These are proportional design heuristics, not a physical law — treat the table as a starting scale to tune against real content and Pretendard's actual x-height, not a value to reproduce pixel-for-pixel in every context.
- For Korean text set in Pretendard, keep tracking closer to 0 or slightly positive at small sizes; Hangul doesn't benefit from tight negative tracking the way Latin display type does. The negative values above apply mainly to Latin/numeral-heavy headings.

## Base size depends on surface mode — not always 16px

The 16px-based scale above is the default for content-forward surfaces: **Persuade** (landing pages, marketing), **Read** (docs, articles), **Experience** (portfolios, showcases) — see impeccable's Mode system in the main SKILL.md.

**Operate mode (dashboards, admin UI, dense tools, data filters/tables) uses a 14px base instead.** Dense information surfaces read better at a tighter base; this is the PC/desktop convention for dashboard chrome, not a stylistic choice. Same golden-ratio proportions, scaled by 14/16 = 0.875:

| Token | Font size | Line height | Letter spacing | Typical use |
|---|---|---|---|---|
| `text-xs` | 12px (floor — raw ratio gives ~9px) | 1.75 | +0.015em | field labels, micro captions |
| `text-sm` | 13px | 1.75 | +0.01em | secondary text, helper copy, section descriptions |
| `text-base` | 14px | 1.618 | 0em | body copy, filter values, table cells (default) |
| `text-lg` | 18px | 1.5 | -0.005em | card titles, section headers |
| `text-xl` | 23px | 1.272 | -0.01em | panel/page titles |
| `text-2xl` | 29px | 1.176 | -0.015em | dashboard h2 |
| `text-3xl` | 37px | 1.1 | -0.02em | dashboard h1 (rare — most dashboards don't need one) |

Before setting any font-size in a component, first decide the mode of the surface it lives on (per SKILL.md's Modes section), then pull sizes from the matching table — 16px-base for Persuade/Read/Experience, 14px-base for Operate. Mixing bases within one surface (e.g. a dashboard filter bar using the 16px table) is the most common way this system quietly breaks.

## Single-line UI controls: line-height: 1

The scale above is for text that can wrap (body copy, paragraphs, headings). It does not apply to single-line UI controls, where vertical centering — not reading rhythm — determines the line-height. For any element whose text is always exactly one line, set `line-height: 1` regardless of its font-size step, so the text box height matches the cap-height/descender box instead of carrying leftover leading that pushes it off-center inside the control:

- Buttons (all variants/sizes)
- Inputs, textareas (the placeholder/value line itself; a multi-row textarea still uses `line-height: 1` per line)
- Select triggers, badges, chips, tags, tabs, pills
- Table cell content, list item labels
- Any label/value pair rendered as a single line (form labels, stat values, menu items)

Vertical centering inside these controls should then come from flex/grid centering (`display: flex; align-items: center`) or matching `height`/`padding`, not from inflated line-height. In Tailwind/shadcn/ui terms: `leading-none` (maps to `line-height: 1`) on the text, with the component's own padding/flex layout handling the box.

## Wiring into Tailwind / shadcn/ui

Add the scale to `tailwind.config` (or the CSS-first `@theme` block on Tailwind v4) so shadcn/ui components inherit it automatically instead of hardcoding sizes per component:

```css
@theme {
  --font-sans: 'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont,
    system-ui, Roboto, 'Helvetica Neue', 'Segoe UI', 'Apple SD Gothic Neo',
    'Noto Sans KR', 'Malgun Gothic', sans-serif;

  --text-xs: 0.625rem;   --text-xs--line-height: 1.902; --text-xs--letter-spacing: 0.02em;
  --text-sm: 0.8125rem;  --text-sm--line-height: 1.75;  --text-sm--letter-spacing: 0.01em;
  --text-base: 1rem;     --text-base--line-height: 1.618; --text-base--letter-spacing: 0em;
  --text-lg: 1.25rem;    --text-lg--line-height: 1.5;   --text-lg--letter-spacing: -0.005em;
  --text-xl: 1.625rem;   --text-xl--line-height: 1.272; --text-xl--letter-spacing: -0.01em;
  --text-2xl: 2.0625rem; --text-2xl--line-height: 1.176; --text-2xl--letter-spacing: -0.015em;
  --text-3xl: 2.625rem;  --text-3xl--line-height: 1.1;  --text-3xl--letter-spacing: -0.02em;
  --text-4xl: 4.25rem;   --text-4xl--line-height: 1.0;  --text-4xl--letter-spacing: -0.025em;
}
```

With this in place, shadcn/ui's default `text-sm` / `text-base` / etc. utility classes (used throughout `Button`, `Card`, `Input`, form labels, etc. per [rules/styling.md](shadcn-ui/rules/styling.md)) automatically pick up Pretendard and the golden-ratio scale — no per-component overrides needed. Only deviate from the scale when a specific component's information density genuinely requires it, and note the deviation rather than silently drifting from the system.
