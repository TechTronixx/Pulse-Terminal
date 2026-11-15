// js/verdict.js -- Pulse verdict: a rule-based read of Market Cipher B across timeframes,
// combined with the chart's classic indicators, market sentiment, news, and fundamentals.
// Pure functions; browser global `PulseVerdict`, Node `require("./js/verdict.js")`.
// Every score is in [-1, 1]: positive = bullish, negative = bearish.
(function (global) {
  "use strict";

  const isNa = (v) => v === null || v === undefined || Number.isNaN(v);
  const clamp = (v, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));

  // Higher timeframes carry more weight; 1m-30m together are 35%.
  const TF_WEIGHTS = {
    "1m": 0.04, "3m": 0.05, "5m": 0.07, "15m": 0.09, "30m": 0.1, "1h": 0.12,
    "4h": 0.14, "1d": 0.14, "1w": 0.11, "1M": 0.09, "1y": 0.05,
  };
  const COMPONENT_WEIGHTS = { technical: 0.55, sentiment: 0.15, news: 0.15, fundamentals: 0.15 };
  const DOT_LOOKBACK = 12;

  function zoneOf(fast) {
    if (isNa(fast)) return { key: "unknown", label: "Warming up", score: 0 };
    if (fast <= -60) return { key: "oversold", label: "Oversold", score: 1 };
    if (fast <= -53) return { key: "nearOversold", label: "Near oversold", score: 0.5 };
    if (fast >= 60) return { key: "overbought", label: "Overbought", score: -1 };
    if (fast >= 53) return { key: "nearOverbought", label: "Near overbought", score: -0.5 };
    return { key: "neutral", label: "Mid range", score: 0 };
  }

  function lastDot(mcb, n) {
    for (let i = n - 1; i >= 0 && i >= n - DOT_LOOKBACK; i--) {
      const ago = n - 1 - i;
      if (mcb.buySignal[i]) return { type: "buySignal", label: "Big green dot", ago, sign: 1, strength: 1 };
      if (mcb.sellSignal[i]) return { type: "sellSignal", label: "Big red dot", ago, sign: -1, strength: 1 };
      if (mcb.buy[i]) return { type: "buy", label: "Green dot", ago, sign: 1, strength: 0.6 };
      if (mcb.sell[i]) return { type: "sell", label: "Red dot", ago, sign: -1, strength: 0.6 };
    }
    return null;
  }

  const biasOf = (s) => (s > 0.15 ? "Bullish" : s < -0.15 ? "Bearish" : "Neutral");

  // One timeframe, read from Market Cipher B on its latest bar.
  function readTimeframe(mcb) {
    const n = mcb.fast.length;
    const i = n - 1;
    const fast = mcb.fast[i];
    const slow = mcb.slow[i];
    const mf = mcb.mf[i];
    const rsi = mcb.rsi[i];
    const stoch = mcb.stoch[i];
    if (n === 0 || isNa(fast) || isNa(slow)) {
      return { ready: false, score: 0, bias: "Neutral", action: "Wait", zone: zoneOf(NaN), reasons: ["Not enough bars yet"] };
    }
    const zone = zoneOf(fast);
    const dot = lastDot(mcb, n);
    const wave = fast > slow ? 1 : -1;
    const flow = isNa(mf) ? 0 : mf > 0 ? 1 : -1;
    const stochSide = isNa(stoch) || isNa(rsi) ? 0 : stoch < rsi ? 1 : -1;
    const dotScore = dot ? dot.sign * dot.strength * Math.max(0, 1 - dot.ago / DOT_LOOKBACK) : 0;

    const score = clamp(0.3 * wave + 0.3 * dotScore + 0.2 * flow + 0.1 * stochSide + 0.1 * zone.score);

    const reasons = [];
    reasons.push(wave > 0 ? "WaveTrend fast line above slow" : "WaveTrend fast line below slow");
    if (dot) reasons.push(`${dot.label} ${dot.ago === 0 ? "on this bar" : dot.ago === 1 ? "1 bar ago" : `${dot.ago} bars ago`}`);
    if (flow) reasons.push(flow > 0 ? "Money flow positive" : "Money flow negative");
    if (zone.key !== "neutral") reasons.push(`Wave ${zone.label.toLowerCase()}`);

    let action = "Wait";
    let note = "";
    const freshBig = dot && dot.strength === 1 && dot.ago <= 3;
    if (freshBig && dot.sign > 0) action = "Long";
    else if (freshBig && dot.sign < 0) action = "Short";
    else if (score >= 0.35) {
      if (zone.score < 0) note = "Bullish, but the wave is overbought (late entry)";
      else action = "Long";
    } else if (score <= -0.35) {
      if (zone.score > 0) note = "Bearish, but the wave is oversold (late entry)";
      else action = "Short";
    }
    if (note) reasons.push(note);

    return {
      ready: true,
      score,
      bias: biasOf(score),
      action,
      zone,
      dot,
      wave: wave > 0 ? "up" : "down",
      flow: flow > 0 ? "inflow" : flow < 0 ? "outflow" : "unknown",
      stochSide: stochSide > 0 ? "up" : stochSide < 0 ? "down" : "unknown",
      fast,
      slow,
      mf,
      reasons,
    };
  }

  // The chart timeframe's classic indicators: VWAP, RSI, EMA 9/21, MACD histogram, Bollinger.
  // ichi: optional Ichimoku score in [-1, 1] (counted as a sixth factor when present)
  function readClassic({ price, vwap, rsi, ema9, ema21, hist, prevHist, upper, lower, ichi }) {
    const f = [];
    if (!isNa(vwap)) f.push(price > vwap ? 1 : -1);
    if (!isNa(rsi)) f.push(rsi < 40 ? 1 : rsi > 60 ? -1 : 0);
    if (!isNa(ema9) && !isNa(ema21)) f.push(ema9 > ema21 ? 1 : -1);
    if (!isNa(hist) && !isNa(prevHist)) f.push(hist > 0 && hist > prevHist ? 1 : hist < 0 && hist < prevHist ? -1 : 0);
    if (!isNa(upper) && !isNa(lower)) f.push(price < lower ? 1 : price > upper ? -1 : 0);
    if (Number.isFinite(ichi)) f.push(ichi);
    if (!f.length) return null;
    return f.reduce((a, b) => a + b, 0) / Math.max(5, f.length);
  }

  function technical(rows, classic) {
    let w = 0;
    let s = 0;
    for (const tf in TF_WEIGHTS) {
      const r = rows[tf];
      if (!r || !r.ready) continue;
      w += TF_WEIGHTS[tf];
      s += TF_WEIGHTS[tf] * r.score;
    }
    if (!w && classic === null) return null;
    const mtf = w ? s / w : 0;
    if (!w) return clamp(classic);
    return clamp(classic === null ? mtf : 0.8 * mtf + 0.2 * classic);
  }

  // Fear & Greed 0..100 -> [-1, 1]; greed reads bullish, fear bearish.
  const sentiment = (fng) => (fng && Number.isFinite(fng.value) ? clamp((fng.value - 50) / 50) : null);

  // CoinGecko market data -> [-1, 1] from the 7d / 30d trend and supply dilution.
  function fundamentals(cg) {
    if (!cg) return null;
    const t7 = Number.isFinite(cg.change7d) ? Math.tanh(cg.change7d / 10) : 0;
    const t30 = Number.isFinite(cg.change30d) ? Math.tanh(cg.change30d / 25) : 0;
    let dil = 0;
    if (cg.marketCap > 0 && cg.fdv > 0) dil = clamp((cg.marketCap / cg.fdv - 0.5) * 2);
    return clamp(0.45 * t30 + 0.25 * t7 + 0.3 * dil);
  }

  // ctx.zones = { oversold, overbought, ready }: Market Cipher B zone counts across timeframes.
  function overall(parts, ctx) {
    let w = 0;
    let s = 0;
    const used = {};
    for (const k in COMPONENT_WEIGHTS) {
      const v = parts[k];
      if (v === null || v === undefined || Number.isNaN(v)) continue;
      w += COMPONENT_WEIGHTS[k];
      s += COMPONENT_WEIGHTS[k] * v;
      used[k] = v;
    }
    if (!w) return null;
    const score = clamp(s / w);
    const agree = Object.values(used).filter((v) => Math.sign(v) === Math.sign(score) && Math.abs(v) > 0.05).length;
    let action = score >= 0.25 ? "Long" : score <= -0.25 ? "Short" : "Wait";
    let note = "";
    if (action !== "Wait" && used.technical !== undefined && Math.sign(used.technical) !== Math.sign(score)) {
      note = "Technicals disagree with the rest";
      action = "Wait";
    }
    // Do not chase: most timeframes already stretched in the trade's direction.
    const z = ctx && ctx.zones;
    if (z && z.ready >= 3) {
      if (action === "Short" && z.oversold / z.ready >= 0.6) {
        action = "Wait";
        note = `Bearish, but ${z.oversold} of ${z.ready} timeframes are already oversold; wait for a bounce or a fresh red dot`;
      } else if (action === "Long" && z.overbought / z.ready >= 0.6) {
        action = "Wait";
        note = `Bullish, but ${z.overbought} of ${z.ready} timeframes are already overbought; wait for a pullback or a fresh green dot`;
      }
    }
    return {
      score,
      bias: biasOf(score),
      action,
      confidence: Math.round(Math.abs(score) * 100),
      agree,
      total: Object.keys(used).length,
      note,
    };
  }

  // Entry / invalidation / target on the chart timeframe: last swing (20 bars), 1:2 reward.
  function levels(bars, action, lookback = 20) {
    const n = bars.length;
    if (!n || action === "Wait") return null;
    const entry = bars[n - 1].close;
    const from = Math.max(0, n - 1 - lookback);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = from; i < n; i++) {
      if (bars[i].low < lo) lo = bars[i].low;
      if (bars[i].high > hi) hi = bars[i].high;
    }
    if (action === "Long" && lo < entry) return { entry, stop: lo, target: entry + 2 * (entry - lo) };
    if (action === "Short" && hi > entry) return { entry, stop: hi, target: entry - 2 * (hi - entry) };
    return null;
  }

  const api = {
    TF_WEIGHTS,
    COMPONENT_WEIGHTS,
    zoneOf,
    readTimeframe,
    readClassic,
    technical,
    sentiment,
    fundamentals,
    overall,
    levels,
  };
  global.PulseVerdict = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
