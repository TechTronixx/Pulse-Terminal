# Pulse Terminal

[![Live Demo](https://img.shields.io/badge/Live_Demo-green?style=for-the-badge)](https://pulse-terminal.vercel.app)
[![GitHub](https://img.shields.io/badge/GitHub-100000?style=for-the-badge&logo=github&logoColor=white)](https://github.com/TechTronixx/Pulse-Terminal)
![Issues](https://img.shields.io/github/issues/TechTronixx/Pulse-Terminal)
![Stars](https://img.shields.io/github/stars/TechTronixx/Pulse-Terminal)
![Last commit](https://img.shields.io/github/last-commit/TechTronixx/Pulse-Terminal)
![License](https://img.shields.io/github/license/TechTronixx/Pulse-Terminal)

A fast, single-view terminal for crypto, US stocks and commodities in real time, powered by Binance's public WebSocket and REST APIs.

## Screenshots

|              Light Mode               |              Dark Mode              |
| :-----------------------------------: | :---------------------------------: |
| ![Light Mode](./screenshot-light.png) | ![Dark Mode](./screenshot-dark.png) |

## Live Demo

**https://pulse-terminal.vercel.app**

## Key Features

- **Crypto, stocks and commodities** — 14 crypto pairs on Binance spot; SPY, QQQ, NVIDIA, Tesla, Apple, Microsoft, Amazon, Alphabet, Meta, AMD, Strategy and Coinbase; gold, silver, WTI and Brent crude, natural gas, copper and platinum. Stocks and commodities come from Binance USD-M perpetuals that track the real price and trade 24/7 (they can drift from the official price outside market hours).

- **Trade-speed chart** — Candles move on every Binance trade (`@aggTrade`) and are reconciled against Binance's own klines, so OHLCV matches the exchange.
- **Live order book** — Top 20 levels every 100 ms over the same WebSocket, with spread and bid/ask pressure.
- **Market Cipher B** — Line-for-line port of the Pine Script v6 source: WaveTrend fast/slow/VWAP areas, MFI band, RSI and Stoch lines, cross dots, bottom/top signals, editable inputs, and its four alert conditions (in-app and browser notifications, on bar close).
- **Indicators** — Volume, session VWAP (seeded from 00:00 UTC), EMA 9/21, RSI 14 in its own pane, and VPVR.
- **Pulse verdict (Signal tab)** — Long / Short / Wait with bias, score, entry, invalidation, and a 1:2 target. Built from Market Cipher B on 5m, 15m, 1h, 4h, and 1d plus the chart's classic indicators (55%), Fear & Greed sentiment (15%), news tone (15%), and CoinGecko fundamentals (15%). Rule-based, not financial advice.
- **Market Cipher B by timeframe** — Zone, last dot, and read for every timeframe, with the reasons in a tooltip.
- **Market tab** — Crypto Fear & Greed Index, coin headlines from CoinDesk, Cointelegraph, Decrypt, and Bitcoin.com tagged bullish / bearish, and fundamentals (market cap, FDV, supply, distance from ATH, 7d / 30d trend).
- **Insights** — Chart-timeframe indicator summary, order-book pressure, activity, MACD momentum, and Bollinger volatility.
- **Watchlist** — Star any market (or press `W`) and follow crypto, stocks and commodities side by side: live price, 24h change and the 1h Market Cipher B read (Long / Short / Wait). Click a row to open it.
- **Built-in help** — ? explanations for every indicator, a Market Cipher B guide in its settings, and tooltips across the UI.
- **Timeframes** — 1s (crypto only), 1m, 3m, 5m, 15m, 30m, 1h, 4h, 1D, 1W and 1M, with up to 1,000 bars of history.
- **Keyboard first** — `Ctrl K` / `⌘K` or `/` opens a command palette for pairs, timeframes, indicators, and views.
- **Smooth navigation** — Trackpad scroll and pinch move the chart directly, mouse-wheel notches ease in, the price axis rescales smoothly instead of jumping, and drag keeps kinetic momentum. Indicator panes resize by dragging their divider; the right panel resizes by dragging its left edge or with the wide-panel button, which puts the verdict and timeframes side by side.

## Tech Stack

- **Core** — Vanilla HTML5, CSS3, JavaScript (ES6+). No build step.
- **Charting** — [Lightweight Charts](https://www.tradingview.com/lightweight-charts/) v5.3.0 (panes, custom series primitives).
- **Icons** — Tabler UI icons and Cryptocurrency Color coin icons from [Iconify](https://iconify.design), stored locally.
- **Fonts** — Satoshi (Fontshare) and Chivo Mono (Google Fonts), self-hosted in onts/.
- **News** — pi/news.js, a Vercel serverless function that reads public RSS feeds and scores headlines. No API key needed.
- **Market data** — [alternative.me Fear & Greed](https://alternative.me/crypto/fear-and-greed-index/) and [CoinGecko](https://www.coingecko.com/) public APIs.
- **API** — Binance public WebSocket and REST API, with automatic fallback to `data-api.binance.vision` / `data-stream.binance.vision`.

## Project Layout

| File | Role |
| --- | --- |
| `js/indicators.js` | Pure indicator math with Pine Script semantics (na handling, SMA-seeded EMA, `ta.stoch`, crossovers, Market Cipher B). |
| `js/instruments.js` | Market catalog (crypto / stocks / commodities, venue, icons, news symbols). |
| `js/feed.js` | Binance spot and USD-M perpetual feed: history, WebSockets, trade-built candles, reconnect with backoff. |
| `js/chart.js` | Lightweight Charts setup, panes, and series mapping. |
| `js/vpvr.js`, `js/vpvr-view.js` | Volume profile math and overlay. |
| `js/verdict.js` | Pulse verdict rules (per-timeframe Market Cipher B read, component scores, levels). |
| `js/market.js` | Multi-timeframe klines, Fear & Greed, CoinGecko, and news polling. |
| `api/news.js`, `api/_news-core.js` | News function (crypto RSS, Yahoo Finance for stocks and commodities) and headline scoring. |
| `api/sentiment.js` | CNN US stock market Fear & Greed, proxied for the browser. |
| `scripts/make-icons.js` | Generates the monogram icons in `icons/markets/`. |
| `scripts/dev.js` | Local server for the site and `/api/news`. |
| `js/app.js` | State, UI, order book, Signal and Market tabs, palette, tooltips, alerts. |
| `tests/` | Unit tests for indicator math, verdict rules, and news scoring. |

## Tests

```bash
node --test tests/indicators.test.js tests/verdict.test.js tests/instruments.test.js
```

## Quick Start

No build tools or dependencies required. Run `node scripts/dev.js` and open `http://127.0.0.1:4173`. Opening `Terminal-main.html` directly also works, but the News list needs the `/api/news` function.

## Running Locally

```bash
git clone https://github.com/TechTronixx/Pulse-Terminal.git
cd Pulse-Terminal
node scripts/dev.js
```

Then visit `http://127.0.0.1:4173`. The dev server serves the site and `/api/news`. On Vercel, `api/news.js` deploys automatically as a serverless function.

## Disclaimer

- Market data comes from Binance's public endpoints; the only server code is the read-only news function.
- Does not place trades, hold funds, or access private accounts.
- Do not enter private keys or trading credentials anywhere in this app.
- You are responsible for complying with Binance's terms of service.
- Provided "AS IS", without warranty of any kind.

## License

MIT — see [LICENSE](./LICENSE).
