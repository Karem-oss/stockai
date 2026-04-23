// ─────────────────────────────────────────
//  API KEYS — replace these with your real keys
// ─────────────────────────────────────────
const FINNHUB_KEY = 'd7kqh5pr01qiqbcvcucgd7kqh5pr01qiqbcvcud0';
const GEMINI_KEY  = 'AIzaSyACcheKTfArPmzgDN5EHV1K7HlZQ8qJ6mM';
const FMP_KEY     = 'demo';


// ─────────────────────────────────────────
//  DOM REFERENCES
// ─────────────────────────────────────────

// Search
const searchInput  = document.getElementById('searchInput');
const searchBtn    = document.getElementById('searchBtn');

// Error banner
const errorBanner  = document.getElementById('errorBanner');
const errorMsg     = document.getElementById('errorMsg');

// Results wrapper
const resultsArea  = document.getElementById('resultsArea');

// Overview card
const overviewSkeleton = document.getElementById('overviewSkeleton');
const overviewContent  = document.getElementById('overviewContent');
const tickerLabel      = document.getElementById('tickerLabel');
const exchangeLabel    = document.getElementById('exchangeLabel');
const companyName      = document.getElementById('companyName');
const sectorLabel      = document.getElementById('sectorLabel');
const currentPriceEl   = document.getElementById('currentPrice');
const priceChangeEl    = document.getElementById('priceChange');
const changeIcon       = document.getElementById('changeIcon');
const changeValue      = document.getElementById('changeValue');
const mktCapEl         = document.getElementById('mktCap');

// Chart
const chartSkeleton    = document.getElementById('chartSkeleton');
const chartWrap        = document.getElementById('chartWrap');
const chartRangeBadge  = document.getElementById('chartRangeBadge');

// AI analysis
const aiLoading        = document.getElementById('aiLoading');
const aiCard           = document.getElementById('aiCard');
const aiText           = document.getElementById('aiText');

// Compare section
const compareBtn       = document.getElementById('compareBtn');
const compare1         = document.getElementById('compare1');
const compare2         = document.getElementById('compare2');
const compare3         = document.getElementById('compare3');
const compareResults   = document.getElementById('compareResults');
const compareChartsEl  = document.getElementById('compareCharts');
const compareCard3     = document.getElementById('compareCard3');
const compareLabel1    = document.getElementById('compareLabel1');
const compareLabel2    = document.getElementById('compareLabel2');
const compareLabel3    = document.getElementById('compareLabel3');
const compareAiLoading = document.getElementById('compareAiLoading');
const compareAiCard    = document.getElementById('compareAiCard');
const compareAiText    = document.getElementById('compareAiText');

// Watchlist + new UI elements
const saveWatchlistBtn   = document.getElementById('saveWatchlistBtn');
const saveWatchlistLabel = document.getElementById('saveWatchlistLabel');
const watchlistSection   = document.getElementById('watchlistSection');
const watchlistPills     = document.getElementById('watchlistPills');
const sentimentBadge     = document.getElementById('sentimentBadge');


// ─────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────

// Holds Chart.js instances so we can destroy them before re-rendering
let mainChartInstance     = null;
let compareChartInstances = [null, null, null];


// ─────────────────────────────────────────
//  UTILITY HELPERS
// ─────────────────────────────────────────

// Format a number as a dollar price with 2 decimal places
function formatPrice(n) {
  return '$' + parseFloat(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Format a large number as market cap (e.g. 2940000000000 → "$2.94T")
function formatMarketCap(n) {
  const num = parseFloat(n);
  if (!num || num === 0) return 'N/A';
  if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
  if (num >= 1e9)  return `$${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6)  return `$${(num / 1e6).toFixed(2)}M`;
  return `$${num.toLocaleString()}`;
}

// Show the red error banner with a custom message
function showError(msg) {
  errorMsg.textContent = msg;
  errorBanner.hidden = false;
}

// Hide the error banner
function hideError() {
  errorBanner.hidden = true;
}

// Toggle loading state on the search button (disables it and shows spinner)
function setSearchLoading(on) {
  searchBtn.disabled = on;
  searchBtn.classList.toggle('loading', on);
}

// Toggle loading state on the compare button
function setCompareLoading(on) {
  compareBtn.disabled = on;
  compareBtn.classList.toggle('loading', on);
}

// Show shimmer skeleton for the overview card
function showOverviewSkeleton() {
  overviewSkeleton.hidden = false;
  overviewContent.hidden  = true;
}

// Reveal real overview content and hide skeleton
function showOverviewContent() {
  overviewSkeleton.hidden = true;
  overviewContent.hidden  = false;
}

// Show shimmer skeleton for the chart area
function showChartSkeleton() {
  chartSkeleton.hidden = false;
  chartWrap.hidden     = true;
}

// Reveal real chart canvas and hide skeleton
function showChartContent() {
  chartSkeleton.hidden = true;
  chartWrap.hidden     = false;
}

// Convert a "YYYY-MM-DD" string to a short label like "Jan '24"
// Adding T00:00:00 forces local-time parsing to avoid off-by-one timezone issues
function formatDateLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}


// ─────────────────────────────────────────
//  FINANCIAL MODELING PREP — PRICE HISTORY
// ─────────────────────────────────────────

// Fetches full daily price history from FMP (no proxy needed — CORS supported).
// Samples to monthly closes and returns { prices: {t,c}, overview } so all
// downstream code (extractTenYears, charts, AI) stays completely unchanged.
async function fetchYahooData(ticker) {
  const url =
    `https://financialmodelingprep.com/api/v3/historical-price-full/` +
    `${encodeURIComponent(ticker)}?serietype=line&apikey=${FMP_KEY}`;

  const res = await fetch(url);
  if (res.status === 404) throw new Error('ticker_not_found');
  if (!res.ok)            throw new Error('network_error');

  const data    = await res.json();
  const history = data.historical;
  if (!history || history.length === 0) throw new Error('ticker_not_found');

  // Filter to last 10 years (FMP returns newest-first, so reverse after filtering)
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 10);

  const filtered = history
    .filter(d => new Date(d.date + 'T00:00:00') >= cutoff)
    .reverse();  // now oldest → newest

  if (filtered.length === 0) throw new Error('ticker_not_found');

  // Sample to monthly: iterate oldest→newest so the last write per "YYYY-MM"
  // key is always the final trading day of that month.
  const byMonth = {};
  filtered.forEach(d => { byMonth[d.date.slice(0, 7)] = d; });

  const monthly = Object.keys(byMonth).sort().map(k => byMonth[k]);

  return {
    prices: {
      t: monthly.map(d => Math.floor(new Date(d.date + 'T00:00:00').getTime() / 1000)),
      c: monthly.map(d => d.close),
    },
    overview: {
      Name:                 data.symbol || ticker,
      Exchange:             '',
      Sector:               '',
      Industry:             '',
      MarketCapitalization: 0,
    },
  };
}

// Thin wrapper used by handleCompare — returns only the prices shape.
async function fetchMonthlyPrices(ticker) {
  const { prices } = await fetchYahooData(ticker);
  return prices;
}


// ─────────────────────────────────────────
//  DATA PROCESSING — EXTRACT 10 YEARS
// ─────────────────────────────────────────

// Converts a Finnhub candles response ({ t: [unix...], c: [prices...] })
// to the [{ date, price }] shape used by every chart and AI function.
// Finnhub already scopes the request to 10 years, so no date filtering needed.
function extractTenYears(candles) {
  if (!candles.t || !candles.c) return [];

  return candles.t
    .map((ts, i) => ({
      date:  new Date(ts * 1000).toISOString().slice(0, 10),
      price: candles.c[i],
    }))
    .filter(d => d.price > 0 && !isNaN(d.price));
}


// ─────────────────────────────────────────
//  GEMINI API
// ─────────────────────────────────────────

// Sends a prompt to Gemini 1.5 Flash and returns the plain-text response.
async function fetchGeminiAnalysis(prompt) {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 10_000);

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent` +
    `?key=${GEMINI_KEY}`;

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      signal:  controller.signal,
    });

    // Always parse the body first — Gemini puts useful error details in JSON even on non-2xx
    const data = await res.json();

    if (!res.ok) {
      const geminiMsg = data?.error?.message || 'Unknown Gemini error';
      console.error('Gemini API error', { status: res.status, message: geminiMsg, full: data });
      throw new Error(`AI analysis unavailable (${res.status}: ${geminiMsg})`);
    }

    console.log('Gemini raw response:', data);

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.error('Gemini response missing expected text field:', data);
      throw new Error('AI returned an empty response. Please try again.');
    }

    return text.trim();

  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Gemini request timed out after 10 seconds.');
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}


// ─────────────────────────────────────────
//  CHART HELPERS
// ─────────────────────────────────────────

// Builds a vertical gradient fill for the area under the chart line.
// colorRgb should be an "r,g,b" string, e.g. "59,130,246".
function buildGradient(ctx, colorRgb) {
  const gradient = ctx.createLinearGradient(0, 0, 0, 380);
  gradient.addColorStop(0, `rgba(${colorRgb},0.28)`);
  gradient.addColorStop(1, `rgba(${colorRgb},0)`);
  return gradient;
}

// Shared Chart.js scale config for a clean dark-theme look
function darkScales(showAxes = true) {
  const base = {
    grid:  { color: 'rgba(255,255,255,0.04)', drawBorder: false },
    ticks: { color: '#52525b', font: { family: 'Inter', size: 11 } },
  };
  if (!showAxes) return { x: { display: false }, y: { display: false } };
  return {
    x: { ...base, ticks: { ...base.ticks, maxTicksLimit: 8, maxRotation: 0 } },
    y: {
      ...base,
      position: 'right',
      ticks: { ...base.ticks, callback: v => '$' + v.toLocaleString() },
    },
  };
}

// Shared tooltip config for dark theme
function darkTooltip(showTitle = true) {
  return {
    backgroundColor:  '#1c1c1c',
    borderColor:      '#3a3a3a',
    borderWidth:      1,
    titleColor:       '#a1a1aa',
    bodyColor:        '#f4f4f5',
    padding:          { top: 8, right: 12, bottom: 8, left: 12 },
    displayColors:    false,
    callbacks: {
      title: items => showTitle ? items[0].label : '',
      label: item  => `$${item.raw.toFixed(2)}`,
    },
  };
}


// ─────────────────────────────────────────
//  RENDER MAIN PRICE CHART
// ─────────────────────────────────────────

// Destroys any existing main chart, then renders a new line chart using priceData.
// Line is blue if the stock trended up over the period, red if it trended down.
function renderMainChart(priceData, ticker) {
  if (mainChartInstance) {
    mainChartInstance.destroy();
    mainChartInstance = null;
  }

  const labels = priceData.map(d => formatDateLabel(d.date));
  const prices = priceData.map(d => d.price);

  const isUp     = prices[prices.length - 1] >= prices[0];
  const colorRgb = isUp ? '59,130,246' : '239,68,68';   // blue : red
  const lineHex  = isUp ? '#3b82f6'    : '#ef4444';

  const canvas = document.getElementById('priceChart');
  const ctx    = canvas.getContext('2d');

  mainChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label:                    ticker,
        data:                     prices,
        borderColor:              lineHex,
        backgroundColor:          buildGradient(ctx, colorRgb),
        borderWidth:              2,
        pointRadius:              0,
        pointHoverRadius:         5,
        pointHoverBackgroundColor: lineHex,
        pointHoverBorderColor:    '#fff',
        pointHoverBorderWidth:    2,
        tension:                  0.3,
        fill:                     true,
      }],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      animation:           { duration: 800, easing: 'easeInOutQuart' },
      plugins: {
        legend:  { display: false },
        tooltip: darkTooltip(true),
      },
      scales:      darkScales(true),
      interaction: { mode: 'index', intersect: false },
    },
  });
}


// ─────────────────────────────────────────
//  RENDER COMPARE MINI CHART
// ─────────────────────────────────────────

// Renders one of the three small comparison charts.
// colorIndex: 0=blue, 1=green, 2=amber
function renderCompareChart(canvasId, priceData, colorIndex) {
  const palettes = [
    { rgb: '59,130,246',  hex: '#3b82f6' },   // blue
    { rgb: '34,197,94',   hex: '#22c55e' },   // green
    { rgb: '245,158,11',  hex: '#f59e0b' },   // amber
  ];
  const { rgb, hex } = palettes[colorIndex % palettes.length];

  const canvas = document.getElementById(canvasId);
  const ctx    = canvas.getContext('2d');

  const labels = priceData.map(d => formatDateLabel(d.date));
  const prices = priceData.map(d => d.price);

  return new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data:            prices,
        borderColor:     hex,
        backgroundColor: buildGradient(ctx, rgb),
        borderWidth:     1.5,
        pointRadius:     0,
        tension:         0.3,
        fill:            true,
      }],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      animation:           { duration: 500 },
      plugins: {
        legend:  { display: false },
        tooltip: darkTooltip(false),
      },
      scales:      darkScales(false),
      interaction: { mode: 'index', intersect: false },
    },
  });
}


// ─────────────────────────────────────────
//  POPULATE OVERVIEW CARD
// ─────────────────────────────────────────

// Fills in all fields on the stock overview card with live data.
// Uses the latest adjusted close as the "current price" and compares
// to the previous month's close to show a % change.
function populateOverviewCard(overview, priceData, ticker) {
  tickerLabel.textContent   = ticker;
  exchangeLabel.textContent = overview.Exchange || '';
  companyName.textContent   = overview.Name     || ticker;

  const sector   = overview.Sector   || '';
  const industry = overview.Industry || '';
  sectorLabel.textContent = [sector, industry].filter(Boolean).join(' · ') || 'Equity';

  // Latest price = most recent monthly adjusted close
  const latest   = priceData[priceData.length - 1].price;
  const previous = priceData.length >= 2 ? priceData[priceData.length - 2].price : latest;

  currentPriceEl.textContent = formatPrice(latest);

  const pct      = ((latest - previous) / previous) * 100;
  const isUp     = pct >= 0;

  changeIcon.textContent  = isUp ? '▲' : '▼';
  changeValue.textContent = `${isUp ? '+' : ''}${pct.toFixed(2)}%`;
  priceChangeEl.className = `overview-card__change ${isUp ? 'positive' : 'negative'}`;

  mktCapEl.textContent = `Market Cap: ${formatMarketCap(overview.MarketCapitalization)}`;

  showOverviewContent();
}


// ─────────────────────────────────────────
//  BUILD GEMINI PRICE SUMMARY
// ─────────────────────────────────────────

// Condenses 10 years of monthly data into ~10 yearly checkpoints for the prompt.
// Keeps the prompt concise without losing the key trend shape.
function buildPriceSummary(priceData) {
  return priceData
    .filter((_, i) => i % 12 === 0 || i === priceData.length - 1)
    .map(d => `${d.date.slice(0, 7)}: $${d.price.toFixed(2)}`)
    .join(', ');
}


// ─────────────────────────────────────────
//  WATCHLIST
// ─────────────────────────────────────────

// Read the saved ticker list from localStorage (returns [] on any parse error)
function loadWatchlist() {
  try { return JSON.parse(localStorage.getItem('stockai_watchlist') || '[]'); }
  catch { return []; }
}

function persistWatchlist(list) {
  localStorage.setItem('stockai_watchlist', JSON.stringify(list));
}

// Add a ticker and refresh the pill row
function addToWatchlist(ticker) {
  const list = loadWatchlist();
  if (!list.includes(ticker)) { list.push(ticker); persistWatchlist(list); }
  renderWatchlist();
  updateSaveButton(ticker);
}

// Remove a ticker and refresh the pill row + save button state
function removeFromWatchlist(ticker) {
  persistWatchlist(loadWatchlist().filter(t => t !== ticker));
  renderWatchlist();
  const current = searchInput.value.trim().toUpperCase();
  if (current === ticker) updateSaveButton(ticker);
}

// Re-render the entire watchlist pill row from localStorage
function renderWatchlist() {
  const list = loadWatchlist();
  watchlistSection.hidden = list.length === 0;
  if (list.length === 0) return;

  watchlistPills.innerHTML = list.map(t => `
    <span class="watchlist-pill">
      <button class="watchlist-pill__ticker" data-ticker="${t}">${t}</button>
      <button class="watchlist-pill__remove" data-remove="${t}" aria-label="Remove ${t}">×</button>
    </span>`).join('');

  watchlistPills.querySelectorAll('.watchlist-pill__ticker').forEach(btn => {
    btn.addEventListener('click', () => { searchInput.value = btn.dataset.ticker; handleSearch(); });
  });
  watchlistPills.querySelectorAll('.watchlist-pill__remove').forEach(btn => {
    btn.addEventListener('click', () => removeFromWatchlist(btn.dataset.remove));
  });
}

// Sync the save button label/style with current watchlist state
function updateSaveButton(ticker) {
  const saved = loadWatchlist().includes(ticker);
  saveWatchlistBtn.classList.toggle('saved', saved);
  saveWatchlistLabel.textContent = saved ? 'Saved' : 'Save';
  saveWatchlistBtn.title         = saved ? 'Remove from Watchlist' : 'Save to Watchlist';
  saveWatchlistBtn.onclick       = () => saved ? removeFromWatchlist(ticker) : addToWatchlist(ticker);
}


// ─────────────────────────────────────────
//  SENTIMENT BADGE
// ─────────────────────────────────────────

// Compares first vs last price over the full period and shows a Bullish/Neutral/Bearish badge.
// ±5% band is used as the "roughly flat" neutral zone.
function showSentimentBadge(priceData) {
  const pct = ((priceData[priceData.length - 1].price - priceData[0].price) / priceData[0].price) * 100;

  let label, cls;
  if (pct > 5)       { label = '▲ Bullish'; cls = 'bullish'; }
  else if (pct < -5) { label = '▼ Bearish'; cls = 'bearish'; }
  else               { label = '● Neutral'; cls = 'neutral'; }

  sentimentBadge.textContent = label;
  sentimentBadge.className   = `sentiment-badge sentiment-badge--${cls}`;
  sentimentBadge.hidden      = false;
}


// ─────────────────────────────────────────
//  COMPARE WINNER HIGHLIGHT
// ─────────────────────────────────────────

// Finds the best-performing stock by % growth and adds a glowing border + badge to its card.
function highlightWinner(allData, tickers) {
  const cardIds = ['compareCard1', 'compareCard2', 'compareCard3'];

  // Clean up any previous winner state
  cardIds.forEach(id => {
    const card = document.getElementById(id);
    card.classList.remove('compare-chart-card--winner');
    card.querySelector('.winner-badge')?.remove();
  });

  let bestIdx = 0, bestGrowth = -Infinity;
  allData.forEach((data, i) => {
    if (!data || data.length < 2) return;
    const growth = ((data[data.length - 1].price - data[0].price) / data[0].price) * 100;
    if (growth > bestGrowth) { bestGrowth = growth; bestIdx = i; }
  });

  const winnerCard  = document.getElementById(cardIds[bestIdx]);
  winnerCard.classList.add('compare-chart-card--winner');

  const badge = document.createElement('div');
  badge.className   = 'winner-badge';
  badge.textContent = '👑 Best Performer';
  winnerCard.insertBefore(badge, winnerCard.firstChild);
}


// ─────────────────────────────────────────
//  MAIN SEARCH HANDLER
// ─────────────────────────────────────────

async function handleSearch() {
  const ticker = searchInput.value.trim().toUpperCase();
  if (!ticker) return;

  hideError();
  setSearchLoading(true);

  // Reveal the results area in skeleton state
  resultsArea.hidden = false;
  showOverviewSkeleton();
  showChartSkeleton();
  aiLoading.hidden = false;
  aiCard.hidden    = true;

  try {
    // One request returns both prices and overview metadata
    let yahooResult;
    try {
      yahooResult = await fetchYahooData(ticker);
    } catch (e) {
      if (e.message === 'ticker_not_found') throw new Error("We couldn't find that ticker. Try AAPL or TSLA.");
      throw new Error("Couldn't load data. Check your ticker or try again.");
    }

    const priceData = extractTenYears(yahooResult.prices);
    if (priceData.length === 0) throw new Error("We couldn't find that ticker. Try AAPL or TSLA.");

    const overview = yahooResult.overview;

    // Populate the overview card and sync watchlist button state
    populateOverviewCard(overview, priceData, ticker);
    updateSaveButton(ticker);

    // Render the chart
    showChartContent();
    renderMainChart(priceData, ticker);

    // Update the chart range badge with actual date span
    const first = formatDateLabel(priceData[0].date);
    const last  = formatDateLabel(priceData[priceData.length - 1].date);
    chartRangeBadge.textContent = `${first} – ${last} · Monthly Close`;

    // Build and send the Gemini prompt
    const summary = buildPriceSummary(priceData);
    const prompt  =
      `You are a stock analyst. Based on this 10-year monthly price history for ${ticker}: ${summary}. ` +
      `Write a 3-4 sentence plain English analysis of the trend. ` +
      `Mention overall direction, any major events visible in the data, and a simple risk note. ` +
      `No bullet points. No jargon. No financial advice framing.`;

    // Gemini failure is non-fatal — chart stays visible regardless
    try {
      const analysis = await fetchGeminiAnalysis(prompt);
      aiText.textContent = analysis;
      showSentimentBadge(priceData);
    } catch (aiErr) {
      console.error('Gemini failed:', aiErr.message);
      aiText.textContent = 'AI analysis temporarily unavailable. Chart data is still accurate.';
    } finally {
      aiLoading.hidden = true;
      aiCard.hidden    = false;
    }

  } catch (err) {
    showError(err.message || "Couldn't load data. Check your ticker or try again.");
    resultsArea.hidden = true;
  } finally {
    setSearchLoading(false);
  }
}


// ─────────────────────────────────────────
//  COMPARE HANDLER
// ─────────────────────────────────────────

async function handleCompare() {
  const t1 = compare1.value.trim().toUpperCase();
  const t2 = compare2.value.trim().toUpperCase();
  const t3 = compare3.value.trim().toUpperCase();

  if (!t1 || !t2) {
    showError("Please enter at least 2 tickers to compare.");
    return;
  }

  hideError();
  setCompareLoading(true);

  // Reveal results with AI loading state
  compareResults.hidden      = false;
  compareAiLoading.hidden    = false;
  compareAiCard.hidden       = true;

  // Destroy any previous compare charts to avoid canvas reuse errors
  compareChartInstances.forEach(c => { if (c) c.destroy(); });
  compareChartInstances = [null, null, null];

  const tickers = [t1, t2, t3].filter(Boolean);

  try {
    // Fetch price data for all entered tickers in parallel
    const results = await Promise.allSettled(
      tickers.map(t => fetchMonthlyPrices(t))
    );

    // The first two tickers are required
    if (results[0].status === 'rejected') {
      throw new Error(`Couldn't load data for ${t1}. Check the ticker symbol.`);
    }
    if (results[1].status === 'rejected') {
      throw new Error(`Couldn't load data for ${t2}. Check the ticker symbol.`);
    }

    // Map to extracted price data arrays; null if fetch failed (only possible for t3)
    const allData = results.map(r =>
      r.status === 'fulfilled' ? extractTenYears(r.value) : null
    );

    const canvasIds = ['compareChart1', 'compareChart2', 'compareChart3'];
    const labelEls  = [compareLabel1,   compareLabel2,   compareLabel3];

    // Show/hide the third card depending on whether t3 was provided and loaded
    const hasThird       = Boolean(t3 && allData[2]);
    compareCard3.hidden  = !hasThird;

    // Adjust the grid to 2 or 3 columns
    compareChartsEl.style.gridTemplateColumns = hasThird ? 'repeat(3,1fr)' : 'repeat(2,1fr)';

    // Render a mini chart for each valid ticker, then crown the winner
    tickers.forEach((ticker, i) => {
      const data = allData[i];
      if (!data) return;
      labelEls[i].textContent  = ticker;
      compareChartInstances[i] = renderCompareChart(canvasIds[i], data, i);
    });
    highlightWinner(allData, tickers);

    // Build a compact yearly summary for each ticker to pass to Gemini
    const stockSummaries = tickers
      .map((ticker, i) => {
        const data = allData[i];
        if (!data) return null;
        return `${ticker}: [${buildPriceSummary(data)}]`;
      })
      .filter(Boolean)
      .join('\n');

    const prompt =
      `Compare these stocks based on their 10-year price history:\n${stockSummaries}\n\n` +
      `In 4-5 sentences, tell me which looks strongest based on trend and why. ` +
      `Be direct and simple. No jargon.`;

    // Gemini failure is non-fatal — comparison charts stay visible regardless
    try {
      const analysis = await fetchGeminiAnalysis(prompt);
      compareAiText.textContent = analysis;
    } catch (aiErr) {
      console.error('Gemini failed:', aiErr.message);
      compareAiText.textContent = 'AI analysis temporarily unavailable. Chart data is still accurate.';
    } finally {
      compareAiLoading.hidden = true;
      compareAiCard.hidden    = false;
    }

  } catch (err) {
    showError(err.message || "Couldn't load comparison data. Check your tickers.");
    compareResults.hidden = true;
  } finally {
    setCompareLoading(false);
  }
}


// ─────────────────────────────────────────
//  EVENT LISTENERS
// ─────────────────────────────────────────

// Search button click
searchBtn.addEventListener('click', handleSearch);

// Enter key in search input
searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') handleSearch();
});

// Auto-uppercase the search input as the user types
searchInput.addEventListener('input', () => {
  const pos = searchInput.selectionStart;
  searchInput.value = searchInput.value.toUpperCase();
  searchInput.setSelectionRange(pos, pos);
});

// Ticker chip clicks — auto-fill the input and fire a search immediately
document.querySelectorAll('.ticker-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    searchInput.value = chip.dataset.ticker;
    handleSearch();
  });
});

// Compare button click
compareBtn.addEventListener('click', handleCompare);

// Enter key in any compare input
[compare1, compare2, compare3].forEach(input => {
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleCompare();
  });
});

// Auto-uppercase compare inputs as the user types
[compare1, compare2, compare3].forEach(input => {
  input.addEventListener('input', () => {
    const pos = input.selectionStart;
    input.value = input.value.toUpperCase();
    input.setSelectionRange(pos, pos);
  });
});

// Render any saved watchlist pills on page load
renderWatchlist();
