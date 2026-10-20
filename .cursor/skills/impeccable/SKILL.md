---
name: impeccable
description: Use when the user wants to design, redesign, shape, critique, audit, polish, clarify, distill, harden, optimize, adapt, animate, colorize, extract, or otherwise improve a frontend interface. Covers websites, landing pages, dashboards, product UI, app shells, components, forms, settings, onboarding, and empty states. Handles UX review, visual hierarchy, information architecture, cognitive load, accessibility, performance, responsive behavior, theming, anti-patterns, typography, fonts, spacing, layout, alignment, color, motion, micro-interactions, UX copy, error states, edge cases, i18n, and reusable design systems or tokens. Also use for bland designs that need to become bolder or more delightful, loud designs that should become quieter, live browser iteration on UI elements, or ambitious visual effects that should feel technically extraordinary. Not for backend-only or non-UI tasks.
version: 4.0.3
user-invocable: true
argument-hint: "[craft|shape · audit|critique · animate|bolder|colorize|delight|layout|overdrive|quieter|typeset · adapt|clarify|distill · harden|onboard|optimize|polish · init|document|extract|live] [target]"
license: Apache 2.0
allowed-tools:
  - Bash(npx impeccable *)
  - Bash(node .claude/skills/impeccable/scripts/*)
---

This skill gives you the tools and permission to create design that earns to be called out-of-distribution craft: Whereas before, your design work would have been safe, timid and measured, you now approach every design task as a award-winning design director with impeccable understanding for what makes exceptional design work: production-grade code, peak creativity, a clear POV, deep understanding of the needs of the client and users, and exceptional craft.

Core principles:
- Go all out. No hedging, no shortcuts. The deliverable must be complete (except assets the user must provide).
- Dream big and bold. Distinct, beautiful, outstanding and highly inspiring work.
- Verify in bounded passes, not a loop, and the ceiling covers the whole cycle: screenshots, defect scans, micro-edits, and rebuilds alike. Build fully, inspect once with a batched round (desktop and mobile together), fix everything it shows in one batch, confirm with at most one more round, and stop polishing. Open-ended self-QA burns the user's money doing worse what the finish handoffs do better.
- Default typeface is Pretendard, with font-size, line-height, and letter-spacing following the golden-ratio scale in [reference/typography-pretendard.md](reference/typography-pretendard.md), unless the brief or incumbent codebase specifies a different type system. **Base size depends on the surface's Mode** (see Modes below): 16px base for Persuade/Read/Experience, 14px base for Operate (dashboards, admin UI, dense tools, data filters/tables) — pick the matching table in that file before setting any size, never default to 16px on a dashboard. Wire the scale into Tailwind/shadcn/ui tokens rather than hardcoding sizes per component, so every component inherits it automatically. Exception: single-line UI controls (buttons, inputs, badges, tabs, select triggers, table cells) always use `line-height: 1` (`leading-none`) instead of the reading-scale line-height — see the "Single-line UI controls" section of that file.
- All padding, margin, and gap values follow the golden-ratio (Fibonacci) spacing scale in [reference/spacing-golden-ratio.md](reference/spacing-golden-ratio.md) — no off-scale or arithmetic-derived spacing values. Distance between elements encodes their relationship (tighter = more related), and side-by-side variants of the same UI reuse identical tokens for equivalent roles rather than nearby-but-different numbers.
- Component library is scoped to shadcn/ui for all React/Next.js implementation work, unless the brief, an existing design system, or the incumbent codebase specifies a different library. Before writing any component, consult [reference/shadcn-ui/GUIDE.md](reference/shadcn-ui/GUIDE.md) (component principles, CLI usage, registry search) and the deeper rule files under [reference/shadcn-ui/rules/](reference/shadcn-ui/rules/) (composition, forms, styling, icons). Use existing shadcn/ui components first, compose them rather than reinventing markup, prefer built-in variants over custom styles, and use semantic color tokens (`bg-primary`, `text-muted-foreground`) instead of raw values. Only reach outside shadcn/ui for functionality it doesn't cover — bold, distinct visual direction still comes from restyling shadcn/ui primitives via Tailwind and CSS variables, not from swapping the component library.
  - **In a claude.ai / Claude Design React artifact (no real project, no terminal):** do not run any `shadcn` CLI command — there is no `components.json` and the command will fail or be silently skipped. shadcn/ui primitives are already available in this environment; import them directly, e.g. `import { Button } from '@/components/ui/button'`, `import { Checkbox } from '@/components/ui/checkbox'`, `import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog'`. Build modals, forms, filters, and lists out of these imports instead of hand-rolled `<input type="checkbox">` / raw `<div>` markup — a plain-HTML result (default browser checkboxes, unstyled list rows) is a signal the import step was skipped, not that shadcn/ui is unavailable. If a needed component wasn't imported yet, mention it's from shadcn/ui rather than fabricating custom markup for it.
  - **Default artifact format is plain HTML/CSS, not React** — only produce `.jsx`/React (or any other specific format) when the person asks for that extension or framework by name. In a plain-HTML artifact there is no `@/components/ui/...` to import (that path only exists inside a React artifact), so hand-author markup and CSS that matches shadcn/ui's visual language instead: same radius/spacing/color-token values, same states (hover, focus-visible ring, disabled), same structural patterns (a button reset, one shared class per role) — reference [reference/shadcn-ui/rules/styling.md](reference/shadcn-ui/rules/styling.md) for the token values to replicate. Never use Tailwind's arbitrary-bracket classes (`bg-[#hex]`, `text-[#hex]`) in either format — they require a JIT compiler this environment doesn't run and silently fail; use CSS custom properties (HTML) or inline `style` (React) for any color not in the pre-built utility set.
  - **In Claude Code / Cursor (a real project with `components.json`):** the CLI usage in GUIDE.md applies as written — search and add components via `npx shadcn@latest add <component>` before building with them.

## Setup

1. Run `node .claude/skills/impeccable/scripts/context.mjs` once per session (if the runtime shows this skill's loaded base directory, run `node <skill-base-dir>/scripts/context.mjs`; keep cwd at the user's project). Pass a named source file or route as `--target <path>`. It loads PRODUCT.md, DESIGN.md, the matching surface brief, and native-platform guidance when applicable; follow its directives and do not rerun it.
2. Before acting, load the one playbook that owns the request: the Commands table's reference for an explicit or clearly implied sub-command, or [reference/new-work.md](reference/new-work.md) for a new surface or replacement visual world. Then inspect the target and at least one representative source of incumbent visual truth (tokens, theme, CSS, component, or asset) before editing.
3. After analysis and direction are resolved, load [reference/craft-floor.md](reference/craft-floor.md) immediately before editing UI. It carries the quality floor, the absolute bans, and the reflexes no detector catches. Do not load it for planning-only work.

## How to design

- **The brief wins.** Honor pinned aesthetics, eras, materials, fonts, and palettes even when they conflict with a saturated-pattern warning. Redirecting a clear brief toward your taste is failure.
- **Refinement preserves; redesign replaces.** Refinement keeps the incumbent identity, behavior, copy, and everything outside scope. Ask before replacing factual copy or adding claims. Redesign keeps product truth, content, function, native affordances, and constraints, but treats the old look as evidence and anti-reference; choose a replacement world in new-work and replace DESIGN.md. Never split the difference into polish on the discarded look.
- **Visual authority is evidence, not a filename.** Missing DESIGN.md alone does not make a project greenfield; new-work decides whether to preserve, expand, or replace the incumbent world.

## Before shipping: self-check

Run this against the actual rendered output, not just the code, before calling any UI work done:

- **Radius, elevation, and spacing tokens are identical across every variant/component shown together.** If two things are side-by-side for comparison, differing values for the same role (e.g. one uses 6px corners, the other 8px) reads as broken, not as intentional variety.
- **Every padding/margin/gap traces to a token in [reference/spacing-golden-ratio.md](reference/spacing-golden-ratio.md)** — no `value * 1.6`, `token + 2px`, or other arithmetic on scale values.
- **Every font-size traces to a token in [reference/typography-pretendard.md](reference/typography-pretendard.md)**, respects the surface's Mode (16px vs 14px base), and nothing sits below the 12px legibility floor.
- **Every text color clears the 4.5:1 contrast floor** against its actual background — check muted/secondary colors and any white-on-dark opacity value specifically; don't eyeball it.
- **Any ratio-driven size (width, height, font-size) is checked against its longest realistic content** — a proportionally "correct" column that truncates real text needs a content-based `min-width` floor, the same way sizes below the legibility floor get clamped.
- **The same component pattern is used for the same role everywhere** — don't build one instance with a real component/primitive and a sibling instance with hand-rolled markup for the same job.
- **Title/label text and its supporting caption are visually distinct** in weight and/or color, not just marginally different font-sizes of the same muted tone — proximity (spacing) and prominence (weight/color) together are what create hierarchy, and both must actually render, not just exist in the code.

## Modes

The mode names what the visitor's success looks like on this surface.

- **Persuade:** the visitor decides and acts; design is the product. Landing pages, marketing, campaigns, pricing. Earn attention and action. Ship real imagery when the brief needs it; follow the committed world, not category habit.
- **Operate:** the visitor completes a task. App UI, dashboards, editors, admin, settings, tools. Scanability, consistency, native expectations, and the real usage scene outrank expression. Brand lives in precise details.
- **Read:** the visitor understands something. Docs, articles, guides, help, changelogs. Structure for comprehension, then make the reading experience worth staying in.
- **Experience:** the visitor is inside the work itself. Portfolios, galleries, showcases. Let the artifact lead from the first viewport; the interface recedes.

Choose the mode from the requested surface, not the product, and persist it only in that surface brief. A tool's landing page is still Persuade; a fashion house's documentation is still Read; a docs index is Read, not Persuade. See [new-work.md](reference/new-work.md) for new surfaces and [operate.md](reference/operate.md) for deeper Operate/Read guidance.

## Commands

| Command | Category | Description | Reference |
|---|---|---|---|
| `craft [feature]` | Build | Deprecated alias for an ordinary new-work request | [reference/craft.md](reference/craft.md) |
| `shape [feature]` | Build | Plan UX/UI before writing code | [reference/shape.md](reference/shape.md) |
| `init` | Build | Capture durable product context in PRODUCT.md | [reference/init.md](reference/init.md) |
| `document` | Build | Generate DESIGN.md from existing project code | [reference/document.md](reference/document.md) |
| `extract [target]` | Build | Pull reusable tokens and components into design system | [reference/extract.md](reference/extract.md) |
| `critique [target]` | Evaluate | UX design review with heuristic scoring | [reference/critique.md](reference/critique.md) |
| `audit [target]` | Evaluate | Technical quality checks (a11y, perf, responsive) | [reference/audit.md](reference/audit.md) · native: [reference/audit.native.md](reference/audit.native.md) |
| `polish [target]` | Refine | Final quality pass before shipping | [reference/polish.md](reference/polish.md) |
| `bolder [target]` | Refine | Amplify safe or bland designs | [reference/bolder.md](reference/bolder.md) |
| `quieter [target]` | Refine | Tone down aggressive or overstimulating designs | [reference/quieter.md](reference/quieter.md) |
| `distill [target]` | Refine | Strip to essence, remove complexity | [reference/distill.md](reference/distill.md) |
| `harden [target]` | Refine | Production-ready: errors, i18n, edge cases | [reference/harden.md](reference/harden.md) |
| `onboard [target]` | Refine | Design first-run flows, empty states, activation | [reference/onboard.md](reference/onboard.md) |
| `animate [target]` | Enhance | Add purposeful animations and motion | [reference/animate.md](reference/animate.md) |
| `colorize [target]` | Enhance | Add strategic color to monochromatic UIs | [reference/colorize.md](reference/colorize.md) |
| `typeset [target]` | Enhance | Improve typography hierarchy and fonts | [reference/typeset.md](reference/typeset.md) |
| `layout [target]` | Enhance | Fix spacing, rhythm, and visual hierarchy | [reference/layout.md](reference/layout.md) |
| `delight [target]` | Enhance | Add personality and memorable touches | [reference/delight.md](reference/delight.md) |
| `overdrive [target]` | Enhance | Push past conventional limits | [reference/overdrive.md](reference/overdrive.md) |
| `clarify [target]` | Fix | Improve UX copy, labels, and error messages | [reference/clarify.md](reference/clarify.md) |
| `adapt [target]` | Fix | Adapt for different devices and screen sizes | [reference/adapt.md](reference/adapt.md) · native: [reference/adapt.native.md](reference/adapt.native.md) |
| `optimize [target]` | Fix | Diagnose and fix UI performance | [reference/optimize.md](reference/optimize.md) |
| `live` | Iterate | Visual variant mode: pick elements in the browser, generate alternatives | [reference/live.md](reference/live.md) |

Routing:

- **No argument:** read [routing.md](reference/routing.md) and present its context-aware menu; never auto-run a command.
- **Explicit or clearly implied command:** load its reference (native variant on native platforms) and follow it. Ask once if two commands fit.
- **Otherwise:** treat the request as general design work. Missing PRODUCT.md routes a new surface or replacement world through init, then new-work; a narrow refinement of existing code proceeds on the incumbent implementation as context.mjs directs, offering init afterward rather than blocking on it.
- `teach` aliases `init`. `craft` is a deprecated alias for ordinary new-work and adds nothing. `shape` owns task discovery, then enters new-work only for visual-world and surface-concept decisions.

After init writes PRODUCT.md, resume without rerunning `context.mjs`; init loads the native platform reference itself when the platform it recorded is `ios`, `android`, or `adaptive`.

**Pin / Unpin:** `node .claude/skills/impeccable/scripts/pin.mjs <pin|unpin> <command>` creates or removes a standalone `/<command>` shortcut. Report the script's result concisely; relay stderr verbatim on error.

**Hooks:** `/impeccable hooks <on|off|status|ignore-rule|ignore-file|ignore-value|reset>` manages the design detector hook for this project (auto-runs the detector after UI file edits and surfaces findings). Load [reference/hooks.md](reference/hooks.md) when the user invokes it with any argument.

**Doctor:** `/impeccable doctor` reports and repairs drift between this project's Impeccable artifacts (PRODUCT.md, DESIGN.md and its sidecar, config, surface briefs, the hook) and what this version reads. Load [reference/doctor.md](reference/doctor.md) when the user invokes it, or when they ask what is out of date, stale, or needs refreshing. A `CONTEXT_STALE` directive in Setup's output is the cheap subset of the same report; act on it there per its own instructions rather than running doctor unasked.

**Never repair drift as a side effect of a design task.** A `CONTEXT_STALE` finding is reported, not acted on, unless the user asks. The one exception is a finding marked `auto`, which the next write to that file performs anyway.