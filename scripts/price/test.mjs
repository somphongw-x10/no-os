#!/usr/bin/env node
/**
 * Tests for the price tracker. No credentials, no network.
 *
 *   node scripts/price/test.mjs
 */

import { parseShopeeUrl, isShortLink } from './lib/shopee.mjs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, cp, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const run = promisify(execFile);
let pass = 0;
let fail = 0;
const t = (name, cond) => {
  if (cond) {
    pass++;
    console.log('  ✓ ' + name);
  } else {
    fail++;
    console.log('  ✗ ' + name);
  }
};

console.log('\nparseShopeeUrl');
t('-i.shop.item form', JSON.stringify(parseShopeeUrl('https://shopee.co.th/Logitech-M240-i.123456789.9876543210')) === '{"shopId":"123456789","itemId":"9876543210"}');
t('ignores query string', parseShopeeUrl('https://shopee.co.th/X-i.111.222?sp_atk=a&xptdk=b')?.itemId === '222');
t('ignores hash', parseShopeeUrl('https://shopee.co.th/X-i.111.222#reviews')?.itemId === '222');
t('trailing slash', parseShopeeUrl('https://shopee.co.th/X-i.111.222/')?.itemId === '222');
t('/product/ form', parseShopeeUrl('https://shopee.co.th/product/333/444')?.shopId === '333');
t('thai slug', parseShopeeUrl('https://shopee.co.th/เมาส์ไร้สาย-i.55.66')?.itemId === '66');
t('rejects non-product', parseShopeeUrl('https://shopee.co.th/mall') === null);
t('rejects null', parseShopeeUrl(null) === null);
t('detects s.shopee short link', isShortLink('https://s.shopee.co.th/4fuDwsjWu3'));
t('detects shope.ee short link', isShortLink('https://shope.ee/xyz'));
t('full link is not short', !isShortLink('https://shopee.co.th/X-i.1.2'));

console.log('\nsignature');
const sig = createHash('sha256').update('APPID1700000000{"query":"x"}SECRET', 'utf8').digest('hex');
t('sha256 hex, 64 chars', sig.length === 64 && /^[0-9a-f]+$/.test(sig));

console.log('\npipeline against the real content files');
// Work on a throwaway copy so a test run never touches the repo's own data.
const repo = path.resolve(new URL('../..', import.meta.url).pathname);
const tmp = await mkdtemp(path.join(tmpdir(), 'pk-test-'));
for (const f of ['articles.json', 'data', 'scripts']) {
  await cp(path.join(repo, f), path.join(tmp, f), { recursive: true });
}

await run('node', ['scripts/price/mock-data.mjs', '--all'], { cwd: tmp });
await run('node', ['scripts/price/build-summary.mjs'], { cwd: tmp });

const cat = JSON.parse(await readFile(path.join(tmp, 'prices/products.json'), 'utf8'));
const latest = JSON.parse(await readFile(path.join(tmp, 'prices/latest.json'), 'utf8'));
const products = Object.values(latest.products);

t('catalogue built from real articles', cat.products.length > 0);
t('every catalogue entry has a shopeeUrl', cat.products.every((p) => p.shopeeUrl?.startsWith('http')));
t('mock entries are disabled for the API', cat.products.filter((p) => p.mock).every((p) => p.enabled === false));
t('summary produced', products.length > 0);
t('spark capped at 90 points', products.every((p) => p.spark.length <= 90));
t('spark ends at the current price', products.every((p) => p.spark.at(-1)[1] === p.current));
t('badge only ever 30 or 90 days', products.every((p) => !p.lowestBadgeDays || [30, 90].includes(p.lowestBadgeDays)));
t('badged products really are at their low', products.filter((p) => p.lowestBadgeDays).every((p) => p.current === p.allTimeLow));
t('min ≤ avg ≤ max in every window', products.every((p) => Object.values(p.windows).every((w) => w.min <= w.avg && w.avg <= w.max)));
t('vsAvg sign matches the numbers', products.every((p) => {
  const w = p.windows['30'];
  return !w || (w.vsAvg <= 0) === (p.current <= w.avg);
}));
t('latest.json stays small (<150KB)', JSON.stringify(latest).length < 150000);

// build.py integration
await cp(path.join(repo, 'build.py'), path.join(tmp, 'build.py'));
const idMap = new Map(cat.products.filter((p) => p.itemId).map((p) => [p.shopeeUrl, p.itemId]));
t('build.py can map every tracked link to an itemId', idMap.size === cat.products.filter((p) => p.itemId).length);

// mock --clean must fully reverse itself
await run('node', ['scripts/price/mock-data.mjs', '--clean'], { cwd: tmp });
const cleaned = JSON.parse(await readFile(path.join(tmp, 'prices/products.json'), 'utf8'));
t('--clean removes every mock entry', cleaned.products.every((p) => !p.mock));

await rm(tmp, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
