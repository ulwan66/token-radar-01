// Token Radar: reads the sealed snapshot, scores every pre-token protocol
// that passes the watchlist screen, and writes board.json, data.js, the
// dashboard, the screenshots and dossier.json to /output.
//
// The scoring and planning live in dashboard/model.js, the same file the
// page loads, so the board and the page run identical arithmetic. The run
// is pure: no clock, no randomness, no network, so two runs write the
// same bytes.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const require = createRequire(import.meta.url);
// The shared model: a classic script the dashboard loads too. Loaded with
// require so one file serves both runtimes with no transform and no copy.
const MODEL: any = require('./dashboard/model.js');

const ROOT = dirname(fileURLToPath(import.meta.url));
const TEXT_MAX_BYTES = 65_536;

interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  multiple: number;
  multiple_basis: string;
  multiple_n: number;
  category_median: number | null;
  growth_factor: number;
  age_factor: number;
  chain_factor: number;
  watchlist: boolean;
}

function fail(message: string): never {
  throw new Error(`token radar: ${message}`);
}

function parseArgs(argv: string[]): { input: string; output: string } {
  let input = '/input/snapshot.json';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input' && i + 1 < argv.length) {
      input = argv[++i];
    } else if (arg.startsWith('--input=')) {
      input = arg.slice('--input='.length);
    }
  }
  const output = process.env.MAKEFUN_OUTPUT_DIR || '/output';
  return { input, output };
}

function resolveInput(input: string): string {
  const st = statSync(input);
  return st.isDirectory() ? join(input, 'snapshot.json') : input;
}

function bySlugAsc(a: { slug: string }, b: { slug: string }): number {
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

function main(): void {
  const { input, output } = parseArgs(process.argv.slice(2));
  const snapshot = JSON.parse(readFileSync(resolveInput(input), 'utf8')) as Snapshot;
  if (!Array.isArray(snapshot.protocols) || !Array.isArray(snapshot.watchlist) || typeof snapshot.as_of !== 'string') {
    fail('snapshot.json does not hold protocols, watchlist and as_of');
  }
  const watchlist = new Set(snapshot.watchlist);
  const ctx = { as_of: snapshot.as_of, multiples: MODEL.computeMultiples(snapshot.protocols) };

  const rows: BoardRow[] = [];
  const live: Array<Record<string, unknown>> = [];
  const setAside: Array<Record<string, unknown>> = [];

  for (const p of snapshot.protocols) {
    const screen = MODEL.screenProtocol(p);
    if (MODEL.hasToken(p)) {
      const multiple = typeof p.mcap_usd === 'number' && p.tvl_usd > 0 ? p.mcap_usd / p.tvl_usd : null;
      live.push({
        slug: p.slug, name: p.name, category: p.category, chains: p.chains,
        tvl_usd: p.tvl_usd, change_7d: p.change_7d, mcap_usd: p.mcap_usd,
        symbol: p.symbol, multiple
      });
      continue;
    }
    if (!screen.pass) {
      setAside.push({
        slug: p.slug, name: p.name, category: p.category, chains: p.chains,
        tvl_usd: p.tvl_usd, reasons: screen.reasons
      });
      continue;
    }
    const score = MODEL.scoreProtocol(p, ctx);
    const farmSteps: string[] = MODEL.farmPlan(p, ctx);
    rows.push({
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: score.implied_value_usd,
      farm_steps: farmSteps,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: score.age_days,
      multiple: score.multiple,
      multiple_basis: score.multiple_basis,
      multiple_n: score.multiple_n,
      category_median: score.category_median,
      growth_factor: score.growth_factor,
      age_factor: score.age_factor,
      chain_factor: score.chain_factor,
      watchlist: watchlist.has(p.slug)
    });
  }

  // Rank by implied value, highest first; slug order breaks ties so the
  // board is identical on every run.
  rows.sort((a, b) => (b.implied_value_usd - a.implied_value_usd) || bySlugAsc(a, b));
  rows.forEach((row, i) => { row.rank = i + 1; });
  live.sort((a, b) => {
    const am = typeof a.mcap_usd === 'number' ? (a.mcap_usd as number) : -1;
    const bm = typeof b.mcap_usd === 'number' ? (b.mcap_usd as number) : -1;
    return (bm - am) || bySlugAsc(a as { slug: string }, b as { slug: string });
  });
  setAside.sort((a, b) => ((b.tvl_usd as number) - (a.tvl_usd as number)) || bySlugAsc(a as { slug: string }, b as { slug: string }));

  // Gate-shape validation, loud before anything is written.
  if (rows.length < 100 || rows.length > 4000) fail(`board holds ${rows.length} rows, outside 100..4000`);
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.slug)) fail(`duplicate slug ${row.slug}`);
    seen.add(row.slug);
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) fail(`row ${row.slug} has a bad implied value`);
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) fail(`row ${row.slug} has ${row.farm_steps.length} farm steps`);
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) fail(`row ${row.slug} has a farm step of ${len} characters`);
    }
  }
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].implied_value_usd > rows[i - 1].implied_value_usd) fail('implied values rise with rank');
  }
  if (rows.length > 1 && rows.every((r) => r.implied_value_usd === rows[0].implied_value_usd)) {
    fail('all implied values are equal: not a ranking');
  }
  const missing = snapshot.watchlist.filter((slug) => !seen.has(slug));
  if (missing.length > 0) fail(`watchlist slugs missing from the board: ${missing.slice(0, 5).join(', ')}`);

  const multiples = ctx.multiples as {
    global: number;
    comps: number;
    byCategory: Record<string, { median: number; n: number; multiple: number }>;
  };
  const categoryMultiples = Object.keys(multiples.byCategory).sort().map((category) => ({
    category,
    median: multiples.byCategory[category].median,
    n: multiples.byCategory[category].n,
    multiple: multiples.byCategory[category].multiple
  }));

  const earlySize = rows.filter((r) => !r.watchlist).length;
  const board = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL.MODEL_VERSION as string,
    rows
  };
  const radar = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL.MODEL_VERSION as string,
    model: {
      constants: MODEL.CONSTANTS,
      global_multiple: multiples.global,
      comps: multiples.comps,
      by_category: categoryMultiples
    },
    board_size: rows.length,
    watchlist_size: snapshot.watchlist.length,
    early_size: earlySize,
    live_size: live.length,
    set_aside_size: setAside.length,
    rows,
    live,
    set_aside: setAside
  };

  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'board.json'), `${JSON.stringify(board)}\n`);
  writeFileSync(join(output, 'data.js'), `window.RADAR = ${JSON.stringify(radar)};\n`);

  const dashboardOut = join(output, 'dashboard');
  mkdirSync(dashboardOut, { recursive: true });
  cpSync(join(ROOT, 'dashboard'), dashboardOut, { recursive: true });
  // model.json carries only the computed multiples, rounded to six
  // decimals for the dossier text cap; the constants and the algorithm
  // are in dashboard/model.js, which the dossier shows whole.
  writeFileSync(join(dashboardOut, 'model.json'), `${JSON.stringify({
    model_version: MODEL.MODEL_VERSION,
    global_multiple: round6(multiples.global),
    comps: multiples.comps,
    category_multiples: categoryMultiples.map((e) => ({ category: e.category, median: round6(e.median), n: e.n, multiple: round6(e.multiple) }))
  })}\n`);

  const shotsDir = join(ROOT, 'screenshots');
  if (existsSync(shotsDir)) {
    cpSync(shotsDir, join(output, 'screenshots'), { recursive: true });
  }

  // The dossier is written last: the scorer rebuilds it from this /output
  // and compares bytes, so it must see the finished dashboard and shots.
  writeFileSync(join(output, 'dossier.json'), buildDossier(output, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 }
  }));

  process.stdout.write(
    `token radar: ${rows.length} rows (${snapshot.watchlist.length} watchlist, ${earlySize} early), ` +
    `${live.length} live, ${setAside.length} set aside; top ${rows[0].slug} at $${rows[0].implied_value_usd}\n`
  );
}

main();
