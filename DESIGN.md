# Design

Pulse Terminal is an Operate surface: a trader reads live numbers for hours. The chart owns the screen; everything else is a flat, dense frame. Visual reference pinned by the owner: the openmarket.xyz chart UI.

Source of truth: `css/styles.css` (tokens at the top) and `js/chart.js` (`THEMES`, `MCB_COLORS`).

## Layout

| Region | Size | Content |
| --- | --- | --- |
| Top bar | 40px | Brand mark, pair tabs (coin icon, symbol, 24h change), search trigger (`Ctrl K`), theme toggle |
| Symbol bar | 48px | Symbol box (venue + pair), timeframe segments, chart-type segments, last price + change chip, 24h high/low/volume, Indicators n/6, Panels |
| Workspace | rest | Chart (price pane, then indicator panes in the order enabled) + 336px right panel (Order book / Signal / Market tabs) |
| Status bar | 26px | Connection state, feed latency, trades/s, data source, UTC clock, About (`i`) |

Under 900px: pair tabs, status bar, stats, and chart tools hide; the panel becomes a full-height view switched from a 54px bottom nav (Chart, Book, Signal, Market, Indicators); the Indicators menu becomes a bottom sheet.

## Color

Restrained: neutrals plus one copper accent used for state (selected tab underline, switches, up values, focus ring).

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--bg` | `#0d0d0d` | `#fbfbfa` | Chart canvas and page |
| `--bg-2` | `#101010` | `#f5f5f3` | Bars and panel |
| `--surface` | `#151515` | `#ffffff` | Menus, palette, toasts |
| `--line` | `#1f1f1f` | `#e7e6e2` | Hairline dividers |
| `--text` / `--text-2` / `--text-3` | `#ececea` / `#a6a6a2` / `#85857f` | `#151515` / `#4f4f4a` / `#6b6a65` | Primary / secondary / tertiary text |
| `--accent` | `#e2783f` | `#c4561d` | State only |
| `--up` / `--down` | `#e8854f` / `#f2566f` | `#b44f19` / `#c92a46` | Signed numbers, book sides |

Candles: up copper (`#e2783f` dark, `#c4561d` light), down light grey (`#d4d4d4`) in dark and near-black (`#2c2c2c`) in light. Volume uses the same pair at low alpha.

Market Cipher B keeps the Pine script's own colors (`MCB_COLORS` in `js/chart.js`, converted with `color.new` transparency rules). Only the white level lines and zero line follow the theme ink so they stay visible in light mode.

## Type

Satoshi (self-hosted, 400 / 500 / 700) for all interface text. Chivo Mono (self-hosted, variable) for every number via `.num`: prices, book, legends, scores, axes. Mono digits keep live prices from jittering. Sizes run 10.5-30px; caps labels (9.5px, 0.06em tracking) only for the symbol-bar stat labels.

## Signal and Market tabs

- **Pulse verdict**: a tinted hero (copper = Long, red = Short, neutral = Wait) with the action at 30px, bias and score on the right, then one plain sentence saying why. Below: a Short / Wait / Long scale with the ±25 thresholds shaded, four part bars that grow from the centre, and Entry / Invalidation / Target (replaced by a one-line note while waiting).
- **Timeframes**: one row per timeframe, 1m to 1y. Columns: name (chart timeframe marked with a copper dot), a wave meter (-100 to 100, oversold / overbought ends shaded, marker colored by zone), the last dot glyph with bars ago, and a Long / Short / Wait tag. Full reasons live in the row tooltip. A key under the list explains the dots.
- **Market**: Fear & Greed value, scale and 7-day bars; headline list with source, age and a tone tag; fundamentals grid.

## Watchlist

Rows of icon, symbol and name, price (flashes copper or red on change), 24h change, and the 1h Market Cipher B read tag, with a remove control that shows on hover. The open market gets a copper inset bar. The star next to the symbol box toggles membership (amber when on).

## Help and tooltips

Any element with `data-tip` gets a tooltip (dark pill, 450ms delay, instant for the next one, keyboard focus supported, off for touch). Indicators carry a `?` that expands a plain explanation inline; Market Cipher B's settings open with a "How it works" guide. The TradingView attribution and data credits live in the About popover (`i` in the status bar, also in the palette).

## Components

- **Segments** (`.seg`): 26px buttons, selected = `--surface-2` fill + 1px inset line.
- **Tool buttons** (`.tool-btn`, `.icon-btn`): 28px, hover = `--hover`, press = `scale(0.97)`.
- **Legends**: plain text inside the chart, top-left of each pane, no box; values colored like their series. Panes keep top headroom (`scaleMargins.top`) so legends sit above data.
- **Order book**: fixed rows updated in place; depth bars are `transform: scaleX` from the right edge.
- **Insights**: sections split by hairlines, no cards; tags for signal states.
- **Menus / palette / toasts**: `--surface`, 1px `--line-2` border, 10px radius, one soft shadow.
- **Icons**: Tabler (via Iconify) inlined as an SVG sprite, 16px, stroke 1.75; coin icons from Iconify Cryptocurrency Color in `icons/coins/`.

## Motion

150-240ms with `cubic-bezier(0.23, 1, 0.32, 1)`; menus, toasts and About enter with `@starting-style`. The command palette has no animation (it opens many times a day). Chart drag uses Lightweight Charts' kinetic scroll; wheel and trackpad zoom / scroll are custom (`smoothWheel` in `js/chart.js`): the visible range eases 30% of the way to its target each frame, zooming around the cursor. `prefers-reduced-motion` keeps only opacity and color transitions.
