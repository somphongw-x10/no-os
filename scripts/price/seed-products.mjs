#!/usr/bin/env node
/**
 * Build prices/products.json from the site's own content files.
 *
 * Source of truth is articles.json → data/*.json → products[].shopeeUrl
 * (no HTML crawling: the JSON already has every link, plus the product name,
 * the hand-written price and which article it belongs to).
 *
 * Every shopeeUrl on this site is a short link (s.shopee.co.th/xxxx), which
 * carries no ids, so each one has to be followed once to recover
 * shopId / itemId. Resolved ids are cached in the output file and never
 * re-resolved, so repeat runs only touch links that are actually new.
 *
 *   node scripts/price/seed-products.mjs
 *   node scripts/price/seed-products.mjs --force   re-resolve every link
 *
 * Needs network access → run it locally or via the seed-products workflow.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseShopeeUrl, isShortLink, resolveShortLink, sleep } from './lib/shopee.mjs';

const FORCE = process.argv.includes('--force');
const OUT = 'prices/products.json';

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function main() {
  const articles = await readJson('articles.json', null);
  if (!articles) throw new Error('articles.json not found — run this from the repo root');

  const previous = await readJson(OUT, { products: [] });
  const byUrl = new Map(previous.products.map((p) => [p.shopeeUrl, p]));

  // ---- collect every product reference from the content files -------------
  const refs = [];
  for (const art of articles) {
    const data = await readJson(art.data, null);
    if (!data) {
      console.warn(`  ! ${art.data} unreadable — skipped`);
      continue;
    }
    for (const p of data.products ?? []) {
      if (!p.shopeeUrl) continue;
      refs.push({
        shopeeUrl: p.shopeeUrl,
        name: p.name,
        staticPrice: p.price ?? null,
        rank: p.rank ?? null,
        article: art.url,
        dataFile: art.data,
      });
    }
  }

  // One product can appear in several articles — group by link.
  const grouped = new Map();
  for (const r of refs) {
    const g = grouped.get(r.shopeeUrl);
    if (g) {
      g.articles.push(r.article);
    } else {
      grouped.set(r.shopeeUrl, {
        shopeeUrl: r.shopeeUrl,
        label: r.name,
        staticPrice: r.staticPrice,
        articles: [r.article],
      });
    }
  }

  console.log(
    `${refs.length} product references across ${articles.length} articles → ${grouped.size} unique links\n`
  );

  // ---- resolve short links to shopId / itemId -----------------------------
  const out = [];
  let resolved = 0;
  let cached = 0;
  let failed = 0;

  for (const [i, g] of [...grouped.values()].entries()) {
    const prev = byUrl.get(g.shopeeUrl);
    const tag = `[${i + 1}/${grouped.size}] ${g.label}`;

    if (prev?.itemId && !FORCE) {
      out.push({ ...prev, label: g.label, staticPrice: g.staticPrice, articles: g.articles });
      cached++;
      continue;
    }

    let target = g.shopeeUrl;
    if (isShortLink(target)) {
      target = (await resolveShortLink(target)) || target;
      await sleep(700); // one redirect every 0.7s — polite, and avoids tripping rate limits
    }

    const ids = parseShopeeUrl(target);
    if (!ids) {
      failed++;
      console.warn(`  ✗ ${tag} — could not resolve → ${target}`);
      // Keep the entry so the link is visible in the file and can be fixed by hand.
      out.push({
        shopeeUrl: g.shopeeUrl,
        itemId: null,
        shopId: null,
        label: g.label,
        staticPrice: g.staticPrice,
        articles: g.articles,
        enabled: false,
        note: 'unresolved — add itemId/shopId by hand or check the link',
      });
      continue;
    }

    resolved++;
    console.log(`  ✓ ${tag} — ${ids.shopId}.${ids.itemId}`);
    out.push({
      shopeeUrl: g.shopeeUrl,
      itemId: ids.itemId,
      shopId: ids.shopId,
      label: g.label,
      staticPrice: g.staticPrice,
      articles: g.articles,
      enabled: prev?.enabled ?? true,
    });
  }

  await mkdir('prices', { recursive: true });
  await writeFile(
    OUT,
    JSON.stringify(
      { updatedAt: new Date().toISOString(), count: out.length, products: out },
      null,
      2
    )
  );

  console.log(`\n✓ ${OUT} — ${resolved} newly resolved, ${cached} from cache, ${failed} failed`);
  if (failed) {
    console.log('  Unresolved links are saved with "enabled": false so nothing breaks —');
    console.log('  open the file and fill in itemId/shopId by hand, or fix the link in data/*.json');
  }
}

main().catch((err) => {
  console.error('\n✗ ' + err.message);
  process.exit(1);
});
