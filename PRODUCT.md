# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A crypto trader watching short timeframes (1s to 30m) on a desktop browser, often next to an exchange tab. The job is reading the market fast: price, order flow, and indicator state for a handful of major USDT pairs. Phone use is secondary (a quick check while away from the desk).

## Product Purpose

Pulse Terminal is a single-view, frontend-only market terminal. It streams Binance public market data and draws a live chart with indicators (VWAP, EMA 9/21, Volume, RSI, VPVR, Market Cipher B), a live order book, 24h stats, and a rule-based Insights panel. Success means the chart and book feel instant and the indicator values match what the trader sees on TradingView.

## Positioning

A free, no-login, no-build terminal that opens instantly in a browser and reads straight from Binance's public streams. It never places trades or holds keys.

## Operating Context

- Used beside an exchange or TradingView tab; the user compares values across them.
- Sessions are long (hours), mostly on dark desktop monitors in a dim room.
- Deployed as a static site on Vercel (`vercel.json` rewrites `/` to `Terminal-main.html`).

## Capabilities and Constraints

- Vanilla HTML, CSS, and JavaScript; no build step, no package dependencies at runtime except Lightweight Charts from unpkg.
- One serverless function, `api/news.js` (Vercel), reads public RSS headlines; everything else runs in the browser. CryptoPanic was considered but has no free API plan (owner decision: free RSS for now, swappable later).
- Data: Binance public REST and WebSocket only. Fallback to `data-api.binance.vision` / `data-stream.binance.vision` where `binance.com` is blocked.
- Markets (owner decision: only relevant ones): 14 crypto pairs on Binance spot; 12 US stocks / index ETFs and 7 commodities as Binance USD-M TradFi perpetuals (24/7, track the underlying, may drift outside market hours). No 1s candles for perps.
- Timeframes: 1s, 1m, 3m, 5m, 15m, 30m.
- Market Cipher B must reproduce the user's Pine Script v6 source exactly (same inputs, defaults, plots, colors, signals, alert conditions).
- Insights stays (user decision) and the old trade read is rebuilt as the Pulse verdict: rule-based Long / Short / Wait from Market Cipher B on 1m-1y plus sentiment (Fear & Greed), news tone, and CoinGecko fundamentals (owner decision: rule-based, not an LLM). Never presented as financial advice.
- The TradingView attribution required by the Lightweight Charts license stays in the About popover (owner decision).

## Brand Commitments

- Name: Pulse Terminal.
- Visual reference pinned by the user: openmarket.xyz chart UI (flat near-black canvas, copper up candles, light-grey down candles, dense symbol bar, in-chart legend, status bar with latency, smooth kinetic chart scrolling).
- Light and dark themes both exist.

## Evidence on Hand

- Live data from Binance, alternative.me, CoinGecko, and RSS feeds (CoinDesk, Cointelegraph, Decrypt, Bitcoin.com); no testimonials, user counts, or benchmarks exist and none may be invented.

## Product Principles

1. Speed is the feature: data shows up the moment it arrives; nothing on screen waits for decoration.
2. Numbers must be true: indicator math matches TradingView; stale data is never shown as live.
3. The chart owns the screen; everything else is a quiet frame around it.
4. Honest copy: rule-based reads are labeled as such, with no buy/sell advice.
