# Navigator Demo UI v2.1 Design System

Approved Superdesign direction: `Navigator Compact Task-Guided Home`, project
`a94f43c4-a1b3-492b-99c7-838ba218ed53`, draft
`a51cdac5-0a83-423c-8428-dfe869139e1f`, Version 2.

## Product and audience

Navigator is a private, access-controlled internal demo of a global expansion workbench for renewable-energy companies. It is designed to be presented with the clarity and polish expected by executives and customer-facing teams, while the actual runtime remains restricted to authorized internal viewers.

The primary job is to make one business story immediately understandable:

1. choose a target market;
2. frame the market decision with the controlled AI assistant;
3. shape a solar-and-storage concept;
4. assemble a feasibility draft;
5. prepare for a synthetic tender.

This is a deterministic synthetic demo. It is not a production system, professional advice, a live intelligence service, or a real AI/chat product.

## Fixed information architecture

The top-level navigation must remain:

- Home: `/`
- Global Markets: `/countries`
- Policy & Risk: `/policies` and `/risks`
- Expansion Tools: `/tools`
- Partners: `/partners`

`/compare` remains a supporting two-market comparison, not a top-level navigation item. `/tenders` redirects to `/tools/tenders`.

The v2.1 design scope is login, home, global markets, country detail, tools hub, the four tool pages, and two-market comparison. Policy, risk, opportunity, and partner lists inherit the shared shell and tokens but are not structurally redesigned in this round.

## Visual direction

The design language is **multilateral-institution information order plus restrained renewable-energy technology**:

- credible, calm, structured, and open;
- executive-friendly hierarchy with clear outcomes and next actions;
- one dominant visual per viewport and no more than four summary/task cards;
- progressive disclosure instead of a dense operations dashboard;
- thin borders, low-to-medium radii, restrained shadows, and generous whitespace;
- no decorative charts, neon effects, glassmorphism, purple gradients, serif display fonts, or consumer-app styling.

Preserve the current visual identity. The header intentionally uses the existing Lucide Compass mark with the Navigator wordmark; `apps/web/app/icon.svg` is a favicon and is not the selected header logo. Do not invent a logo, monogram, replacement SVG mark, emoji, or substitute identity.

## Color tokens

Use only these colors and their transparent variants:

| Token | Value | Role |
| --- | --- | --- |
| `--navy-975` | `#061a35` | darkest header and globe stage |
| `--navy-950` | `#071c3f` | header, primary headings, deep globe stage |
| `--navy-900` | `#0a254c` | dark surfaces |
| `--navy-850` | `#082447` | hero and recommendation surfaces |
| `--navy-800` | `#12335e` | emphasized body text, chart axes |
| `--navy-700` | `#0d3155` | controls on dark surfaces |
| `--teal-800` | `#0a625f` | high-contrast teal text |
| `--teal-700` | `#087e7c` | high-contrast teal text |
| `--teal-600` | `#079b98` | primary actions, selection, energy signal |
| `--teal-400` | `#62d6ce` | accent on dark surfaces |
| `--teal-300` | `#86eee6` | focus on dark controls |
| `--teal-100` | `#dff5f3` | selected background |
| `--teal-050` | `#f0fbfa` | subtle teal section background |
| `--coral-700` | `#a53028` | risk text on light surfaces |
| `--coral-600` | `#ef4f45` | risk and negative signal |
| `--coral-100` | `#fff0ee` | risk background |
| `--amber-300` | `#f6c86d` | warning accent on dark surfaces |
| `--amber-500` | `#e8a12d` | demo boundary emphasis |
| `--amber-700` | `#ad6500` | warning icon on light surfaces |
| `--amber-800` | `#846b49` | warning copy |
| `--amber-200` | `#f0dcc0` | quiet warning border |
| `--amber-100` | `#fff7e9` | persistent demo notice background |
| `--blue-600` | `#1768d4` | focus ring and secondary series |
| `--surface` | `#ffffff` | primary surface |
| `--surface-page` | `#f5f8fb` | application page background |
| `--surface-subtle` | `#f7f9fc` | quiet section background |
| `--surface-teal-muted` | `#eaf4f4` | muted teal section |
| `--surface-teal-quiet` | `#f8fbfb` | quiet task surface |
| `--surface-warning-quiet` | `#fff8e9` | contextual limitation surface |
| `--border` | `#d7dee8` | standard border |
| `--border-strong` | `#bdc9d8` | stronger separator |
| `--border-subtle` | `#e1e7ee` | quiet separator |
| `--border-teal` | `#77c8c2` | active and hover border |
| `--border-teal-muted` | `#c5dedd` | muted task separator |
| `--border-amber` | `#ead5af` | contextual warning border |
| `--border-dark` | `#163d67` | dark-stage separator |
| `--border-dark-strong` | `#123a61` | strong dark-stage separator |
| `--muted` | `#607086` | secondary text |
| `--text` | `#213550` | body text |

Do not introduce any color outside this palette except transparent overlays derived from these tokens.

## Typography

- Use the existing system stack only: `Inter, "Noto Sans SC", "Microsoft YaHei", sans-serif`.
- Do not request or embed external fonts.
- Desktop display heading: 48-56px, 700-780 weight, compact line height.
- Page heading: 34-42px, 700 weight.
- Section heading: 26-34px, 700 weight.
- Body: 15-17px with 1.55-1.7 line height.
- Labels and controls: 13-15px, 600-700 weight.
- Kicker text may use uppercase in English; Chinese kicker text must remain naturally spaced and must not imitate Latin all-caps tracking.

## Spacing, radius, and elevation

- Base spacing unit: 8px.
- Maximum content width: 1280px.
- Desktop section gap: 64-84px; tablet: 48-64px; mobile: 36-52px.
- Control height: 44-48px; touch targets never below 44px.
- Radii are tokenized as `--radius-control: 5px`, `--radius-field: 8px`,
  `--radius-panel: 12px`, `--radius-section: 16px`, and `--radius-pill: 99px`.
- Elevation is tokenized as `--shadow-card`, `--shadow-card-hover`, `--shadow-active`,
  `--shadow-popover`, `--shadow-tooltip`, `--shadow-overlay`, and `--shadow-hero`.
  Use shadows only on the hero stage, active cards, floating controls, and overlays.

## Shared shell

- Desktop header height: approximately 72px; mobile header: 64px.
- Keep the current deep navy header, active teal underline, language switcher, planning CTA, logout action, and responsive menu.
- A persistent amber `Demo Data / Non-official Conclusions` notice remains visible on every protected page in the current language.
- Avoid repeating the same full warning inside every section. Contextual warnings remain only beside sensitive inputs or outputs that could be mistaken for professional conclusions.
- Preserve the footer synthetic-source and baseline-date treatment.

## Home page

- Use a desktop split hero around 540px high, not the previous 670px stage. The approved
  implementation measures 551-555px at 1440 and 1600px browser widths.
- Left: short value proposition, one primary planning action, one secondary market link, and compact synthetic/no-external/bilingual proof points.
- Right: the real local interactive globe, concise instructions, current market summary, readiness score, and country-detail action.
- The selected globe market must flow into planning actions through `country=<ISO3>`.
- Replace the separate capability grid and workflow grid with one four-step clickable task journey:
  1. AI market framing;
  2. solar-and-storage concept;
  3. feasibility draft;
  4. tender preparation.
- End with a calm trust statement, not another large warning banner.

## Markets and country detail

- Keep the globe as the single primary market-selection visual.
- Make the selected market context, readiness, summary, and next action visually obvious without adding data fields.
- Country detail hierarchy: identity and market context, five-dimension assessment,
  reasons/risks/actions with related task actions, then the signal timeline.
- Related actions link to assistant, solar-storage, feasibility, tenders, and two-market comparison using the current country.
- Risks must always include text or an icon in addition to color.

## Tools hub and tool pages

- The tools hub is a connected four-step journey rather than four unrelated marketing cards.
- Preserve the recommended order: assistant, solar-storage, feasibility, tenders.
- Carry the optional `country=<ISO3>` parameter from the home/market context into the hub and every child route.
- Desktop tool workspace uses approximately 40% input and 60% result; mobile stacks input before result.
- All four tools share the same page heading, market context, step indicator, input panel, result panel, state treatment, and next-step action.
- Results have consistent empty, loading, error, summary, limitation, and related-action patterns.
- The AI assistant remains controlled-choice guidance, never free-form chat.
- Solar/storage must not output IRR, LCOE, or engineering-grade design.
- Feasibility remains a structured preview and never generates a formal file.
- Tenders remain synthetic and non-real-time.

## Two-market comparison

- Keep two distinct market selectors with explicit Market A and Market B identity.
- Lead with the five controlled dimensions; show paired values and bars with an unambiguous leader treatment.
- Radar is supporting evidence, not the dominant visual.
- Recommendation and country reasons follow the comparison.
- On mobile, each dimension becomes a vertical A/B comparison block; the page must not rely on horizontal scrolling.

## Login

- One centered branded entry panel with Compass + Navigator, language switcher, concise private-demo explanation, passphrase field, one primary action, and explicit synthetic boundary.
- Do not add user registration, identity providers, enterprise permissions, social login, or account recovery.

## Responsive behavior

- `>=1180px`: wide split layouts and up to four columns.
- `840-1179px`: two-column summaries; hero and tool regions may stack when needed.
- `<840px`: mobile navigation and single-column page flow.
- At `390x844`, no page-level horizontal overflow. Wide data comparisons must recompose inside the component rather than shrinking text below readable sizes.
- The globe retains touch controls, keyboard selector, reduced-motion behavior, and no-WebGL fallback.

## Motion and accessibility

- Motion range: 150-300ms for standard transitions; up to 900ms only for globe/viewpoint movement.
- Respect `prefers-reduced-motion`; stop automatic globe rotation and remove nonessential animation.
- Visible 2px blue focus rings with 2px offset.
- Every control has an accessible name; state cannot rely on color alone.
- Loading, empty, and error states must use the active language. Missing data is never displayed as zero.

## Runtime and governance constraints

- Use only repository-owned `synthetic_demo` fixtures.
- Keep `data_origin=synthetic_demo` and the current-language demo notice in every response and surface.
- Runtime may call only the local web/API/database chain.
- No external maps, tiles, textures, fonts, translation, models, analytics, or live sources.
- No real customer data, project secrets, personal information, restricted material, production credentials, or professional claims.
- Do not change the existing backend schemas, database, formal comparison contract, or production/data-gate scope.

## Design-generation fidelity constraint

Use ONLY the fonts, colors, spacing, component styles, information architecture, and constraints defined in this design system. Preserve the current Navigator navy/teal identity and Lucide icon language. Do not introduce any fonts, colors, brand marks, visual styles, runtime dependencies, data fields, or product capabilities not defined here.
