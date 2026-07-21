# VPVR (Volume Profile Visible Range) — Design

Date: 2026-07-21
Target: Pulse Terminal (`1s Terminal`), Lightweight Charts v4.1.1, vanilla JS, no build step.

## Goal

Add a production-ready VPVR indicator that distributes traded volume across price bins for the **currently visible** chart range, TradingView-VRVP style: right-anchored semi-transparent horizontal bars, POC/VAH/VAL price lines, value-area shading, and Total / Buy-Sell / Delta display modes. Recomputes on pan, zoom, timeframe, symbol, resize, and live updates; bars follow the price axis smoothly during pan.

## Architecture (modular)

Three layers, matching the spec's separation requirement:

1. **`js/vpvr.js` — calculation (pure, no DOM, testable).** Exposes global `VPVR.computeProfile(visibleCandles, opts)`. No chart or DOM imports. This is the layer that can be unit-tested in isolation.
2. **`js/vpvr-view.js` — rendering + chart integration.** Exposes global `VPVRView` (`init`, `destroy`, `update`, `setSettings`, `refreshTheme`). Owns the overlay canvas, price lines, viewport subscription, resize, theme, tooltip.
3. **`js/app.js` — wiring.** Captures taker volume in the ingest, instantiates `VPVRView` after chart init, tears down/reinits on pair/timeframe switch, marks dirty on live ticks, refreshes on theme toggle, owns settings state + dropdown handlers.

No ES modules (the app uses classic `<script>` tags), so `vpvr.js` and `vpvr-view.js` expose globals and load before `app.js`.

## Data model change

Candle gains one field: `takerBuy` (taker buy **base** volume).
- REST klines: `parseFloat(k[9])`.
- WS kline: `parseFloat(k.V)`.
- Default `0` when absent.

`buy = takerBuy`, `sell = volume - takerBuy`, `delta = buy - sell`. This is real taker-side data from Binance, not an approximation.

## Volume distribution (per visible candle)

Distribute each candle's volume across the price bins its `[low, high]` range overlaps, weighted by overlap fraction — **not** all volume at close. For bin `b` with bounds `[binLow, binHigh]`:

```
overlap = min(cHigh, binHigh) - max(cLow, binLow)
if overlap > 0:
  frac = overlap / (cHigh - cLow)        // guard cHigh==cLow -> frac = 1 for the containing bin
  bin.total += volume * frac
  bin.buy  += buy * frac
  bin.sell += sell * frac
```

Rationale: OHLCV candles aggregate many trades across the high-low range; overlap-weighted distribution is the standard VPVR approximation when trade-level ticks aren't available, and it correctly handles candles spanning multiple bins. Buy/sell are distributed with the same fractions so per-bin delta stays consistent.

## Bin generation

- Visible high/low from the visible candle set. `binSize = (hi - lo) / rows`.
- Guards: `rows < 1` -> 1; `hi == lo` (flat) -> single bin; `binSize <= 0` -> single bin.
- `rows` default 24 (configurable).
- Precision: operate on raw floats; format for display using a precision derived from `binSize` (not hardcoded decimals) so BTC, ETH, and low-priced tokens all render correctly.

## Metrics

Per bin: `priceLow`, `priceHigh`, `priceMid`, `total`, `buy`, `sell`, `delta`, `deltaPct`, `pctOfTotal`, `inValueArea`, `isPOC`.
Profile: `totalVolume`, `valueAreaVolume`, `pocPrice`, `vah`, `val`, `bins`.

## POC + Value Area

- **POC**: bin with max `total` (first on tie).
- **Value Area** (default 70%, configurable): start at POC, expand alternately up/down adding the larger neighboring bin's volume until cumulative >= `target = totalVolume * vaPct` or both ends exhausted. `VAH` = highest VA bin upper bound, `VAL` = lowest VA bin lower bound. Invariant: `VAH >= VAL`.

## Rendering (`vpvr-view.js`)

- Overlay `<canvas>` inside `#chart-wrapper`, absolutely positioned, full-size, `pointer-events: none` (chart pan/zoom pass through). DPI-aware (`devicePixelRatio`).
- Bars right-anchored: each bin drawn at y = `mainSeries.priceToCoordinate(priceMid)`, width proportional to `volume / maxVolume * profileWidthPx`, growing leftward from the right edge. Semi-transparent fills so candles show through.
- Modes: **Total** (single bar per bin, neutral/accent), **Up/Down** (stacked buy=green/sell=red), **Delta** (bar colored by sign). Defaults to Total.
- VA shading: translucent band over `[VAL, VAH]` on the canvas.
- POC/VAH/VAL: native `mainSeries.createPriceLine(...)` (crisp, pan with the price axis natively), toggleable. Recreated on recompute/theme change.
- Theme: CSS vars read via `getComputedStyle` and cached; refreshed on theme toggle.

## Performance

- **Profile recompute** (binning over visible candles) is debounced (~80ms) on `subscribeVisibleLogicalRangeChange`, data update, pair/timeframe switch.
- **Redraw** runs on `requestAnimationFrame`: maps existing bin prices to current y via `priceToCoordinate` and draws. During pan the price scale shifts every frame — rAF redraw keeps bars glued to the axis without recomputing bins, so panning stays smooth (TV behavior).
- Memoization: skip recompute if the visible candle set's signature (first/last time + count + last volume) is unchanged.
- Visible candles only — never the full 1200-candle history. `O(visibleCandles * binsSpanned)`.
- Heavy calc off the render path; live ticks set a dirty flag + schedule, not a synchronous recompute.

## Edge cases (all guarded, no NaN/Infinity)

No data (clear canvas + remove price lines), one candle (single bin), zero-volume candles (contribute 0), missing/NaN volume (treated 0), flat market `high==low` (single bin), extremely narrow range, very large range, symbol switch, timeframe switch, live updates, partially formed current candle, varying precision/tick size. All divisions guarded (`total==0` -> pct 0, `cHigh==cLow` -> single-bin frac, `binSize<=0` -> skip).

## Settings (defaults in parens)

Enable/disable (off), rows 24, value-area % 70, profile width ~120px, position right, show POC line (on), show VAH/VAL lines (on), show VA highlight (on), display mode Total, opacity ~0.5. Settings UI reuses the toolbar `.clean-dropdown` pattern.

## Tooltips

Pointermove over `#chart-wrapper` → y → `mainSeries.coordinateToPrice(y)` → find containing bin → DOM tooltip with: price range, total volume, % of visible, buy, sell, delta, delta %, in-VA, POC flag. Only metrics actually available are shown.

## Assumptions (documented)

1. Buy/sell uses **real Binance taker buy base volume** (`k[9]` / `k.V`), captured into the candle model. Not an OHLCV approximation.
2. Within-candle volume distribution across `[low, high]` is **overlap-weighted** (trade ticks unavailable); this is the standard VPVR approximation and is documented as such.
3. VAH/VAL use VA bin **bounds** (upper/lower), not centers.
4. No ES modules in this project → calc and view are globals on `window`, loaded before `app.js`; the calc module remains DOM-free and independently testable.

## Not in scope

No new dependencies. No changes to existing indicators, orderbook, or insights. No backend. User handles live testing; this design covers code correctness + a calc self-check.
