#!/usr/bin/env node
/**
 * Daily job: read prices/products.json, ask the Shopee Affiliate API for the
 * current price of each product, and append one dated point per product to
 * prices/history/<itemId>.json
 *
 *   SHOPEE_APP_ID=xxx SHOPEE_SECRET=yyy node scripts/price/fetch-prices.mjs
 *
 * Flags:
 *   --dry     don't write anything, just print what would happen
 *   --only 123456   fetch a single itemId (handy while debugging)
 *
 * Design notes:
 *  - One point per product per UTC day. Re-running the same day OVERWRITES that
 *    day's point rather than appending a duplicate, so a retried workflow is safe.
 *  - A product that fails is skipped, not fatal. Losing one SKU must never cost
 *    us the whole day's data for the other 29.
 *  - History is append-only JSON per product: small files, cheap git diffs,
 *    and the front-end can fetch just the one it needs.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { gql, sleep } from './lib/shopee.mjs';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

/**
 * Fields requested from productOfferV2.
 * ⚠️ Run `node scripts/price/introspect.mjs` once and confirm these names against your
 * account's real schema. If a name is wrong the API returns a GraphQL error that
 * names the offending field — just remove or rename it here.
 */
const PRODUCT_FIELDS = `
  itemId
  shopId
  productName
  priceMin
  priceMax
  priceDiscountRate
  imageUrl
  productLink
  offerLink
  commissionRate
  sales
  ratingStar
  shopName
`;

const QUERY = `
query ProductOffer($itemId: Int64!, $shopId: Int64!) {
  productOfferV2(itemId: $itemId, shopId: $shopId, page: 1, limit: 1) {
    nodes { ${PRODUCT_FIELDS} }
  }
}
`;

/** Shopee returns prices as strings sometimes, numbers other times. Normalise. */
function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function fetchOne(product) {
  const data = await gql(QUERY, {
    itemId: Number(product.itemId),
    shopId: Number(product.shopId),
  });

  const node = data?.productOfferV2?.nodes?.[0];
  if (!node) return null;

  const priceMin = toNumber(node.priceMin);
  const priceMax = toNumber(node.priceMax);
  // For a single-variant listing priceMin === priceMax. For multi-variant we track
  // the floor, because that is the number a shopper sees on the listing card.
  const price = priceMin ?? priceMax;
  if (price === null) return null;

  return {
    price,
    priceMin,
    priceMax,
    discountRate: toNumber(node.priceDiscountRate),
    commissionRate: toNumber(node.commissionRate),
    sales: toNumber(node.sales),
    rating: toNumber(node.ratingStar),
    meta: {
      productName: node.productName ?? null,
      shopName: node.shopName ?? null,
      imageUrl: node.imageUrl ?? null,
      offerLink: node.offerLink ?? null,
      productLink: node.productLink ?? null,
    },
  };
}

async function main() {
  const catalogue = await readJson('prices/products.json', null);
  if (!catalogue?.products?.length) {
    throw new Error('prices/products.json is missing or empty — run scripts/price/seed-products.mjs first');
  }

  let products = catalogue.products.filter((p) => p.enabled !== false);
  if (ONLY) products = products.filter((p) => String(p.itemId) === String(ONLY));

  const date = todayUTC();
  console.log(`Fetching ${products.length} product(s) for ${date}${DRY ? ' [DRY RUN]' : ''}\n`);

  await mkdir('prices/history', { recursive: true });

  let ok = 0;
  let failed = 0;
  const failures = [];

  for (const [i, product] of products.entries()) {
    const tag = `[${i + 1}/${products.length}] ${product.label || product.itemId}`;

    let result;
    try {
      result = await fetchOne(product);
    } catch (err) {
      failed++;
      failures.push({ itemId: product.itemId, error: err.message });
      console.warn(`  ✗ ${tag} — ${err.message.split('\n')[0]}`);
      await sleep(1200);
      continue;
    }

    if (!result) {
      failed++;
      failures.push({ itemId: product.itemId, error: 'no offer returned (delisted or out of catalogue?)' });
      console.warn(`  ✗ ${tag} — no offer returned`);
      await sleep(1200);
      continue;
    }

    const file = `prices/history/${product.itemId}.json`;
    const history = await readJson(file, {
      itemId: product.itemId,
      shopId: product.shopId,
      points: [],
    });

    history.shopId = product.shopId;
    history.label = product.label ?? history.label ?? result.meta.productName ?? null;
    history.meta = result.meta;

    const point = {
      d: date,
      p: result.price,
      ...(result.discountRate ? { dr: result.discountRate } : {}),
      ...(result.sales !== null ? { s: result.sales } : {}),
      ...(result.rating !== null ? { r: result.rating } : {}),
    };

    // One point per day — replace instead of appending on a same-day re-run.
    const existingIdx = history.points.findIndex((pt) => pt.d === date);
    if (existingIdx >= 0) history.points[existingIdx] = point;
    else history.points.push(point);

    history.points.sort((a, b) => a.d.localeCompare(b.d));

    if (!DRY) await writeFile(file, JSON.stringify(history));

    ok++;
    console.log(`  ✓ ${tag} — ${result.price.toLocaleString('th-TH')}฿ (${history.points.length} points)`);

    await sleep(1200); // stay well under the API rate limit
  }

  console.log(`\n${ok} ok, ${failed} failed`);

  if (!DRY) {
    await writeFile(
      'prices/_last-run.json',
      JSON.stringify({ date, ranAt: new Date().toISOString(), ok, failed, failures }, null, 2)
    );
  }

  // A handful of dead SKUs is normal. Everything failing means auth or schema is broken.
  if (ok === 0 && products.length > 0) {
    throw new Error('Every product failed — check credentials and the field list in PRODUCT_FIELDS');
  }
}

main().catch((err) => {
  console.error('\n✗ ' + err.message);
  process.exit(1);
});
