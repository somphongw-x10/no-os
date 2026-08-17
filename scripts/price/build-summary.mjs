#!/usr/bin/env node
/**
 * Turn the raw per-product history into ONE small file the front-end can fetch:
 * prices/latest.json
 *
 *   node scripts/build-summary.mjs
 *
 * For each product it computes, over 7 / 30 / 90 day windows:
 *   min, max, avg, and whether today's price is the lowest in that window.
 *
 * It also emits a downsampled 90-point series for the sparkline so the browser
 * never has to download the full history.
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';

const WINDOWS = [7, 30, 90];
/** Windows eligible for the "lowest in N days" badge, longest first. */
const BADGE_WINDOWS = [90, 30];
const SPARK_POINTS = 90;

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function stats(points) {
  if (!points.length) return null;
  const prices = points.map((p) => p.p);
  const sum = prices.reduce((a, b) => a + b, 0);
  return {
    min: Math.min(...prices),
    max: Math.max(...prices),
    avg: Math.round((sum / prices.length) * 100) / 100,
    n: prices.length,
  };
}

/**
 * Evenly downsample to at most `max` points, always keeping the first and last
 * so the sparkline's endpoints match the real start and current price.
 */
function downsample(points, max) {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

function pct(a, b) {
  if (!b) return null;
  return Math.round(((a - b) / b) * 1000) / 10; // one decimal
}

async function main() {
  let files;
  try {
    files = (await readdir('prices/history')).filter((f) => f.endsWith('.json'));
  } catch {
    throw new Error('prices/history/ not found — run scripts/price/fetch-prices.mjs first');
  }

  if (!files.length) throw new Error('No price history yet — run scripts/price/fetch-prices.mjs first');

  const catalogue = JSON.parse(await readFile('prices/products.json', 'utf8')).products ?? [];
  const labelById = new Map(catalogue.map((p) => [String(p.itemId), p.label]));

  const out = {};
  let skipped = 0;

  for (const file of files) {
    const history = JSON.parse(await readFile(`prices/history/${file}`, 'utf8'));
    const points = (history.points ?? []).filter((p) => typeof p.p === 'number');
    if (!points.length) {
      skipped++;
      continue;
    }

    const current = points.at(-1);
    const previous = points.at(-2) ?? null;

    const windows = {};
    for (const w of WINDOWS) {
      const cutoff = daysAgo(w);
      const inWindow = points.filter((p) => p.d >= cutoff);
      const s = stats(inWindow);
      if (!s) continue;
      windows[w] = {
        ...s,
        // "Lowest in N days" only means something once we actually have N days of
        // data. Below ~60% coverage we still report it but flag it as partial, and
        // the widget refuses to show the badge.
        isLowest: current.p <= s.min,
        coverage: Math.round((s.n / w) * 100) / 100,
        vsAvg: pct(current.p, s.avg),
      };
    }

    // The headline badge: the longest window we have solid data for, where today is the low.
    // Deliberately capped at 30+ days — "lowest in 7 days" is technically true but
    // reads as hype, and one over-claimed badge costs more trust than it earns clicks.
    let bestBadge = null;
    for (const w of BADGE_WINDOWS) {
      const win = windows[w];
      if (win && win.isLowest && win.coverage >= 0.6 && win.n >= 14) {
        bestBadge = w;
        break;
      }
    }

    out[history.itemId] = {
      itemId: history.itemId,
      shopId: history.shopId,
      label: labelById.get(String(history.itemId)) ?? history.label ?? null,
      current: current.p,
      currentDate: current.d,
      previous: previous ? previous.p : null,
      changeFromPrevious: previous ? pct(current.p, previous.p) : null,
      firstSeen: points[0].d,
      totalPoints: points.length,
      windows,
      lowestBadgeDays: bestBadge,
      allTimeLow: Math.min(...points.map((p) => p.p)),
      allTimeHigh: Math.max(...points.map((p) => p.p)),
      offerLink: history.meta?.offerLink ?? history.meta?.productLink ?? null,
      spark: downsample(points, SPARK_POINTS).map((p) => [p.d, p.p]),
    };
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    currency: 'THB',
    productCount: Object.keys(out).length,
    products: out,
  };

  await writeFile('prices/latest.json', JSON.stringify(payload));

  const badged = Object.values(out).filter((p) => p.lowestBadgeDays);
  console.log(`✓ prices/latest.json — ${payload.productCount} products${skipped ? `, ${skipped} skipped (no data)` : ''}`);
  console.log(`  ${badged.length} currently at their lowest price:`);
  for (const p of badged.slice(0, 10)) {
    console.log(`    · ${p.label || p.itemId} — ${p.current.toLocaleString('th-TH')}฿ (ถูกสุดใน ${p.lowestBadgeDays} วัน)`);
  }
}

main().catch((err) => {
  console.error('\n✗ ' + err.message);
  process.exit(1);
});
