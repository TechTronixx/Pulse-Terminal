// js/instruments.js -- every market the terminal can show, grouped Crypto / Stocks / Commodities.
// Crypto trades on Binance spot. Stocks, ETFs and commodities are Binance USD-M "TradFi"
// perpetuals: contracts that track the underlying and trade 24/7.
// Browser global `PulseInstruments`, Node `require("./js/instruments.js")`.
(function (global) {
  "use strict";

  const GROUPS = [
    { id: "crypto", name: "Crypto" },
    { id: "stocks", name: "Stocks" },
    { id: "commodities", name: "Commodities" },
  ];

  // cg = CoinGecko id (fundamentals), news = news feed key for /api/news, mono = icon monogram
  const LIST = [
    // ---- crypto (spot) ----
    { id: "BTC", name: "Bitcoin", group: "crypto", cg: "bitcoin" },
    { id: "ETH", name: "Ethereum", group: "crypto", cg: "ethereum" },
    { id: "SOL", name: "Solana", group: "crypto", cg: "solana" },
    { id: "BNB", name: "BNB", group: "crypto", cg: "binancecoin" },
    { id: "XRP", name: "XRP", group: "crypto", cg: "ripple" },
    { id: "DOGE", name: "Dogecoin", group: "crypto", cg: "dogecoin" },
    { id: "ADA", name: "Cardano", group: "crypto", cg: "cardano" },
    { id: "LINK", name: "Chainlink", group: "crypto", cg: "chainlink" },
    { id: "HYPE", name: "Hyperliquid", group: "crypto", cg: "hyperliquid", mono: "H", color: "#4fd1b8" },
    { id: "SUI", name: "Sui", group: "crypto", cg: "sui" },
    { id: "AVAX", name: "Avalanche", group: "crypto", cg: "avalanche-2" },
    { id: "LTC", name: "Litecoin", group: "crypto", cg: "litecoin" },
    { id: "TRX", name: "TRON", group: "crypto", cg: "tron" },
    { id: "PEPE", name: "Pepe", group: "crypto", cg: "pepe" },
    // ---- stocks and index ETFs (perp) ----
    { id: "SPY", name: "S&P 500 ETF", group: "stocks", mono: "SPY", color: "#5b7bd5", kind: "ETF" },
    { id: "QQQ", name: "Nasdaq 100 ETF", group: "stocks", mono: "QQQ", color: "#2a9d8f", kind: "ETF" },
    { id: "NVDA", name: "NVIDIA", group: "stocks", mono: "NV", color: "#76b900" },
    { id: "TSLA", name: "Tesla", group: "stocks", mono: "T", color: "#e31937" },
    { id: "AAPL", name: "Apple", group: "stocks", mono: "A", color: "#9aa0a6" },
    { id: "MSFT", name: "Microsoft", group: "stocks", mono: "MS", color: "#00a4ef" },
    { id: "AMZN", name: "Amazon", group: "stocks", mono: "a", color: "#ff9900" },
    { id: "GOOGL", name: "Alphabet", group: "stocks", mono: "G", color: "#4285f4" },
    { id: "META", name: "Meta", group: "stocks", mono: "M", color: "#0866ff" },
    { id: "AMD", name: "AMD", group: "stocks", mono: "AMD", color: "#ed1c24" },
    { id: "MSTR", name: "Strategy", group: "stocks", mono: "MS", color: "#f7931a" },
    { id: "COIN", name: "Coinbase", group: "stocks", mono: "C", color: "#0052ff" },
    // ---- commodities (perp) ----
    { id: "XAU", name: "Gold", group: "commodities", mono: "Au", color: "#d4a72c", news: "GC=F" },
    { id: "XAG", name: "Silver", group: "commodities", mono: "Ag", color: "#b8bcc2", news: "SI=F" },
    { id: "CL", name: "WTI Crude Oil", group: "commodities", mono: "WTI", color: "#3d3d3d", news: "CL=F" },
    { id: "BZ", name: "Brent Crude Oil", group: "commodities", mono: "BR", color: "#5a4632", news: "BZ=F" },
    { id: "NATGAS", name: "Natural Gas", group: "commodities", mono: "NG", color: "#3b82f6", news: "NG=F" },
    { id: "COPPER", name: "Copper", group: "commodities", mono: "Cu", color: "#b87333", news: "HG=F" },
    { id: "XPT", name: "Platinum", group: "commodities", mono: "Pt", color: "#8e9aa6", news: "PL=F" },
  ];

  for (const it of LIST) {
    it.symbol = `${it.id}USDT`;
    it.venue = it.group === "crypto" ? "spot" : "perp";
    it.icon = it.mono ? `icons/markets/${it.id.toLowerCase()}.svg` : `icons/coins/${it.id.toLowerCase()}.svg`;
    it.label = it.venue === "spot" ? `${it.id}-USDT` : it.id;
    if (!it.news) it.news = it.group === "stocks" ? it.id : null;
    if (!it.kind) it.kind = it.group === "stocks" ? "Stock" : it.group === "commodities" ? "Commodity" : "Crypto";
  }

  const BY_ID = Object.fromEntries(LIST.map((i) => [i.id, i]));
  const get = (id) => BY_ID[id] || null;
  const inGroup = (g) => LIST.filter((i) => i.group === g);

  const api = { GROUPS, LIST, get, inGroup };
  global.PulseInstruments = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
