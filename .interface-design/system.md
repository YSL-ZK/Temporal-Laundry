# Laundry Interface System

This file is the persistent UI contract for Laundry. Read it before changing any authenticated product screen, authentication surface, PWA artwork, or reusable control. The implementation sources of truth are `app/dashboard.css`, `app/auth.css`, `app/dashboard-client.tsx`, and `app/laundry-mark.tsx`.

## Direction and intent

- Human: a person or household member checking money quickly between everyday tasks, often one-handed on a phone, who needs confidence more than financial spectacle.
- Core verbs: understand the current position, record a movement, plan an obligation, coordinate a purchase, and act without losing auditability.
- Feel: calm financial observatory—private, precise, quietly dimensional, and active without resembling a trading terminal.
- Domain vocabulary: ledger, balance, movement, orbit, household, allocation, statement, receipt, due date, shared/private scope.
- Color world: midnight ink, deep vault blue, oxidized-teal surfaces, paper-white figures, ledger mint, restrained periwinkle, and muted coral for destructive/negative states.
- Signature: money and household records exist “in motion.” The orbit-ledger logo, elliptical paths, moving nodes, balance-stage composition, and movement language should recur subtly across the experience.

Reject these defaults:

- Generic initial-in-a-rounded-square branding. Always use the Laundry orbit-ledger SVG mark.
- A grid of interchangeable KPI cards. Give each view one focal financial story, then support it with quieter evidence.
- Desktop navigation shrunk onto mobile. Use the five-destination bottom thumb dock and place secondary tools inside Settings.
- The same CTA everywhere. Every view owns a contextual verb and target.
- Bright controls floating above cards. Inputs are inset, darker than their containing surface.

## Palette and tokens

Authenticated surfaces use the `--vault-*` tokens in `app/dashboard.css`:

- Canvas / void: `--vault-void: #071117`
- Deep background: `--vault-deep: #0b171e`
- Base surface: `--vault-surface: #10212a`
- Raised surface: `--vault-raised: #152a35`
- Primary text: `--vault-ink: #f1f7f5`
- Secondary text: `--vault-secondary: #afc0c0`
- Muted metadata: `--vault-muted: #819696`
- Quiet boundary: `--vault-line: rgb(214 244 232 / 0.11)`
- Emphasized boundary: `--vault-line-strong: rgb(214 244 232 / 0.2)`
- Primary action/identity: `--mint: #b8f5d2`
- Active/status mint: `--mint-strong: #79dfa9`
- Ink on mint: `--mint-ink: #09291d`
- Secondary accent: `--periwinkle: #9eb0ff`
- Destructive/negative: `--danger: #ffb4a8`

Color distribution should remain approximately 60% ink canvas, 30% blue-teal surfaces, and 10% mint/semantic accents. Mint is scarce: identity, current navigation, primary action, focus-relevant status, and positive movement. Coral is only for negative amounts and destructive actions. Do not add unrelated accent hues.

## Depth and surfaces

- Primary depth strategy: dark surface-color layering plus low-opacity borders.
- Use shadows only for elements that genuinely lift: the logo, primary CTA, mobile dock, auth card, and the main financial stage.
- The rail shares the canvas hue and separates with one quiet border; it must not become a disconnected colored sidebar.
- Inputs use a darker inset fill. Dropdowns/popovers, when introduced, sit one surface level above their parent.
- Borders should be discoverable, not visually dominant. Avoid solid gray outlines and thick decorative strokes.
- Radii follow a scale: controls `0.65–0.85rem`, compact cards `0.8–1.2rem`, feature cards `1.35–1.75rem`, auth card `1.75rem`. Nested radii must remain concentric.

## Spacing and density

- Base unit: 4px. Use multiples of 4px for new measurements unless optical alignment requires a documented exception.
- Micro gaps: 4–8px.
- Control gaps and internal padding: 8–16px.
- Card padding: 20–32px depending on information density.
- Section gaps: 16–36px.
- Desktop content breathes; operational forms remain compact. Dense controls may live inside generous page-level whitespace.
- Interactive targets are at least 44×44px. Primary actions are normally 48px high.

## Typography and data hierarchy

- Product type stack: `"Segoe UI Variable", "Aptos", system-ui, sans-serif` through the existing Geist-compatible token. Do not introduce another UI font casually.
- Type ratio: approximately 1.25, with weight and color doing more hierarchy work than adjacent size changes.
- Display/page title: `clamp(2rem, 4vw, 3.7rem)`, weight around 690–740, line-height near 0.98, tight negative tracking, balanced wrapping.
- Section title: approximately 1–1.25rem, strong weight, modest negative tracking.
- Body/supporting copy: 0.68–0.9rem with 1.5–1.65 line-height.
- Eyebrow: 0.55–0.65rem, uppercase, 700–800 weight, 0.12–0.16em tracking, muted or mint-strong.
- Four text levels are required: primary value/title, secondary supporting copy, muted metadata, disabled.
- All money, percentages, counters, dates in aligned rows, and changing balances use tabular numerals.

## Brand mark

- Use `LaundryMark` / `LaundryMarkSvg` from `app/laundry-mark.tsx`.
- Meaning: two orbit paths and terminal nodes around an open, balanced ledger.
- Never replace it with a standalone “L,” emoji, generated raster logo, or unrelated wallet/coin icon.
- Keep the mark one-color so it inherits context safely. Preferred tile is mint with `--mint-ink` artwork.
- Apply the same mark to in-app branding, authentication, offline/404 states, favicon, Apple icon, PWA icons, and Open Graph artwork.

## Navigation and page composition

### Desktop

- Fixed left rail: 17.5rem at wide widths and 14.5rem at medium desktop widths.
- The rail contains the brand, active household, full navigation, profile, and local-device sign-out.
- Active navigation uses a quiet mint surface and a narrow positional marker.
- Main content is subordinate to navigation structurally but is the visual focal area.

### Mobile and tablet

- At `56rem` and below, navigation becomes a fixed five-item bottom dock: Overview, Activity, Plans, Shopping, Settings.
- Do not place the Laundry logo or sign-out in the bottom dock.
- Place the logo beside the current title in the mobile workspace banner.
- Accounts, Reports, and Ask Laundry remain reachable through Settings shortcuts.
- Sign-out lives in Settings on mobile.
- Reserve bottom padding for the dock plus `env(safe-area-inset-bottom)`.

### View headers

- Every screen has one eyebrow, one expressive title, one date/support line, and one contextual CTA.
- CTA mapping: Overview → Post Transaction; Accounts → Add Account; Activity → New Entry; Plans → Create Plan; Shopping → New List; Reports → Export CSV; Ask Laundry → Ask Laundry; Settings → Manage Expenses.
- A CTA must navigate or scroll to its real action target. Do not show a generic action unrelated to the current view.

## Reusable components

- Primary action: 48px minimum height, mint surface, mint ink, `0.85rem` radius, subtle lift, 160ms transform/color/shadow transition, `scale(0.97)` active state.
- Inset field: 44px minimum height, dark receiving surface, quiet strong border, `0.65–0.75rem` radius, brighter border on hover, visible gold focus ring.
- Select system: every native dashboard/auth select opts into `appearance: base-select` when supported, with a raised Laundry picker, 48px options, mint selection/checkmark, bounded viewport height, and an OS-native fallback. The closed control uses centered flex alignment with its label and picker icon distributed to opposite edges. Rich finance choices use `SelectField`: a semantic trigger plus modal choice sheet, grouped labels, visible selected state, arrow-key movement, Escape dismissal, and a mobile bottom-sheet layout. Server schemas remain authoritative for submitted values.
- Color input: full-width 48px control with an inset swatch and rounded internal sample.
- Panel: deep blue-teal surface, quiet border, no decorative shadow by default, padding on the 4px grid.
- Expense record: receipt icon, payee/category focal label, date/account metadata, scope metadata, tabular coral amount, and a secondary remove action.
- Destructive confirmation: inline two-step confirmation, coral-tinted surface, explicit cancel/confirm controls. Never use browser `alert()` or `confirm()`.
- Empty state: domain icon, concise state title, one explanatory sentence, and at most one relevant next action.
- Mobile workspace banner: logo + eyebrow/title as one identity block; contextual CTA becomes full-width below it.
- Mobile home identity bar: the Overview screen replaces the generic workspace banner with a compact 44px Laundry mark, household/name context, and a 44px profile shortcut. Other screens keep their own app-bar treatment until redesigned.
- Mobile position stage: one 320px-class feature surface owns the current reporting-currency position, monthly delta, contextual movement action, and restrained orbit state. It is the sole visual focal point on Home.
- Mobile home evidence sections: cash flow, upcoming obligations, and recent activity use flat grouped rows with quiet top separators rather than nested dashboard cards. Section actions remain 44px targets.
- Mobile home quick actions: four equal touch targets for Accounts, Plans, Shopping, and Reports. They are secondary to the position stage and may show only a real count, never decorative badges.
- Mobile valuation rail: a shallow surface below quick actions shows the official valuation date plus USD and EUR values in the household reporting currency. Missing or stale rates use calm, explicit status copy.
- Mobile position math: value active accounts plus unlinked debt positions in the reporting currency. Add receivables, subtract payables, and never count a debt again when its balance is already represented by a linked account.
- Card statement workspace: keep the current balance, utilization, and open-statement figures in one compact inset rail. Statement history is a flat ledger row with due state, remaining balance, and an inline payment form; overdue uses coral only for the status signal.
- Obligation calendar: use a compact date tile, one semantic state icon, a single-line title, tabular amount, and explicit confirm/skip actions. Confirmed and skipped rows recede; overdue rows remain readable without turning the whole surface red.
- Receipt vault: use flat file rows with movement, account, category, scope, amount, file size, and a direct download action. Creator-only deletion always uses an inline two-step confirmation and never hides the underlying posted transaction.
- Reconciliation workspace: present statement balance, ledger balance, and difference as a compact three-value audit rail. Balanced status uses mint, discrepancies use coral, and posting an adjustment is an explicit reviewed choice rather than an automatic correction.
- Debt payoff lab: compare snowball and avalanche as two selectable strategy surfaces, keep the monthly budget and payoff estimate visible, and reveal the month-by-month schedule progressively. All mixed-currency debt values are presented in the household reporting currency with interest and remaining balance in tabular numerals.
- Reminder center: the header bell opens a right-side sheet on desktop and a bottom sheet on mobile. Group urgency through restrained icon/color changes, expose the source record and scope, and route users to Accounts or Plans for the real action instead of duplicating mutation controls inside the alert surface.
- Goal forecast card: progress remains the focal signal, followed by remaining balance, recent monthly pace, required pace, and projected completion. Contribution history stays collapsed until requested; status language must distinguish completed, on-track, behind, undated, and insufficient-history states without false precision.

## Motion

- Motion should suggest orbit and continuity, never delay routine finance work.
- Interactive transitions: 120–180ms with `cubic-bezier(0.23, 1, 0.32, 1)`.
- Page/card entrance: 550–650ms only for initial view presentation, staggered 30–80ms where useful.
- Button active feedback: `scale(0.97)`; never scale below 0.95.
- Animate only transform and opacity for movement. Never use `transition: all`.
- Auth atmosphere may use slow orbit/float motion because it is a rare entrance surface; authenticated operational controls stay fast.
- `prefers-reduced-motion` must remove movement and retain state clarity.

## Forms, language, and accessibility

- Use semantic native labels, buttons, links, fieldsets, and inputs. Never make a clickable `div`.
- Every control needs default, hover, active where relevant, focus-visible, disabled, error, and loading behavior.
- Keep the gold 3px focus-visible ring with 3px offset; never remove focus indication.
- Maintain the skip link and logical keyboard order.
- English and Spanish are persistent user preferences. New user-facing dashboard copy must go through `translate()` or a future equivalent dictionary, and dates must use `localeFor()`.
- Brand name “Laundry,” user content, account names, payees, and category names are not translated.
- Layouts must tolerate longer Spanish copy without clipping or fixed-height truncation.
- Do not use fixed viewport height plus `overflow: hidden` around forms. Auth pages use natural vertical overflow so browser chrome and short screens cannot cut off actions.
- Preserve safe-area insets, 44px touch targets, balanced headings, pretty body wrapping, and readable contrast.

## Financial trust patterns

- Posted financial records should look stable and auditable. Destructive UI must describe its ledger consequence.
- Creator-only expense removal is presented as “Remove,” but the system voids the expense, recalculates active balances/reports/exports, and retains audit history.
- Private/shared scope is always visible near the record or action it affects.
- Closed budget cards expose one explicit rollover decision: reset, retain only surplus, or carry the full signed balance. Show the resulting amount before confirmation, label incoming rollover separately from the base limit, and compare against the matching prior month without celebratory or punitive language.
- Transaction rows expose a quiet 44px detail action rather than making the whole row ambiguous. Detail opens as a centered desktop record and a mobile bottom sheet: amount/status first, then a directional money path, metadata, itemized lines, receipts, and a calm audit note. Native dialog semantics own focus, Escape, backdrop dismissal, and scroll containment.
- Draft movements live in a visually separate private vault and never look posted: periwinkle document marks, explicit “publish” language, and a visible private-scope explanation distinguish them from the ledger. Corrections and reversals stay inside the posted-record sheet, require an audit reason, and describe the balance consequence before confirmation.
- Guided category workflows use a compact horizontal/vertical rail for Bills, Transport, Dining, Health, and Travel, followed by two explicit layers: domain context and ledger review. Periwinkle marks the selected capture mode; mint is reserved for the final reviewed post. Stored workflow context appears as a quiet, typed definition list inside movement details instead of raw JSON.
- Custom templates use a horizontal library strip, a raised runner, and a quieter composer beneath it. Field cards are numbered ledger rows rather than interchangeable dashboard tiles; formula results use periwinkle, while the final reviewed post remains mint. Dynamic values and a field snapshot return inside movement detail so later template edits never erase historical meaning.
- Reports begin with a compact five-control lens, then one focal net-cash-flow stage. Income/expense evidence, net-worth history, spending composition, and private CSV exports descend in that order. The comparison currency is explicit and never changes original ledger records; estimated or missing historical rates receive a calm integrity note rather than silently disappearing.
- AI surfaces disclose what minimized summaries leave Supabase, which provider processes them, and what Laundry excludes/stores before a user sends a question.
- Avoid celebratory or alarming motion around debt, overspending, and negative balances. Use calm semantic color and direct language.

## Verification checklist

Before accepting future UI changes:

1. Identify the single focal task for each changed view.
2. Confirm the orbit/ledger signature appears meaningfully without becoming decoration.
3. Run the squint test: hierarchy remains visible and borders do not dominate.
4. Check all spacing against the 4px grid and all controls against the 44px target.
5. Verify default, hover, active, focus, disabled, loading, empty, and error states affected by the change.
6. Test desktop and real mobile viewport behavior, including Spanish copy and safe-area bottom navigation.
7. Test `prefers-reduced-motion` and keyboard navigation.
8. Keep authenticated/private data out of screenshots, generated assets, client logs, and preview fixtures.
9. Remove temporary preview routes, generated QA images, and development logs before committing.
10. Run ESLint, TypeScript, unit tests, and the production build.
