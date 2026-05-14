// -- sync theme icon with the data-theme set in html head --
const _iconEl = document.getElementById("theme-icon");
if (_iconEl)
  _iconEl.setAttribute(
    "data-icon",
    document.documentElement.getAttribute("data-theme") === "dark"
      ? "tabler:sun"
      : "tabler:moon",
  );

// -- trading pairs and their iconify icon keys --
const pairs = ["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP", "ADA", "LINK"];
const cryptoIcons = {
  BTC: "cryptocurrency-color:btc",
  ETH: "cryptocurrency-color:eth",
  SOL: "cryptocurrency-color:sol",
  BNB: "cryptocurrency-color:bnb",
  DOGE: "cryptocurrency-color:doge",
  XRP: "cryptocurrency-color:xrp",
  ADA: "cryptocurrency-color:ada",
  LINK: "cryptocurrency-color:link",
};

// -- core state --
let currentPair = "BTC";
let ws = null;
let chart = null;
let mainSeries = null;
let chartType = "candlestick";
let currentTimeframe = "1s";
const timeframeOptions = ["1s", "1m", "3m", "5m", "15m", "30m"];
let volumeSeries = null;
let vwapSeries = null;
let ema9Series = null;
let ema21Series = null;
let rsiSeries = null;
let isSwitching = false;

// websocket reconnect with exponential backoff
let reconnectAttempt = 0;
const MAX_RECONNECT_DELAY = 30000;

// orderbook polling state
let obAbortController = null;
let obIntervalId = null;

const indicators = { vwap: false, ema: false, rsi: false, vol: false };
const candles = {};
const rsiState = {};
const vwapState = {};

const MAX_CANDLES = 1200; // cap to prevent memory bloat

pairs.forEach((pair) => {
  candles[pair] = [];
  rsiState[pair] = { avgGain: null, avgLoss: null, count: 0 };
  vwapState[pair] = { cumTPV: 0, cumVol: 0, resetDay: -1 };
});

// -- pair selector buttons --
function createPairButtons() {
  const container = document.getElementById("pairSelector");
  container.innerHTML = "";
  pairs.forEach((pair) => {
    const btn = document.createElement("button");
    btn.className = "pair-btn" + (pair === currentPair ? " active" : "");
    const icon = cryptoIcons[pair] || "cryptocurrency-color:generic";
    btn.innerHTML = `<span class="iconify" data-icon="${icon}" style="font-size:16px;"></span> ${pair}`;
    btn.onclick = () => switchPair(pair);
    container.appendChild(btn);
  });
}
// removes all chart series before rebuilding (pair/timeframe switch)
function destroyAllSeries() {
  [
    mainSeries,
    volumeSeries,
    vwapSeries,
    ema9Series,
    ema21Series,
    rsiSeries,
  ].forEach((s) => {
    if (s && chart) {
      try {
        chart.removeSeries(s);
      } catch (_) {}
    }
  });
  mainSeries =
    volumeSeries =
    vwapSeries =
    ema9Series =
    ema21Series =
    rsiSeries =
      null;
}

// creates indicator overlays (volume, vwap, ema, rsi)
function createIndicatorSeries() {
  volumeSeries = chart.addHistogramSeries({
    color: "#e5e7eb",
    priceFormat: { type: "volume" },
    priceScaleId: "vol",
    priceLineVisible: false,
    visible: indicators.vol,
  });
  chart.priceScale("vol").applyOptions({
    visible: false,
    scaleMargins: { top: 0.85, bottom: 0 },
  });
  vwapSeries = chart.addLineSeries({
    color: "#FCD535",
    lineWidth: 2,
    crosshairMarkerRadius: 0,
    lastValueVisible: false,
    priceLineVisible: false,
    visible: indicators.vwap,
  });
  ema9Series = chart.addLineSeries({
    color: "#3b82f6",
    lineWidth: 1.5,
    crosshairMarkerRadius: 0,
    lastValueVisible: false,
    priceLineVisible: false,
    visible: indicators.ema,
  });
  ema21Series = chart.addLineSeries({
    color: "#e67e22",
    lineWidth: 1.5,
    crosshairMarkerRadius: 0,
    lastValueVisible: false,
    priceLineVisible: false,
    visible: indicators.ema,
  });
  rsiSeries = chart.addLineSeries({
    color: "#9ca3af",
    lineWidth: 1.5,
    crosshairMarkerRadius: 0,
    lastValueVisible: false,
    priceLineVisible: false,
    visible: indicators.rsi,
  });
}

// restarts orderbook polling (called on pair switch)
function resetObInterval() {
  clearInterval(obIntervalId);
  fetchOrderbookDepth();
  obIntervalId = setInterval(fetchOrderbookDepth, 30000);
}

// tears down current ws/state and reconnects to a new pair
function switchPair(pair) {
  if (pair === currentPair) return;
  currentPair = pair;

  document.querySelectorAll(".pair-btn").forEach((btn, idx) => {
    btn.classList.toggle("active", pairs[idx] === pair);
  });

  if (ws) {
    isSwitching = true;
    ws.onclose = ws.onerror = ws.onmessage = null;
    try {
      ws.close();
    } catch (e) {
      console.error("WS close error", e);
    }
    ws = null;
  }

  destroyAllSeries();
  initMainSeries();
  createIndicatorSeries();
  chart.timeScale().fitContent();

  rsiState[pair] = { avgGain: null, avgLoss: null, count: 0 };
  vwapState[pair] = { cumTPV: 0, cumVol: 0, resetDay: -1 };
  insightsVolWindow.length = 0;

  document.getElementById("livePrice").textContent = "-";
  document.getElementById("priceChange").textContent = "-";
  document.getElementById("priceChange").className =
    "price-change number";
  document.getElementById("ghostWatermark").textContent = pair;
  document.getElementById("streamOverlay").classList.remove("hidden");

  resetObInterval();
  setTimeout(startStream, 100);
}

// -- chart initialization (lightweight-charts) --
function initChart() {
  const chartContainer = document.getElementById("chart");
  const isDark =
    document.documentElement.getAttribute("data-theme") === "dark";

  chart = LightweightCharts.createChart(chartContainer, {
    layout: {
      background: {
        type: "solid",
        color: isDark ? "#0b0e11" : "#F0E0CE",
      },
      textColor: isDark ? "#707a8a" : "#8B7B6B",
      fontFamily: "'BinancePlex', 'IBM Plex Sans', sans-serif",
    },
    grid: {
      vertLines: { color: isDark ? "#2b3139" : "#ECD8C4" },
      horzLines: { color: isDark ? "#2b3139" : "#ECD8C4" },
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: {
        color: "#9ca3af",
        width: 1,
        style: 2,
        labelBackgroundColor: "#111111",
      },
      horzLine: {
        color: "#9ca3af",
        width: 1,
        style: 2,
        labelBackgroundColor: "#111111",
      },
    },
    timeScale: {
      borderColor: isDark ? "#2b3139" : "#ECD8C4",
      timeVisible: true,
      secondsVisible: true,
      rightOffset: 3,
      barSpacing: 6,
    },
    rightPriceScale: {
      visible: true,
      borderColor: isDark ? "#2b3139" : "#ECD8C4",
    },
    width: chartContainer.clientWidth,
    height: chartContainer.clientHeight,
    autoSize: true,
  });

  initMainSeries();
  createIndicatorSeries();

  chart.subscribeCrosshairMove((param) => {
    const readout = document.getElementById("readout");
    if (!param.time || !param.seriesData.get(mainSeries)) {
      readout.classList.remove("visible");
      return;
    }
    const data = candles[currentPair].find((c) => c.time === param.time);
    if (!data) return;
    readout.classList.add("visible");
    document.getElementById("r-o").textContent = data.open.toFixed(2);
    document.getElementById("r-h").textContent = data.high.toFixed(2);
    document.getElementById("r-l").textContent = data.low.toFixed(2);
    const closeEl = document.getElementById("r-c");
    closeEl.textContent = data.close.toFixed(2);
    closeEl.className =
      "val number " +
      (data.close >= data.open ? "trading-up" : "trading-down");
    document.getElementById("r-v").textContent = data.volume.toFixed(2);
    document.getElementById("r-vwap").textContent = data.vwap
      ? data.vwap.toFixed(2)
      : "-";
    document.getElementById("r-rsi").textContent = data.rsi || "-";
  });
}

// transforms raw candle data for the active chart type
function getChartData() {
  const raw = candles[currentPair];
  if (!raw.length) return [];

  if (chartType === "candlestick") {
    return raw.map((c) => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
  } else if (chartType === "line") {
    return raw.map((c) => ({ time: c.time, value: c.close }));
  } else if (chartType === "heikinAshi") {
    const ha = [];
    let prevOpen = null;
    let prevClose = null;
    for (let c of raw) {
      const close = (c.open + c.high + c.low + c.close) / 4;
      const open =
        prevOpen !== null
          ? (prevOpen + prevClose) / 2
          : (c.open + c.close) / 2;
      const high = Math.max(c.high, open, close);
      const low = Math.min(c.low, open, close);
      ha.push({ time: c.time, open, high, low, close });
      prevOpen = open;
      prevClose = close;
    }
    return ha;
  }
}

function initMainSeries() {
  if (mainSeries) chart.removeSeries(mainSeries);

  if (chartType === "candlestick" || chartType === "heikinAshi") {
    mainSeries = chart.addCandlestickSeries({
      upColor: "#0ecb81",
      downColor: "#f6465d",
      borderVisible: false,
      wickUpColor: "#0ecb81",
      wickDownColor: "#f6465d",
    });
  } else if (chartType === "line") {
    mainSeries = chart.addLineSeries({
      color: "#3b82f6",
      lineWidth: 2,
      crosshairMarkerRadius: 4,
    });
  }

  const data = getChartData();
  if (data.length) mainSeries.setData(data);
}
// -- technical indicator calculations --
// incremental ema: maintains running state to avoid full recalc
function calcEMAIncr(state, price, period) {
  state.buf.push(price);
  if (state.buf.length < period) return null;
  if (state.buf.length === period) {
    state.val = state.buf.reduce((a, b) => a + b, 0) / period;
    return state.val;
  }
  const k = 2 / (period + 1);
  state.val = price * k + state.val * (1 - k);
  return state.val;
}

// vwap resets daily, accumulates typical_price * volume
function updateVWAP(candle, pair) {
  const state = vwapState[pair];
  const day = new Date(candle.time * 1000).getUTCDate();
  if (state.resetDay !== day) {
    state.cumTPV = 0;
    state.cumVol = 0;
    state.resetDay = day;
  }
  const typical = (candle.high + candle.low + candle.close) / 3;
  state.cumTPV += typical * candle.volume;
  state.cumVol += candle.volume;
  return state.cumVol > 0 ? state.cumTPV / state.cumVol : candle.close;
}

// wilder's smoothed rsi(14), needs 15+ closes to produce a value
function updateRSI(closes, pair) {
  if (closes.length < 15) return null;
  const state = rsiState[pair];
  const diff = closes[closes.length - 1] - closes[closes.length - 2];
  const gain = diff > 0 ? diff : 0;
  const loss = diff < 0 ? -diff : 0;

  if (state.count === 0) {
    let tg = 0,
      tl = 0;
    for (let i = closes.length - 14; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      tg += d > 0 ? d : 0;
      tl += d < 0 ? -d : 0;
    }
    state.avgGain = tg / 14;
    state.avgLoss = tl / 14;
    state.count = 14;
  } else {
    state.avgGain = (state.avgGain * 13 + gain) / 14;
    state.avgLoss = (state.avgLoss * 13 + loss) / 14;
  }
  const rs = state.avgLoss === 0 ? 100 : state.avgGain / state.avgLoss;
  return 100 - 100 / (1 + rs);
}

function updateLivePrice(candle) {
  document.getElementById("livePrice").textContent =
    "$" +
    candle.close.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
}

// fetches orderbook depth + 24h ticker from binance rest api
// aborts previous in-flight request to avoid stale data races
async function fetchOrderbookDepth() {
  if (obAbortController) obAbortController.abort();
  obAbortController = new AbortController();
  const { signal } = obAbortController;

  const widget = document.getElementById("orderbookWidget");
  const pair = currentPair + "USDT";

  try {
    const [tickerRes, depthRes] = await Promise.all([
      fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${pair}`, {
        signal,
      }),
      fetch(
        `https://api.binance.com/api/v3/depth?symbol=${pair}&limit=20`,
        { signal },
      ),
    ]);

    if (!tickerRes.ok || !depthRes.ok)
      throw new Error("Binance API Error");

    const ticker = await tickerRes.json();
    const depth = await depthRes.json();
    const changePct = parseFloat(ticker.priceChangePercent);

    const changeEl = document.getElementById("priceChange");
    const sign = changePct >= 0 ? "+" : "";
    changeEl.textContent = `${sign}${changePct.toFixed(2)}% (24H)`;
    changeEl.className =
      "price-change number " +
      (changePct >= 0 ? "trading-up" : "trading-down");

    const bids = depth.bids
      .slice(0, 10)
      .map((b) => [parseFloat(b[0]), parseFloat(b[1])]);
    const asks = depth.asks
      .slice(0, 10)
      .map((a) => [parseFloat(a[0]), parseFloat(a[1])]);

    let askTotal = 0;
    asks.forEach((a) => {
      askTotal += a[1];
      a[2] = askTotal;
    });
    let bidTotal = 0;
    bids.forEach((b) => {
      bidTotal += b[1];
      b[2] = bidTotal;
    });

    const maxTotal = Math.max(askTotal, bidTotal);


    const asksHtml = asks
      .reverse()
      .map(
        (a) => `
      <div class="ob-row">
        <div class="ob-bg-ask" style="width:${((a[2] / maxTotal) * 100).toFixed(1)}%"></div>
        <div class="ob-col ob-price-ask">${a[0].toFixed(2)}</div>
        <div class="ob-col">${a[1].toFixed(4)}</div>
        <div class="ob-col">${a[2].toFixed(4)}</div>
      </div>`,
      )
      .join("");

    const bidsHtml = bids
      .map(
        (b) => `
      <div class="ob-row">
        <div class="ob-bg-bid" style="width:${((b[2] / maxTotal) * 100).toFixed(1)}%"></div>
        <div class="ob-col ob-price-bid">${b[0].toFixed(2)}</div>
        <div class="ob-col">${b[1].toFixed(4)}</div>
        <div class="ob-col">${b[2].toFixed(4)}</div>
      </div>`,
      )
      .join("");

    const spread = (asks[asks.length - 1][0] - bids[0][0]).toFixed(2);
    const midPrice = parseFloat(ticker.lastPrice).toLocaleString(
      "en-US",
      { minimumFractionDigits: 2, maximumFractionDigits: 4 },
    );

    widget.innerHTML = `
      <div class="ob-table" style="margin:-16px">
        <div class="ob-header"><div>PRICE</div><div>SIZE</div><div>TOTAL</div></div>
        <div style="padding-top:4px">${asksHtml}</div>
        <div class="ob-mid">
          <div class="ob-mid-price">${midPrice}</div>
          <div class="ob-mid-spread">SPREAD ${spread}</div>
        </div>
        <div style="padding-bottom:4px">${bidsHtml}</div>
      </div>`;

    // update 24h stats sidebar
    const fmt = (n, dp = 2) =>
      parseFloat(n).toLocaleString("en-US", {
        minimumFractionDigits: dp,
        maximumFractionDigits: dp,
      });
    const fmtK = (n) => {
      const v = parseFloat(n);
      return v >= 1e6
        ? (v / 1e6).toFixed(2) + "M"
        : v >= 1e3
          ? (v / 1e3).toFixed(2) + "K"
          : v.toFixed(2);
    };
    const high24 = document.getElementById("stat-high");
    const low24 = document.getElementById("stat-low");
    if (high24) {
      high24.textContent = fmt(ticker.highPrice);
      high24.className = "stat-value up";
    }
    if (low24) {
      low24.textContent = fmt(ticker.lowPrice);
      low24.className = "stat-value down";
    }
    const vol24 = document.getElementById("stat-vol");
    if (vol24) vol24.textContent = fmtK(ticker.volume);
    const trades = document.getElementById("stat-trades");
    if (trades)
      trades.textContent = parseInt(
        ticker.count || ticker.tradeCount || 0,
      ).toLocaleString();
    const open24 = document.getElementById("stat-open");
    if (open24) open24.textContent = fmt(ticker.openPrice);
    const qvol = document.getElementById("stat-qvol");
    if (qvol) qvol.textContent = fmtK(ticker.quoteVolume);

    updateInsightsOrderbook(bids, asks, maxTotal);
  } catch (error) {
    if (error.name === "AbortError") return;
    console.error("[Fetch] fetchOrderbookDepth failed:", error);
    widget.innerHTML =
      '<div class="loading"><span class="iconify" data-icon="tabler:alert-triangle" style="font-size:24px;color:var(--trading-down);margin-bottom:8px"></span><br/>Orderbook unavailable. Retrying...</div>';
  }
}

// updates the sidebar technical signals panel
function updateSignals(candle, rsi, ema9, ema21, vwap) {
  const widget = document.getElementById("signalsWidget");

  let rsiSignal = "neutral",
    rsiText = "Hold",
    rsiVal = "-";
  if (rsi !== null) {
    rsiVal = rsi.toFixed(2);
    if (rsi < 30) {
      rsiSignal = "bullish";
      rsiText = "Buy";
    } else if (rsi > 70) {
      rsiSignal = "bearish";
      rsiText = "Sell";
    }
  }

  let emaSignal = "neutral",
    emaText = "Hold";
  if (ema9 !== null && ema21 !== null) {
    if (ema9 > ema21) {
      emaSignal = "bullish";
      emaText = "Buy";
    } else if (ema9 < ema21) {
      emaSignal = "bearish";
      emaText = "Sell";
    }
  }

  let vwapSignal = "neutral",
    vwapText = "Hold";
  if (vwap !== null) {
    if (candle.close > vwap) {
      vwapSignal = "bullish";
      vwapText = "Buy";
    } else if (candle.close < vwap) {
      vwapSignal = "bearish";
      vwapText = "Sell";
    }
  }

  widget.innerHTML = `
        <div class="signal-row">
          <div class="signal-label">
            <div class="signal-name">RSI (14)</div>
            <div class="signal-desc number">${rsiVal}</div>
          </div>
          <div class="badge ${rsiSignal}">${rsiText}</div>
        </div>
        <div class="signal-row">
          <div class="signal-label">
            <div class="signal-name">EMA Trend</div>
            <div class="signal-desc">9 vs 21 Period</div>
          </div>
          <div class="badge ${emaSignal}">${emaText}</div>
        </div>
        <div class="signal-row">
          <div class="signal-label">
            <div class="signal-name">VWAP</div>
            <div class="signal-desc">Vol-Weighted Price</div>
          </div>
          <div class="badge ${vwapSignal}">${vwapText}</div>
        </div>
      `;
}

// -- websocket stream (binance kline) --
function startStream() {
  if (ws) return;
  const symbol = currentPair.toLowerCase() + "usdt";
  try {
    ws = new WebSocket(
      "wss://stream.binance.com:9443/ws/" +
        symbol +
        "@kline_" +
        currentTimeframe,
    );
  } catch (e) {
    console.error("[WebSocket] Failed to open connection.", e);
    return;
  }

  const ema9State = { buf: [], val: null };
  const ema21State = { buf: [], val: null };
  let prevHaOpen = null,
    prevHaClose = null;
  const closes = [];

  ws.onopen = () => {
    isSwitching = false;
    reconnectAttempt = 0;
    document.getElementById("status").classList.add("live");
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    const k = msg.k;
    const candle = {
      time: Math.floor(k.t / 1000),
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      volume: parseFloat(k.v),
    };

    const overlay = document.getElementById("streamOverlay");
    if (overlay && !overlay.classList.contains("hidden"))
      overlay.classList.add("hidden");

    closes.push(candle.close);
    if (closes.length > 50) closes.shift();

    const vwap = updateVWAP(candle, currentPair);
    const rsi = updateRSI(closes, currentPair);
    const ema9 = calcEMAIncr(ema9State, candle.close, 9);
    const ema21 = calcEMAIncr(ema21State, candle.close, 21);

    const data = {
      ...candle,
      vwap,
      rsi: rsi !== null ? rsi.toFixed(2) : null,
      ema9: ema9 !== null ? ema9.toFixed(2) : null,
      ema21: ema21 !== null ? ema21.toFixed(2) : null,
    };

    const lastRaw = candles[currentPair][candles[currentPair].length - 1];
    if (lastRaw && lastRaw.time === candle.time) {
      candles[currentPair][candles[currentPair].length - 1] = data;
    } else {
      candles[currentPair].push(data);
      if (candles[currentPair].length > MAX_CANDLES)
        candles[currentPair].shift();
    }

    if (candles[currentPair].length === 10)
      chart.timeScale().fitContent();

    // build the data point for the active chart type
    let pointToUpdate;
    if (chartType === "heikinAshi") {
      const haClose =
        (candle.open + candle.high + candle.low + candle.close) / 4;
      const haOpen =
        prevHaOpen !== null
          ? (prevHaOpen + prevHaClose) / 2
          : (candle.open + candle.close) / 2;
      const haHigh = Math.max(candle.high, haOpen, haClose);
      const haLow = Math.min(candle.low, haOpen, haClose);
      prevHaOpen = haOpen;
      prevHaClose = haClose;
      pointToUpdate = {
        time: candle.time,
        open: haOpen,
        high: haHigh,
        low: haLow,
        close: haClose,
      };
    } else if (chartType === "line") {
      pointToUpdate = { time: candle.time, value: candle.close };
    } else {
      pointToUpdate = candle;
    }
    mainSeries.update(pointToUpdate);

    if (indicators.vol)
      volumeSeries.update({
        time: candle.time,
        value: candle.volume,
        color: candle.close >= candle.open ? "#0ecb8180" : "#f6465d80",
      });
    if (indicators.vwap)
      vwapSeries.update({ time: candle.time, value: vwap });
    if (indicators.ema) {
      if (ema9 !== null)
        ema9Series.update({ time: candle.time, value: ema9 });
      if (ema21 !== null)
        ema21Series.update({ time: candle.time, value: ema21 });
    }
    if (indicators.rsi && rsi !== null)
      rsiSeries.update({ time: candle.time, value: rsi });

    updateLivePrice(candle);
    updateSignals(candle, rsi, ema9, ema21, vwap);
    updateInsightsMomentum(candle, vwap, closes);
    updateInsightsWhale(candle);
  };

  ws.onclose = () => {
    document.getElementById("status").classList.remove("live");
    ws = null;
    if (!isSwitching) {
      const delay = Math.min(
        3000 * Math.pow(2, reconnectAttempt),
        MAX_RECONNECT_DELAY,
      );
      reconnectAttempt++;
      setTimeout(startStream, delay);
    }
  };

  ws.onerror = (error) => {
    console.error("[WebSocket] Connection error.", error);
    if (ws) ws.close();
  };
}

// toggles indicator visibility on chart and button state
function toggleIndicator(key, btnId, seriesArray) {
  indicators[key] = !indicators[key];
  document
    .getElementById(btnId)
    .classList.toggle("active", indicators[key]);
  const visible = indicators[key];
  if (Array.isArray(seriesArray))
    seriesArray.forEach((s) => {
      if (s) s.applyOptions({ visible });
    });
  else if (seriesArray) seriesArray.applyOptions({ visible });
}

// syncs chart colors with the current light/dark theme
function applyChartTheme(isDark) {
  if (!chart) return;
  chart.applyOptions({
    layout: {
      background: {
        type: "solid",
        color: isDark ? "#0b0e11" : "#F0E0CE",
      },
      textColor: isDark ? "#707a8a" : "#8B7B6B",
    },
    grid: {
      vertLines: { color: isDark ? "#2b3139" : "#ECD8C4" },
      horzLines: { color: isDark ? "#2b3139" : "#ECD8C4" },
    },
    timeScale: { borderColor: isDark ? "#2b3139" : "#ECD8C4" },
    rightPriceScale: { borderColor: isDark ? "#2b3139" : "#ECD8C4" },
  });
}

document.getElementById("btn-theme").onclick = () => {
  const el = document.documentElement;
  const isDark = el.getAttribute("data-theme") === "dark";
  el.setAttribute("data-theme", isDark ? "light" : "dark");
  document
    .getElementById("theme-icon")
    .setAttribute("data-icon", isDark ? "tabler:moon" : "tabler:sun");
  applyChartTheme(!isDark);
};

// -- ui handlers --
document.getElementById("chartTypeBtn").onclick = (e) => {
  e.stopPropagation();
  document.getElementById("chartTypeMenu").classList.toggle("open");
};
document.querySelectorAll(".chart-type-opt").forEach((btn) => {
  btn.onclick = (e) => {
    chartType = e.target.getAttribute("data-val");
    document.getElementById("activeChartTypeText").textContent =
      e.target.textContent;
    document.getElementById("chartTypeMenu").classList.remove("open");
    initMainSeries();
  };
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".clean-dropdown")) {
    const menu = document.getElementById("chartTypeMenu");
    if (menu) menu.classList.remove("open");
    const tfMenu = document.getElementById("timeframeMenu");
    if (tfMenu) tfMenu.classList.remove("open");
  }
});

function switchTimeframe(tf) {
  if (tf === currentTimeframe) return;
  currentTimeframe = tf;
  document.getElementById("activeTimeframeText").textContent = tf;

  if (ws) {
    isSwitching = true;
    ws.onclose = ws.onerror = ws.onmessage = null;
    try {
      ws.close();
    } catch (e) {}
    ws = null;
  }

  pairs.forEach((pair) => {
    candles[pair] = [];
    rsiState[pair] = { avgGain: null, avgLoss: null, count: 0 };
    vwapState[pair] = { cumTPV: 0, cumVol: 0, resetDay: -1 };
  });
  insightsVolWindow.length = 0;

  if (mainSeries) mainSeries.setData([]);
  if (chart) chart.timeScale().fitContent();
  document.getElementById("streamOverlay").classList.remove("hidden");

  setTimeout(startStream, 100);
}

document.getElementById("timeframeBtn").onclick = (e) => {
  e.stopPropagation();
  document.getElementById("timeframeMenu").classList.toggle("open");
};
document.querySelectorAll(".tf-opt").forEach((btn) => {
  btn.onclick = (e) => {
    const tf = e.target.getAttribute("data-val");
    document.getElementById("activeTimeframeText").textContent = tf;
    document.getElementById("timeframeMenu").classList.remove("open");
    switchTimeframe(tf);
  };
});

// indicator toggle buttons
document.getElementById("btn-vwap").onclick = () =>
  toggleIndicator("vwap", "btn-vwap", vwapSeries);
document.getElementById("btn-ema").onclick = () =>
  toggleIndicator("ema", "btn-ema", [ema9Series, ema21Series]);
document.getElementById("btn-rsi").onclick = () =>
  toggleIndicator("rsi", "btn-rsi", rsiSeries);
document.getElementById("btn-vol").onclick = () =>
  toggleIndicator("vol", "btn-vol", volumeSeries);
document.getElementById("btn-fit").onclick = () => {
  if (chart) chart.timeScale().fitContent();
};
document.getElementById("btn-reset").onclick = () => {
  if (chart) chart.timeScale().resetTimeScale();
};

document.getElementById("btn-insights").onclick = () => {
  const panel = document.getElementById("liveInsightsPanel");
  const btn = document.getElementById("btn-insights");
  const hidden = panel.classList.toggle("hidden");
  btn.classList.toggle("active", !hidden);
};
document.getElementById("li-close-btn").onclick = () => {
  document.getElementById("liveInsightsPanel").classList.add("hidden");
  document.getElementById("btn-insights").classList.remove("active");
};
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement.tagName !== "INPUT") {
    e.preventDefault();
    document.getElementById("tokenSearch").focus();
  }
});

document.getElementById("tokenSearch").addEventListener("input", (e) => {
  const q = e.target.value.toUpperCase();
  const btns = document.querySelectorAll(".pair-btn");
  btns.forEach((b) => {
    if (b.textContent.toUpperCase().includes(q)) b.style.display = "flex";
    else b.style.display = "none";
  });
});

const toolbar = document.getElementById("mainToolbar");
let isDragging = false,
  offsetX,
  offsetY;
const isTouchDevice = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
if (!isTouchDevice) {
  toolbar.addEventListener("mousedown", (e) => {
    if (
      e.target.closest(
        "button, input, .clean-dropdown, .pair-btn, .search-container",
      )
    )
      return;
    isDragging = true;
    const rect = toolbar.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    toolbar.style.cursor = "grabbing";
    if (!toolbar.style.left || toolbar.style.left.includes("%")) {
      toolbar.style.left = rect.left + "px";
      toolbar.style.top = rect.top + "px";
      toolbar.style.transform = "none";
    }
  });
  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const w = toolbar.offsetWidth;
    const h = toolbar.offsetHeight;
    const newLeft = Math.max(
      0,
      Math.min(e.clientX - offsetX, window.innerWidth - w),
    );
    const newTop = Math.max(
      0,
      Math.min(e.clientY - offsetY, window.innerHeight - h),
    );
    toolbar.style.left = newLeft + "px";
    toolbar.style.top = newTop + "px";
  });
  document.addEventListener("mouseup", () => {
    if (isDragging) {
      isDragging = false;
      toolbar.style.cursor = "grab";
    }
  });
}

function updateClock() {
  document.getElementById("clock").textContent =
    new Date().toUTCString().slice(17, 25) + " UTC";
}

// -- live insights engine --
// 20-bar rolling volume window, multi-signal consensus for price bias
const insightsVolWindow = [];
const INSIGHTS_VOL_WINDOW = 20;

// draws a mini price sparkline on the insights panel canvas
function drawSparkline(closes) {
  const canvas = document.getElementById("liSparkCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.offsetWidth || 260;
  const h = canvas.height;
  canvas.width = w;
  ctx.clearRect(0, 0, w, h);
  if (closes.length < 2) return;

  const slice = closes.slice(-40);
  const min = Math.min(...slice);
  const max = Math.max(...slice);
  const range = max - min || 1;
  const isUp = slice[slice.length - 1] >= slice[0];

  const grad = ctx.createLinearGradient(0, 0, w, 0);
  if (isUp) {
    grad.addColorStop(0, "rgba(14,203,129,0.3)");
    grad.addColorStop(1, "#0ecb81");
  } else {
    grad.addColorStop(0, "rgba(246,70,93,0.3)");
    grad.addColorStop(1, "#f6465d");
  }
  ctx.strokeStyle = grad;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.beginPath();
  slice.forEach((v, i) => {
    const x = (i / (slice.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
}

// price bias card: scores rsi + vwap + ema alignment into a verdict
function updateInsightsMomentum(candle, vwap, closes) {
  const text = document.getElementById("liMomText");
  const meta = document.getElementById("liMomMeta");
  const tf = document.getElementById("liMomTf");
  if (tf) tf.textContent = currentTimeframe;

  drawSparkline(closes);


  if (closes.length < 14 || vwap === null) {
    if (text) {
      text.textContent = "Building signal history...";
      text.style.color = "var(--muted)";
    }
    return;
  }

  const price = candle.close;
  const rsiVal = parseFloat(candle.rsi);
  const ema9v = parseFloat(candle.ema9);
  const ema21v = parseFloat(candle.ema21);

  // score each signal: +1 bullish, -1 bearish, 0 neutral
  let score = 0;
  const signals = [];


  const vwapPct = ((price - vwap) / vwap) * 100;
  if (vwapPct > 0.05) {
    score++;
    signals.push(`+${vwapPct.toFixed(2)}% VWAP`);
  } else if (vwapPct < -0.05) {
    score--;
    signals.push(`${vwapPct.toFixed(2)}% VWAP`);
  } else {
    signals.push("At VWAP");
  }


  if (!isNaN(rsiVal)) {
    if (rsiVal < 35) {
      score++;
      signals.push(`RSI ${rsiVal} oversold`);
    } else if (rsiVal > 65) {
      score--;
      signals.push(`RSI ${rsiVal} overbought`);
    } else {
      signals.push(`RSI ${rsiVal.toFixed(0)} neutral`);
    }
  }


  if (!isNaN(ema9v) && !isNaN(ema21v)) {
    if (ema9v > ema21v) {
      score++;
      signals.push("EMA bullish cross");
    } else {
      score--;
      signals.push("EMA bearish cross");
    }
  }


  let verdict, color;
  if (score >= 2) {
    verdict = "Bullish bias â€” multiple signals aligned upward.";
    color = "var(--text-bullish)";
  } else if (score === 1) {
    verdict = "Mild bullish lean â€” watch for confirmation.";
    color = "var(--text-bullish)";
  } else if (score === -1) {
    verdict = "Mild bearish lean â€” watch for breakdown.";
    color = "var(--text-bearish)";
  } else if (score <= -2) {
    verdict = "Bearish bias â€” multiple signals aligned downward.";
    color = "var(--text-bearish)";
  } else {
    verdict = "Mixed signals â€” market is ranging. Stand aside.";
    color = "var(--text-neutral)";
  }

  if (text) {
    text.textContent = verdict;
    text.style.color = color;
  }
  if (meta) meta.textContent = signals.join(" Â· ");
}

// volume context card: compares current bar volume to 20-bar rolling avg
function updateInsightsWhale(candle) {
  const text = document.getElementById("liWhaleText");
  const meta = document.getElementById("liWhaleMeta");
  const bar = document.getElementById("liVolBar");

  insightsVolWindow.push(candle.volume);
  if (insightsVolWindow.length > INSIGHTS_VOL_WINDOW)
    insightsVolWindow.shift();

  const avgVol =
    insightsVolWindow.reduce((a, b) => a + b, 0) /
    insightsVolWindow.length;
  const ratio = avgVol > 0 ? candle.volume / avgVol : 0;
  const barPct = Math.min(ratio * 40, 100).toFixed(0);

  if (bar) {
    bar.style.width = barPct + "%";
    bar.classList.toggle("spike", ratio > 2.5);
  }

  const isUp = candle.close >= candle.open;
  const isHigh = ratio > 2.5;
  const isMed = ratio > 1.4 && ratio <= 2.5;
  const isLow = ratio < 0.6;

  let verdict, color;
  if (isHigh && isUp) {
    verdict = `High-conviction buying (${ratio.toFixed(1)}Ã— avg). Breakout likely.`;
    color = "var(--text-bullish)";
  } else if (isHigh) {
    verdict = `High-volume selling (${ratio.toFixed(1)}Ã— avg). Distribution in progress.`;
    color = "var(--text-bearish)";
  } else if (isMed && isUp) {
    verdict = `Elevated buying interest (${ratio.toFixed(1)}Ã— avg). Momentum building.`;
    color = "var(--text-bullish)";
  } else if (isMed) {
    verdict = `Elevated selling pressure (${ratio.toFixed(1)}Ã— avg). Monitor closely.`;
    color = "var(--text-bearish)";
  } else if (isLow) {
    verdict = `Low volume (${ratio.toFixed(1)}Ã— avg). Likely range-bound â€” no edge.`;
    color = "var(--text-neutral)";
  } else {
    verdict = `Normal volume (${ratio.toFixed(1)}Ã— avg). No unusual activity.`;
    color = "var(--body)";
  }

  if (text) {
    text.textContent = verdict;
    text.style.color = color;
  }
  if (meta) meta.textContent = `${ratio.toFixed(1)}Ã— 20-bar avg`;
}

// orderbook pressure card: visualizes bid/ask imbalance
function updateInsightsOrderbook(bids, asks, maxTotal) {
  const barsEl = document.getElementById("liObBars");
  const text = document.getElementById("liObText");
  const meta = document.getElementById("liObMeta");
  if (!barsEl) return;

  const bidVol = bids.reduce((a, b) => a + b[1], 0);
  const askVol = asks.reduce((a, b) => a + b[1], 0);
  const total = bidVol + askVol || 1;
  const bidPct = bidVol / total;
  const askPct = askVol / total;

  // 4 ask bars + 4 bid bars side by side
  const numBars = 4;
  const bSlice = bids.slice(0, numBars);
  const aSlice = asks.slice(0, numBars);
  const peakVol = Math.max(
    ...bSlice.map((b) => b[1]),
    ...aSlice.map((a) => a[1]),
    1,
  );

  let html = "";
  aSlice.reverse().forEach((a) => {
    const h = Math.max(4, Math.round((a[1] / peakVol) * 28));
    html += `<div class="li-ob-bar-ask" style="height:${h}px"></div>`;
  });
  bSlice.forEach((b) => {
    const h = Math.max(4, Math.round((b[1] / peakVol) * 28));
    html += `<div class="li-ob-bar-bid" style="height:${h}px"></div>`;
  });
  barsEl.innerHTML = html;

  const imbalance = Math.abs(bidPct - askPct);
  const side = bidPct > askPct ? "bid" : "ask";
  let label;
  if (imbalance > 0.2) {
    const price = side === "bid" ? bids[0][0] : asks[0][0];
    label = `Massive ${side} wall detected at ${price.toLocaleString()}. ${side === "ask" ? "Ask liquidity thinning." : "Bid support building."}`;
  } else {
    label = "Order flow balanced. No significant walls detected.";
  }

  if (text) text.textContent = label;
  if (meta)
    meta.textContent = `High Imbalance | ${(bidPct * 100).toFixed(0)}% Bid vs ${(askPct * 100).toFixed(0)}% Ask`;
}

// -- boot --
function init() {
  createPairButtons();
  initChart();
  startStream();
  setInterval(updateClock, 1000);
  updateClock();
  resetObInterval();
}

document.addEventListener("DOMContentLoaded", init);
