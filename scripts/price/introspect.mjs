#!/usr/bin/env node
/**
 * One-off: dump the real GraphQL schema exposed by the Shopee Affiliate API.
 *
 * Run this FIRST, before anything else. Field names in Shopee's affiliate schema
 * have changed between versions and differ slightly by country. This prints the
 * exact fields available to your account so fetch-prices.mjs can be locked to them.
 *
 *   SHOPEE_APP_ID=xxx SHOPEE_SECRET=yyy node scripts/price/introspect.mjs
 *
 * Writes the full schema to prices/_schema.json and prints a human-readable summary
 * of the product-offer types.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { gql } from './lib/shopee.mjs';

const INTROSPECTION = `
query IntrospectionQuery {
  __schema {
    queryType { name }
    types {
      kind
      name
      description
      fields(includeDeprecated: true) {
        name
        description
        args { name type { ...TypeRef } }
        type { ...TypeRef }
      }
      inputFields { name type { ...TypeRef } }
    }
  }
}
fragment TypeRef on __Type {
  kind name
  ofType { kind name ofType { kind name ofType { kind name } } }
}
`;

function typeName(t) {
  if (!t) return '?';
  if (t.kind === 'NON_NULL') return typeName(t.ofType) + '!';
  if (t.kind === 'LIST') return '[' + typeName(t.ofType) + ']';
  return t.name || '?';
}

const INTERESTING = /offer|product|node|shop|price|link/i;

async function main() {
  console.log(`Introspecting ${process.env.SHOPEE_ENDPOINT || 'open-api.affiliate.shopee.co.th'} ...`);

  const data = await gql(INTROSPECTION);
  const schema = data.__schema;

  await mkdir('prices', { recursive: true });
  await writeFile('prices/_schema.json', JSON.stringify(schema, null, 2));
  console.log('→ full schema written to prices/_schema.json\n');

  const queryTypeName = schema.queryType?.name || 'Query';
  const queryType = schema.types.find((t) => t.name === queryTypeName);

  console.log('='.repeat(70));
  console.log('AVAILABLE QUERIES');
  console.log('='.repeat(70));
  for (const f of queryType?.fields ?? []) {
    const args = (f.args ?? []).map((a) => `${a.name}: ${typeName(a.type)}`).join(', ');
    console.log(`  ${f.name}(${args}) : ${typeName(f.type)}`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('PRODUCT / OFFER TYPES  (use these exact field names)');
  console.log('='.repeat(70));
  for (const t of schema.types) {
    if (!t.name || t.name.startsWith('__')) continue;
    if (t.kind !== 'OBJECT') continue;
    if (!INTERESTING.test(t.name)) continue;

    console.log(`\n  type ${t.name} {`);
    for (const f of t.fields ?? []) {
      console.log(`    ${f.name}: ${typeName(f.type)}`);
    }
    console.log('  }');
  }

  console.log(
    '\nDone. Compare the fields above with PRODUCT_FIELDS in scripts/price/fetch-prices.mjs\n' +
      'and edit that list if any name differs.'
  );
}

main().catch((err) => {
  console.error('\n✗ ' + err.message);
  process.exit(1);
});
