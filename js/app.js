// js/app.js -- Pulse Terminal orchestration: state, feed -> model -> chart, and the UI.
// Depends on PulseIndicators, PulseFeed, PulseChart, VPVR, VPVRView (loaded before it).
(function () {
  "use strict";

  const I = window.PulseIndicators;
  const IN = window.PulseInstruments;
  const PAIRS = IN.LIST.map((i) => i.id);
  const inst = () => IN.get(state.pair);
  const TIMEFRAMES = ["1s", "1m", "3m", "5m", "15m", "30m"];
  const CHART_TYPES = { candlestick: "Candles", heikinAshi: "Heikin Ashi", line: "Line" };
  const INDICATORS = [
    { key: "vol", name: "Volume", desc: "Bars at the bottom of the price pane: how much traded in each candle. Copper = candle closed up, grey = closed down." },
    { key: "vwap", name: "VWAP", note: "Session, UTC", desc: "Volume-weighted average price since 00:00 UTC. Price above VWAP means buyers are paying more than today's average; below means sellers are in control." },
    { key: "ema", name: "EMA 9 / 21", desc: "Two exponential moving averages. Blue (9) reacts fast, purple (21) is slower. Blue above purple = short-term uptrend." },
    { key: "rsi", name: "RSI 14", desc: "Relative Strength Index in its own pane, 0 to 100. Above 70 = overbought, below 30 = oversold." },
    { key: "vpvr", name: "VPVR", note: "Visible range", settings: "menuVpvr", desc: "Volume profile on the right edge: how much traded at each price in the visible range. POC = busiest price, VAH / VAL = the band holding 70% of volume." },
    { key: "mcb", name: "Market Cipher B", note: "WaveTrend, MFI, Stoch", settings: "menuMcb", desc: "Momentum oscillator. Blue waves show momentum, green / red area shows money flow, dots mark crosses. Big green dot at the bottom = oversold buy signal, big red dot at the top = overbought sell signal. Open settings for the full guide." },
  ];
  const MCB_ALERTS = [
    { key: "buy", title: "Buy Signal - Green dot wavetrend", tone: "up" },
    { key: "sell", title: "Sell Signal - Red dot wavetrend", tone: "down" },
    { key: "buySignal", title: "Green dot(Buy)-(Botton)", tone: "up" },
    { key: "sellSignal", title: "Red Dot(Sell)-(Top)", tone: "down" },
  ];
  const STORE_KEY = "pulse.v2";
  const $ = (id) => document.getElementById(id);
  const isNa = I.isNa;

  // ---------------------------------------------------------------- state
  const defaults = {
    pair: "BTC",
    group: "crypto",
    tf: "1m",
    chartType: "candlestick",
    theme: document.documentElement.getAttribute("data-theme") || "dark",
    panel: "book",
    panelOpen: true,
    panelW: null,
    ind: { vol: true, vwap: false, ema: false, rsi: false, vpvr: false, mcb: true },
    mcb: Object.assign({}, I.MCB_DEFAULTS),
    alerts: { inApp: true, notify: false },
    vpvr: {},
  };

  function loadState() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    } catch (_) {}
    const s = Object.assign({}, defaults, saved);
    s.ind = Object.assign({}, defaults.ind, saved.ind);
    s.mcb = Object.assign({}, defaults.mcb, saved.mcb);
    s.alerts = Object.assign({}, defaults.alerts, saved.alerts);
    s.vpvr = Object.assign({}, window.VPVRView ? VPVRView.DEFAULTS : {}, saved.vpvr, { enabled: !!s.ind.vpvr });
    if (!PAIRS.includes(s.pair)) s.pair = defaults.pair;
    if (!IN.GROUPS.some((g) => g.id === s.group)) s.group = IN.get(s.pair).group;
    if (!PulseFeed.supports(IN.get(s.pair).venue, s.tf)) s.tf = "1m";
    if (s.panel === "insights") s.panel = "signal";
    if (!["book", "signal", "market"].includes(s.panel)) s.panel = "book";
    if (!TIMEFRAMES.includes(s.tf)) s.tf = defaults.tf;
    if (!CHART_TYPES[s.chartType]) s.chartType = defaults.chartType;
    return s;
  }

  const state = loadState();
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(state));
      } catch (_) {}
    }, 200);
  }

  // ---------------------------------------------------------------- formatting
  const symbolInfo = {};
  const fmtCache = {};
  function nf(dp) {
    if (!fmtCache[dp]) fmtCache[dp] = new Intl.NumberFormat("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
    return fmtCache[dp];
  }
  function guessPrecision(p) {
    if (!(p > 0)) return 2;
    if (p >= 1000) return 2;
    if (p >= 10) return 3;
    if (p >= 1) return 4;
    return 5;
  }
  function pricePrecision(pair, sample) {
    const info = symbolInfo[pair];
    return info ? info.precision : guessPrecision(sample);
  }
  const fmtPrice = (v, pair = state.pair) => (isNa(v) ? "\u2013" : nf(pricePrecision(pair, v)).format(v));
  const fmtNum = (v, dp = 2) => (isNa(v) ? "\u2013" : nf(dp).format(v));
  function fmtCompact(v) {
    if (isNa(v)) return "\u2013";
    const a = Math.abs(v);
    if (a >= 1e9) return nf(2).format(v / 1e9) + "B";
    if (a >= 1e6) return nf(2).format(v / 1e6) + "M";
    if (a >= 1e3) return nf(2).format(v / 1e3) + "K";
    return nf(2).format(v);
  }
  function fmtQty(v) {
    if (isNa(v)) return "\u2013";
    if (v >= 1e5) return fmtCompact(v);
    if (v >= 100) return nf(2).format(v);
    if (v >= 1) return nf(3).format(v);
    return nf(4).format(v);
  }
  const fmtPct = (v) => (isNa(v) ? "\u2013" : (v >= 0 ? "+" : "") + nf(2).format(v) + "%");
  const coinIcon = (id) => (IN.get(id) ? IN.get(id).icon : "icons/favicon.svg");
  const venueName = (it) => (it.venue === "spot" ? "Binance spot" : "Binance perp");
  const labelOf = (id) => (IN.get(id) ? IN.get(id).label : id);

  // ---------------------------------------------------------------- chart + model
  const chartView = PulseChart.create($("chart"), { theme: state.theme });
  let model = { bars: [], ha: [], vwap: [], ema9: [], ema21: [], rsi: [], mcb: null };
  let vpvrView = null;
  let lastBarTime = null;
  let hoverIndex = -1;
  let historyReady = false;
  let lastComputeAt = 0;
  let trailingTimer = 0;
  const LIVE_RECOMPUTE_MS = 80;

  function computeModel(bars) {
    const closes = bars.map((b) => b.close);
    lastComputeAt = performance.now();
    return {
      bars,
      ha: state.chartType === "heikinAshi" ? I.heikinAshi(bars) : null,
      vwap: I.vwap(bars, vwapSeed),
      ema9: I.ema(closes, 9),
      ema21: I.ema(closes, 21),
      rsi: I.rsi(closes, 14),
      mcb: state.ind.mcb ? I.marketCipherB(bars, state.mcb) : null,
      closes,
    };
  }

  // Intra-bar ticks between full recomputes: move only the live candle and its volume.
  function updateLiveBarOnly() {
    const bars = model.bars;
    const n = bars.length;
    if (state.chartType === "heikinAshi" && model.ha && n) {
      const b = bars[n - 1];
      const prev = model.ha[n - 2];
      const close = (b.open + b.high + b.low + b.close) / 4;
      const open = prev ? (prev.open + prev.close) / 2 : (b.open + b.close) / 2;
      model.ha[n - 1] = { time: b.time, open, high: Math.max(b.high, open, close), low: Math.min(b.low, open, close), close };
    }
    chartView.updateLive(model);
  }

  // ---- VWAP session seed (history can start after 00:00 UTC on 1s / 1m) ----
  let vwapSeed = null;
  let seedGen = 0;

  function addToSeed(seed, list, day) {
    let pv = seed && seed.day === day ? seed.pv : 0;
    let vol = seed && seed.day === day ? seed.vol : 0;
    for (const b of list) {
      if (Math.floor(b.time / 86400) !== day) continue;
      pv += ((b.high + b.low + b.close) / 3) * b.volume;
      vol += b.volume;
    }
    return { day, pv, vol };
  }

  async function loadVwapSeed(bars) {
    const myGen = ++seedGen;
    vwapSeed = null;
    if (!bars.length) return;
    const first = bars[0].time;
    const day = Math.floor(first / 86400);
    const dayStart = day * 86400;
    if (first <= dayStart) return;
    const pair = state.pair;
    try {
      const minuteEdge = Math.floor(first / 60) * 60;
      const parts = await Promise.all([
        minuteEdge > dayStart ? PulseFeed.fetchKlines(IN.get(pair), "1m", dayStart * 1000, minuteEdge * 1000) : [],
        first > minuteEdge && IN.get(pair).venue === "spot" ? PulseFeed.fetchKlines(IN.get(pair), "1s", minuteEdge * 1000, first * 1000) : [],
      ]);
      if (myGen !== seedGen || pair !== state.pair) return;
      vwapSeed = addToSeed(null, parts[0].concat(parts[1]), day);
      model = computeModel(model.bars);
      chartView.setData(model);
      updateLegend();
    } catch (err) {
      console.warn("[vwap seed]", err);
    }
  }

  function recreateVpvr() {
    if (vpvrView) {
      vpvrView.destroy();
      vpvrView = null;
    }
    if (window.VPVRView) {
      vpvrView = VPVRView.create(chartView.chart, chartView.main, () => model.bars);
      if (vpvrView) vpvrView.setSettings(state.vpvr);
    }
  }

  function applyIndicators() {
    chartView.setMcbParams(state.mcb);
    chartView.setIndicators(state.ind);
    model = computeModel(model.bars);
    if (model.bars.length) chartView.setData(model);
    state.vpvr.enabled = !!state.ind.vpvr;
    if (vpvrView) vpvrView.setSettings({ enabled: state.vpvr.enabled });
    renderIndicatorMenu();
    renderLegendVisibility();
    updateLegend();
    queuePaneLayout();
    if (typeof recomputeMtf === "function") {
      recomputeMtf();
      updateInsights(true);
    }
    save();
  }

  // ---------------------------------------------------------------- feed
  const feed = PulseFeed.create({
    onHistory(bars) {
      vwapSeed = null;
      model = computeModel(bars);
      chartView.setData(model);
      const n = bars.length;
      if (n) {
        chartView.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 160), to: n + 8 });
        lastBarTime = bars[n - 1].time;
      }
      historyReady = true;
      if (vpvrView) vpvrView.update();
      $("streamOverlay").classList.add("is-hidden");
      updateQuote();
      updateLegend();
      updateInsights(true);
      loadVwapSeed(bars);
    },
    onBars(bars, { from, reset, closedTimes, trimmed }) {
      if (!historyReady) return;
      const n = bars.length;
      const newBar = n && bars[n - 1].time !== lastBarTime;
      if (trimmed && trimmed.length && n) {
        vwapSeed = addToSeed(vwapSeed, trimmed, Math.floor(bars[0].time / 86400));
      }
      const liveOnly =
        !newBar && !reset && !(closedTimes && closedTimes.length) && from >= n - 1 &&
        performance.now() - lastComputeAt < LIVE_RECOMPUTE_MS;
      if (liveOnly) {
        model.bars = bars;
        updateLiveBarOnly();
        clearTimeout(trailingTimer);
        trailingTimer = setTimeout(() => {
          if (!historyReady || model.bars !== bars) return;
          model = computeModel(bars);
          chartView.update(model, bars.length - 1);
          if (vpvrView) vpvrView.update();
          if (hoverIndex < 0) updateLegend();
        }, LIVE_RECOMPUTE_MS);
      } else {
        clearTimeout(trailingTimer);
        model = computeModel(bars);
        if (reset) chartView.setData(model);
        else chartView.update(model, from);
        if (vpvrView) vpvrView.update();
      }
      if (newBar) lastBarTime = bars[n - 1].time;
      // Alerts run on Binance's final kline for the bar (x=true), like a bar-close alertcondition.
      if (!liveOnly && closedTimes) for (const t of closedTimes) checkAlerts(barIndexAtTime(t));
      updateQuote();
      if (hoverIndex < 0) updateLegend();
      updateInsights(false);
    },
    onDepth(depth) {
      renderBook(depth);
    },
    onTicker(tk) {
      renderTicker(tk);
    },
    onStatus(s) {
      renderStatus(s);
    },
    onStats(st) {
      $("latency").textContent = isNa(st.latency) ? "Feed \u2013 ms" : `Feed ${Math.round(st.latency)} ms`;
      $("tps").textContent = `${st.tradesPerSec} trades/s`;
    },
    onError(err) {
      console.error("[feed]", err);
      $("streamText").textContent = "Binance did not respond. Retrying automatically.";
      $("streamOverlay").classList.remove("is-hidden");
    },
  });

  function startFeed() {
    historyReady = false;
    lastBarTime = null;
    lastBook = null;
    lastTicker = null;
    vwapSeed = null;
    seedGen++;
    clearTimeout(trailingTimer);
    model = computeModel([]);
    chartView.setData(model);
    $("streamText").textContent = `Loading 1,000 ${state.tf} bars from Binance`;
    $("streamOverlay").classList.remove("is-hidden");
    resetBookView();
    feed.start(inst(), state.tf);
  }

  // ---------------------------------------------------------------- pair / timeframe / type
  function applyPrecision() {
    const info = symbolInfo[state.pair];
    if (info) chartView.setPrecision(info.precision, info.tickSize);
  }

  function switchPair(pair) {
    if (pair === state.pair || !IN.get(pair)) return;
    state.pair = pair;
    state.group = IN.get(pair).group;
    // futures have no 1s candles
    if (!PulseFeed.supports(inst().venue, state.tf)) {
      state.tf = "1m";
      chartView.setSecondsVisible(false);
    }
    save();
    renderGroups();
    renderPairTabs();
    renderTimeframes();
    renderSymbol();
    applyPrecision();
    startFeed();
    resetMarketData();
    market.start(inst());
  }

  function switchTimeframe(tf) {
    if (tf === state.tf || !PulseFeed.supports(inst().venue, tf)) return;
    state.tf = tf;
    save();
    renderTimeframes();
    chartView.setSecondsVisible(tf === "1s");
    startFeed();
  }

  function switchChartType(type) {
    if (type === state.chartType) return;
    state.chartType = type;
    save();
    renderChartTypes();
    model = computeModel(model.bars);
    chartView.setChartType(type, model);
    applyPrecision();
    recreateVpvr();
  }

  function toggleIndicator(key, on) {
    state.ind[key] = on === undefined ? !state.ind[key] : !!on;
    applyIndicators();
  }

  // ---------------------------------------------------------------- top bar
  function renderGroups() {
    const seg = $("groupSeg");
    if (!seg.children.length) {
      for (const g of IN.GROUPS) {
        const b = document.createElement("button");
        b.type = "button";
        b.setAttribute("role", "tab");
        b.dataset.group = g.id;
        b.textContent = g.name;
        b.dataset.tip =
          g.id === "crypto"
            ? "Crypto on Binance spot"
            : `${g.name} as Binance perpetual contracts: they track the real price and trade 24/7`;
        b.addEventListener("click", () => showGroup(g.id));
        seg.appendChild(b);
      }
    }
    for (const b of seg.children) b.setAttribute("aria-selected", String(b.dataset.group === state.group));
  }

  // switching the group shows its markets; the chart changes when a market is picked
  function showGroup(g) {
    if (g === state.group) return;
    state.group = g;
    save();
    renderGroups();
    renderPairTabs();
    pollTickers(true);
  }

  function renderPairTabs() {
    const nav = $("pairTabs");
    nav.innerHTML = "";
    for (const it of IN.inGroup(state.group)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pair-tab";
      b.dataset.pair = it.id;
      b.dataset.tip = `${it.name} \u00b7 ${venueName(it)}`;
      b.setAttribute("aria-pressed", String(it.id === state.pair));
      b.innerHTML =
        `<img src="${it.icon}" alt="" width="14" height="14" />` +
        `<span class="pair-sym">${it.id}</span>` +
        `<span class="pair-chg num" data-chg>\u2013</span>`;
      b.addEventListener("click", () => switchPair(it.id));
      nav.appendChild(b);
      if (miniCache[it.id]) renderPairTab(it.id, miniCache[it.id]);
    }
    const active = nav.querySelector('[aria-pressed="true"]');
    if (active) active.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  const miniCache = {};
  function renderPairTab(base, mini) {
    miniCache[base] = mini;
    const el = document.querySelector(`.pair-tab[data-pair="${base}"] [data-chg]`);
    if (!el) return;
    el.textContent = fmtPct(mini.changePct);
    el.dataset.dir = mini.changePct >= 0 ? "up" : "down";
  }

  // 24h change for the visible group's tabs (REST, every 5 s while the tab is visible)
  let tickerTimer = 0;
  let tickerBusy = false;
  function pollTickers(now) {
    clearTimeout(tickerTimer);
    const run = () => {
      if (document.hidden || tickerBusy) return schedule();
      tickerBusy = true;
      PulseFeed.fetchTickers(IN.inGroup(state.group))
        .then((t) => {
          for (const id in t) renderPairTab(id, t[id]);
        })
        .catch((e) => console.warn("[tickers]", e))
        .finally(() => {
          tickerBusy = false;
          schedule();
        });
    };
    const schedule = () => (tickerTimer = setTimeout(run, 5000));
    if (now) run();
    else schedule();
  }

  function renderSymbol() {
    const it = inst();
    document.querySelectorAll(".pair-tab").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.pair === state.pair)));
    $("symbolText").textContent = it.label;
    $("symbolIcon").src = it.icon;
    $("symbolVenue").textContent = it.venue === "spot" ? "Binance spot" : `${it.kind} \u00b7 perp`;
    $("symbolName").textContent = it.name;
    $("symbolBox").dataset.tip =
      it.venue === "spot"
        ? `${it.name} on Binance spot. Click to change market.`
        : `${it.name}: a Binance USD-M perpetual that tracks the real price and trades 24/7. Outside regular market hours it can drift from the official price. Click to change market.`;
    $("lgSymbol").textContent = it.label;
    $("bookBase").textContent = `(${it.id})`;
    $("statusSrc").textContent = it.venue === "spot" ? "Binance spot, public data" : "Binance USD-M perpetual, public data";
    renderLegendMeta();
  }

  function renderLegendMeta() {
    $("lgMeta").textContent = `${state.tf} \u00b7 ${CHART_TYPES[state.chartType]} \u00b7 ${venueName(inst())}`;
  }

  function renderTimeframes() {
    const seg = $("tfSeg");
    if (!seg.children.length) {
      for (const tf of TIMEFRAMES) {
        const b = document.createElement("button");
        b.type = "button";
        b.setAttribute("role", "radio");
        b.dataset.tf = tf;
        b.textContent = tf;
        b.addEventListener("click", () => switchTimeframe(tf));
        seg.appendChild(b);
      }
    }
    const venue = inst().venue;
    for (const b of seg.children) {
      const ok = PulseFeed.supports(venue, b.dataset.tf);
      b.disabled = !ok;
      if (!ok) b.dataset.tip = "1s candles are only available for crypto spot";
      else delete b.dataset.tip;
      b.setAttribute("aria-checked", String(b.dataset.tf === state.tf));
    }
    renderLegendMeta();
  }

  function renderChartTypes() {
    for (const b of $("typeSeg").children) b.setAttribute("aria-checked", String(b.dataset.type === state.chartType));
    renderLegendMeta();
  }

  $("typeSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-type]");
    if (b) switchChartType(b.dataset.type);
  });

  function applyTheme(name) {
    state.theme = name;
    document.documentElement.setAttribute("data-theme", name);
    document.querySelector('meta[name="theme-color"]').setAttribute("content", name === "dark" ? "#0d0d0d" : "#fbfbfa");
    $("themeIcon").setAttribute("href", name === "dark" ? "#i-sun" : "#i-moon");
    $("themeBtn").setAttribute("aria-label", name === "dark" ? "Switch to light theme" : "Switch to dark theme");
    chartView.setTheme(name, model);
    if (vpvrView) vpvrView.refreshTheme();
    save();
  }
  $("themeBtn").addEventListener("click", () => applyTheme(state.theme === "dark" ? "light" : "dark"));

  // ---------------------------------------------------------------- quote + ticker
  let lastTicker = null;
  let prevPrice = NaN;
  let titleAt = 0;

  function updateQuote() {
    const bars = model.bars;
    if (!bars.length) return;
    const price = bars[bars.length - 1].close;
    const el = $("lastPrice");
    el.textContent = fmtPrice(price);
    if (!isNa(prevPrice) && price !== prevPrice) el.dataset.dir = price > prevPrice ? "up" : "down";
    prevPrice = price;
    const now = Date.now();
    if (now - titleAt > 1000) {
      titleAt = now;
      document.title = `${fmtPrice(price)} ${labelOf(state.pair)} \u00b7 Pulse Terminal`;
    }
    if (lastTicker && lastTicker.open) {
      const pct = ((price - lastTicker.open) / lastTicker.open) * 100;
      const chip = $("changeChip");
      chip.textContent = fmtPct(pct);
      chip.dataset.dir = pct >= 0 ? "up" : "down";
    }
  }

  function renderTicker(tk) {
    lastTicker = tk;
    $("sHigh").textContent = fmtPrice(tk.high);
    $("sLow").textContent = fmtPrice(tk.low);
    $("sQvol").textContent = "$" + fmtCompact(tk.quoteVolume);
    $("st-high").textContent = fmtPrice(tk.high);
    $("st-low").textContent = fmtPrice(tk.low);
    $("st-open").textContent = fmtPrice(tk.open);
    $("st-trades").textContent = nf(0).format(tk.trades);
    $("st-vol").textContent = fmtCompact(tk.volume) + " " + state.pair;
    $("st-qvol").textContent = "$" + fmtCompact(tk.quoteVolume);
    updateQuote();
  }

  // ---------------------------------------------------------------- order book
  const BOOK_ROWS = 12;
  let bookRows = { asks: [], bids: [] };
  let lastBook = null;

  function buildBookRows() {
    for (const side of ["asks", "bids"]) {
      const host = $(side === "asks" ? "bookAsks" : "bookBids");
      host.innerHTML = "";
      bookRows[side] = [];
      for (let i = 0; i < BOOK_ROWS; i++) {
        const row = document.createElement("div");
        row.className = "book-row";
        row.innerHTML = '<span class="book-depth"></span><span class="book-price num"></span><span class="num"></span><span class="num"></span>';
        host.appendChild(row);
        const [depth, price, size, total] = row.children;
        bookRows[side].push({ depth, price, size, total });
      }
    }
  }

  function resetBookView() {
    for (const side of ["asks", "bids"]) {
      for (const r of bookRows[side]) {
        r.price.textContent = r.size.textContent = r.total.textContent = "";
        r.depth.style.transform = "scaleX(0)";
      }
    }
    $("bookMid").textContent = "\u2013";
    $("bookSpread").textContent = "Spread \u2013";
    $("pressBid").style.transform = "scaleX(0.5)";
    $("pressBidTxt").textContent = "Bids \u2013";
    $("pressAskTxt").textContent = "\u2013 Asks";
  }

  function renderBook(depth) {
    lastBook = depth;
    const asks = depth.asks.slice(0, BOOK_ROWS);
    const bids = depth.bids.slice(0, BOOK_ROWS);
    if (!asks.length || !bids.length) return;
    let cum = 0;
    const askCum = asks.map((a) => (cum += a[1]));
    cum = 0;
    const bidCum = bids.map((b) => (cum += b[1]));
    const max = Math.max(askCum[askCum.length - 1], bidCum[bidCum.length - 1]) || 1;

    // asks: best ask sits at the bottom of the ask block, next to the spread
    for (let i = 0; i < BOOK_ROWS; i++) {
      const r = bookRows.asks[BOOK_ROWS - 1 - i];
      const a = asks[i];
      if (!a) {
        r.price.textContent = r.size.textContent = r.total.textContent = "";
        r.depth.style.transform = "scaleX(0)";
        continue;
      }
      r.price.textContent = fmtPrice(a[0]);
      r.size.textContent = fmtQty(a[1]);
      r.total.textContent = fmtQty(askCum[i]);
      r.depth.style.transform = `scaleX(${(askCum[i] / max).toFixed(4)})`;
    }
    for (let i = 0; i < BOOK_ROWS; i++) {
      const r = bookRows.bids[i];
      const b = bids[i];
      if (!b) {
        r.price.textContent = r.size.textContent = r.total.textContent = "";
        r.depth.style.transform = "scaleX(0)";
        continue;
      }
      r.price.textContent = fmtPrice(b[0]);
      r.size.textContent = fmtQty(b[1]);
      r.total.textContent = fmtQty(bidCum[i]);
      r.depth.style.transform = `scaleX(${(bidCum[i] / max).toFixed(4)})`;
    }

    const bestAsk = depth.asks[0][0];
    const bestBid = depth.bids[0][0];
    const mid = (bestAsk + bestBid) / 2;
    const spread = bestAsk - bestBid;
    $("bookMid").textContent = fmtPrice(mid);
    $("bookSpread").textContent = `Spread ${fmtPrice(spread)} (${nf(2).format((spread / mid) * 10000)} bps)`;

    const bidVol = depth.bids.reduce((s, l) => s + l[1], 0);
    const askVol = depth.asks.reduce((s, l) => s + l[1], 0);
    const share = bidVol + askVol > 0 ? bidVol / (bidVol + askVol) : 0.5;
    $("pressBid").style.transform = `scaleX(${share.toFixed(4)})`;
    $("pressBidTxt").textContent = `Bids ${Math.round(share * 100)}%`;
    $("pressAskTxt").textContent = `${100 - Math.round(share * 100)}% Asks`;
  }

  // ---------------------------------------------------------------- legend
  function barIndexAtTime(time) {
    const bars = model.bars;
    let lo = 0;
    let hi = bars.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (bars[mid].time === time) return mid;
      if (bars[mid].time < time) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }

  function setVal(id, v, fmt) {
    const el = $(id);
    const txt = fmt(v);
    if (el.textContent !== txt) el.textContent = txt;
  }

  function updateLegend() {
    const bars = model.bars;
    if (!bars.length) return;
    const i = hoverIndex >= 0 && hoverIndex < bars.length ? hoverIndex : bars.length - 1;
    const b = bars[i];
    setVal("lgO", b.open, fmtPrice);
    setVal("lgH", b.high, fmtPrice);
    setVal("lgL", b.low, fmtPrice);
    setVal("lgC", b.close, fmtPrice);
    const chg = b.close - b.open;
    const chgEl = $("lgChg");
    chgEl.textContent = `${chg >= 0 ? "+" : ""}${fmtPrice(chg)} (${fmtPct(b.open ? (chg / b.open) * 100 : NaN)})`;
    chgEl.dataset.dir = chg >= 0 ? "up" : "down";
    setVal("lgV", b.volume, fmtQty);
    if (state.ind.vwap) setVal("lgVwap", model.vwap[i], fmtPrice);
    if (state.ind.ema) {
      setVal("lgEma9", model.ema9[i], fmtPrice);
      setVal("lgEma21", model.ema21[i], fmtPrice);
    }
    if (state.ind.rsi) setVal("lgRsi", model.rsi[i], (v) => fmtNum(v, 2));
    if (state.ind.mcb && model.mcb) {
      const m = model.mcb;
      setVal("lgFast", m.fast[i], (v) => fmtNum(v, 2));
      setVal("lgSlow", m.slow[i], (v) => fmtNum(v, 2));
      setVal("lgWtv", m.vwap[i], (v) => fmtNum(v, 2));
      setVal("lgMf", m.mf[i], (v) => fmtNum(v, 2));
      $("lgMf").dataset.dir = m.mf[i] > 0 ? "up" : "down";
      setVal("lgMrsi", m.rsi[i], (v) => fmtNum(v, 2));
      setVal("lgStoch", m.stoch[i], (v) => fmtNum(v, 2));
      $("lgStoch").dataset.dir = m.stoch[i] < m.rsi[i] ? "up" : "down";
    }
  }

  function renderLegendVisibility() {
    $("lgVolRow").hidden = !state.ind.vol;
    $("lgVwapRow").hidden = !state.ind.vwap;
    $("lgEmaRow").hidden = !state.ind.ema;
    $("legendMcb").hidden = !state.ind.mcb;
    $("legendRsi").hidden = !state.ind.rsi;
    const p = state.mcb;
    $("lgMcbParams").textContent = [p.wt_emaLen, p.wt_avgLen, p.wt_maLen, p.mfi_smaLen, p.mfi_signLen, p.rsi_len, p.rsi_k, p.stoch_len, p.stoch_k].join(" ");
  }

  // pane legends follow the pane tops (panes can be resized by dragging)
  let layoutRaf = 0;
  let lastLayoutKey = "";
  function queuePaneLayout() {
    if (layoutRaf) return;
    layoutRaf = requestAnimationFrame(() => {
      layoutRaf = 0;
      const layout = chartView.paneLayout();
      const key = layout.map((p) => p.id + p.top).join("|");
      if (key === lastLayoutKey) return;
      lastLayoutKey = key;
      for (const p of layout) {
        const el = p.id === "mcb" ? $("legendMcb") : p.id === "rsi" ? $("legendRsi") : null;
        if (el) el.style.transform = `translateY(${p.top}px)`;
      }
    });
  }
  new ResizeObserver(queuePaneLayout).observe($("chart-wrapper"));
  $("chart-wrapper").addEventListener("pointerup", () => setTimeout(queuePaneLayout, 0));
  $("chart-wrapper").addEventListener("pointermove", (e) => {
    if (e.buttons) queuePaneLayout();
  });

  chartView.chart.subscribeCrosshairMove((param) => {
    const idx = param && param.time !== undefined ? barIndexAtTime(param.time) : -1;
    if (idx === hoverIndex) return;
    hoverIndex = idx;
    updateLegend();
  });

  // ---------------------------------------------------------------- insights
  let insightsAt = 0;

  function setTag(id, label, tone) {
    const el = $(id);
    el.textContent = label;
    el.dataset.tone = tone;
  }

  function insightsVisible() {
    if (isMobile()) return mobileView === "signal";
    return state.panelOpen && state.panel === "signal";
  }

  function updateInsights(force) {
    const now = Date.now();
    if (!force && now - insightsAt < 250) return;
    if (!insightsVisible()) return;
    insightsAt = now;
    const bars = model.bars;
    const n = bars.length;
    if (n < 35) return;
    const i = n - 1;
    const price = bars[i].close;
    const closes = model.closes;
    const vwap = model.vwap[i];
    const rsi = model.rsi[i];
    const e9 = model.ema9[i];
    const e21 = model.ema21[i];
    const macd = I.macd(closes, 12, 26, 9);
    const hist = macd.hist[i];
    const prevHist = macd.hist[i - 1];
    const bb = I.bollinger(closes, 20, 2);
    const upper = bb.upper[i];
    const lower = bb.lower[i];
    const basis = bb.basis[i];

    // ---- signal summary: five factors, +-20 each (same scoring as before) ----
    const factors = [];
    let score = 0;
    const add = (pts, label) => {
      score += pts;
      factors.push({ label, tone: pts > 0 ? "up" : pts < 0 ? "down" : "flat" });
    };
    if (!isNa(vwap)) add(price > vwap ? 20 : -20, price > vwap ? "Price above VWAP" : "Price below VWAP");
    if (!isNa(rsi)) {
      if (rsi < 40) add(20, `RSI ${fmtNum(rsi, 1)}, below 40`);
      else if (rsi > 60) add(-20, `RSI ${fmtNum(rsi, 1)}, above 60`);
      else add(0, `RSI ${fmtNum(rsi, 1)}, between 40 and 60`);
    }
    if (!isNa(e9) && !isNa(e21)) add(e9 > e21 ? 20 : -20, e9 > e21 ? "EMA 9 above EMA 21" : "EMA 9 below EMA 21");
    if (!isNa(hist) && !isNa(prevHist)) {
      if (hist > 0 && hist > prevHist) add(20, "MACD histogram rising above zero");
      else if (hist < 0 && hist < prevHist) add(-20, "MACD histogram falling below zero");
      else add(0, "MACD histogram turning");
    }
    if (!isNa(upper) && !isNa(lower)) {
      if (price < lower) add(20, "Price below lower Bollinger Band");
      else if (price > upper) add(-20, "Price above upper Bollinger Band");
      else add(0, "Price inside Bollinger Bands");
    }

    const confidence = Math.abs(score);
    let bias = score > 0 ? "Long bias" : score < 0 ? "Short bias" : "Neutral";
    let biasTone = score > 0 ? "up" : score < 0 ? "down" : "flat";
    if (confidence < 40) {
      bias = "No clear bias";
      biasTone = "flat";
    }
    const risk = confidence >= 80 ? "Strong agreement" : confidence >= 60 ? "Moderate agreement" : "Weak agreement";
    $("sumBias").textContent = bias;
    $("sumBias").dataset.tone = biasTone;
    $("sumConf").textContent = `${confidence}% agreement`;
    $("sumConfBar").style.transform = `scaleX(${confidence / 100})`;
    $("sumConfBar").dataset.tone = biasTone;
    $("sumRisk").textContent = risk;
    const list = $("sumFactors");
    const html = factors.map((f) => `<li data-tone="${f.tone}"><i></i>${f.label}</li>`).join("");
    if (list.innerHTML !== html) list.innerHTML = html;

    lastClassic = { price, vwap, rsi, ema9: e9, ema21: e21, hist, prevHist, upper, lower };
    chartTfRead = model.mcb ? V.readTimeframe(model.mcb) : null;
    renderVerdict();

    // ---- signals ----
    $("sgRsiVal").textContent = fmtNum(rsi, 2);
    if (rsi < 30) setTag("sgRsi", "Oversold", "up");
    else if (rsi > 70) setTag("sgRsi", "Overbought", "down");
    else setTag("sgRsi", "Neutral", "flat");
    $("sgEmaVal").textContent = isNa(e9) || isNa(e21) ? "\u2013" : `${e9 - e21 >= 0 ? "+" : ""}${fmtPrice(e9 - e21)}`;
    if (isNa(e9) || isNa(e21)) setTag("sgEma", "\u2013", "flat");
    else setTag("sgEma", e9 > e21 ? "Bullish" : "Bearish", e9 > e21 ? "up" : "down");
    $("sgVwapVal").textContent = fmtPrice(vwap);
    if (isNa(vwap)) setTag("sgVwap", "\u2013", "flat");
    else setTag("sgVwap", price > vwap ? "Above" : "Below", price > vwap ? "up" : "down");
    const m = model.mcb;
    if (!m) {
      $("sgWtVal").textContent = "\u2013";
      setTag("sgWt", "MCB off", "flat");
    }
    const fast = m ? m.fast[i] : NaN;
    if (m) $("sgWtVal").textContent = fmtNum(fast, 2);
    let lastCross = -1;
    for (let k = n - 1; m && k >= 0 && k >= n - 500; k--) {
      if (m.buy[k] || m.sell[k]) {
        lastCross = k;
        break;
      }
    }
    if (!m) {
      // nothing more to show for WaveTrend
    } else if (lastCross < 0) setTag("sgWt", "No cross", "flat");
    else {
      const ago = n - 1 - lastCross;
      const up = m.buy[lastCross];
      setTag("sgWt", `Cross ${up ? "up" : "down"} ${ago === 0 ? "now" : ago + (ago === 1 ? " bar ago" : " bars ago")}`, up ? "up" : "down");
    }

    // ---- order book pressure ----
    if (lastBook && lastBook.bids.length && lastBook.asks.length) {
      const bidVol = lastBook.bids.reduce((s, l) => s + l[1], 0);
      const askVol = lastBook.asks.reduce((s, l) => s + l[1], 0);
      const share = bidVol / (bidVol + askVol || 1);
      const imbalance = Math.abs(share - 0.5) * 2;
      let wall = null;
      for (const l of lastBook.bids) if (!wall || l[1] > wall.q) wall = { q: l[1], p: l[0], side: "bid" };
      for (const l of lastBook.asks) if (l[1] > wall.q) wall = { q: l[1], p: l[0], side: "ask" };
      let text;
      if (imbalance > 0.2) text = share > 0.5 ? "Bids outweigh asks in the top 20 levels." : "Asks outweigh bids in the top 20 levels.";
      else text = "Bids and asks are roughly balanced in the top 20 levels.";
      $("inBook").textContent = text;
      $("inBookMeta").textContent = `Largest level: ${fmtQty(wall.q)} ${state.pair} ${wall.side} at ${fmtPrice(wall.p)} \u00b7 ${Math.round(share * 100)}% bids`;
    }

    // ---- activity: last closed bar vs the 20 before it ----
    if (n > 22) {
      const closedVol = bars[n - 2].volume;
      let sum = 0;
      for (let k = n - 22; k < n - 2; k++) sum += bars[k].volume;
      const avg = sum / 20;
      const ratio = avg > 0 ? closedVol / avg : NaN;
      $("inVolBar").style.transform = `scaleX(${Math.min(1, (ratio || 0) / 3).toFixed(3)})`;
      $("inVolBar").dataset.spike = String(ratio > 2.5);
      const up = bars[n - 2].close >= bars[n - 2].open;
      let text;
      if (ratio > 2.5) text = `Volume spike on a ${up ? "rising" : "falling"} bar.`;
      else if (ratio > 1.4) text = `Above-average volume on a ${up ? "rising" : "falling"} bar.`;
      else if (ratio < 0.6) text = "Quiet: volume well below average.";
      else text = "Normal volume.";
      $("inVol").textContent = text;
      $("inVolMeta").textContent = `Last closed bar ${fmtNum(ratio, 2)}x the 20-bar average`;
    }

    // ---- momentum ----
    if (!isNa(hist) && !isNa(prevHist)) {
      let text;
      if (hist > 0) text = hist > prevHist ? "Bullish momentum is building." : "Bullish momentum is fading.";
      else text = hist < prevHist ? "Bearish momentum is building." : "Bearish momentum is fading.";
      $("inMacd").textContent = text;
      $("inMacdMeta").textContent = `MACD ${fmtNum(macd.line[i], 4)} \u00b7 Signal ${fmtNum(macd.signal[i], 4)} \u00b7 Hist ${fmtNum(hist, 4)}`;
    }

    // ---- volatility ----
    if (!isNa(upper)) {
      const width = ((upper - lower) / basis) * 100;
      let text;
      if (width < 0.2) text = "Bands are very tight (squeeze). Volatility is compressed.";
      else if (price > upper) text = "Price is above the upper band.";
      else if (price < lower) text = "Price is below the lower band.";
      else text = price > basis ? "Price is in the upper half of the bands." : "Price is in the lower half of the bands.";
      $("inBb").textContent = text;
      $("inBbMeta").textContent = `Upper ${fmtPrice(upper)} \u00b7 Lower ${fmtPrice(lower)} \u00b7 Width ${fmtNum(width, 2)}%`;
    }
  }

  // ---------------------------------------------------------------- Pulse verdict + market data
  const V = window.PulseVerdict;
  let lastClassic = null;
  let chartTfRead = null;
  const mtfBars = {};
  const mtfReads = {};
  let fng = null;
  let fundamentalsData = null;
  let newsData = null;
  let verdictAt = 0;

  function recomputeMtf() {
    for (const tf in mtfBars) mtfReads[tf] = V.readTimeframe(I.marketCipherB(mtfBars[tf], state.mcb));
  }

  function resetMarketData() {
    for (const k in mtfBars) delete mtfBars[k];
    for (const k in mtfReads) delete mtfReads[k];
    fundamentalsData = null;
    newsData = null;
    fng = null;
    renderVerdict(true);
    renderMarket();
  }

  const market = PulseMarket.create({
    onKlines(tf, bars) {
      mtfBars[tf] = bars;
      mtfReads[tf] = V.readTimeframe(I.marketCipherB(bars, state.mcb));
      renderVerdict(true);
    },
    onFearGreed(v) {
      fng = v;
      renderVerdict(true);
      renderMarket();
    },
    onFundamentals(v) {
      fundamentalsData = v;
      renderVerdict(true);
      renderMarket();
    },
    onNews(v) {
      newsData = v;
      renderVerdict(true);
      renderMarket();
    },
    onError(what, err) {
      console.warn(`[market] ${what}`, err);
      if (what === "news" && !newsData) {
        newsData = { error: true, items: [], summary: null };
        renderMarket();
      }
    },
  });

  const toneOf = (s) => (s > 0.15 ? "up" : s < -0.15 ? "down" : "flat");
  const signed = (v) => (v === null || isNa(v) ? "\u2013" : `${v >= 0 ? "+" : ""}${Math.round(v * 100)}`);
  const agoText = (n) => (n === 0 ? "now" : n === 1 ? "1 bar ago" : `${n} bars ago`);

  function verdictParts() {
    const classic = lastClassic ? V.readClassic(lastClassic) : null;
    return {
      technical: V.technical(mtfReads, classic),
      sentiment: V.sentiment(fng),
      news: newsData && newsData.summary && newsData.summary.sample ? newsData.summary.score : null,
      fundamentals: V.fundamentals(fundamentalsData),
    };
  }

  function tfTally() {
    const t = { ready: 0, bull: 0, bear: 0, flat: 0, oversold: 0, overbought: 0 };
    for (const tf of PulseMarket.MTF) {
      const r = mtfReads[tf];
      if (!r || !r.ready) continue;
      t.ready++;
      if (r.bias === "Bullish") t.bull++;
      else if (r.bias === "Bearish") t.bear++;
      else t.flat++;
      if (r.zone.score > 0) t.oversold++;
      if (r.zone.score < 0) t.overbought++;
    }
    return t;
  }

  function renderVerdict(force) {
    if (!insightsVisible()) return;
    const now = Date.now();
    if (!force && now - verdictAt < 500) return;
    verdictAt = now;

    const parts = verdictParts();
    const tally = tfTally();
    const ov = V.overall(parts, { zones: { ready: tally.ready, oversold: tally.oversold, overbought: tally.overbought } });
    const hero = $("vdHero");
    const lv = ov ? V.levels(model.bars, ov.action) : null;

    if (!ov) {
      hero.dataset.tone = "flat";
      $("vdAction").textContent = "Loading";
      $("vdBias").textContent = "Reading data";
      $("vdScore").textContent = "\u2013";
      $("vdNote").textContent = "Fetching timeframes, sentiment, news and fundamentals\u2026";
    } else {
      const tone = ov.action === "Long" ? "up" : ov.action === "Short" ? "down" : "flat";
      hero.dataset.tone = tone;
      hero.dataset.bias = toneOf(ov.score);
      $("vdAction").textContent = ov.action;
      $("vdBias").textContent = `${ov.bias} bias`;
      $("vdScore").textContent = `Score ${signed(ov.score)}`;
      $("vdAgree").textContent = `${ov.agree} of ${ov.total} parts agree`;
      $("vdMark").style.left = `${((ov.score + 1) / 2) * 100}%`;

      // one plain sentence: what to do and why
      const tfs = tally.ready ? `${tally.bull} of ${tally.ready} timeframes bullish, ${tally.bear} bearish` : "timeframes still loading";
      let note;
      if (ov.action === "Long") note = `Buyers in control: ${tfs}. The idea fails below ${fmtPrice(lv ? lv.stop : NaN)}.`;
      else if (ov.action === "Short") note = `Sellers in control: ${tfs}. The idea fails above ${fmtPrice(lv ? lv.stop : NaN)}.`;
      else if (ov.note) note = `${ov.note}.`;
      else note = `No clear edge: ${tfs}. Wait for the timeframes to line up.`;
      $("vdNote").textContent = note;
    }

    for (const li of $("vdParts").children) {
      const v = parts[li.dataset.part];
      const bar = li.querySelector("i");
      li.querySelector("b").textContent = v === null ? "n/a" : signed(v);
      li.dataset.tone = v === null ? "off" : toneOf(v);
      bar.dataset.side = v !== null && v < 0 ? "neg" : "pos";
      bar.style.transform = `scaleX(${v === null ? 0 : Math.abs(v).toFixed(3)})`;
    }

    $("vdEntry").textContent = lv ? fmtPrice(lv.entry) : "\u2013";
    $("vdStop").textContent = lv ? fmtPrice(lv.stop) : "\u2013";
    $("vdTarget").textContent = lv ? fmtPrice(lv.target) : "\u2013";
    $("vdLevels").hidden = !lv;
    $("vdNoLevels").hidden = !!lv;

    $("tfTally").textContent = tally.ready ? `${tally.bull} up \u00b7 ${tally.bear} down \u00b7 ${tally.flat} flat` : "\u2013";
    renderTfTable();
  }

  const shortAgo = (n) => (n === 0 ? "now" : n === 1 ? "1 bar" : `${n} bars`);

  function renderTfTable() {
    const list = $("tfRows");
    const rows = PulseMarket.MTF.map((tf) => ({ tf, read: mtfReads[tf], bars: mtfBars[tf], chart: tf === state.tf }));
    if (!PulseMarket.MTF.includes(state.tf)) rows.unshift({ tf: state.tf, read: chartTfRead, bars: model.bars, chart: true });
    if (list.children.length !== rows.length) {
      list.innerHTML = "";
      for (let k = 0; k < rows.length; k++) {
        const li = document.createElement("li");
        li.className = "tf-row";
        li.innerHTML =
          '<span class="tf-name num"></span>' +
          '<span class="wmeter"><span class="wmeter-zero"></span><i></i></span>' +
          '<span class="tf-dot"><i class="dot"></i><span></span></span>' +
          '<span class="tag tag-strong"></span>';
        list.appendChild(li);
      }
    }
    rows.forEach((r, k) => {
      const li = list.children[k];
      const [name, meter, dot, act] = li.children;
      name.textContent = r.tf;
      li.dataset.chart = String(r.chart);
      const marker = meter.querySelector("i");
      const dotGlyph = dot.firstChild;
      const dotText = dot.lastChild;
      const rd = r.read;
      if (!rd || !rd.ready) {
        marker.hidden = true;
        dotGlyph.className = "dot dot-none";
        const n = r.bars ? r.bars.length : 0;
        dotText.textContent = !rd ? "Loading" : `${n} bars`;
        act.textContent = !rd ? "\u2013" : "n/a";
        act.dataset.tone = "flat";
        li.dataset.tip = !rd
          ? `${r.tf}: loading from Binance.`
          : `${r.tf}: only ${n} bars of history on Binance. Market Cipher B needs about 30 for the waves and 83 for every line.`;
        li.setAttribute("aria-label", `${r.tf}: not enough data`);
        return;
      }
      const pos = (Math.max(-100, Math.min(100, rd.fast)) + 100) / 2;
      marker.hidden = false;
      marker.style.left = `${pos}%`;
      marker.dataset.tone = rd.zone.score > 0 ? "up" : rd.zone.score < 0 ? "down" : "flat";
      if (rd.dot) {
        dotGlyph.className = `dot ${{ buy: "dot-g", sell: "dot-r", buySignal: "dot-G", sellSignal: "dot-R" }[rd.dot.type]}`;
        dotText.textContent = shortAgo(rd.dot.ago);
      } else {
        dotGlyph.className = "dot dot-none";
        dotText.textContent = "none";
      }
      act.textContent = rd.action;
      act.dataset.tone = rd.action === "Long" ? "up" : rd.action === "Short" ? "down" : "flat";
      const dotSentence = rd.dot ? `${rd.dot.label} ${agoText(rd.dot.ago)}` : "No dot in the last 12 bars";
      li.dataset.tip = `${r.tf}${r.chart ? " (chart)" : ""}: ${rd.bias}, score ${signed(rd.score)}. Wave ${fmtNum(rd.fast, 1)} (${rd.zone.label.toLowerCase()}). ${dotSentence}. ${rd.reasons.slice(1).join(". ")}${rd.reasons.length > 1 ? "." : ""}`;
      li.setAttribute("aria-label", `${r.tf}: ${rd.action}, ${rd.bias}, ${rd.zone.label}, ${dotSentence}`);
    });
  }
  function timeAgo(ms) {
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    return `${Math.round(s / 86400)}d ago`;
  }

  function renderMarket() {
    if (isMobile() ? mobileView !== "market" : !(state.panelOpen && state.panel === "market")) return;

    const it = inst();
    const group = it.group;
    $("fgTitle").textContent = group === "stocks" ? "Sentiment \u00b7 US stocks" : group === "crypto" ? "Sentiment \u00b7 crypto" : "Sentiment";
    $("fgTitle").dataset.tip =
      group === "stocks"
        ? "CNN Fear & Greed Index for the US stock market, from 7 indicators including momentum, breadth, put/call ratio and volatility."
        : group === "crypto"
          ? "Crypto Fear & Greed Index (alternative.me), updated daily. Built from volatility, momentum, social media, dominance and trends."
          : "There is no standard fear and greed index for commodities. The verdict uses news tone instead.";
    $("fgBody").hidden = group === "commodities";
    $("fgNone").hidden = group !== "commodities";
    $("fdBody").hidden = !it.cg;
    $("fdNone").hidden = !!it.cg;
    $("fdNone").textContent =
      group === "stocks"
        ? `Fundamentals come from CoinGecko and cover crypto only. For ${it.name}, see earnings and filings on the company's investor site.`
        : `Fundamentals come from CoinGecko and cover crypto only. ${it.name} has no supply or market cap data here.`;
    $("newsTitle").dataset.tip =
      group === "crypto"
        ? "Headlines from CoinDesk, Cointelegraph, Decrypt and Bitcoin.com. Tags come from keyword scoring, not from reading the full article."
        : `Yahoo Finance headlines that name ${it.name}. Tags come from keyword scoring, not from reading the full article.`;

    // ---- sentiment ----
    if (!fng) {
      $("fgValue").textContent = "\u2013";
      $("fgLabel").textContent = "Loading";
      $("fgLabel").dataset.tone = "flat";
      $("fgHistory").innerHTML = "";
      $("fgUpdated").textContent = "\u2013";
    }
    if (fng) {
      $("fgValue").textContent = fng.value;
      $("fgLabel").textContent = fng.label;
      $("fgLabel").dataset.tone = fng.value >= 55 ? "up" : fng.value <= 45 ? "down" : "flat";
      $("fgMark").style.left = `${fng.value}%`;
      $("fgUpdated").textContent = new Date(fng.time * 1000).toISOString().slice(0, 10);
      const hist = $("fgHistory");
      hist.innerHTML = "";
      fng.history.slice(0, 7).reverse().forEach((h) => {
        const b = document.createElement("span");
        b.style.setProperty("--h", `${Math.max(6, h.value)}%`);
        b.dataset.tone = h.value >= 55 ? "up" : h.value <= 45 ? "down" : "flat";
        b.dataset.tip = `${new Date(h.time * 1000).toISOString().slice(5, 10)}: ${h.value} (${h.label})`;
        hist.appendChild(b);
      });
    }

    // ---- news ----
    const list = $("newsList");
    if (newsData) {
      list.innerHTML = "";
      if (newsData.error || !newsData.items.length) {
        if (!newsData.error) $("newsTally").textContent = "0 headlines";
        const li = document.createElement("li");
        li.className = "news-empty";
        li.textContent = newsData.error
          ? "Headlines are unavailable. They load from /api/news, so run the site with `node scripts/dev.js` locally or deploy to Vercel."
          : "No recent headlines.";
        list.appendChild(li);
        $("newsTally").textContent = "\u2013";
      } else {
        const s = newsData.summary;
        $("newsTally").textContent = `${s.bullish} up \u00b7 ${s.bearish} down \u00b7 ${s.neutral} flat`;
        for (const it of newsData.items.slice(0, 14)) {
          if (!/^https?:\/\//.test(it.url)) continue;
          const li = document.createElement("li");
          li.className = "news-item";
          const a = document.createElement("a");
          a.href = it.url;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = it.title;
          const meta = document.createElement("span");
          meta.className = "news-meta";
          meta.textContent = `${it.source} \u00b7 ${it.published ? timeAgo(it.published) : ""}${it.coinSpecific ? "" : " \u00b7 market"}`;
          const tag = document.createElement("span");
          tag.className = "tag";
          tag.dataset.tone = it.tag === "bullish" ? "up" : it.tag === "bearish" ? "down" : "flat";
          tag.textContent = it.tag === "bullish" ? "Bullish" : it.tag === "bearish" ? "Bearish" : "Neutral";
          li.append(a, meta, tag);
          list.appendChild(li);
        }
      }
    }

    // ---- fundamentals ----
    const f = fundamentalsData;
    if (f) {
      $("fdRank").textContent = f.rank ? `Rank #${f.rank}` : "\u2013";
      $("fdMcap").textContent = "$" + fmtCompact(f.marketCap);
      $("fdFdv").textContent = isNa(f.fdv) ? "\u2013" : "$" + fmtCompact(f.fdv);
      $("fdTurnover").textContent = f.marketCap ? `${fmtNum((f.volume / f.marketCap) * 100, 2)}%` : "\u2013";
      $("fdSupply").textContent = f.max ? `${fmtNum((f.circulating / f.max) * 100, 1)}% of max` : `${fmtCompact(f.circulating)} (no max)`;
      $("fdAth").textContent = fmtPct(f.athChange);
      $("fdAth").dataset.dir = f.athChange >= 0 ? "up" : "down";
      $("fdTrend").textContent = `${fmtPct(f.change7d)} / ${fmtPct(f.change30d)}`;
    }
  }

  // ---------------------------------------------------------------- tooltips
  const tipEl = $("tip");
  let tipTarget = null;
  let tipTimer = 0;
  let tipHiddenAt = 0;

  function showTip(el) {
    const text = el.getAttribute("data-tip");
    if (!text) return;
    tipEl.textContent = text;
    tipEl.hidden = false;
    const r = el.getBoundingClientRect();
    const w = tipEl.offsetWidth;
    const h = tipEl.offsetHeight;
    let top = r.top - h - 8;
    if (top < 6) top = r.bottom + 8;
    const left = Math.max(6, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 6));
    tipEl.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }
  function hideTip() {
    clearTimeout(tipTimer);
    if (!tipEl.hidden) tipHiddenAt = Date.now();
    tipEl.hidden = true;
    tipTarget = null;
  }
  function armTip(el) {
    if (el === tipTarget) return;
    clearTimeout(tipTimer);
    tipTarget = el;
    // after one tip was open, the next opens without delay
    const delay = Date.now() - tipHiddenAt < 400 || !tipEl.hidden ? 0 : 450;
    tipTimer = setTimeout(() => tipTarget === el && showTip(el), delay);
  }
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const el = e.target.closest("[data-tip]");
    if (el) armTip(el);
    else if (tipTarget) hideTip();
  });
  document.addEventListener("focusin", (e) => {
    const el = e.target.closest && e.target.closest("[data-tip]");
    if (el && e.target.matches(":focus-visible")) armTip(el);
  });
  document.addEventListener("focusout", hideTip);
  document.addEventListener("pointerdown", hideTip);
  window.addEventListener("scroll", hideTip, true);

  // ---------------------------------------------------------------- about
  const about = $("aboutPop");
  function toggleAbout(open) {
    about.hidden = !open;
    $("aboutBtn").setAttribute("aria-expanded", String(open));
  }
  $("aboutBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleAbout(about.hidden);
  });
  document.addEventListener("pointerdown", (e) => {
    if (!about.hidden && !about.contains(e.target) && !e.target.closest("#aboutBtn")) toggleAbout(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !about.hidden) {
      toggleAbout(false);
      $("aboutBtn").focus();
    }
  });

  // ---------------------------------------------------------------- alerts (Market Cipher B)
  const alerted = new Set();
  function checkAlerts(i) {
    if (i < 0 || !state.ind.mcb || !model.mcb || i >= model.bars.length) return;
    if (!state.alerts.inApp && !state.alerts.notify) return;
    const m = model.mcb;
    const bar = model.bars[i];
    for (const a of MCB_ALERTS) {
      if (!m[a.key][i]) continue;
      const id = `${state.pair}|${state.tf}|${bar.time}|${a.key}`;
      if (alerted.has(id)) continue;
      alerted.add(id);
      const body = `${labelOf(state.pair)} ${state.tf} \u00b7 close ${fmtPrice(bar.close)}`;
      if (state.alerts.inApp) toast(a.title, body, a.tone);
      if (state.alerts.notify && "Notification" in window && Notification.permission === "granted") {
        try {
          new Notification(`Market Cipher B: ${a.title}`, { body, icon: "icons/favicon.svg", tag: id });
        } catch (_) {}
      }
    }
  }

  function toast(title, body, tone) {
    const host = $("toasts");
    const el = document.createElement("div");
    el.className = "toast";
    el.dataset.tone = tone;
    el.setAttribute("role", "status");
    el.innerHTML = `<svg class="ic"><use href="#i-bell" /></svg><div><strong></strong><span class="num"></span></div><button type="button" class="icon-btn" aria-label="Dismiss"><svg class="ic"><use href="#i-x" /></svg></button>`;
    el.querySelector("strong").textContent = title;
    el.querySelector("span").textContent = body;
    let timer = 0;
    const dismiss = () => {
      clearTimeout(timer);
      el.classList.add("is-leaving");
      setTimeout(() => el.remove(), 160);
    };
    const arm = () => (timer = setTimeout(dismiss, 8000));
    el.querySelector("button").addEventListener("click", dismiss);
    el.addEventListener("pointerenter", () => clearTimeout(timer));
    el.addEventListener("pointerleave", arm);
    host.appendChild(el);
    const maxToasts = isMobile() ? 2 : 4;
    while (host.children.length > maxToasts) host.firstElementChild.remove();
    arm();
  }

  // ---------------------------------------------------------------- status bar
  function renderStatus(s) {
    const el = $("connState");
    el.dataset.state = s.state;
    const txt = $("connText");
    if (s.state === "live") txt.textContent = "Live";
    else if (s.state === "connecting") txt.textContent = "Connecting";
    else if (s.state === "reconnecting") txt.textContent = s.retryIn ? `Reconnecting in ${Math.round(s.retryIn / 1000)}s` : "Reconnecting";
    else txt.textContent = s.retryIn ? `Offline, retry in ${Math.round(s.retryIn / 1000)}s` : "Offline";
  }

  function tickClock() {
    $("utcClock").textContent = new Date(feed.serverNow()).toISOString().slice(11, 19) + " UTC";
  }
  setInterval(tickClock, 1000);
  tickClock();

  // ---------------------------------------------------------------- panel
  const PANEL_TABS = ["book", "signal", "market"];
  function renderPanel() {
    $("app").dataset.panel = state.panelOpen ? "open" : "closed";
    $("panelBtn").setAttribute("aria-pressed", String(state.panelOpen));
    for (const tab of PANEL_TABS) {
      $(`tab-${tab}`).setAttribute("aria-selected", String(state.panel === tab));
      $(`view-${tab}`).hidden = state.panel !== tab;
    }
    if (state.panel === "signal") updateInsights(true);
    if (state.panel === "market") renderMarket();
  }

  function setPanelTab(tab) {
    state.panel = tab;
    state.panelOpen = true;
    renderPanel();
    save();
  }

  document.querySelectorAll(".panel-tabs [data-tab]").forEach((b) => b.addEventListener("click", () => setPanelTab(b.dataset.tab)));
  $("panelBtn").addEventListener("click", () => {
    state.panelOpen = !state.panelOpen;
    renderPanel();
    save();
  });
  $("panelClose").addEventListener("click", () => {
    if (isMobile()) setMobileView("chart");
    else {
      state.panelOpen = false;
      renderPanel();
      save();
    }
  });

  // ---- panel width: drag the left edge, double-click to reset, or toggle wide ----
  const PANEL_MIN = 280;
  const defaultPanelW = () => (window.innerWidth >= 1440 ? 400 : 336);
  const maxPanelW = () => Math.max(PANEL_MIN, Math.min(960, window.innerWidth - 480));
  const clampW = (w) => Math.round(Math.max(PANEL_MIN, Math.min(maxPanelW(), w)));
  let widthRaf = 0;
  function applyPanelWidth(w) {
    const px = clampW(w || defaultPanelW());
    $("app").style.setProperty("--panel-w", `${px}px`);
    $("panelWiden").setAttribute("aria-pressed", String(px >= 600));
    $("panelResizer").setAttribute("aria-valuenow", String(px));
    return px;
  }
  function setPanelWidth(w, persist) {
    state.panelW = w ? clampW(w) : null;
    applyPanelWidth(state.panelW);
    if (persist) save();
    queuePaneLayout();
  }
  (function panelResize() {
    const handle = $("panelResizer");
    let startX = 0;
    let startW = 0;
    let pending = null;
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      startX = e.clientX;
      startW = $("panel").getBoundingClientRect().width;
      $("app").dataset.resizing = "true";
    });
    handle.addEventListener("pointermove", (e) => {
      if (!handle.hasPointerCapture(e.pointerId)) return;
      pending = startW + (startX - e.clientX);
      if (widthRaf) return;
      widthRaf = requestAnimationFrame(() => {
        widthRaf = 0;
        if (pending !== null) setPanelWidth(pending, false);
      });
    });
    const end = (e) => {
      if (!handle.hasPointerCapture(e.pointerId)) return;
      handle.releasePointerCapture(e.pointerId);
      delete $("app").dataset.resizing;
      save();
    };
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    handle.addEventListener("dblclick", () => setPanelWidth(null, true));
    handle.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const cur = $("panel").getBoundingClientRect().width;
      setPanelWidth(cur + (e.key === "ArrowLeft" ? 24 : -24), true);
    });
    let narrowW = null;
    $("panelWiden").addEventListener("click", () => {
      const cur = $("panel").getBoundingClientRect().width;
      if (cur >= 600) setPanelWidth(narrowW, true);
      else {
        narrowW = state.panelW;
        setPanelWidth(Math.max(640, Math.min(760, Math.round(window.innerWidth * 0.42))), true);
      }
    });
    window.addEventListener("resize", () => applyPanelWidth(state.panelW));
    applyPanelWidth(state.panelW);
  })();

  // tab keyboard: left/right arrows move between tabs
  $("panel").querySelector(".panel-tabs").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const i = PANEL_TABS.indexOf(state.panel);
    const next = PANEL_TABS[(i + (e.key === "ArrowRight" ? 1 : PANEL_TABS.length - 1)) % PANEL_TABS.length];
    setPanelTab(next);
    $(`tab-${next}`).focus();
  });

  // ---------------------------------------------------------------- mobile views
  const mq = window.matchMedia("(max-width: 900px)");
  const isMobile = () => mq.matches;
  let mobileView = "chart";

  function setMobileView(view) {
    if (view === "indicators") {
      openMenu($("indicatorsBtn"));
      return;
    }
    mobileView = view;
    $("app").dataset.mobileView = view;
    document.querySelectorAll(".mobile-nav [data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === view)));
    if (PANEL_TABS.includes(view)) {
      state.panel = view;
      renderPanel();
    }
  }
  document.querySelectorAll(".mobile-nav [data-view]").forEach((b) => b.addEventListener("click", () => setMobileView(b.dataset.view)));
  $("app").dataset.mobileView = "chart";
  mq.addEventListener("change", () => {
    chartView.relayout();
    queuePaneLayout();
  });

  // ---------------------------------------------------------------- indicators menu
  const menu = $("indMenu");
  let menuAnchor = null;

  function renderIndicatorMenu() {
    const list = $("indList");
    if (!list.children.length) {
      for (const ind of INDICATORS) {
        const li = document.createElement("li");
        li.className = "ind-row";
        li.innerHTML =
          `<label class="switch-row"><input type="checkbox" role="switch" data-ind="${ind.key}" />` +
          `<span class="switch" aria-hidden="true"></span>` +
          `<span class="ind-name">${ind.name}${ind.note ? `<em>${ind.note}</em>` : ""}</span></label>` +
          `<button type="button" class="icon-btn" data-help="${ind.key}" aria-expanded="false" aria-controls="help-${ind.key}" aria-label="What is ${ind.name}?"><svg class="ic"><use href="#i-help" /></svg></button>` +
          (ind.settings
            ? `<button type="button" class="icon-btn" data-settings="${ind.settings}" aria-label="${ind.name} settings" data-tip="Settings"><svg class="ic"><use href="#i-sliders" /></svg></button>`
            : '<span class="icon-spacer"></span>') +
          `<p class="ind-help" id="help-${ind.key}" hidden>${ind.desc}</p>`;
        list.appendChild(li);
      }
      list.addEventListener("change", (e) => {
        const input = e.target.closest("input[data-ind]");
        if (input) toggleIndicator(input.dataset.ind, input.checked);
      });
      list.addEventListener("click", (e) => {
        const b = e.target.closest("[data-settings]");
        if (b) showMenuView(b.dataset.settings);
        const h = e.target.closest("[data-help]");
        if (h) {
          const p = $(`help-${h.dataset.help}`);
          p.hidden = !p.hidden;
          h.setAttribute("aria-expanded", String(!p.hidden));
        }
      });
    }
    list.querySelectorAll("input[data-ind]").forEach((i) => (i.checked = !!state.ind[i.dataset.ind]));
    const on = INDICATORS.filter((i) => state.ind[i.key]).length;
    $("indCount").textContent = `${on}/${INDICATORS.length}`;
  }

  function showMenuView(id) {
    for (const v of menu.querySelectorAll(".menu-view")) v.hidden = v.id !== id;
    if (id === "menuMcb") fillMcbForm();
    if (id === "menuVpvr") fillVpvrForm();
    const first = menu.querySelector(`#${id} input, #${id} button`);
    if (first) first.focus({ preventScroll: true });
  }
  menu.querySelectorAll("[data-back]").forEach((b) => b.addEventListener("click", () => showMenuView("menuMain")));

  function positionMenu() {
    if (!menuAnchor || isMobile()) {
      menu.style.left = menu.style.top = "";
      return;
    }
    const r = menuAnchor.getBoundingClientRect();
    const w = menu.offsetWidth;
    menu.style.top = `${Math.round(r.bottom + 6)}px`;
    menu.style.left = `${Math.round(Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)))}px`;
  }

  function openMenu(anchor, view) {
    menuAnchor = anchor;
    menu.hidden = false;
    showMenuView(view || "menuMain");
    positionMenu();
    $("indicatorsBtn").setAttribute("aria-expanded", "true");
  }
  function closeMenu() {
    if (menu.hidden) return;
    menu.hidden = true;
    $("indicatorsBtn").setAttribute("aria-expanded", "false");
    if (isMobile()) setMobileView(mobileView === "indicators" ? "chart" : mobileView);
  }
  $("indicatorsBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu.hidden) openMenu(e.currentTarget);
    else closeMenu();
  });
  document.addEventListener("pointerdown", (e) => {
    if (menu.hidden) return;
    if (menu.contains(e.target) || e.target.closest("#indicatorsBtn") || e.target.closest('.mobile-nav [data-view="indicators"]')) return;
    closeMenu();
  });
  window.addEventListener("resize", positionMenu);

  // ---- MCB settings form ----
  const mcbForm = $("mcbForm");
  function fillMcbForm() {
    for (const el of mcbForm.elements) {
      if (!el.name) continue;
      if (el.name === "alertsInApp") el.checked = !!state.alerts.inApp;
      else if (el.name === "alertsNotify") el.checked = !!state.alerts.notify;
      else if (el.type === "checkbox") el.checked = !!state.mcb[el.name];
      else el.value = state.mcb[el.name];
    }
  }
  let mcbTimer = 0;
  mcbForm.addEventListener("input", (e) => {
    const el = e.target;
    if (!el.name) return;
    if (el.name === "alertsInApp") {
      state.alerts.inApp = el.checked;
      save();
      return;
    }
    if (el.name === "alertsNotify") {
      if (el.checked && "Notification" in window && Notification.permission !== "granted") {
        Notification.requestPermission().then((p) => {
          state.alerts.notify = p === "granted";
          el.checked = state.alerts.notify;
          if (p !== "granted") toast("Notifications are blocked", "Allow notifications for this site in your browser settings.", "flat");
          save();
        });
        return;
      }
      state.alerts.notify = el.checked;
      save();
      return;
    }
    if (el.type === "checkbox") state.mcb[el.name] = el.checked;
    else {
      const v = Math.floor(+el.value);
      if (!(v >= 1)) {
        el.setAttribute("aria-invalid", "true");
        return; // minval=1, as in the script
      }
      el.removeAttribute("aria-invalid");
      state.mcb[el.name] = v;
    }
    clearTimeout(mcbTimer);
    mcbTimer = setTimeout(applyIndicators, 120);
  });
  $("mcbReset").addEventListener("click", () => {
    state.mcb = Object.assign({}, I.MCB_DEFAULTS);
    fillMcbForm();
    applyIndicators();
  });

  // ---- VPVR settings form ----
  function fillVpvrForm() {
    const s = state.vpvr;
    for (const b of $("vpvrMode").children) b.setAttribute("aria-checked", String(b.dataset.mode === s.mode));
    $("vpvrRows").value = s.rows;
    $("vpvrRowsVal").textContent = s.rows;
    $("vpvrVa").value = Math.round(s.vaPct * 100);
    $("vpvrVaVal").textContent = `${Math.round(s.vaPct * 100)}%`;
    $("vpvrWidth").value = s.widthPx;
    $("vpvrWidthVal").textContent = `${s.widthPx} px`;
    $("vpvrPOC").checked = s.showPOC;
    $("vpvrVAHVAL").checked = s.showVAHVAL;
    $("vpvrVAHL").checked = s.showVA;
  }
  function setVpvr(partial) {
    Object.assign(state.vpvr, partial);
    if (vpvrView) vpvrView.setSettings(partial);
    save();
  }
  $("vpvrMode").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-mode]");
    if (!b) return;
    setVpvr({ mode: b.dataset.mode });
    fillVpvrForm();
  });
  $("vpvrRows").addEventListener("input", (e) => {
    setVpvr({ rows: +e.target.value });
    $("vpvrRowsVal").textContent = e.target.value;
  });
  $("vpvrVa").addEventListener("input", (e) => {
    setVpvr({ vaPct: +e.target.value / 100 });
    $("vpvrVaVal").textContent = `${e.target.value}%`;
  });
  $("vpvrWidth").addEventListener("input", (e) => {
    setVpvr({ widthPx: +e.target.value });
    $("vpvrWidthVal").textContent = `${e.target.value} px`;
  });
  $("vpvrPOC").addEventListener("change", (e) => setVpvr({ showPOC: e.target.checked }));
  $("vpvrVAHVAL").addEventListener("change", (e) => setVpvr({ showVAHVAL: e.target.checked }));
  $("vpvrVAHL").addEventListener("change", (e) => setVpvr({ showVA: e.target.checked }));

  // ---------------------------------------------------------------- command palette
  const palette = $("palette");
  const pInput = $("paletteInput");
  const pList = $("paletteList");
  let pItems = [];
  let pActive = 0;

  function commands() {
    const out = [];
    for (const g of IN.GROUPS) {
      for (const it of IN.inGroup(g.id)) {
        const mini = miniCache[it.id];
        out.push({
          group: g.name,
          label: `${it.label}  ${it.name}`,
          hint: mini ? `${fmtPrice(mini.last, it.id)}  ${fmtPct(mini.changePct)}` : "",
          icon: it.icon,
          keys: `${it.id} ${it.symbol} ${it.name} ${it.kind} ${g.id} pair market`,
          active: it.id === state.pair,
          run: () => switchPair(it.id),
        });
      }
    }
    for (const tf of TIMEFRAMES.filter((t) => PulseFeed.supports(inst().venue, t))) out.push({ group: "Timeframe", label: `Timeframe ${tf}`, keys: `tf interval ${tf}`, active: tf === state.tf, run: () => switchTimeframe(tf) });
    for (const t in CHART_TYPES) out.push({ group: "Chart type", label: CHART_TYPES[t], keys: `chart type ${t}`, active: t === state.chartType, run: () => switchChartType(t) });
    for (const ind of INDICATORS) {
      out.push({
        group: "Indicators",
        label: `${state.ind[ind.key] ? "Hide" : "Show"} ${ind.name}`,
        keys: `indicator toggle ${ind.key} ${ind.name}`,
        hint: state.ind[ind.key] ? "On" : "Off",
        run: () => toggleIndicator(ind.key),
      });
      if (ind.settings) {
        out.push({
          group: "Indicators",
          label: `${ind.name} settings`,
          keys: `settings ${ind.key} ${ind.name} inputs`,
          run: () => {
            if (!state.ind[ind.key]) toggleIndicator(ind.key, true);
            openMenu($("indicatorsBtn"), ind.settings);
          },
        });
      }
    }
    out.push({ group: "View", label: state.theme === "dark" ? "Switch to light theme" : "Switch to dark theme", keys: "theme dark light", run: () => applyTheme(state.theme === "dark" ? "light" : "dark") });
    out.push({ group: "View", label: "Fit all bars", keys: "fit zoom", run: () => chartView.fit() });
    out.push({ group: "View", label: "Reset chart view", keys: "reset zoom", run: () => chartView.reset() });
    out.push({ group: "View", label: "Jump to latest bar", keys: "live realtime latest", run: () => chartView.scrollToRealtime() });
    out.push({ group: "View", label: "Show order book", keys: "book depth orderbook panel", run: () => (isMobile() ? setMobileView("book") : setPanelTab("book")) });
    out.push({ group: "View", label: "Show Pulse verdict and signals", keys: "signal verdict insights ai buy sell long short", run: () => (isMobile() ? setMobileView("signal") : setPanelTab("signal")) });
    out.push({ group: "View", label: "Show market: sentiment, news, fundamentals", keys: "market news sentiment fear greed fundamentals", run: () => (isMobile() ? setMobileView("market") : setPanelTab("market")) });
    if (!isMobile()) out.push({ group: "View", label: state.panelOpen ? "Hide panel" : "Show panel", keys: "panel sidebar", run: () => $("panelBtn").click() });
    out.push({ group: "View", label: "About and data sources", keys: "about credits tradingview data sources license", run: () => toggleAbout(true) });
    return out;
  }

  function renderPalette() {
    const q = pInput.value.trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    pItems = commands().filter((c) => {
      const hay = `${c.label} ${c.keys} ${c.group}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
    pActive = Math.min(pActive, Math.max(0, pItems.length - 1));
    let html = "";
    let group = "";
    pItems.forEach((c, i) => {
      if (c.group !== group) {
        group = c.group;
        html += `<li class="palette-group" role="presentation">${group}</li>`;
      }
      html +=
        `<li class="palette-item" role="option" id="pi-${i}" data-i="${i}" aria-selected="${i === pActive}">` +
        (c.icon ? `<img src="${c.icon}" alt="" width="16" height="16" />` : '<span class="palette-dot"></span>') +
        `<span class="palette-label">${c.label}</span>` +
        (c.active ? '<span class="palette-current">Current</span>' : "") +
        `<span class="palette-hint num">${c.hint || ""}</span></li>`;
    });
    if (!pItems.length) html = `<li class="palette-empty">No match for "${escapeHtml(pInput.value)}". Try a pair like SOL, a timeframe like 5m, or an indicator name.</li>`;
    pList.innerHTML = html;
    pInput.setAttribute("aria-activedescendant", pItems.length ? `pi-${pActive}` : "");
    const act = pList.querySelector(`[data-i="${pActive}"]`);
    if (act) act.scrollIntoView({ block: "nearest" });
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }

  function openPalette(prefill) {
    closeMenu();
    pInput.value = prefill || "";
    pActive = 0;
    renderPalette();
    if (!palette.open) palette.showModal();
    pInput.focus();
  }
  function closePalette() {
    if (palette.open) palette.close();
  }
  function runPalette(i) {
    const c = pItems[i];
    if (!c) return;
    closePalette();
    c.run();
  }

  pInput.addEventListener("input", () => {
    pActive = 0;
    renderPalette();
  });
  pInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      pActive = Math.min(pItems.length - 1, pActive + 1);
      renderPalette();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      pActive = Math.max(0, pActive - 1);
      renderPalette();
    } else if (e.key === "Enter") {
      e.preventDefault();
      runPalette(pActive);
    }
  });
  pList.addEventListener("click", (e) => {
    const li = e.target.closest("[data-i]");
    if (li) runPalette(+li.dataset.i);
  });
  pList.addEventListener("pointermove", (e) => {
    const li = e.target.closest("[data-i]");
    if (!li || +li.dataset.i === pActive) return;
    pList.querySelector('[aria-selected="true"]')?.setAttribute("aria-selected", "false");
    pActive = +li.dataset.i;
    li.setAttribute("aria-selected", "true");
  });
  palette.addEventListener("click", (e) => {
    if (e.target === palette) closePalette();
  });
  $("openPalette").addEventListener("click", () => openPalette());
  $("symbolBox").addEventListener("click", () => openPalette(state.group === "crypto" ? "crypto" : state.group));

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  $("paletteKbd").textContent = isMac ? "\u2318K" : "Ctrl K";

  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (palette.open) closePalette();
      else openPalette();
      return;
    }
    if (e.key === "/" && !typing && !palette.open) {
      e.preventDefault();
      openPalette();
      return;
    }
    if (e.key === "Escape" && !menu.hidden) {
      closeMenu();
      $("indicatorsBtn").focus();
    }
  });

  // ---------------------------------------------------------------- chart tools
  $("btnFit").addEventListener("click", () => chartView.fit());
  $("btnReset").addEventListener("click", () => chartView.reset());
  $("btnLive").addEventListener("click", () => chartView.scrollToRealtime());

  // ---------------------------------------------------------------- boot
  function init() {
    buildBookRows();
    resetBookView();
    renderGroups();
    renderPairTabs();
    pollTickers(true);
    document.addEventListener("visibilitychange", () => !document.hidden && pollTickers(true));
    renderSymbol();
    renderTimeframes();
    renderChartTypes();
    renderPanel();
    applyTheme(state.theme);
    chartView.setSecondsVisible(state.tf === "1s");
    chartView.setChartType(state.chartType, model);
    recreateVpvr();
    applyIndicators();
    startFeed();
    market.start(inst());
    // canvas text is drawn before webfonts load; redraw the axes once they are ready
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => chartView.chart.applyOptions({ layout: { fontSize: 11 } }));
    }
    PulseFeed.fetchSymbolInfo(IN.LIST)
      .then((info) => {
        Object.assign(symbolInfo, info);
        applyPrecision();
        updateQuote();
        updateLegend();
        if (lastTicker) renderTicker(lastTicker);
        if (lastBook) renderBook(lastBook);
      })
      .catch((err) => console.warn("[exchangeInfo]", err));
  }

  init();
})();
