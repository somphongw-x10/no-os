/**
 * Shopee Affiliate Open API client (Thailand)
 *
 * Auth scheme (per Shopee Affiliate Open API docs):
 *   Signature = SHA256( AppId + Timestamp + Payload + Secret )
 *   Header:    Authorization: SHA256 Credential=<AppId>, Timestamp=<ts>, Signature=<sig>
 *
 * `Payload` must be the EXACT JSON string sent as the request body — byte for byte.
 * That is why we stringify once and reuse the same string for both signing and sending.
 */

import { createHash } from 'node:crypto';

export const ENDPOINT =
  process.env.SHOPEE_ENDPOINT || 'https://open-api.affiliate.shopee.co.th/graphql';

const APP_ID = process.env.SHOPEE_APP_ID;
const SECRET = process.env.SHOPEE_SECRET;

export function assertCredentials() {
  if (!APP_ID || !SECRET) {
    throw new Error(
      'Missing credentials. Set SHOPEE_APP_ID and SHOPEE_SECRET.\n' +
        'Get them at https://affiliate.shopee.co.th/open_api/list'
    );
  }
}

function sign(payload, timestamp) {
  return createHash('sha256')
    .update(APP_ID + timestamp + payload + SECRET, 'utf8')
    .digest('hex');
}

/**
 * Execute a GraphQL request against the Shopee Affiliate API.
 * Retries on transient failures with exponential backoff.
 */
export async function gql(query, variables = undefined, { retries = 3 } = {}) {
  assertCredentials();

  const body = variables === undefined ? { query } : { query, variables };
  const payload = JSON.stringify(body);

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const waitMs = 1000 * 2 ** (attempt - 1);
      await sleep(waitMs);
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const signature = sign(payload, timestamp);

    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `SHA256 Credential=${APP_ID}, Timestamp=${timestamp}, Signature=${signature}`,
        },
        body: payload,
      });
    } catch (err) {
      lastErr = new Error(`Network error: ${err.message}`);
      continue;
    }

    const text = await res.text();

    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      continue;
    }

    if (!res.ok) {
      // 4xx other than 429 will not get better by retrying.
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 800)}`);
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Response was not JSON: ${text.slice(0, 300)}`);
    }

    if (json.errors?.length) {
      const msg = json.errors.map((e) => e.message).join(' | ');
      // Signature errors are deterministic — fail loudly instead of hammering the API.
      if (/signature|credential|unauthor/i.test(msg)) {
        throw new Error(
          `Shopee API auth error: ${msg}\n` +
            'Check SHOPEE_APP_ID / SHOPEE_SECRET, and that your server clock is correct.'
        );
      }
      lastErr = new Error(`GraphQL error: ${msg}`);
      continue;
    }

    return json.data;
  }

  throw lastErr ?? new Error('Request failed for an unknown reason');
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Parse shopId / itemId out of a Shopee product URL.
 *
 * Handles:
 *   https://shopee.co.th/Some-Product-Name-i.123456789.9876543210
 *   https://shopee.co.th/product/123456789/9876543210
 *   https://shopee.co.th/Name-i.123.456?sp_atk=...   (query string ignored)
 *
 * Short links (s.shopee.co.th/xxxx) cannot be parsed offline — they must be
 * resolved with a HTTP request first; see resolveShortLink().
 */
export function parseShopeeUrl(url) {
  if (typeof url !== 'string') return null;
  const clean = url.split('?')[0].split('#')[0];

  const iForm = clean.match(/-i\.(\d+)\.(\d+)\/?$/);
  if (iForm) return { shopId: iForm[1], itemId: iForm[2] };

  const productForm = clean.match(/\/product\/(\d+)\/(\d+)\/?$/);
  if (productForm) return { shopId: productForm[1], itemId: productForm[2] };

  return null;
}

export function isShortLink(url) {
  return /^https?:\/\/(s\.shopee\.|shp\.ee|shope\.ee)/i.test(url || '');
}

/** Follow redirects on a Shopee short link to recover the canonical product URL. */
export async function resolveShortLink(url) {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    return res.url || null;
  } catch {
    return null;
  }
}
