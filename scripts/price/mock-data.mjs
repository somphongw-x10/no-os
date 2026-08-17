#!/usr/bin/env node
/**
 * Generate fake price history so the widget can be seen and tested before the
 * Shopee API is wired up.
 *
 *   node scripts/price/mock-data.mjs            # mock the first 8 real products
 *   node scripts/price/mock-data.mjs --all      # mock every product on the site
 *   node scripts/price/mock-data.mjs --clean    # remove all mock data again
 *
 * It reads the real shopeeUrls out of articles.json → data/*.json and assigns
 * each one a synthetic itemId prefixed 99999, so prices/products.json has the
 * same shape the real seeder produces and build.py can be tested end to end.
 * Mock entries carry "mock": true and "enabled": false, so the live fetcher
 * never calls the API for them.
 */

import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';

const args = process.argv.slice(2);
const CLEAN = args.includes('--clean');
const ALL = args.includes('--all');
const DAYS = 90;

function dateNDaysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// Deterministic PRNG — the same product always gets the same chart, so a repeat
// run produces no spurious git diff.
function rng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** "409 บาท" → 409 */
function parsePrice(text) {
  const m = String(text || '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

async function readJson(p, fallback) {
  try {
    return JSON.parse(await readFile(p, 'utf8'));
  } catch {
    return fallback;
  }
}

async function clean() {
  let removed = 0;
  try {
    for (const f of await readdir('prices/history')) {
      if (f.startsWith('99999')) {
        await rm(`prices/history/${f}`, { force: true });
        removed++;
      }
    }
  } catch {
    /* nothing to clean */
  }

  const cat = await readJson('prices/products.json', null);
  if (cat) {
    cat.products = (cat.products ?? []).filter((p) => !p.mock);
    cat.count = cat.products.length;
    await writeFile('prices/products.json', JSON.stringify(cat, null, 2));
  }

  console.log(`✓ removed ${removed} mock history file(s) and all mock catalogue entries`);
  console.log('  run: node scripts/price/build-summary.mjs   (or delete prices/latest.json)');
}

async function main() {
  if (CLEAN) return clean();

  const articles = await readJson('articles.json', null);
  if (!articles) throw new Error('articles.json not found — run this from the repo root');

  // Collect real products from the site's own content.
  const seen = new Map();
  for (const art of articles) {
    const data = await readJson(art.data, null);
    for (const p of data?.products ?? []) {
      if (!p.shopeeUrl || seen.has(p.shopeeUrl)) continue;
      seen.set(p.shopeeUrl, { shopeeUrl: p.shopeeUrl, label: p.name, price: parsePrice(p.price), article: art.url });
    }
  }

  let picked = [...seen.values()].filter((p) => p.price);
  if (!ALL) picked = picked.slice(0, 8);

  if (!picked.length) throw new Error('found no products with a parseable price');

  await mkdir('prices/history', { recursive: true });

  const catalogue = (await readJson('prices/products.json', null)) ?? { products: [] };
  const byUrl = new Map((catalogue.products ?? []).map((p) => [p.shopeeUrl, p]));

  for (const item of picked) {
    const seed = hash(item.shopeeUrl);
    const rand = rng(seed);
    const itemId = '99999' + String(seed % 100000).padStart(5, '0');

    const vol = 0.04 + (seed % 10) / 100;      // 4–13% day-to-day noise
    const trend = ((seed % 21) - 10) / 60;     // −17% … +17% over the window
    const points = [];

    for (let i = DAYS - 1; i >= 0; i--) {
      const progress = (DAYS - 1 - i) / (DAYS - 1);
      const flash = i === 12 + (seed % 20) ? 0.83 : 1; // one flash sale per product
      const price = Math.max(
        1,
        Math.round((item.price * (1 + trend * progress) * (1 + (rand() - 0.5) * 2 * vol) * flash) / 5) * 5
      );
      points.push({ d: dateNDaysAgo(i), p: price });
    }

    // Give roughly a third of them a genuine all-time low today so the badge is
    // visible in the demo without being on every single card.
    if (seed % 3 === 0) {
      points[points.length - 1].p = Math.min(...points.map((p) => p.p)) - 5;
    }

    await writeFile(
      `prices/history/${itemId}.json`,
      JSON.stringify({
        itemId,
        shopId: '9999999',
        label: item.label,
        meta: { productName: item.label, offerLink: item.shopeeUrl, shopName: null, imageUrl: null },
        points,
      })
    );

    byUrl.set(item.shopeeUrl, {
      shopeeUrl: item.shopeeUrl,
      itemId,
      shopId: '9999999',
      label: item.label,
      staticPrice: item.price + ' บาท',
      articles: [item.article],
      enabled: false, // never hit the real API for a mock entry
      mock: true,
    });
  }

  catalogue.products = [...byUrl.values()];
  catalogue.count = catalogue.products.length;
  catalogue.updatedAt = new Date().toISOString();
  await writeFile('prices/products.json', JSON.stringify(catalogue, null, 2));

  console.log(`✓ ${picked.length} mock products × ${DAYS} days`);
  console.log('  next: node scripts/price/build-summary.mjs && python3 build.py');
  console.log('  undo: node scripts/price/mock-data.mjs --clean');
}

main().catch((err) => {
  console.error('✗ ' + err.message);
  process.exit(1);
});
