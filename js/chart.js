// js/chart.js -- Lightweight Charts v5 wiring for Pulse Terminal.
// Owns the chart, its panes, and every series. Indicator values come in already
// computed (js/indicators.js); this module only maps them onto series.
// Exposes global `PulseChart`.
(function (global) {
  "use strict";

  const LWC = global.LightweightCharts;
  const isNa = (v) => v === null || v === undefined || Number.isNaN(v);

  // Pine `color.new(hex, transp)` -> rgba with alpha = 1 - transp / 100
  function pine(hex, transp) {
    const n = parseInt(hex.slice(1), 16);
    const a = 1 - (transp || 0) / 100;
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${+a.toFixed(3)})`;
  }

  // Colors from the Market Cipher B source. White levels follow the theme ink so they
  // stay visible in light mode; every other color is the script's own.
  const MCB_COLORS = {
    fast: pine("#c1cbff", 25),
    slow: pine("#0019fa", 32),
    vwap: pine("#ffeb3b", 40),
    mfUp: pine("#53ff1e", 53),
    mfDown: pine("#ff1100", 50),
    bandUp: pine("#3cff00", 70),
    bandDown: pine("#ff1100", 70),
    rsi: "#E040FB", // color.fuchsia
    stochUp: pine("#00e676", 0),
    stochDown: pine("#ff5252", 0),
    dotBuy: pine("#00e676", 0),
    dotSell: pine("#ff5252", 0),
    sigBuy: "#4CAF50", // color.green
    sigSell: "#F23645", // color.red
  };

  const THEMES = {
    dark: {
      bg: "#0d0d0d",
      text: "#7c7c7c",
      grid: "rgba(255, 255, 255, 0.035)",
      border: "#1c1c1c",
      crosshair: "rgba(255, 255, 255, 0.28)",
      label: "#2a2a2a",
      separator: "#1c1c1c",
      separatorHover: "rgba(226, 120, 63, 0.35)",
      up: "#e2783f",
      down: "#d4d4d4",
      volUp: "rgba(226, 120, 63, 0.42)",
      volDown: "rgba(212, 212, 212, 0.2)",
      line: "#e2783f",
      ink: "#ffffff",
      vwap: "#f0a95a",
      ema9: "#6ea8fe",
      ema21: "#c792ea",
      rsi: "#b9b9b9",
      rsiLevel: "rgba(255, 255, 255, 0.22)",
    },
    light: {
      bg: "#fbfbfa",
      text: "#7a7a76",
      grid: "rgba(0, 0, 0, 0.045)",
      border: "#e7e6e2",
      crosshair: "rgba(0, 0, 0, 0.3)",
      label: "#1a1a1a",
      separator: "#e7e6e2",
      separatorHover: "rgba(196, 86, 29, 0.3)",
      up: "#c4561d",
      down: "#2c2c2c",
      volUp: "rgba(196, 86, 29, 0.35)",
      volDown: "rgba(44, 44, 44, 0.18)",
      line: "#c4561d",
      ink: "#151515",
      vwap: "#b8741f",
      ema9: "#2f6fd6",
      ema21: "#8a46c2",
      rsi: "#4a4a4a",
      rsiLevel: "rgba(0, 0, 0, 0.25)",
    },
  };

  // Pine `fill(p, p2, color=...)` between the constant -95 and -105 plots: one band
  // segment per bar, colored by the sign of mf on that bar.
  class BandFill {
    constructor() {
      this._items = [];
      this._chart = null;
      this._series = null;
      this._request = null;
      const self = this;
      this._view = {
        zOrder: () => "normal",
        renderer: () => ({ draw: (target) => self._draw(target) }),
      };
    }
    attached({ chart, series, requestUpdate }) {
      this._chart = chart;
      this._series = series;
      this._request = requestUpdate;
    }
    detached() {
      this._chart = this._series = this._request = null;
    }
    paneViews() {
      return [this._view];
    }
    updateAllViews() {}
    setItems(items) {
      this._items = items;
      if (this._request) this._request();
    }
    _draw(target) {
      if (!this._chart || !this._series || !this._items.length) return;
      const ts = this._chart.timeScale();
      const yTop = this._series.priceToCoordinate(-95);
      const yBot = this._series.priceToCoordinate(-105);
      if (yTop === null || yBot === null) return;
      const spacing = ts.options().barSpacing;
      const range = ts.getVisibleLogicalRange();
      if (!range) return;
      const from = Math.max(0, Math.floor(range.from) - 1);
      const to = Math.min(this._items.length - 1, Math.ceil(range.to) + 1);
      target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
        const top = Math.round(Math.min(yTop, yBot) * vr);
        const h = Math.max(1, Math.round(Math.abs(yBot - yTop) * vr));
        for (let i = from; i <= to; i++) {
          const it = this._items[i];
          const x = ts.logicalToCoordinate(i);
          if (x === null) continue;
          const left = Math.round((x - spacing / 2) * hr);
          const right = Math.round((x + spacing / 2) * hr);
          context.fillStyle = it.color;
          context.fillRect(left, top, Math.max(1, right - left), h);
        }
      });
    }
  }

  function create(container, opts) {
    let themeName = opts && opts.theme === "light" ? "light" : "dark";
    let t = THEMES[themeName];
    let precision = 2;
    let minMove = 0.01;
    let chartType = "candlestick";

    const chart = LWC.createChart(container, {
      autoSize: true,
      layout: {
        background: { type: LWC.ColorType.Solid, color: t.bg },
        textColor: t.text,
        fontSize: 11,
        fontFamily: "'Chivo Mono', ui-monospace, Menlo, Consolas, monospace",
        attributionLogo: false,
        panes: { enableResize: true, separatorColor: t.separator, separatorHoverColor: t.separatorHover },
      },
      grid: {
        vertLines: { color: t.grid },
        horzLines: { color: t.grid },
      },
      crosshair: {
        mode: LWC.CrosshairMode.Normal,
        vertLine: { color: t.crosshair, width: 1, style: LWC.LineStyle.Dashed, labelBackgroundColor: t.label },
        horzLine: { color: t.crosshair, width: 1, style: LWC.LineStyle.Dashed, labelBackgroundColor: t.label },
      },
      rightPriceScale: { borderColor: t.border, scaleMargins: { top: 0.14, bottom: 0.06 } },
      timeScale: {
        borderColor: t.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        barSpacing: 7,
        minBarSpacing: 1.5,
      },
      kineticScroll: { mouse: true, touch: true },
      // wheel zoom / scroll are handled by smoothWheel() below
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: false, pinch: true },
    });

    // ---- smooth wheel / trackpad zoom and scroll ----
    // Wheel or pinch zooms around the cursor; horizontal swipe or Shift+wheel scrolls.
    // Trackpads already send smooth, small deltas, so they move the chart directly (no lag).
    // A mouse wheel moves in notches, so each notch eases toward its target with a
    // frame-rate independent exponential curve (same feel at 60 Hz and 144 Hz).
    const reduceMotion = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let dataLen = 0;
    (function smoothWheel() {
      const ts = chart.timeScale();
      const TAU = 70; // ms; ~95% of the way in 210 ms
      let target = null;
      let raf = 0;
      let last = 0;

      function step(now) {
        raf = 0;
        const cur = ts.getVisibleLogicalRange();
        if (!cur || !target) return;
        const dt = Math.min(50, now - (last || now - 16));
        last = now;
        const a = 1 - Math.exp(-dt / TAU);
        const from = cur.from + (target.from - cur.from) * a;
        const to = cur.to + (target.to - cur.to) * a;
        const done = Math.abs(target.from - from) < 0.02 && Math.abs(target.to - to) < 0.02;
        ts.setVisibleLogicalRange(done ? target : { from, to });
        if (done) {
          target = null;
          last = 0;
        } else raf = global.requestAnimationFrame(step);
      }

      function stop() {
        target = null;
        if (raf) global.cancelAnimationFrame(raf);
        raf = 0;
      }

      container.addEventListener(
        "wheel",
        (e) => {
          const base = target || ts.getVisibleLogicalRange();
          if (!base) return;
          const rect = container.getBoundingClientRect();
          let psW = 0;
          try {
            psW = chart.priceScale("right", 0).width();
          } catch (_) {}
          const plotW = rect.width - psW;
          const x = e.clientX - rect.left;
          if (x > plotW || plotW <= 0) return;
          e.preventDefault();

          let dx = e.deltaX;
          let dy = e.deltaY;
          if (e.deltaMode === 1) {
            dx *= 16;
            dy *= 16;
          }
          if (e.shiftKey && !dx) {
            dx = dy;
            dy = 0;
          }
          let { from, to } = base;
          const width = to - from;
          if (Math.abs(dx) > Math.abs(dy)) {
            const shift = dx * (width / plotW);
            from += shift;
            to += shift;
          } else {
            // trackpad pinch arrives as ctrl+wheel with small deltas
            const intensity = e.ctrlKey ? 0.012 : 0.0016;
            const newW = Math.min(4000, Math.max(12, width * Math.exp(dy * intensity)));
            const f = newW / width;
            const anchor = from + (x / plotW) * width;
            from = anchor - (anchor - from) * f;
            to = anchor + (to - anchor) * f;
          }
          // keep some data in view
          const n = dataLen;
          const w = to - from;
          if (n) {
            const maxTo = n - 1 + w * 0.6;
            const minFrom = -w * 0.6;
            if (to > maxTo) {
              from -= to - maxTo;
              to = maxTo;
            }
            if (from < minFrom) {
              to += minFrom - from;
              from = minFrom;
            }
          }
          // mouse wheel notches ease; trackpad deltas apply directly
          const notch = e.deltaMode !== 0 || (Math.abs(dx) < 1 && Math.abs(dy) >= 50 && Number.isInteger(dy) && !e.ctrlKey);
          if (reduceMotion || !notch) {
            stop();
            ts.setVisibleLogicalRange({ from, to });
            return;
          }
          target = { from, to };
          if (!raf) raf = global.requestAnimationFrame(step);
        },
        { passive: false },
      );
      container.addEventListener("pointerdown", stop);
    })();

    // ---- smooth price autoscale ----
    // Lightweight Charts re-fits the price axis on every frame, so scrolling makes the
    // candles jump up and down. The main series' autoscale eases toward the true range
    // instead; overlays (VWAP / EMA) report their range here and are folded in.
    const yAuto = { overlays: new Map(), cur: null, at: 0, snap: true, request: null, raf: 0 };
    function requestY() {
      if (yAuto.raf || !yAuto.request) return;
      yAuto.raf = global.requestAnimationFrame(() => {
        yAuto.raf = 0;
        if (yAuto.request) yAuto.request();
      });
    }
    function mainAutoscale(orig) {
      const r = orig();
      if (!r || !r.priceRange) return r;
      let lo = r.priceRange.minValue;
      let hi = r.priceRange.maxValue;
      for (const v of yAuto.overlays.values()) {
        if (!v) continue;
        if (v.lo < lo) lo = v.lo;
        if (v.hi > hi) hi = v.hi;
      }
      const now = global.performance ? global.performance.now() : Date.now();
      const span = hi - lo || Math.abs(hi) * 0.001 || 1;
      const c = yAuto.cur;
      if (!c || yAuto.snap || reduceMotion || lo > c.hi + span || hi < c.lo - span) {
        yAuto.cur = { lo, hi };
        yAuto.snap = false;
      } else {
        const dt = Math.min(64, now - yAuto.at);
        const a = 1 - Math.exp(-dt / 90);
        c.lo += (lo - c.lo) * a;
        c.hi += (hi - c.hi) * a;
        if (Math.abs(c.lo - lo) > span * 0.001 || Math.abs(c.hi - hi) > span * 0.001) requestY();
        else yAuto.cur = { lo, hi };
      }
      yAuto.at = now;
      return { priceRange: { minValue: yAuto.cur.lo, maxValue: yAuto.cur.hi }, margins: r.margins };
    }
    function overlayAutoscale(key) {
      return (orig) => {
        const r = orig();
        yAuto.overlays.set(key, r && r.priceRange ? { lo: r.priceRange.minValue, hi: r.priceRange.maxValue } : null);
        return null;
      };
    }
    // a no-op primitive that gives us requestUpdate() for the main series
    function redrawHook() {
      return {
        attached: ({ requestUpdate }) => (yAuto.request = requestUpdate),
        detached: () => (yAuto.request = null),
        updateAllViews() {},
        paneViews: () => [],
      };
    }

    let main = null;
    let volume = null;
    let vwap = null;
    let ema9 = null;
    let ema21 = null;
    let rsiGroup = null;
    let mcbGroup = null;
    let mcbParams = null;

    // ---- helpers ----
    const lineOpts = (color, extra) =>
      Object.assign(
        {
          color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        },
        extra,
      );

    function priceFormat() {
      return { type: "price", precision, minMove };
    }

    function paneIndexOf(series) {
      try {
        return series.getPane().paneIndex();
      } catch (_) {
        return 0;
      }
    }

    function nextPane() {
      return chart.panes().length;
    }

    function setStretch() {
      const panes = chart.panes();
      const compact = global.matchMedia && global.matchMedia("(max-width: 900px)").matches;
      panes.forEach((p, i) => p.setStretchFactor(i === 0 ? (compact ? 2.2 : 3.2) : 1.25));
    }

    // ---- main + overlay series ----
    function buildMain() {
      if (main) chart.removeSeries(main);
      if (chartType === "line") {
        main = chart.addSeries(LWC.LineSeries, {
          color: t.line,
          lineWidth: 2,
          priceFormat: priceFormat(),
          crosshairMarkerRadius: 3,
          lastPriceAnimation: LWC.LastPriceAnimationMode.OnDataUpdate,
          autoscaleInfoProvider: mainAutoscale,
        }, 0);
      } else {
        main = chart.addSeries(LWC.CandlestickSeries, {
          upColor: t.up,
          downColor: t.down,
          borderVisible: false,
          wickUpColor: t.up,
          wickDownColor: t.down,
          priceFormat: priceFormat(),
          autoscaleInfoProvider: mainAutoscale,
        }, 0);
      }
      main.attachPrimitive(redrawHook());
      yAuto.snap = true;
      try {
        main.setSeriesOrder(0);
      } catch (_) {}
    }

    function buildOverlays(ind) {
      if (!volume) {
        volume = chart.addSeries(LWC.HistogramSeries, {
          priceFormat: { type: "volume" },
          priceScaleId: "vol",
          priceLineVisible: false,
          lastValueVisible: false,
        }, 0);
        chart.priceScale("vol", 0).applyOptions({ visible: false, scaleMargins: { top: 0.82, bottom: 0 } });
      }
      if (!vwap) vwap = chart.addSeries(LWC.LineSeries, lineOpts(t.vwap, { lineWidth: 2, priceFormat: priceFormat(), autoscaleInfoProvider: overlayAutoscale("vwap") }), 0);
      if (!ema9) ema9 = chart.addSeries(LWC.LineSeries, lineOpts(t.ema9, { lineWidth: 1, priceFormat: priceFormat(), autoscaleInfoProvider: overlayAutoscale("ema9") }), 0);
      if (!ema21) ema21 = chart.addSeries(LWC.LineSeries, lineOpts(t.ema21, { lineWidth: 1, priceFormat: priceFormat(), autoscaleInfoProvider: overlayAutoscale("ema21") }), 0);
      if (!ind.vwap) yAuto.overlays.delete("vwap");
      if (!ind.ema) {
        yAuto.overlays.delete("ema9");
        yAuto.overlays.delete("ema21");
      }
      volume.applyOptions({ visible: !!ind.vol });
      vwap.applyOptions({ visible: !!ind.vwap });
      ema9.applyOptions({ visible: !!ind.ema });
      ema21.applyOptions({ visible: !!ind.ema });
    }

    // ---- RSI pane ----
    function addRsi() {
      if (rsiGroup) return;
      const pane = nextPane();
      const line = chart.addSeries(LWC.LineSeries, lineOpts(t.rsi, {
        lineWidth: 1,
        lastValueVisible: true,
        priceFormat: { type: "price", precision: 2, minMove: 0.01 },
        autoscaleInfoProvider: (orig) => {
          const r = orig();
          return { priceRange: { minValue: 0, maxValue: 100 }, margins: r ? r.margins : undefined };
        },
      }), pane);
      const lines = [70, 30].map((price) =>
        line.createPriceLine({ price, color: t.rsiLevel, lineWidth: 1, lineStyle: LWC.LineStyle.Dashed, axisLabelVisible: false }),
      );
      line.priceScale().applyOptions({ scaleMargins: { top: 0.22, bottom: 0.06 } });
      rsiGroup = { line, lines };
      setStretch();
    }

    function removeRsi() {
      if (!rsiGroup) return;
      chart.removeSeries(rsiGroup.line);
      rsiGroup = null;
      setStretch();
    }

    // ---- Market Cipher B pane ----
    function addMcb() {
      if (mcbGroup) return;
      const pane = nextPane();
      const pf = { type: "price", precision: 2, minMove: 0.01 };
      const add = (def, o) => chart.addSeries(def, Object.assign({ priceFormat: pf }, o), pane);
      const area = (color) => ({
        baseValue: { type: "price", price: 0 },
        topLineColor: color,
        topFillColor1: color,
        topFillColor2: color,
        bottomLineColor: color,
        bottomFillColor1: color,
        bottomFillColor2: color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });

      // ===== OB/OS Levels =====  (plotted first in the source, so drawn underneath)
      // Pine draws the constant plot.style_circles levels as a dot per bar; a sparse
      // dotted price line is the closest native rendering.
      const levels = add(LWC.LineSeries, lineOpts("rgba(0,0,0,0)", {
        lineVisible: false,
        autoscaleInfoProvider: () => ({ priceRange: { minValue: -105, maxValue: 100 } }),
      }));
      const ink = t.ink;
      const levelLines = [
        { price: 60, lineWidth: 2, lineStyle: LWC.LineStyle.Solid },
        { price: -60, lineWidth: 2, lineStyle: LWC.LineStyle.Solid },
        { price: 53, lineWidth: 1, lineStyle: LWC.LineStyle.SparseDotted },
        { price: -53, lineWidth: 1, lineStyle: LWC.LineStyle.SparseDotted },
        { price: 100, lineWidth: 1, lineStyle: LWC.LineStyle.SparseDotted },
      ].map((l) => levels.createPriceLine(Object.assign({ color: ink, axisLabelVisible: false }, l)));

      // ===== Plot Wave =====
      const fast = add(LWC.BaselineSeries, area(MCB_COLORS.fast));
      const slow = add(LWC.BaselineSeries, area(MCB_COLORS.slow));
      const wtVwap = add(LWC.BaselineSeries, area(MCB_COLORS.vwap));

      // ===== Money Flow =====
      const mf = add(LWC.BaselineSeries, Object.assign(area(MCB_COLORS.mfUp), {
        bottomLineColor: MCB_COLORS.mfDown,
        bottomFillColor1: MCB_COLORS.mfDown,
        bottomFillColor2: MCB_COLORS.mfDown,
      }));
      const band = new BandFill();
      mf.attachPrimitive(band);

      // ===== Zero Line =====
      const zero = mf.createPriceLine({ price: 0, color: ink, lineWidth: 1, lineStyle: LWC.LineStyle.Solid, axisLabelVisible: false });

      // ===== Stochastic =====
      const rsi = add(LWC.LineSeries, lineOpts(MCB_COLORS.rsi));
      const stoch = add(LWC.LineSeries, lineOpts(MCB_COLORS.stochUp));

      // ===== Buy/Sell Signals (WaveTrend Cross) =====
      const dots = (color, radius) =>
        add(LWC.LineSeries, lineOpts(color, {
          lineVisible: false,
          pointMarkersVisible: true,
          pointMarkersRadius: radius,
        }));
      const dotBuy = dots(MCB_COLORS.dotBuy, 3);
      const dotSell = dots(MCB_COLORS.dotSell, 3);
      // ===== Plot Oversold / Overbought Signals =====
      const sigBuy = dots(MCB_COLORS.sigBuy, 4);
      const sigSell = dots(MCB_COLORS.sigSell, 4);

      levels.priceScale().applyOptions({ scaleMargins: { top: 0.16, bottom: 0.04 } });
      mcbGroup = { levels, levelLines, zero, fast, slow, wtVwap, mf, band, rsi, stoch, dotBuy, dotSell, sigBuy, sigSell };
      setStretch();
    }

    function removeMcb() {
      if (!mcbGroup) return;
      const g = mcbGroup;
      [g.levels, g.fast, g.slow, g.wtVwap, g.mf, g.rsi, g.stoch, g.dotBuy, g.dotSell, g.sigBuy, g.sigSell].forEach((s) =>
        chart.removeSeries(s),
      );
      mcbGroup = null;
      setStretch();
    }

    // ---- data mapping ----
    const val = (time, v) => (isNa(v) ? { time } : { time, value: v });

    function mainPoint(model, i) {
      const b = chartType === "heikinAshi" ? model.ha[i] : model.bars[i];
      if (chartType === "line") return { time: b.time, value: b.close };
      return { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close };
    }

    function volPoint(model, i) {
      const b = model.bars[i];
      return { time: b.time, value: b.volume, color: b.close >= b.open ? t.volUp : t.volDown };
    }

    function mcbPoints(model, i) {
      const m = model.mcb;
      const time = model.bars[i].time;
      const p = mcbParams || {};
      return {
        levels: { time, value: 0 },
        fast: val(time, m.fast[i]),
        slow: val(time, m.slow[i]),
        wtVwap: val(time, m.vwap[i]),
        mf: val(time, m.mf[i]),
        rsi: val(time, m.rsi[i]),
        stoch: isNa(m.stoch[i])
          ? { time }
          : { time, value: m.stoch[i], color: m.stoch[i] < m.rsi[i] ? MCB_COLORS.stochUp : MCB_COLORS.stochDown },
        dotBuy: m.buy[i] ? val(time, m.slow[i]) : { time },
        dotSell: m.sell[i] ? val(time, m.slow[i]) : { time },
        sigBuy: p.showBuySignal !== false && m.buySignal[i] ? { time, value: -108 } : { time },
        sigSell: p.showSellSignal !== false && m.sellSignal[i] ? { time, value: 105 } : { time },
      };
    }

    function bandItems(model) {
      // `mf > 0` is false when mf is na, so warm-up bars take the red band, as in Pine.
      return model.mcb.mf.map((v) => ({ color: v > 0 ? MCB_COLORS.bandUp : MCB_COLORS.bandDown }));
    }

    const MCB_KEYS = ["levels", "fast", "slow", "wtVwap", "mf", "rsi", "stoch", "dotBuy", "dotSell", "sigBuy", "sigSell"];

    function setData(model) {
      const n = model.bars.length;
      dataLen = n;
      yAuto.snap = true;
      const idx = Array.from({ length: n }, (_, i) => i);
      main.setData(idx.map((i) => mainPoint(model, i)));
      volume.setData(idx.map((i) => volPoint(model, i)));
      vwap.setData(idx.map((i) => val(model.bars[i].time, model.vwap[i])));
      ema9.setData(idx.map((i) => val(model.bars[i].time, model.ema9[i])));
      ema21.setData(idx.map((i) => val(model.bars[i].time, model.ema21[i])));
      if (rsiGroup) rsiGroup.line.setData(idx.map((i) => val(model.bars[i].time, model.rsi[i])));
      if (mcbGroup && model.mcb) {
        const cols = {};
        MCB_KEYS.forEach((k) => (cols[k] = new Array(n)));
        for (let i = 0; i < n; i++) {
          const p = mcbPoints(model, i);
          MCB_KEYS.forEach((k) => (cols[k][i] = p[k]));
        }
        MCB_KEYS.forEach((k) => mcbGroup[k].setData(cols[k]));
        mcbGroup.band.setItems(bandItems(model));
      }
    }

    function update(model, from) {
      const n = model.bars.length;
      dataLen = n;
      for (let i = Math.max(0, from); i < n; i++) {
        const hist = i < n - 1;
        main.update(mainPoint(model, i), hist);
        volume.update(volPoint(model, i), hist);
        vwap.update(val(model.bars[i].time, model.vwap[i]), hist);
        ema9.update(val(model.bars[i].time, model.ema9[i]), hist);
        ema21.update(val(model.bars[i].time, model.ema21[i]), hist);
        if (rsiGroup) rsiGroup.line.update(val(model.bars[i].time, model.rsi[i]), hist);
        if (mcbGroup && model.mcb) {
          const p = mcbPoints(model, i);
          MCB_KEYS.forEach((k) => mcbGroup[k].update(p[k], hist));
        }
      }
      if (mcbGroup && model.mcb) mcbGroup.band.setItems(bandItems(model));
    }

    // ---- theme ----
    function applyTheme(name) {
      themeName = name === "light" ? "light" : "dark";
      t = THEMES[themeName];
      chart.applyOptions({
        layout: {
          background: { type: LWC.ColorType.Solid, color: t.bg },
          textColor: t.text,
          panes: { separatorColor: t.separator, separatorHoverColor: t.separatorHover },
        },
        grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } },
        crosshair: {
          vertLine: { color: t.crosshair, labelBackgroundColor: t.label },
          horzLine: { color: t.crosshair, labelBackgroundColor: t.label },
        },
        rightPriceScale: { borderColor: t.border },
        timeScale: { borderColor: t.border },
      });
      if (chartType === "line") main.applyOptions({ color: t.line });
      else main.applyOptions({ upColor: t.up, downColor: t.down, wickUpColor: t.up, wickDownColor: t.down });
      vwap.applyOptions({ color: t.vwap });
      ema9.applyOptions({ color: t.ema9 });
      ema21.applyOptions({ color: t.ema21 });
      if (rsiGroup) {
        rsiGroup.line.applyOptions({ color: t.rsi });
        rsiGroup.lines.forEach((l) => l.applyOptions({ color: t.rsiLevel }));
      }
      if (mcbGroup) {
        mcbGroup.levelLines.forEach((l) => l.applyOptions({ color: t.ink }));
        mcbGroup.zero.applyOptions({ color: t.ink });
      }
    }

    buildMain();
    buildOverlays({});

    return {
      chart,
      get main() {
        return main;
      },
      theme: () => t,
      setTheme(name, model) {
        applyTheme(name);
        if (model && model.bars.length) volume.setData(model.bars.map((_, i) => volPoint(model, i)));
      },
      setPrecision(p, move) {
        precision = p;
        minMove = move;
        [main, vwap, ema9, ema21].forEach((s) => s && s.applyOptions({ priceFormat: priceFormat() }));
      },
      setChartType(type, model) {
        chartType = type;
        buildMain();
        if (model && model.bars.length) main.setData(model.bars.map((_, i) => mainPoint(model, i)));
      },
      setSecondsVisible(v) {
        chart.applyOptions({ timeScale: { secondsVisible: v } });
      },
      setIndicators(ind) {
        buildOverlays(ind);
        if (ind.mcb) addMcb();
        else removeMcb();
        if (ind.rsi) addRsi();
        else removeRsi();
      },
      setMcbParams(p) {
        mcbParams = p;
      },
      setData,
      update,
      updateLive(model) {
        const i = model.bars.length - 1;
        if (i < 0) return;
        main.update(mainPoint(model, i));
        volume.update(volPoint(model, i));
      },
      relayout: setStretch,
      fit() {
        yAuto.snap = true;
        chart.timeScale().fitContent();
      },
      reset() {
        yAuto.snap = true;
        chart.timeScale().resetTimeScale();
        chart.timeScale().applyOptions({ barSpacing: 7, rightOffset: 8 });
        chart.panes().forEach((p) => p.priceScale("right").setAutoScale(true));
      },
      scrollToRealtime() {
        chart.timeScale().scrollToRealTime();
      },
      // pixel layout of panes (top offset + height) for the DOM legends
      paneLayout() {
        const out = [];
        let top = 0;
        for (const p of chart.panes()) {
          const h = p.getHeight();
          const series = p.getSeries();
          let id = "price";
          if (mcbGroup && series.includes(mcbGroup.fast)) id = "mcb";
          else if (rsiGroup && series.includes(rsiGroup.line)) id = "rsi";
          out.push({ id, top, height: h });
          top += h + 1;
        }
        return out;
      },
      paneIndexOf,
      priceScaleWidth() {
        try {
          return chart.priceScale("right", 0).width();
        } catch (_) {
          return 0;
        }
      },
      colors: MCB_COLORS,
    };
  }

  global.PulseChart = { create, THEMES, MCB_COLORS };
})(typeof window !== "undefined" ? window : globalThis);
