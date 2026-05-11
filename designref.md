### Cards & Containers

**Hero Media Frame (Stadium)**

- Background: Dark video or full-bleed imagery (typically black `#000000` or `#2B2B2B` behind video)
- Radius: 40px all corners (creates a stadium shape on wide viewports)
- Width: ~full viewport minus ~48px gutter on each side
- Height: ~60–70% of viewport
- Shadow: none (sits directly on canvas)
- Corners: the extreme 40px radius on a media element is the most iconic Mastercard gesture — do not round less

**Service / Solution Portrait Card**

- Shape: Perfect circle (radius 50%) or ellipse (radius 999px / 1000px)
- Diameter: 260–340px desktop; ~220px mobile
- Image crop: square source, cropped to circle
- Attached element: White satellite circular CTA (see above) docked bottom-right, ~40% outside the portrait
- Eyebrow below: accent dot + uppercase label (e.g., "• SERVICES", "• SOLUTIONS")
- Title below: H3 (24px / weight 500 / -2% tracking), 1–2 lines max
- Decorative orbit: thin ~1px Light Signal Orange curved line spanning from this card outward to the next, implying connection

**Pill Carousel Card**

- Radius: 1000px (full pill) or 40px corners (rounded stadium)
- Width: ~40–60% of viewport
- Height: ~380–420px (portrait-pill orientation)
- Content: full-bleed photography with small overlaid chip labels
- Chip inside: White pill (~ 999px radius), Ink Black text, padding 8px 20px, used for category tags like "Story"
- Large inline CTA inside: Ink Pill button, oversized (padding 16px 40px, radius 40px)

**Ghost Watermark Text Block**

- Font: MarkForMC 72–128px / weight 500 / tight -2% tracking
- Color: Canvas Cream slightly darkened (`#E8E2DA` or similar — cream-on-cream)
- Position: layered behind portrait circles, bleeding off the viewport edge
- Purpose: sets section theme without competing with foreground copy

### Inputs & Forms

Minimal form surface on the marketing page. The search input in the nav header is:

- Initial state: a 48px circular button with a magnifier icon
- Expanded state: horizontal input field, border `1px solid` Ink Black at ~50% opacity, radius 999px, padding 12px 24px, white background

**Country/language selector (footer)**

- Background: Ink Black (same as footer)
- Text: White
- Border: 1px solid `rgba(255,255,255,0.4)`
- Radius: 999px (full pill)
- Icon: downward chevron on the right

### Navigation

**Floating Nav Pill (desktop)**

- Container: white-to-translucent-white pill floating below the very top of the viewport with a ~24px top margin
- Radius: 999px / 1000px (full pill)
- Padding: ~16px 40px internal
- Shadow: very soft (`rgba(0, 0, 0, 0.04) 0px 4px 24px 0px`) — just enough to lift it off the cream canvas
- Content: Mastercard logo left, primary link group center ("For you", "For business", "For the world", "For innovators", "News and trends"), search icon right
- Link spacing: ~48–56px gap between primary links
- Link style: Ink Black, weight 500, 16px, no underline, no pill surround until active

**Mobile Nav**

- The same pill shape but collapsed to: logo + hamburger menu button + search icon only
- Menu opens into a full-screen overlay with the primary links stacked vertically

### Image Treatment

- **Aspect ratios used**: 1:1 (all service portraits — cropped to circle), ~3:4 or ~4:5 (carousel pill cards), 16:9 or wider (hero video frame)
- **Full-bleed vs padded**: Hero is viewport-wide with gutters; service portraits are always centered in their column with generous whitespace around; footer imagery is rare
- **Masking**: Aggressive circular masking is the defining treatment — square source images are cropped to perfect circles of matching diameter. Never use rectangular service imagery.
- **Lazy loading**: Standard `loading="lazy"` with a soft blur-up transition from a cream-tinted placeholder, preserving the warm palette during load
  typography:
  hero-display:
  fontFamily: "BinanceNova, -apple-system, BlinkMacSystemFont, sans-serif"
  fontSize: 64px
  fontWeight: 700
  lineHeight: 1.1
  letterSpacing: -1px
  display-lg:
  fontFamily: "BinanceNova, sans-serif"
  fontSize: 48px
  fontWeight: 700
  lineHeight: 1.1
  letterSpacing: -0.5px
  display-md:
  fontFamily: "BinanceNova, sans-serif"
  fontSize: 40px
  fontWeight: 600
  lineHeight: 1.15
  letterSpacing: -0.3px
  display-sm:
  fontFamily: "BinanceNova, sans-serif"
  fontSize: 32px
  fontWeight: 600
  lineHeight: 1.2
  letterSpacing: 0
  title-lg:
  fontFamily: "BinanceNova, sans-serif"
  fontSize: 24px
  fontWeight: 600
  lineHeight: 1.3
  letterSpacing: 0
  title-md:
  fontFamily: "BinanceNova, sans-serif"
  fontSize: 20px
  fontWeight: 600
  lineHeight: 1.35
  letterSpacing: 0
  title-sm:
  fontFamily: "BinanceNova, sans-serif"
  fontSize: 16px
  fontWeight: 600
  lineHeight: 1.4
  letterSpacing: 0
  number-display:
  fontFamily: "BinancePlex, BinanceNova, sans-serif"
  fontSize: 40px
  fontWeight: 700
  lineHeight: 1.1
  letterSpacing: -0.3px
  number-md:
  fontFamily: "BinancePlex, BinanceNova, sans-serif"
  fontSize: 16px
  fontWeight: 500
  lineHeight: 1.4
  letterSpacing: 0
  number-sm:
  fontFamily: "BinancePlex, BinanceNova, sans-serif"
  fontSize: 14px
  fontWeight: 500
  lineHeight: 1.4
  letterSpacing: 0
  body-md:
  fontFamily: "BinanceNova, sans-serif"
  fontSize: 14px
  fontWeight: 400
  lineHeight: 1.5
  letterSpacing: 0
  body-sm:
  fontFamily: "BinanceNova, sans-serif"
  fontSize: 13px
  fontWeight: 400
  lineHeight: 1.5
  letterSpacing: 0
  caption:
  fontFamily: "BinanceNova, sans-serif"
  fontSize: 12px
  fontWeight: 500
  lineHeight: 1.4
  letterSpacing: 0
  button:
  fontFamily: "BinanceNova, sans-serif"
  fontSize: 14px
  fontWeight: 600
  lineHeight: 1
  letterSpacing: 0
  nav-link:
  fontFamily: "BinanceNova, sans-serif"
  fontSize: 14px
  fontWeight: 500
  lineHeight: 1.4
  letterSpacing: 0
  button-tertiary-text:
  backgroundColor: transparent
  textColor: "{colors.body}"
  typography: "{typography.button}"
  button-trading-up:
  backgroundColor: "{colors.trading-up}"
  textColor: "{colors.on-dark}"
  typography: "{typography.button}"
  rounded: "{rounded.sm}"
  padding: 8px 20px
  button-trading-down:
  backgroundColor: "{colors.trading-down}"
  textColor: "{colors.on-dark}"
  typography: "{typography.button}"
  rounded: "{rounded.sm}"
  padding: 8px 20px
  button-subscribe:
  backgroundColor: "{colors.primary}"
  textColor: "{colors.on-primary}"
  typography: "{typography.button}"
  rounded: "{rounded.sm}"
  padding: 6px 16px
  height: 28px
  text-link:
  backgroundColor: transparent
  textColor: "{colors.primary}"
  typography: "{typography.body-md}"
  top-nav-dark:
  backgroundColor: "{colors.canvas-dark}"
  textColor: "{colors.on-dark}"
  typography: "{typography.nav-link}"
  height: 64px
  top-nav-light:
  backgroundColor: "{colors.canvas-light}"
  textColor: "{colors.ink}"
  typography: "{typography.nav-link}"
  height: 64px
  hero-band-dark:
  backgroundColor: "{colors.canvas-dark}"
  textColor: "{colors.on-dark}"
  typography: "{typography.hero-display}"
  padding: 80px
  stat-callout-card:
  backgroundColor: transparent
  textColor: "{colors.primary}"
  typography: "{typography.number-display}"
  trust-badge:
  backgroundColor: "{colors.surface-card-dark}"
  textColor: "{colors.on-dark}"
  typography: "{typography.title-sm}"
  rounded: "{rounded.lg}"
  padding: 16px 20px
  markets-table-card:
  backgroundColor: "{colors.surface-card-dark}"
  textColor: "{colors.on-dark}"
  typography: "{typography.body-md}"
  rounded: "{rounded.xl}"
  padding: 24px
  markets-row:
  backgroundColor: transparent
  textColor: "{colors.on-dark}"
  typography: "{typography.number-md}"
  padding: 12px 0
  price-up-cell:
  backgroundColor: transparent
  textColor: "{colors.trading-up}"
  typography: "{typography.number-md}"
  price-down-cell:
  backgroundColor: transparent
  textColor: "{colors.trading-down}"
  typography: "{typography.number-md}"
  search-input-on-dark:
  backgroundColor: "{colors.surface-card-dark}"
  textColor: "{colors.on-dark}"
  typography: "{typography.body-md}"
  rounded: "{rounded.lg}"
  padding: 10px 16px
  height: 40px
  text-input-on-light:
  backgroundColor: "{colors.canvas-light}"
  textColor: "{colors.ink}"
  typography: "{typography.body-md}"
  rounded: "{rounded.md}"
  padding: 10px 16px
  height: 40px
  funds-safu-band:
  backgroundColor: "{colors.canvas-dark}"
  textColor: "{colors.primary}"
  typography: "{typography.display-lg}"
  padding: 80px
  feature-photo-card:
  backgroundColor: "{colors.surface-card-dark}"
  textColor: "{colors.on-dark}"
  rounded: "{rounded.xl}"
  qr-promo-card:
  backgroundColor: "{colors.surface-card-dark}"
  textColor: "{colors.on-dark}"
  typography: "{typography.title-md}"
  rounded: "{rounded.xl}"
  padding: 32px
  faq-row:
  backgroundColor: transparent
  textColor: "{colors.on-dark}"
  typography: "{typography.title-sm}"
  rounded: "{rounded.md}"
  padding: 20px 0
  cta-band-dark:
  backgroundColor: "{colors.surface-card-dark}"
  textColor: "{colors.on-dark}"
  typography: "{typography.display-sm}"
  rounded: "{rounded.xl}"
  padding: 48px
  arena-hero-gradient:
  backgroundColor: "{colors.canvas-dark}"
  textColor: "{colors.primary}"
  typography: "{typography.display-lg}"
  padding: 80px
  cookie-consent-card:
  backgroundColor: "{colors.canvas-light}"
  textColor: "{colors.ink}"
  typography: "{typography.body-sm}"
  rounded: "{rounded.lg}"
  padding: 16px
  buy-crypto-amount-card:
  backgroundColor: "{colors.canvas-light}"
  textColor: "{colors.ink}"
  typography: "{typography.number-display}"
  rounded: "{rounded.lg}"
  padding: 24px
  steps-card:
  backgroundColor: "{colors.canvas-light}"
  textColor: "{colors.ink}"
  typography: "{typography.title-sm}"
  rounded: "{rounded.lg}"
  padding: 24px
  price-chart-card:
  backgroundColor: "{colors.canvas-light}"
  textColor: "{colors.ink}"
  typography: "{typography.body-md}"
  rounded: "{rounded.lg}"
  padding: 24px
  conversion-cell:
  backgroundColor: transparent
  textColor: "{colors.body-on-light}"
  typography: "{typography.body-md}"
  trader-row:
  backgroundColor: transparent
  textColor: "{colors.on-dark}"
  typography: "{typography.body-md}"
  padding: 12px 0
  footer-light:
  backgroundColor: "{colors.surface-soft-light}"
  textColor: "{colors.body-on-light}"
  typography: "{typography.body-md}"
  padding: 64px

---

**Dark mode (marketing default):**

- **Canvas Dark** (`{colors.canvas-dark}` — #0b0e11): The primary page floor. Near-black with a slight warm tint — never pure black.
- **Surface Card Dark** (`{colors.surface-card-dark}` — #1e2329): Cards, navigation dropdowns, secondary buttons over dark canvas, markets table.
- **Surface Elevated Dark** (`{colors.surface-elevated-dark}` — #2b3139): One step lighter, used for nested cards, hovered nav items, and chart background panels.
  **`top-nav-dark`** — The marketing top nav on dark canvas. 64px tall, `{colors.canvas-dark}` background. Carries the yellow Binance wordmark at left, primary horizontal menu (Buy Crypto, Markets, Trade, Futures, Earn, Square, Smart Money, Campaigns), right-side cluster with language selector, light/dark toggle, "Log In" text link, "Sign Up" `{component.button-primary}`. The wordmark uses `{colors.primary}` for "BINANCE" type.

**`stat-callout-card`** — Inline yellow stat numbers (15,000 BTC, 7,488,223, $429,423,449). Transparent background, text `{colors.primary}`, type `{typography.number-display}` in BinancePlex. Used as a flat layout block, not a card with surface — the yellow text alone carries the visual weight.

**`trust-badge`** — Small dark cards holding "No.1 Customer Service" / "No.1 Trading Volume" claims. Background `{colors.surface-card-dark}`, rounded `{rounded.lg}` (8px), padding 16px × 20px. Yellow numeric or word badge ("No.1") sits next to a short label.

**`markets-table-card`** — The right-side markets table on the homepage. Background `{colors.surface-card-dark}`, rounded `{rounded.xl}` (12px), padding `{spacing.lg}` (24px). Carries a tab row (Popular / New listing / Top gainers), then a 5-column row of coin pairs with last price, 24h change %, action button. Each row uses `{component.markets-row}`.

**`markets-row`** — A single row inside the markets table. Transparent background, 12px vertical padding, hairline divider between rows. Coin icon (32×32) + symbol on left; last price in `{typography.number-md}` (BinancePlex); 24h change cell colored by direction (`{component.price-up-cell}` or `{component.price-down-cell}`); right-aligned chevron icon for "view detail."

**`price-up-cell`** / **`price-down-cell`** — Colored text cells for price changes. Transparent background, text `{colors.trading-up}` or `{colors.trading-down}`, type `{typography.number-md}` in BinancePlex. Always paired with a small triangle arrow indicating direction.

**`feature-photo-card`** — The "Trade on the go" section's photo strip — 3 lifestyle photos showing people using the Binance app. Background `{colors.surface-card-dark}`, rounded `{rounded.xl}`. Photos crop edge-to-edge, no internal padding around the image.

**`qr-promo-card`** — The "Trade on the go. Anywhere, anytime." card with QR code. Background `{colors.surface-card-dark}`, rounded `{rounded.xl}`, padding `{spacing.xl}` (32px). Contains an h2 in `{typography.title-md}`, a body paragraph, app store badges (iOS / Android), and a centered QR code.

**`funds-safu-band`** — The yellow-headlined "FUNDS ARE SAFU" band. Background stays `{colors.canvas-dark}`, but the headline uses `{colors.primary}` at `{typography.display-lg}`. Below the headline, three large `{component.stat-callout-card}` numbers anchor the band: total BTC reserves, users helped, funds recovered.

**`faq-row`** — A single FAQ accordion row. Transparent background, padding 20px vertical, hairline divider between rows. Closed state: question in `{typography.title-sm}` + chevron icon at right. Open state: question + answer body in `{typography.body-md}`.

**`cta-band-dark`** — The "Secure, Low-Fee Trading on Binance" pre-footer CTA band. Background `{colors.surface-card-dark}` (one step elevated from canvas), rounded `{rounded.xl}`, padding `{spacing.xxl}` (48px). Carries an h2 in `{typography.display-sm}` and a `{component.button-primary}` aligned right.

### Light-Mode Transactional Components

**`buy-crypto-amount-card`** — The right-rail card on the Buy BTC page. Background `{colors.canvas-light}`, rounded `{rounded.lg}` (8px), padding `{spacing.lg}` (24px). Carries an editable amount input in `{typography.number-display}` (BinancePlex), a currency selector, and a yellow `{component.button-primary}` for "Continue" / "Confirm Order."

**`steps-card`** — The "How to Buy Crypto" 3-up cards (Enter Amount → Confirm Order → Receive Crypto). Background `{colors.canvas-light}`, rounded `{rounded.lg}`, padding `{spacing.lg}`. Each card has a small numbered icon, a `{typography.title-sm}` step name, and a body description.

**`price-chart-card`** — The "Bitcoin Markets" card carrying the BTC price chart. Background `{colors.canvas-light}`, rounded `{rounded.lg}`. Top row carries pair selector ($79,065.04, +0.45%); main area is a candlestick / line chart in `{colors.trading-up}` and `{colors.trading-down}`; bottom row carries timeframe selector (24H / 1W / 1M / 3M / 1Y / ALL).

**`conversion-cell`** — A single row in the BTC ↔ USD conversion table. Transparent background, text `{colors.body-on-light}`, type `{typography.body-md}`. Pair label on left (BTC, USDT, etc.); USD equivalent on right.

### Inputs & Forms

**`search-input-on-dark`** — The "Search currencies" input on the homepage hero. Background `{colors.surface-card-dark}`, text `{colors.on-dark}`, rounded `{rounded.lg}` (8px), padding 10px × 16px, height 40px. Carries a yellow `{component.button-primary-pill}` on the right side ("Sign Up").

**`text-input-on-light`** — Standard input on transactional pages. Background `{colors.canvas-light}`, 1px `{colors.hairline-on-light}` border, rounded `{rounded.md}` (6px), padding 10px × 16px, height 40px. Focus state inherits the focus-ring shadow.

**`cookie-consent-card`** — The cookie banner card visible on the homepage. Background `{colors.canvas-light}`, rounded `{rounded.lg}`, padding `{spacing.md}` (16px). Body text in `{typography.body-sm}` (13px / 400) with three stacked button options (Accept Cookies & Continue / Reject Additional Cookies / Manage Cookies).

### Smart Money Sub-System

**`trader-row`** — A single row in the top-traders table on /smart-money. Transparent background, padding 12px vertical, hairline divider between rows. Avatar + trader name + private/public badge on left; ROI %, AUM, mint date columns; yellow `{component.button-subscribe}` on right.

### Signature Components

**`arena-hero-gradient`** — The Futures Arena product-launch hero. A vertical gradient from `{colors.primary}` at top to `{colors.canvas-dark}` at bottom, with the prize-pool headline (4,000,000 USDT) in `{typography.display-lg}` centered. A `{component.button-primary-pill}` ("Join Now") sits below the headline. Used only on product-launch event surfaces — do not generalize to other heroes.
