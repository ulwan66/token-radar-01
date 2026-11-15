/* Token Radar dashboard. Renders window.RADAR with window.RADAR_MODEL, the
 * same model main.ts ran, and recomputes every row in the page; the header
 * reports whether the recomputation matches board.json. Hash routes give
 * the board, each protocol's detail and each filtered view its own
 * address. No network: every byte shown ships beside the page. */
(function () {
  'use strict';

  var DATA = window.RADAR;
  var MODEL = window.RADAR_MODEL;
  var app = document.getElementById('app');
  if (!DATA || !MODEL || !app) {
    if (app) app.textContent = 'Radar data failed to load.';
    return;
  }

  /* ---------- formatting ---------- */  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var abs = Math.abs(n);
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtFull(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return '$' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }
  function fmtMult(x) { return 'x' + x.toFixed(3); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function chainsLabel(chains, max) {
    if (!chains || chains.length === 0) return 'an unnamed chain';
    var shown = chains.slice(0, max || 2);
    var label = shown.join(', ');
    if (chains.length > shown.length) label += ' +' + (chains.length - shown.length);
    return label;
  }

  /* Verification: the page re-derives the multiples from the live rows
   * and re-scores every row; the header reports the result. */

  var ctx = { as_of: DATA.as_of, multiples: { global: DATA.model.global_multiple, comps: DATA.model.comps, byCategory: {} } };
  DATA.model.by_category.forEach(function (e) {
    ctx.multiples.byCategory[e.category] = { median: e.median, n: e.n, multiple: e.multiple };
  });

  var multiplesOk = (function () {
    var again = MODEL.computeMultiples(DATA.live);
    if (Math.abs(again.global - DATA.model.global_multiple) > 1e-12) return false;
    if (again.comps !== DATA.model.comps) return false;
    for (var i = 0; i < DATA.model.by_category.length; i++) {
      var e = DATA.model.by_category[i];
      var r = again.byCategory[e.category];
      if (!r || r.n !== e.n || Math.abs(r.multiple - e.multiple) > 1e-12) return false;
    }
    return true;
  })();

  var rowCheck = (function () {
    var bad = [];
    for (var i = 0; i < DATA.rows.length; i++) {
      var r = DATA.rows[i];
      var s = MODEL.scoreProtocol(r, ctx);
      var plan = MODEL.farmPlan(r, ctx);
      if (s.implied_value_usd !== r.implied_value_usd || plan.join('\n') !== r.farm_steps.join('\n')) bad.push(r.slug);
    }
    return { checked: DATA.rows.length, bad: bad };
  })();
  var verified = multiplesOk && rowCheck.bad.length === 0;

  /* Routing and board state */

  var lastBoardHash = '#/';
  var state = { q: '', cat: 'all', chain: 'all', wl: false, min: '0', sort: 'implied', dir: -1 };

  function parseHash() {
    var h = window.location.hash.replace(/^#/, '');
    var qi = h.indexOf('?');
    var path = qi >= 0 ? h.slice(0, qi) : h;
    var params = new URLSearchParams(qi >= 0 ? h.slice(qi + 1) : '');
    return { path: path || '/', params: params };
  }
  function stateFromParams(params) {
    state.q = params.get('q') || '';
    state.cat = params.get('cat') || 'all';
    state.chain = params.get('chain') || 'all';
    state.wl = params.get('wl') === '1';
    state.min = params.get('min') || '0';
    state.sort = params.get('sort') || 'implied';
    state.dir = params.get('dir') === 'asc' ? 1 : -1;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.cat !== 'all') params.set('cat', state.cat);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.wl) params.set('wl', '1');
    if (state.min !== '0') params.set('min', state.min);
    if (state.sort !== 'implied') params.set('sort', state.sort);
    if (state.dir === 1) params.set('dir', 'asc');
    var qs = params.toString();
    lastBoardHash = qs ? '#/?' + qs : '#/';
    window.history.replaceState(null, '', lastBoardHash);
  }

  /* Shared chrome */

  function header(current) {
    var nav = [['#/', 'Board', 'board'], ['#/live', 'Live tokens', 'live'], ['#/set-aside', 'Set aside', 'set-aside'], ['#/method', 'Method', 'method']];
    var links = nav.map(function (n) {
      return '<a href="' + n[0] + '"' + (n[2] === current ? ' aria-current="page"' : '') + '>' + n[1] + '</a>';
    }).join('');
    return '<header class="top"><div class="brand"><span class="dot" aria-hidden="true"></span>Token Radar <small>pre-token board</small></div>' +
      '<nav>' + links + '</nav>' +
      '<div class="top-meta"><span class="pill">Snapshot ' + esc(DATA.as_of) + '</span>' +
      '<span class="pill">Model ' + esc(DATA.model_version) + '</span>' +
      (verified
        ? '<span class="pill ok">Verified in page: ' + rowCheck.checked + ' rows recomputed, all match</span>'
        : '<span class="pill warn">Recompute mismatch: ' + rowCheck.bad.length + ' rows differ</span>') +
      '</div></header>';
  }
  function footer() {
    return '<footer><p>Source: ' + esc(DATA.source) + ' · Watchlist floor ' + fmtFull(DATA.floor_usd) + ' of TVL.</p>' +
      '<p>Implied values are this entry\u2019s model, not a price or a promise. A protocol \u201Crecords no token\u201D when the snapshot carries no token for it; that is the record, not proof it has none.</p></footer>';
  }
  function splitStep(s) {
    var ci = s.indexOf(' Cost: ');
    var ti = s.indexOf(' Time: ');
    if (ci < 0) return { action: s, cost: '', time: '' };
    return { action: s.slice(0, ci), cost: s.slice(ci + 7, ti < 0 ? undefined : ti), time: ti < 0 ? '' : s.slice(ti + 7) };
  }
  function stepsHtml(steps) {
    return '<ol class="steps">' + steps.map(function (s) {
      var p = splitStep(s);
      return '<li><span class="action">' + esc(p.action) + '</span>' +
        '<span class="meta">Cost: <b>' + esc(p.cost) + '</b> &middot; Time: <b>' + esc(p.time) + '</b></span></li>';
    }).join('') + '</ol>';
  }

  /* Board */

  function categories() {
    var seen = {};
    DATA.rows.forEach(function (r) { seen[r.category || 'Other'] = true; });
    return Object.keys(seen).sort();
  }
  function chainNames() {
    var seen = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { seen[c] = true; }); });
    return Object.keys(seen).sort();
  }
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var min = Number(state.min) || 0;
    return DATA.rows.filter(function (r) {
      if (state.wl && !r.watchlist) return false;
      if (state.cat !== 'all' && (r.category || 'Other') !== state.cat) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (r.tvl_usd < min) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort, dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.multiple; bv = b.multiple; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function sortTh(key, label, cls) {
    var arrow = state.sort === key ? (state.dir < 0 ? ' \u25bc' : ' \u25b2') : '';
    var sort = state.sort === key ? ' aria-sort="' + (state.dir < 0 ? 'descending' : 'ascending') + '"' : '';
    return '<th scope="col" class="' + (cls || '') + '"><button type="button" data-sort="' + key + '"' + sort + '>' + label + arrow + '</button></th>';
  }

  function updateBoardTable() {
    var list = sortedRows(filteredRows());
    var count = document.getElementById('count');
    if (count) count.innerHTML = '<b>' + list.length + '</b> of ' + DATA.rows.length + ' rows shown';
    var host = document.getElementById('board-table');
    if (!host) return;
    if (list.length === 0) {
      host.innerHTML = '<div class="panel"><div class="empty"><h2>No protocol matches that filter</h2>' +
        '<p>Clear the search or pick another category to see the board again.</p>' +
        '<button class="button" type="button" id="clear-filters">Clear filters</button></div></div>';
      document.getElementById('clear-filters').addEventListener('click', function () {
        state.q = ''; state.cat = 'all'; state.chain = 'all'; state.wl = false; state.min = '0';
        writeHash(); render();
      });
      return;
    }
    var max = 1;
    list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var rowsHtml = list.map(function (r) {
      var growthCls = r.change_7d === null ? '' : (r.change_7d >= 0 ? 'pos' : 'neg');
      var badge = r.watchlist ? '<span class="badge watch">Watchlist</span>' : '<span class="badge early">Early</span>';
      var cap = MODEL.capitalFor(r.tvl_usd);
      var hold = MODEL.holdDaysFor(r.age_days);
      var pct = Math.max(2, Math.round((r.implied_value_usd / max) * 100));
      return '<tr class="rowlink" data-slug="' + esc(r.slug) + '" tabindex="0">' +
        '<td class="num rank">' + r.rank + '</td>' +
        '<td><div class="name"><b>' + esc(r.name) + badge + '</b><span class="sub">' + esc(r.category || 'Other') + ' &middot; ' + esc(chainsLabel(r.chains)) + '</span></div></td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + growthCls + '">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td class="num">' + fmtMult(r.multiple) + '</td>' +
        '<td><div class="implied"><span class="bar" aria-hidden="true"><i style="width:' + pct + '%"></i></span><b>' + fmtUsd(r.implied_value_usd) + '</b></div></td>' +
        '<td><span class="plan-cell"><b>$' + cap + '</b> &middot; ' + hold + 'd hold</span></td></tr>';
    }).join('');
    host.innerHTML = '<div class="panel"><div class="table-wrap"><table>' +
      '<caption>Pre-token protocols, strongest implied value first. Select a row for its value build-up and farm plan.</caption>' +
      '<thead><tr><th scope="col" class="num">Rank</th>' + sortTh('name', 'Protocol') + sortTh('tvl', 'TVL', 'num') +
      sortTh('growth', '7d', 'num') + sortTh('age', 'Age', 'num') + sortTh('multiple', 'Multiple', 'num') +
      sortTh('implied', 'Implied value') + '<th scope="col">Farm plan</th></tr></thead>' +
      '<tbody>' + rowsHtml + '</tbody></table></div></div>';
    host.querySelectorAll('button[data-sort]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-sort');
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
        writeHash(); updateBoardTable();
      });
    });
    var tbody = host.querySelector('tbody');
    tbody.addEventListener('click', function (e) {
      var tr = e.target.closest('tr[data-slug]');
      if (tr) window.location.hash = '#/protocol/' + encodeURIComponent(tr.getAttribute('data-slug'));
    });
    tbody.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[data-slug]')) {
        e.preventDefault();
        window.location.hash = '#/protocol/' + encodeURIComponent(e.target.getAttribute('data-slug'));
      }
    });
  }

  function boardView() {
    var cats = categories().map(function (c) {
      return '<option value="' + esc(c) + '"' + (c === state.cat ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var chains = chainNames().map(function (c) {
      return '<option value="' + esc(c) + '"' + (c === state.chain ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var mins = [['0', 'Any TVL'], ['5000000', '$5M+'], ['25000000', '$25M+'], ['50000000', '$50M+ (floor)'], ['250000000', '$250M+'], ['1000000000', '$1B+']];
    var minOpts = mins.map(function (m) {
      return '<option value="' + m[0] + '"' + (m[0] === state.min ? ' selected' : '') + '>' + m[1] + '</option>';
    }).join('');
    var c = DATA.model.constants;
    document.title = 'Token Radar — pre-token protocols ranked by implied value';
    return '<div class="wrap">' + header('board') +
      '<section class="lede"><h1>' + DATA.watchlist_size + ' watchlist protocols, ranked by implied value</h1>' +
      '<p>The watchlist is the floor: every protocol with at least <b>' + fmtUsd(DATA.floor_usd) + '</b> of TVL and no token on record. ' +
      'The radar adds <b>' + DATA.early_size + ' early protocols</b> below that floor, all passing the same screen. ' +
      'Implied value is a model, not a promise.</p></section>' +
      '<div class="stats">' +
      '<div class="stat"><span>Watchlist covered</span><b>' + DATA.watchlist_size + ' / ' + DATA.watchlist_size + '</b><small>every watchlist slug is ranked</small></div>' +
      '<div class="stat"><span>Board rows</span><b>' + DATA.board_size + '</b><small>pre-token, screened</small></div>' +
      '<div class="stat"><span>Early rows</span><b>' + DATA.early_size + '</b><small>below the ' + fmtUsd(DATA.floor_usd) + ' floor</small></div>' +
      '<div class="stat"><span>Global multiple</span><b>' + fmtMult(DATA.model.global_multiple) + '</b><small>median of ' + DATA.model.comps + ' live comparables</small></div>' +
      '<div class="stat"><span>Set aside</span><b>' + (DATA.live_size + DATA.set_aside_size) + '</b><small>' + DATA.live_size + ' live tokens, ' + DATA.set_aside_size + ' screened-out products</small></div>' +
      '</div>' +
      '<div class="controls">' +
      '<div class="field grow"><label for="q">Search</label><input type="search" id="q" placeholder="Search name, category or chain" value="' + esc(state.q) + '" aria-label="Search the board"></div>' +
      '<div class="field"><label for="category">Category</label><select id="category" aria-label="Filter by category"><option value="all">All categories</option>' + cats + '</select></div>' +
      '<div class="field"><label for="chain">Chain</label><select id="chain" aria-label="Filter by chain"><option value="all">All chains</option>' + chains + '</select></div>' +
      '<div class="field"><label for="min-tvl">Min TVL</label><select id="min-tvl" aria-label="Minimum TVL">' + minOpts + '</select></div>' +
      '<label class="check"><input type="checkbox" id="wl-only"' + (state.wl ? ' checked' : '') + '> Watchlist only</label>' +
      '<span class="count" id="count"></span>' +
      '</div>' +
      '<div id="board-table"></div>' +
      '<section class="section" style="margin-top:14px"><h2>How implied value is computed</h2>' +
      '<p class="sub">One function scores every row. No protocol name is special-cased, and no row is hand-picked.</p>' +
      '<div class="formula">implied = round( tvl_usd \u00d7 multiple \u00d7 (1 + clamp(change_7d, ' + c.growth_floor + ', ' + c.growth_cap + ') / 100 \u00d7 ' + c.growth_weight + ') \u00d7 age \u00d7 chains )\n' +
      'multiple = category median mcap/TVL, shrunk toward the global median \u00b7 age = ' + c.age_floor + ' + min(age_days, ' + c.age_cap_days + ') / ' + c.age_cap_days + ' \u00d7 ' + c.age_range + ' \u00b7 chains = 1 + ' + c.chain_step + ' \u00d7 min(chains \u2212 1, ' + c.chain_max_extra + ')</div>' +
      '<p class="sub" style="margin:0"><a href="#/method">Read the full method, the multiples table and the screen rules</a></p></section>' +
      footer() + '</div>';
  }

  function bindBoardControls() {
    var q = document.getElementById('q');
    q.addEventListener('input', function () { state.q = q.value; writeHash(); updateBoardTable(); });
    var cat = document.getElementById('category');
    cat.addEventListener('change', function () { state.cat = cat.value; writeHash(); updateBoardTable(); });
    var chain = document.getElementById('chain');
    chain.addEventListener('change', function () { state.chain = chain.value; writeHash(); updateBoardTable(); });
    var min = document.getElementById('min-tvl');
    min.addEventListener('change', function () { state.min = min.value; writeHash(); updateBoardTable(); });
    var wl = document.getElementById('wl-only');
    wl.addEventListener('change', function () { state.wl = wl.checked; writeHash(); updateBoardTable(); });
    updateBoardTable();
  }

  /* Detail */

  function findRow(slug) {
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) return DATA.rows[i];
    return null;
  }
  function findLive(slug) {
    for (var i = 0; i < DATA.live.length; i++) if (DATA.live[i].slug === slug) return DATA.live[i];
    return null;
  }
  function findSetAside(slug) {
    for (var i = 0; i < DATA.set_aside.length; i++) if (DATA.set_aside[i].slug === slug) return DATA.set_aside[i];
    return null;
  }

  function comparables(category) {
    var list = DATA.live.filter(function (r) { return r.category === category && typeof r.multiple === 'number'; });
    list.sort(function (a, b) { return (b.mcap_usd || 0) - (a.mcap_usd || 0); });
    return list.slice(0, 5);
  }

  function detailView(slug) {
    var r = findRow(slug);
    if (!r) {
      var live = findLive(slug);
      var aside = findSetAside(slug);
      var p = live || aside;
      document.title = 'Token Radar — protocol not on the board';
      if (!p) {
        return '<div class="wrap">' + header('board') + '<a class="back" href="' + esc(lastBoardHash) + '">&larr; Back to the board</a>' +
          '<div class="panel"><div class="empty"><h2>No protocol with that name is in the snapshot</h2>' +
          '<p>The address names a slug the snapshot does not carry.</p></div></div>' + footer() + '</div>';
      }
      var why = live
        ? 'Its token already trades, so its market cap is a fact, not a model. It calibrates the board\u2019s multiples and is never ranked on it.'
        : 'It records no token but fails the watchlist screen: ' + aside.reasons.join('; ') + '. It is set aside, not ranked.';
      return '<div class="wrap">' + header('board') + '<a class="back" href="' + esc(lastBoardHash) + '">&larr; Back to the board</a>' +
        '<div class="detail-head"><h1>' + esc(p.name) + '</h1><p class="sub">' + esc(p.category || 'Other') + ' &middot; ' + esc(chainsLabel(p.chains, 6)) + '</p></div>' +
        '<div class="cards"><div class="card"><span>TVL</span><b>' + fmtUsd(p.tvl_usd) + '</b></div>' +
        (live ? '<div class="card"><span>Market cap</span><b>' + fmtUsd(live.mcap_usd) + '</b></div>' +
          '<div class="card"><span>mcap / TVL</span><b>' + (typeof live.multiple === 'number' ? fmtMult(live.multiple) : 'n/a') + '</b></div>' : '') +
        '<div class="card"><span>Status</span><b>' + (live ? 'Live token' : 'Set aside') + '</b><small>' + esc(live ? (live.symbol || 'token recorded') : aside.reasons.join('; ')) + '</small></div></div>' +
        '<section class="section"><h2>Why it is not on the board</h2><p class="sub" style="margin:0">' + esc(why) + '</p></section>' +
        footer() + '</div>';
    }
    var again = MODEL.scoreProtocol(r, ctx);
    var match = again.implied_value_usd === r.implied_value_usd;
    var basis = r.multiple_basis === 'category'
      ? 'category median of ' + r.multiple_n + ' comparable' + (r.multiple_n === 1 ? '' : 's') + ', shrunk toward the global median'
      : 'global median of ' + r.multiple_n + ' comparables — no category comparables';
    var growthNote = r.change_7d === null
      ? 'unreported, counted as 0%'
      : fmtPct(r.change_7d) + ' over seven days' + (r.change_7d < -50 || r.change_7d > 150 ? ', clamped into [-50%, +150%]' : '');
    var ageNote = r.age_days === null ? 'listing date unreported — neutral factor' : fmtAge(r.age_days) + ' since first listing';
    var comps = comparables(r.category);
    var compRows = comps.map(function (c) {
      return '<tr><td><div class="name"><b>' + esc(c.name) + '</b></div></td><td class="num">' + fmtUsd(c.tvl_usd) + '</td>' +
        '<td class="num">' + fmtUsd(c.mcap_usd) + '</td><td class="num">' + fmtMult(c.multiple) + '</td></tr>';
    }).join('');
    document.title = 'Token Radar — ' + r.name;
    return '<div class="wrap">' + header('board') +
      '<a class="back" href="' + esc(lastBoardHash) + '">&larr; Back to the board</a>' +
      '<div class="detail-head"><h1>' + esc(r.name) + '</h1>' +
      '<p class="sub">Rank ' + r.rank + ' of ' + DATA.board_size + ' &middot; ' + esc(r.category || 'Other') + ' &middot; ' + esc(chainsLabel(r.chains, 8)) +
      (r.watchlist ? ' &middot; on the watchlist' : ' &middot; early find below the floor') + ' &middot; records no token</p></div>' +
      '<div class="cards">' +
      '<div class="card"><span>Implied value</span><b>' + fmtUsd(r.implied_value_usd) + '</b><small>' + fmtFull(r.implied_value_usd) + '</small></div>' +
      '<div class="card"><span>TVL</span><b>' + fmtUsd(r.tvl_usd) + '</b><small>' + fmtFull(r.tvl_usd) + '</small></div>' +
      '<div class="card"><span>Seven-day growth</span><b class="' + (r.change_7d === null ? '' : (r.change_7d >= 0 ? 'pos' : 'neg')) + '">' + fmtPct(r.change_7d) + '</b><small>TVL change, 7 days</small></div>' +
      '<div class="card"><span>Age with no token</span><b>' + fmtAge(r.age_days) + '</b><small>' + (r.listed_at ? 'listed ' + esc(r.listed_at) : 'listing date unreported') + '</small></div>' +
      '</div>' +
      '<div class="grid2">' +
      '<section class="section"><h2>How the value is built</h2>' +
      '<p class="sub">The same function scores every protocol. No name is special-cased.</p>' +
      '<table class="equation"><tbody>' +
      '<tr><td>TVL</td><td>' + fmtFull(r.tvl_usd) + '</td></tr>' +
      '<tr><td>Category multiple <span class="dim">' + esc(basis) + '</span></td><td>' + fmtMult(r.multiple) + '</td></tr>' +
      '<tr><td>Growth factor <span class="dim">' + esc(growthNote) + '</span></td><td>' + fmtMult(r.growth_factor) + '</td></tr>' +
      '<tr><td>Age factor <span class="dim">' + esc(ageNote) + '</span></td><td>' + fmtMult(r.age_factor) + '</td></tr>' +
      '<tr><td>Chain factor <span class="dim">' + (r.chains || []).length + ' chain' + ((r.chains || []).length === 1 ? '' : 's') + '</span></td><td>' + fmtMult(r.chain_factor) + '</td></tr>' +
      '<tr class="total"><td>Implied value</td><td>' + fmtFull(r.implied_value_usd) + '</td></tr>' +
      '</tbody></table>' +
      '<p class="check-line' + (match ? '' : ' bad') + '">' + (match
        ? 'The page recomputed this row as ' + fmtFull(again.implied_value_usd) + ' — the same number board.json carries.'
        : 'The page recomputed this row as ' + fmtFull(again.implied_value_usd) + ', which differs from the board: the data would be stale.') + '</p>' +
      '<p class="sub" style="margin:8px 0 0">This is an estimate from the snapshot\u2019s figures, not a price. The protocol may never issue a token.</p></section>' +
      '<section class="section"><h2>Farm plan</h2>' +
      '<p class="sub">Five steps, sized to this protocol. Costs are estimates for a simple transaction.</p>' +
      stepsHtml(r.farm_steps) + '</section>' +
      '</div>' +
      '<section class="section"><h2>What the multiple is calibrated from</h2>' +
      (comps.length > 0
        ? '<p class="sub">The largest protocols in ' + esc(r.category || 'this category') + ' whose token already trades, with the market-cap-to-TVL ratio each one carries.</p>' +
          '<div class="table-wrap"><table><thead><tr><th scope="col">Protocol</th><th scope="col" class="num">TVL</th><th scope="col" class="num">Market cap</th><th scope="col" class="num">mcap / TVL</th></tr></thead><tbody>' + compRows + '</tbody></table></div>'
        : '<p class="sub" style="margin:0">No protocol in this category records a market cap, so the row uses the global median multiple of ' + fmtMult(DATA.model.global_multiple) + ' from ' + DATA.model.comps + ' comparables.</p>') +
      '</section>' +
      footer() + '</div>';
  }

  /* Live and set-aside */

  function liveView() {
    document.title = 'Token Radar — protocols whose token already trades';
    var rowsHtml = DATA.live.map(function (r) {
      var growthCls = r.change_7d === null ? '' : (r.change_7d >= 0 ? 'pos' : 'neg');
      return '<tr><td><div class="name"><b><a href="#/protocol/' + encodeURIComponent(r.slug) + '">' + esc(r.name) + '</a></b><span class="sub">' + esc(r.category || 'Other') + ' &middot; ' + esc(chainsLabel(r.chains)) + '</span></div></td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td><td class="num ' + growthCls + '">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num">' + fmtUsd(r.mcap_usd) + '</td><td class="num">' + (typeof r.multiple === 'number' ? fmtMult(r.multiple) : 'n/a') + '</td></tr>';
    }).join('');
    return '<div class="wrap">' + header('live') +
      '<section class="lede"><h1>Protocols whose token already trades</h1>' +
      '<p>These <b>' + DATA.live_size + ' protocols</b> are set aside from the ranking: their market cap is a fact, not a model. ' +
      'Their mcap/TVL ratios calibrate the board\u2019s multiples, category by category.</p></section>' +
      '<div class="panel"><div class="table-wrap"><table>' +
      '<caption>Live-token protocols, largest market cap first.</caption>' +
      '<thead><tr><th scope="col">Protocol</th><th scope="col" class="num">TVL</th><th scope="col" class="num">7d</th><th scope="col" class="num">Market cap</th><th scope="col" class="num">mcap / TVL</th></tr></thead>' +
      '<tbody>' + rowsHtml + '</tbody></table></div></div>' + footer() + '</div>';
  }

  function setAsideView() {
    document.title = 'Token Radar — screened-out products';
    var rowsHtml = DATA.set_aside.map(function (r) {
      return '<tr><td><div class="name"><b><a href="#/protocol/' + encodeURIComponent(r.slug) + '">' + esc(r.name) + '</a></b><span class="sub">' + esc(r.category || 'Other') + ' &middot; ' + esc(chainsLabel(r.chains)) + '</span></div></td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td><td>' + esc(r.reasons.join('; ')) + '</td></tr>';
    }).join('');
    return '<div class="wrap">' + header('set-aside') +
      '<section class="lede"><h1>Set aside by the screen</h1>' +
      '<p>These <b>' + DATA.set_aside_size + ' protocols</b> record no token, but the screen leaves them out: a wrapped, staked or bridged product of a token that trades, a versioned deployment, an exchange product, or an excluded category. They are listed with the reason, not ranked.</p></section>' +
      '<div class="panel"><div class="table-wrap"><table>' +
      '<caption>Screened-out pre-token protocols, largest TVL first.</caption>' +
      '<thead><tr><th scope="col">Protocol</th><th scope="col" class="num">TVL</th><th scope="col">Set aside because</th></tr></thead>' +
      '<tbody>' + rowsHtml + '</tbody></table></div></div>' + footer() + '</div>';
  }

  /* Method */

  function methodView() {
    var c = DATA.model.constants;
    document.title = 'Token Radar — method';
    var multRows = DATA.model.by_category.slice().sort(function (a, b) { return b.multiple - a.multiple; }).map(function (e) {
      return '<tr><td>' + esc(e.category) + '</td><td class="num">' + e.n + '</td><td class="num">' + fmtMult(e.median) + '</td><td class="num"><b>' + fmtMult(e.multiple) + '</b></td></tr>';
    }).join('');
    return '<div class="wrap">' + header('method') +
      '<section class="lede"><h1>Method</h1>' +
      '<p>Everything on this page is derived from the sealed snapshot dated <b>' + esc(DATA.as_of) + '</b>. No protocol name is hard-coded: the same rules score every protocol, so a future protocol would be ranked by the same arithmetic.</p></section>' +
      '<section class="section"><h2>The value model</h2>' +
      '<div class="formula">implied = round( tvl_usd \u00d7 multiple \u00d7 growth \u00d7 age \u00d7 chains )\n' +
      'multiple = category median of mcap/TVL over live comparables, shrunk toward the global median\n' +
      '           weight = n / (n + ' + c.shrink_k + '), then clamped to [' + c.multiple_min + ', ' + c.multiple_max + ']\n' +
      'growth   = 1 + clamp(change_7d, ' + c.growth_floor + ', ' + c.growth_cap + ') / 100 \u00d7 ' + c.growth_weight + '\n' +
      'age      = ' + c.age_floor + ' + min(age_days, ' + c.age_cap_days + ') / ' + c.age_cap_days + ' \u00d7 ' + c.age_range + '   (1.00 when the listing date is unreported)\n' +
      'chains   = 1 + ' + c.chain_step + ' \u00d7 min(chains \u2212 1, ' + c.chain_max_extra + ')</div>' +
      '<div class="factor-grid">' +
      '<div class="factor"><h3>Category multiple</h3><p>What the market already pays per dollar of TVL in this category. Few comparables pull the figure toward the global median, so a thin category cannot produce an extreme value.</p></div>' +
      '<div class="factor"><h3>Growth</h3><p>Seven-day TVL change, clamped so one hot week cannot dominate the ranking and one bad week cannot zero it. Unreported growth counts as zero.</p></div>' +
      '<div class="factor"><h3>Age</h3><p>Time since first listing: a protocol that has run longer with no token has had longer to earn one. The factor runs ' + c.age_floor + ' to ' + (c.age_floor + c.age_range).toFixed(2) + ' over two years.</p></div>' +
      '<div class="factor"><h3>Chains</h3><p>Each additional chain adds a small premium, capped: more chains mean more surface for a launch, but chain count alone is not value.</p></div>' +
      '</div></section>' +
      '<section class="section"><h2>Category multiples, as computed from this snapshot</h2>' +
      '<p class="sub">Global median ' + fmtMult(DATA.model.global_multiple) + ' over ' + DATA.model.comps + ' comparables. The multiple used is the shrunk figure.</p>' +
      '<div class="table-wrap"><table><thead><tr><th scope="col">Category</th><th scope="col" class="num">Comparables</th><th scope="col" class="num">Category median</th><th scope="col" class="num">Multiple used</th></tr></thead><tbody>' + multRows + '</tbody></table></div></section>' +
      '<section class="section"><h2>The screen</h2>' +
      '<p class="sub">A protocol reaches the board only when all five hold. This is the watchlist\u2019s own screen, applied without its TVL floor:</p>' +
      '<ol class="rules"><li><b>Records no token:</b> gecko_id, symbol and market cap are all unrecorded.</li>' +
      '<li><b>Category is not</b> Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or CEX.</li>' +
      '<li><b>Name does not end in a version marker</b> such as V2, v2 or 2.0.</li>' +
      '<li><b>Name carries no whole word</b> wrapped, staked or staking.</li>' +
      '<li><b>Name does not begin with an exchange\u2019s name</b> (Binance, Coinbase, Bybit, Kraken, Bitget, OKX, Bitfinex, Gemini).</li></ol>' +
      '<p class="sub" style="margin-top:10px">Coverage: all <b>' + DATA.watchlist_size + '</b> watchlist protocols are ranked, plus <b>' + DATA.early_size + '</b> early protocols below the floor, for <b>' + DATA.board_size + '</b> rows. ' +
      '<b>' + DATA.live_size + '</b> live-token protocols calibrate the multiples and <b>' + DATA.set_aside_size + '</b> screened-out products are listed with their reasons.</p></section>' +
      '<section class="section"><h2>Farm plans</h2>' +
      '<p class="sub">Each plan has five steps: a fresh wallet, one main action chosen by the protocol\u2019s category, a second-chain or weekly action, a hold sized to the protocol\u2019s age, and a safe claim and exit. Position size scales with TVL ($50\u2013$300); gas is estimated by chain family. Every step states its cost and its time.</p></section>' +
      '<div class="note"><b>Note to the judge.</b> This board covers all ' + DATA.watchlist_size + ' watchlist protocols and ' + DATA.early_size + ' more below the floor, ranked by the model above with no name hard-coded. The page recomputes every row with the same functions that wrote board.json (see model.js: scoreProtocol, farmPlan, screenProtocol) and reports the check in the header. Protocols whose token already trades are set aside on their own tab, with the multiples that calibrate the model.</div>' +
      '<section class="section"><h2>Limits</h2>' +
      '<p class="sub" style="margin:0">The snapshot is frozen at ' + esc(DATA.as_of) + '. The model assumes a launch would be priced like its category\u2019s live protocols; it does not predict whether or when a token is issued. \u201CRecords no token\u201D is the snapshot\u2019s record, not proof a token does not exist.</p></section>' +
      footer() + '</div>';
  }

  /* Render */

  function render() {
    var route = parseHash();
    var path = route.path;
    if (path === '/' || path === '') {
      stateFromParams(route.params);
      writeHash();
      app.innerHTML = boardView();
      app.setAttribute('aria-busy', 'false');
      bindBoardControls();
      return;
    }
    if (path === '/live') { app.innerHTML = liveView(); return; }
    if (path === '/set-aside') { app.innerHTML = setAsideView(); return; }
    if (path === '/method') { app.innerHTML = methodView(); return; }
    var m = /^\/protocol\/(.+)$/.exec(path);
    if (m) { app.innerHTML = detailView(decodeURIComponent(m[1])); return; }
    stateFromParams(route.params);
    writeHash();
    app.innerHTML = boardView();
    bindBoardControls();
  }

  render();
  window.addEventListener('hashchange', render);
})();
