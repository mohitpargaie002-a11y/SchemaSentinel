# DESIGN.md — SchemaSentinel Visual & Operational Design System

## 1. Visual Philosophy & Design Identity: "Ink & Paper"

SchemaSentinel is a **quiet, precise, and serious database reliability tool** engineered for Staff DBAs, Principal SREs, and Platform Architects.

Inspired by the design philosophies of **Vercel Geist**, **Linear**, and **GitHub Primer**, the visual system eliminates decorative AI tropes (neon glows, blue developer-dashboard chrome, saturated cards, and decorative gradients) in favor of an **"Ink & Paper"** aesthetic:

- **Quiet & Minimal**: Obsidian and carbon neutral surfaces (`#09090A`, `#101011`, `#171718`) provide a calm, high-contrast reading environment where critical database hazards naturally stand out.
- **Restrained & Semantic Color**: Color is never used for general UI chrome. Semantic colors appear strictly to communicate state:
  - **Success / Passed (`#63B58A`)**: Completed steps, passed sandbox assertions, verified invariants.
  - **Warning / Attention (`#D6A84F`)**: Human approval required, lock hazards, table rewrite warnings.
  - **Danger / Blocked (`#E06B6B`)**: Execution failure, critical mutation rejection, syntax/constraint violations.
  - **Information / Neutral (`#A1A1AA`)**: Metadata, tool names, timing, catalog attributes.
- **Technical & Typographic Precision**: Modern geometric sans-serif (`Inter`) paired with clean monospace (`JetBrains Mono`) for SQL statements, row counts, and cryptographic hashes.
- **Structured Surface Hierarchy**: Subtle 1px borders (`#27272A`) and minimal elevation (`0 8px 30px rgba(0,0,0,0.18)`) replace heavy borders and glowing cards.

---

## 2. Color System Tokens

```css
:root {
  /* Canvas & Neutral Surfaces */
  --bg-page: #09090a;
  --bg-surface: #101011;
  --bg-elevated: #171718;
  --bg-hover: #1d1d1f;
  --bg-input: #0c0c0d;

  /* Borders & Separators */
  --border-subtle: #27272a;
  --border-strong: #3f3f46;
  --border-focus: #71717a;

  /* Typography */
  --text-primary: #f5f5f5;
  --text-secondary: #a1a1aa;
  --text-muted: #71717a;
  --text-inverse: #09090a;

  /* Primary Action Buttons (High Contrast Neutral) */
  --action-primary-bg: #f5f5f5;
  --action-primary-text: #09090a;
  --action-primary-hover: #ffffff;

  /* Semantic State Colors (Subtle & Purposeful) */
  --success: #63b58a;
  --success-bg: rgba(99, 181, 138, 0.1);
  --success-border: rgba(99, 181, 138, 0.25);

  --warning: #d6a84f;
  --warning-bg: rgba(214, 168, 79, 0.1);
  --warning-border: rgba(214, 168, 79, 0.25);

  --danger: #e06b6b;
  --danger-bg: rgba(224, 107, 107, 0.1);
  --danger-border: rgba(224, 107, 107, 0.25);

  --info: #a1a1aa;
  --info-bg: rgba(161, 161, 170, 0.08);
  --info-border: rgba(161, 161, 170, 0.2);

  /* Shadows & Elevation */
  --shadow-subtle: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-elevated: 0 8px 30px rgba(0, 0, 0, 0.18);

  /* Radii */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 10px;
  --radius-full: 9999px;

  /* Typography Families */
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', Menlo, Monaco, Consolas, monospace;

  /* Transitions */
  --transition-fast: 120ms cubic-bezier(0.16, 1, 0.3, 1);
  --transition-normal: 180ms cubic-bezier(0.16, 1, 0.3, 1);
}
```

---

## 3. Typography Scale & Hierarchy

| Element | Font Size | Weight | Line Height | Font Family | Case |
|---|---|---|---|---|---|
| **Page Title** | `24px` | `700` | `1.2` | `Inter` | Title Case |
| **Section Headings** | `18px` | `600` | `1.3` | `Inter` | Title Case |
| **Card Headings** | `16px` | `600` | `1.3` | `Inter` | Title Case |
| **Body & Paragraphs** | `14px` | `400` | `1.5` | `Inter` | Sentence case |
| **Labels & Form Headers** | `13px` | `500` | `1.4` | `Inter` | Sentence case |
| **Metadata & Subtitles** | `12px` | `400` | `1.4` | `Inter` | Sentence case |
| **Status Badges & Markers** | `11px` | `600` | `1.0` | `JetBrains Mono` | UPPERCASE |
| **Technical Data & SQL** | `13px` | `400` | `1.5` | `JetBrains Mono` | Normal |
| **Primary Metric Values** | `22px` | `600` | `1.2` | `JetBrains Mono` | Normal |
| **Risk Value Text** | `18px` | `600` | `1.2` | `JetBrains Mono` | UPPERCASE |
| **Buttons** | `14px` | `500` | `1.0` | `Inter` | Sentence case |

---

## 4. Component Rules

### 4.1 Global Header & Navigation
- Height: `56px`, fixed top border `1px solid var(--border-subtle)`.
- Background: `var(--bg-surface)`.
- Brand Title: `20px` bold with neutral `var(--text-primary)`, subtitle tag in `var(--text-muted)`.
- Status Indicator: Small pill with a subtle green dot (`#63B58A`) for Core Online.

### 4.2 Migration Request Bar
- Inputs use dark neutral background (`var(--bg-input)`), subtle border (`var(--border-subtle)`), and distinct focus border (`var(--border-focus)`).
- Primary Button (**[Run Safety Review]**): High-contrast crisp white background (`#F5F5F5`) with black text (`#09090A`), transitioning to `#FFFFFF` on hover.

### 4.3 Subagent Execution Strip
- All 4 cards share the identical neutral surface (`var(--bg-surface)`). No per-card saturated backgrounds.
- Card metrics display technical stats (`3 tables · 6 indexes`, `2070ms`, `Rollback: PASS`) using `JetBrains Mono`.
- State transitions update the compact status badge:
  - `IDLE`: Neutral badge (`var(--bg-elevated)`).
  - `RUNNING`: Subtle neutral/amber tag with clean status text.
  - `COMPLETED`: Muted green status tag (`#63B58A`).
  - `FAILED`: Muted red status tag (`#E06B6B`).

### 4.4 Quantitative Risk Matrix & Staged Rollout Plan
- **Risk Matrix**: Metric grid using neutral cells with subtle 1px dividers. Semantic color applies *only* to the actual metric value (e.g. `HIGH` in muted red, `PASS` in muted green). The matrix container itself remains neutral.
- **Staged Rollout Plan**: Progressive 5-phase execution plan in clean numbered items with monospace phase indicators.

### 4.5 The Human Approval Checkpoint (Primary Decision Anchor)
- Elevated neutral panel (`var(--bg-elevated)`) with a subtle 1px border (`var(--border-strong)`).
- Displays exact mutation target, environment, SHA-256 fingerprint, and redacted approval token (`sat_...XXXXXX (REDACTED)`).
- Warning note rendered with a restrained amber accent.
- Action Buttons:
  - **[Reject Migration]**: Neutral secondary button (`var(--bg-surface)` with `var(--border-subtle)`).
  - **[Approve & Apply to Staging]**: Muted success green button (`#63B58A` with `#09090A` text) signifying an explicit, verified mutation.

### 4.6 Execution Trace Timeline
- Chronological event stream with subtle status dots, timestamps, actor labels (`[SCHEMA_ANALYST]`, `[RISK_ANALYST]`, `[SANDBOX_VALIDATOR]`, `[REVIEW_SYNTHESIZER]`), and duration metrics.

### 4.7 Deep Evidence Explorer
- Clean tabbed interface switching between *Migration SQL*, *Target Schema*, *Sandbox Logs*, and *Audit Ledger*.
- Code blocks rendered with `JetBrains Mono` at `13px` over a deep carbon surface (`#0C0C0D`).

---

## 5. Spacing, Elevation & Radius Scale

- **Spacing Scale (4px Base)**: `4px`, `8px`, `12px`, `16px`, `20px`, `24px`, `32px`, `40px`.
- **Corner Radii**:
  - `6px` (`--radius-sm`): Buttons, inputs, small tags, metric cells.
  - `8px` (`--radius-md`): Subagent cards, workflow panels, evidence code blocks.
  - `10px` (`--radius-lg`): Modal overlays, approval focal container.
  - `9999px` (`--radius-full`): Status pills and badges only.
- **Elevation**: Single unified shadow `--shadow-elevated: 0 8px 30px rgba(0,0,0,0.18)` for elevated interactive surfaces.

---

## 6. Accessibility & Responsive Requirements

1. **Accessibility (`a11y`)**:
   - Contrast ratio exceeds WCAG 2.1 AA (minimum 4.5:1 for body text, 3:1 for large headings/badges).
   - High-contrast `:focus-visible` ring (`2px solid var(--border-focus)` with `2px offset`).
   - Screen reader announcement via `#aria-live-announcer` (`aria-live="polite"`).
2. **Responsive Breakpoints**:
   - Desktop (`1200px+`): 2-column workflow grid (Main telemetry left, Approval & Timeline right).
   - Tablet (`768px - 1199px`): Single-column stacked layout preserving decision hierarchy.
   - Mobile (`< 768px`): Fluid grid, stacked form inputs, full-width button actions with zero horizontal overflow.
