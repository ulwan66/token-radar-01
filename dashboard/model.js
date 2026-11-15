/* Token Radar model: the one scoring and planning implementation.
 *
 * main.ts loads this file in Node and the dashboard loads it as a classic
 * script, so the board and the page run identical arithmetic: the page
 * recomputes every row with the same functions that wrote board.json.
 *
 * Nothing here names a protocol. Every number comes from the snapshot:
 * the category multiple is the median market-cap-to-TVL ratio of the
 * protocols in that category whose token already trades, shrunk toward
 * the global median when the category has few comparables.
 */
(function (root) {
  'use strict';

  var MODEL_VERSION = 'radar-1';

  var CONSTANTS = {
    growth_floor: -50,
    growth_cap: 150,
    growth_weight: 0.4,
    age_cap_days: 730,
    age_floor: 0.85,
    age_range: 0.3,
    chain_step: 0.02,
    chain_max_extra: 10,
    shrink_k: 4,
    multiple_min: 0.03,
    multiple_max: 2.5,
    fallback_multiple: 1.0
  };

  /* The watchlist screen, from the snapshot's field guide: a protocol
   * records no token and is not a wrapped, staked or bridged product of
   * one that trades. The board applies it without the TVL floor. */
  var EXCLUDED_CATEGORIES = ['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX'];
  var EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
  var VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
  var WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

  function medianOf(values) {
    if (values.length === 0) return null;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[mid];
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function parseDay(iso) {
    if (typeof iso !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return null;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  /* Whole days from first listing to the snapshot date; null when the
   * snapshot carries no listing date. Pure date arithmetic, no clock. */
  function ageDays(listedAt, asOf) {
    var start = parseDay(listedAt);
    var end = parseDay(asOf);
    if (start === null || end === null) return null;
    var days = Math.floor((end - start) / 86400000);
    return days < 0 ? 0 : days;
  }

  /* Comparables: every protocol with a market cap and TVL contributes
   * its mcap/TVL ratio. The global median anchors thin categories. */
  function computeMultiples(protocols) {
    var ratios = [];
    var byCat = {};
    for (var i = 0; i < protocols.length; i++) {
      var p = protocols[i];
      if (typeof p.mcap_usd !== 'number' || typeof p.tvl_usd !== 'number') continue;
      if (!(p.mcap_usd > 0) || !(p.tvl_usd > 0)) continue;
      var r = p.mcap_usd / p.tvl_usd;
      ratios.push(r);
      var cat = p.category;
      if (typeof cat === 'string' && cat.length > 0) {
        if (!byCat[cat]) byCat[cat] = [];
        byCat[cat].push(r);
      }
    }
    var global = medianOf(ratios);
    if (global === null) global = CONSTANTS.fallback_multiple;
    var table = {};
    var cats = Object.keys(byCat).sort();
    for (var j = 0; j < cats.length; j++) {
      var cat = cats[j];
      var med = medianOf(byCat[cat]);
      var n = byCat[cat].length;
      var w = n / (n + CONSTANTS.shrink_k);
      var shrunk = clamp(w * med + (1 - w) * global, CONSTANTS.multiple_min, CONSTANTS.multiple_max);
      table[cat] = { median: med, n: n, multiple: shrunk };
    }
    return { global: global, comps: ratios.length, byCategory: table };
  }

  function multipleFor(category, multiples) {
    if (typeof category === 'string' && multiples.byCategory[category]) {
      var e = multiples.byCategory[category];
      return { multiple: e.multiple, basis: 'category', n: e.n, category_median: e.median };
    }
    return {
      multiple: clamp(multiples.global, CONSTANTS.multiple_min, CONSTANTS.multiple_max),
      basis: 'global',
      n: multiples.comps,
      category_median: null
    };
  }

  /* implied = TVL x category multiple x growth x age x chains. Growth is
   * the seven-day change clamped to [-50, +150] and weighted 0.4. Age runs
   * 0.85 new to 1.15 at two years, neutral when unreported. Each extra
   * chain adds 0.02, capped. */
  function scoreProtocol(p, ctx) {
    var m = multipleFor(p.category, ctx.multiples);
    var rawGrowth = (typeof p.change_7d === 'number' && isFinite(p.change_7d)) ? p.change_7d : 0;
    var growthPct = clamp(rawGrowth, CONSTANTS.growth_floor, CONSTANTS.growth_cap);
    var growthFactor = 1 + (growthPct / 100) * CONSTANTS.growth_weight;
    var age = ageDays(p.listed_at, ctx.as_of);
    var ageFactor = age === null
      ? 1.0
      : CONSTANTS.age_floor + (Math.min(age, CONSTANTS.age_cap_days) / CONSTANTS.age_cap_days) * CONSTANTS.age_range;
    var chainCount = Array.isArray(p.chains) ? p.chains.length : 0;
    var chainFactor = 1 + CONSTANTS.chain_step * Math.min(Math.max(chainCount - 1, 0), CONSTANTS.chain_max_extra);
    var implied = Math.max(1, Math.round(p.tvl_usd * m.multiple * growthFactor * ageFactor * chainFactor));
    return {
      implied_value_usd: implied,
      multiple: m.multiple,
      multiple_basis: m.basis,
      multiple_n: m.n,
      category_median: m.category_median,
      growth_pct: growthPct,
      growth_factor: growthFactor,
      age_days: age,
      age_factor: ageFactor,
      chain_factor: chainFactor
    };
  }

  function hasToken(p) {
    return (p.gecko_id !== null && p.gecko_id !== undefined) ||
      (p.symbol !== null && p.symbol !== undefined) ||
      (p.mcap_usd !== null && p.mcap_usd !== undefined);
  }

  /* A protocol passes only when it records no token and none of the
   * product rules trips. Reasons name the rule, for the set-aside view. */
  function screenProtocol(p) {
    var reasons = [];
    if (hasToken(p)) {
      reasons.push('token already trades');
      return { pass: false, reasons: reasons };
    }
    if (typeof p.category === 'string' && EXCLUDED_CATEGORIES.indexOf(p.category) >= 0) {
      reasons.push('category ' + p.category);
    }
    var name = typeof p.name === 'string' ? p.name : '';
    if (VERSION_MARKER.test(name)) reasons.push('versioned name');
    if (WRAPPED_WORD.test(name)) reasons.push('wrapped or staked product');
    for (var i = 0; i < EXCHANGE_PREFIXES.length; i++) {
      if (name.indexOf(EXCHANGE_PREFIXES[i]) === 0) { reasons.push('exchange product'); break; }
    }
    return { pass: reasons.length === 0, reasons: reasons };
  }

  function firstChain(p) {
    return Array.isArray(p.chains) && p.chains.length > 0 ? p.chains[0] : 'its home chain';
  }

  /* Gas is an estimate, stated as one. Ethereum mainnet is the only chain
   * where a simple transaction routinely costs several dollars. */
  function gasFor(chain) {
    if (chain === 'Ethereum') return 'about $8 in gas';
    return 'about $1 in gas';
  }

  /* Position size scales with TVL, so the farm is proportional, never a
   * fixed punt. */
  function capitalFor(tvl) {
    if (tvl >= 1e9) return 300;
    if (tvl >= 25e7) return 200;
    if (tvl >= 5e7) return 100;
    return 50;
  }

  /* Younger protocols get a longer hold: their snapshots are still being
   * written, so the position needs more time to be counted. */
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 90;
    if (age < 365) return 60;
    return 45;
  }

  /* One main action per category family, most specific first (yield
   * aggregator before yield, leveraged before farm). No name is special-cased. */
  var ACTIONS = [
    ['yield aggregator', function (name, cap, chain) { return 'Deposit $' + cap + ' of USDC into one ' + name + ' vault on ' + chain + ' and hold the vault shares instead of trading them.'; }],
    ['allocator', function (name, cap, chain) { return 'Deposit $' + cap + ' of USDC into a ' + name + ' allocation vault on ' + chain + ' and keep the shares while it deploys.'; }],
    ['curator', function (name, cap, chain) { return 'Deposit $' + cap + ' of USDC into a vault ' + name + ' curates on ' + chain + ' and leave the allocation to the curator.'; }],
    ['liquidity', function (name, cap, chain) { return 'Provide $' + cap + ' of managed liquidity through ' + name + ' on ' + chain + ' and leave the position to rebalance itself.'; }],
    ['lend', function (name, cap, chain) { return 'Supply $' + cap + ' of USDC to ' + name + ' on ' + chain + ', borrow a small amount against it, and leave both sides open.'; }],
    ['cdp', function (name, cap, chain) { return 'Lock $' + cap + ' of collateral in ' + name + ' on ' + chain + ' and mint a modest amount of its stable asset against it.'; }],
    ['collateral', function (name, cap, chain) { return 'Post $' + cap + ' of collateral on ' + name + ' (' + chain + ') and use a conservative loan-to-value so the position survives a dip.'; }],
    ['dex', function (name, cap, chain) { return 'Add $' + cap + ' of liquidity to ' + name + "'s deepest pool on " + chain + ' and leave the position in range.'; }],
    ['leveraged', function (name, cap, chain) { return 'Open a leveraged farm on ' + name + ' with $' + cap + ' of collateral on ' + chain + ' at the lowest leverage the app offers.'; }],
    ['farm', function (name, cap, chain) { return 'Deposit $' + cap + ' into the main farm on ' + name + ' (' + chain + ') and stake the receipt token the farm issues.'; }],
    ['yield', function (name, cap, chain) { return 'Deposit $' + cap + ' of USDC into ' + name + "'s highest-yield strategy on " + chain + ' and let the yield compound.'; }],
    ['rwa', function (name, cap, chain) { return 'Mint $' + cap + ' of ' + name + "'s yield-bearing asset on " + chain + ' and hold it in the farming wallet.'; }],
    ['basis', function (name, cap, chain) { return 'Open a $' + cap + ' basis position through ' + name + ' on ' + chain + ' and hold both legs until the funding cycle settles.'; }],
    ['derivative', function (name, cap, chain) { return 'Post $' + cap + ' of USDC as margin on ' + name + ' (' + chain + '), open one small position, and close it before funding eats the edge.'; }],
    ['perpetual', function (name, cap, chain) { return 'Post $' + cap + ' of USDC as margin on ' + name + ' (' + chain + '), open one small position, and close it before funding eats the edge.'; }],
    ['options', function (name, cap, chain) { return 'Deposit $' + cap + ' into the ' + name + ' options vault on ' + chain + ' and hold the vault token through one expiry cycle.'; }],
    ['stak', function (name, cap, chain) { return 'Stake $' + cap + ' of the staking asset through ' + name + ' on ' + chain + ' and keep the liquid receipt token in the wallet.'; }],
    ['bridge', function (name, cap, chain) { return 'Bridge $' + cap + ' of USDC through ' + name + ' to ' + chain + ' and put the bridged funds to work in the destination app.'; }],
    ['prediction', function (name, cap, chain) { return 'Fund ' + name + ' with $' + cap + ' on ' + chain + ' and take a position in one open market, holding it to resolution.'; }],
    ['stable', function (name, cap, chain) { return 'Mint or buy $' + cap + ' of the stable asset ' + name + ' issues on ' + chain + ' and hold it rather than swapping it away.'; }],
    ['insurance', function (name, cap, chain) { return 'Buy $' + cap + ' of cover from ' + name + ' on ' + chain + ' for a protocol you already use, and keep the policy active.'; }],
    ['index', function (name, cap, chain) { return 'Buy $' + cap + ' of the ' + name + ' index token on ' + chain + ' and hold it as a single position.'; }],
    ['privacy', function (name, cap, chain) { return 'Deposit $' + cap + ' into ' + name + "'s shielded pool on " + chain + ' and withdraw it later from a fresh address you control.'; }],
    ['payment', function (name, cap, chain) { return 'Route $' + cap + ' of real spending through ' + name + ' on ' + chain + ' over the next month instead of a single burst.'; }],
    ['card', function (name, cap, chain) { return 'Load $' + cap + ' onto the ' + name + ' card on ' + chain + ' and spend it on ordinary purchases across the month.'; }],
    ['otc', function (name, cap, chain) { return 'Place a $' + cap + ' order on ' + name + ' (' + chain + ') at a price you would genuinely accept, and let it sit.'; }],
    ['governance', function (name, cap, chain) { return 'Deposit $' + cap + ' into the incentive pool ' + name + ' runs on ' + chain + ' and vote with the position when a proposal opens.'; }],
    ['btc', function (name, cap, chain) { return 'Deposit $' + cap + ' of BTC value through ' + name + ' on ' + chain + ' and keep the wrapped receipt in the farming wallet.'; }],
    ['chain', function (name, cap, chain) { return 'Bridge $' + cap + ' of USDC to ' + name + ' and use two of its native apps — one swap and one deposit — so the wallet shows real activity.'; }]
  ];

  function actionFor(p, capital, chain) {
    var c = typeof p.category === 'string' ? p.category.toLowerCase() : '';
    for (var i = 0; i < ACTIONS.length; i++) {
      if (c.indexOf(ACTIONS[i][0]) >= 0) return ACTIONS[i][1](p.name, capital, chain);
    }
    return 'Deposit $' + capital + ' of USDC into ' + p.name + ' on ' + chain + ' and keep the position open across weekly snapshots.';
  }

  /* Five steps, each carrying cost and time: action, then ' Cost: ...'
   * and ' Time: ...', which the page splits apart for display. Capital,
   * gas, hold and the second chain follow from the protocol's figures. */
  function farmPlan(p, ctx) {
    var chain = firstChain(p);
    var capital = capitalFor(p.tvl_usd);
    var age = ageDays(p.listed_at, ctx.as_of);
    var hold = holdDaysFor(age);
    var gas = gasFor(chain);
    var steps = [];
    steps.push(stepText(
      'Open a fresh wallet that holds only the funds for this farm, write its seed phrase on paper, and send a small test deposit first.',
      'the test deposit plus ' + gas + ' on ' + chain,
      '10 minutes to set up'));
    steps.push(stepText(
      actionFor(p, capital, chain),
      '$' + capital + ' of capital plus ' + gas,
      '20 minutes to set up'));
    if (Array.isArray(p.chains) && p.chains.length > 1) {
      var chain2 = p.chains[1];
      steps.push(stepText(
        'Bridge a small amount to ' + chain2 + ' and repeat one qualifying action there, so the wallet is active on more than one chain ' + p.name + ' runs on.',
        'about $25 plus bridge fees and ' + gasFor(chain2),
        '15 minutes'));
    } else {
      steps.push(stepText(
        'Return once a week and make one more qualifying action — a deposit, a swap, a vote, or a claim — so the wallet stays active across snapshots.',
        gas + ' a week',
        '10 minutes a week'));
    }
    steps.push(stepText(
      'Keep the position open for at least ' + hold + ' days, and check ' + p.name + "'s own points or rewards page once a week for new tasks.",
      'the $' + capital + ' stays in the position, plus ' + gas + ' a week for upkeep',
      hold + ' days'));
    steps.push(stepText(
      'When a claim opens, use only the link the protocol publishes on its own site, never pay anyone to claim for you, and record every transaction in a farm log before unwinding gradually.',
      'exit gas of ' + gas + '; never a fee to claim',
      '15 minutes to verify and exit'));
    return steps;
  }

  function stepText(text, cost, time) {
    return text + ' Cost: ' + cost + '. Time: ' + time + '.';
  }

  var api = {
    MODEL_VERSION: MODEL_VERSION,
    CONSTANTS: CONSTANTS,
    EXCLUDED_CATEGORIES: EXCLUDED_CATEGORIES,
    EXCHANGE_PREFIXES: EXCHANGE_PREFIXES,
    clamp: clamp,
    medianOf: medianOf,
    ageDays: ageDays,
    computeMultiples: computeMultiples,
    multipleFor: multipleFor,
    scoreProtocol: scoreProtocol,
    hasToken: hasToken,
    screenProtocol: screenProtocol,
    firstChain: firstChain,
    gasFor: gasFor,
    capitalFor: capitalFor,
    holdDaysFor: holdDaysFor,
    actionFor: actionFor,
    farmPlan: farmPlan
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.RADAR_MODEL = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
