function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function renderBreadcrumb(items, currentLabel) {
  const div = el('div', 'crumb');
  items.forEach(b => {
    const a = el('a', '', b.label);
    a.href = b.href;
    div.appendChild(a);
    div.appendChild(el('span', 'sep', '/'));
  });
  div.appendChild(document.createTextNode(currentLabel));
  return div;
}

function renderHero(meta) {
  const h = el('header', 'hero');
  h.appendChild(el('h1', '', meta.title));
  h.appendChild(el('p', 'lead', meta.description));
  h.appendChild(el('span', 'updated', `อัปเดต ${meta.updatedDate}`));
  return h;
}

function renderGuide(guide) {
  if (!guide || guide.length === 0) return null;
  const sec = el('section', 'section guide-section');
  guide.forEach(block => {
    if (block.heading) sec.appendChild(el('h2', '', block.heading));
    if (block.image) {
      const img = document.createElement('img');
      img.src = block.image;
      img.alt = block.imageAlt || block.heading || '';
      img.loading = 'lazy';
      img.className = 'guide-img';
      sec.appendChild(img);
    }
    if (block.paragraphs) {
      block.paragraphs.forEach(p => sec.appendChild(el('p', 'guide-p', p)));
    }
    if (block.list) {
      const ul = el('ul', 'guide-list');
      block.list.forEach(li => { ul.innerHTML += `<li>${li}</li>`; });
      sec.appendChild(ul);
    }
  });
  return sec;
}

function renderTable(products) {
  const sec = el('section', 'section');
  sec.appendChild(el('h2', '', 'สรุปเร็ว ถ้าไม่อยากอ่านทั้งหมด'));
  const table = el('table', 'qtable');
  table.innerHTML = `<thead><tr><th>รุ่น</th><th>ราคา</th><th>เด่น</th><th>เหมาะกับ</th></tr></thead>`;
  const tbody = el('tbody');
  products.forEach(p => {
    tbody.innerHTML += `<tr>
      <td>${p.name}</td>
      <td class="pricetag">${p.price}</td>
      <td>${p.tableTag}</td>
      <td>${p.tableWho}</td>
    </tr>`;
  });
  table.appendChild(tbody);
  sec.appendChild(table);
  return sec;
}

function renderImage(src, alt) {
  const wrap = el('div', 'card-img');
  if (src) {
    const img = document.createElement('img');
    img.alt = alt;
    img.loading = 'lazy';
    img.onerror = function() {
      this.parentNode.innerHTML = `<div class="img-placeholder">
        <svg width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
          <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
          <path d="m21 15-5-5L5 21"/>
        </svg><span>วางรูปสินค้าที่นี่</span></div>`;
    };
    img.src = src;
    wrap.appendChild(img);
  } else {
    wrap.innerHTML = `<div class="img-placeholder">
      <svg width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
        <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
        <path d="m21 15-5-5L5 21"/>
      </svg><span>วางรูปสินค้าที่นี่</span></div>`;
  }
  return wrap;
}

function renderCard(p) {
  const card = el('article', 'card');
  const inner = el('div', 'card-inner');
  inner.appendChild(renderImage(p.image, p.name));
  const body = el('div', 'card-body');
  body.innerHTML = `
    <div class="card-head">
      <h3><span class="rank">${p.rank}</span>${p.name}</h3>
      <div class="price-tag">ราคา Shopee: <b>${p.price}</b></div>
    </div>
    <p class="desc">${p.summary}</p>`;
  const ul = el('ul', 'specs');
  p.specs.forEach(s => { ul.innerHTML += `<li><span>${s.label}</span><span>${s.value}</span></li>`; });
  body.appendChild(ul);
  const pc = el('div', 'pros-cons');
  pc.innerHTML = `
    <div class="pros"><div class="t">ข้อดี</div><ul>${p.pros.map(x=>`<li>${x}</li>`).join('')}</ul></div>
    <div class="cons"><div class="t">ข้อเสีย</div><ul>${p.cons.map(x=>`<li>${x}</li>`).join('')}</ul></div>`;
  body.appendChild(pc);
  body.appendChild(el('div', 'fit', `<b>เหมาะสำหรับ:</b> ${p.bestFor}`));
  const btn = el('a', 'btn', 'ดูราคาล่าสุดบน Shopee →');
  btn.href = p.shopeeUrl;
  btn.target = '_blank';
  btn.rel = 'sponsored noopener';
  body.appendChild(btn);
  inner.appendChild(body);
  card.appendChild(inner);
  return card;
}

function renderProducts(products) {
  const sec = el('section', 'section');
  sec.appendChild(el('h2', '', 'เปรียบเทียบทีละรุ่น'));
  products.forEach(p => sec.appendChild(renderCard(p)));
  return sec;
}

function renderVerdict(items) {
  const sec = el('section', 'section');
  const v = el('div', 'verdict');
  v.appendChild(el('h2', '', 'สรุป — ซื้อรุ่นไหนดี?'));
  const ul = el('ul');
  items.forEach(i => { ul.innerHTML += `<li><b>${i.condition}</b> → ${i.pick}</li>`; });
  v.appendChild(ul);
  sec.appendChild(v);
  sec.innerHTML += `<p class="disclaim">ราคาอาจเปลี่ยนแปลงตามโปรโมชั่นและคูปอง Shopee — เช็คหน้าร้านก่อนซื้อเสมอ • บทความนี้มีลิงก์ affiliate เมื่อคุณซื้อผ่านลิงก์ เราอาจได้รับค่าคอมมิชชั่นโดยที่คุณไม่ต้องจ่ายเพิ่ม</p>`;
  return sec;
}

function renderRelated(related) {
  if (!related || related.length === 0) return null;
  const sec = el('section', 'section');
  sec.appendChild(el('h2', '', 'บทความที่เกี่ยวข้อง'));
  const grid = el('div', 'related-grid');
  related.forEach(r => {
    const a = el('a', 'related-card', `
      <div class="related-cat">${r.category}</div>
      <div class="related-title">${r.title}</div>
      <div class="related-cta">อ่านเพิ่มเติม →</div>
    `);
    a.href = r.url;
    grid.appendChild(a);
  });
  sec.appendChild(grid);
  return sec;
}

function renderFAQ(faq) {
  if (!faq || faq.length === 0) return null;
  const sec = el('section', 'section faq-section');
  sec.appendChild(el('h2', '', 'คำถามที่พบบ่อย (FAQ)'));
  faq.forEach(item => {
    const wrap = el('div', 'faq-item');
    wrap.appendChild(el('h3', 'faq-q', item.q));
    const a = el('div', 'faq-a');
    a.innerHTML = item.a;
    wrap.appendChild(a);
    sec.appendChild(wrap);
  });
  return sec;
}

async function render(dataFile) {
  const res = await fetch(dataFile);
  const data = await res.json();
  const { meta, guide, products, verdict, related, faq } = data;

  const canonical = document.querySelector('link[rel="canonical"]');
  const canonicalUrl = canonical ? canonical.href : location.href;

  const ogImage = document.querySelector('meta[property="og:image"]');
  const imageUrl = ogImage ? ogImage.content : null;
  const today = new Date().toISOString().split('T')[0];
  const datePublished = meta.datePublished || today;
  const dateModified = meta.dateModified || meta.datePublished || today;

  document.querySelector('meta[name="description"]').content = meta.description;

  // JSON-LD
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        "itemListElement": [
          ...meta.breadcrumb.map((b, i) => ({
            "@type": "ListItem", "position": i+1, "name": b.label,
            "item": `https://pick.no-os.com${b.href}`
          })),
          { "@type": "ListItem", "position": meta.breadcrumb.length+1, "name": meta.title }
        ]
      },
      {
        "@type": "Article",
        "headline": meta.title,
        "description": meta.description,
        ...(imageUrl ? { "image": imageUrl } : {}),
        "datePublished": datePublished,
        "dateModified": dateModified,
        "publisher": { "@type": "Organization", "name": "no-os.com", "url": "https://pick.no-os.com" },
        "mainEntityOfPage": { "@type": "WebPage", "@id": canonicalUrl }
      },
      ...(products && products.length ? [{
        "@type": "ItemList",
        "name": meta.title,
        "numberOfItems": products.length,
        "itemListElement": products.map((p, i) => ({
          "@type": "ListItem", "position": i+1, "name": p.name, "url": p.shopeeUrl
        }))
      }] : []),
      ...(faq && faq.length ? [{
        "@type": "FAQPage",
        "mainEntity": faq.map(item => ({
          "@type": "Question",
          "name": item.q,
          "acceptedAnswer": { "@type": "Answer", "text": item.a.replace(/<[^>]+>/g, '') }
        }))
      }] : [])
    ]
  };
  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.textContent = JSON.stringify(jsonLd);
  document.head.appendChild(script);

  const content = document.getElementById('content');
  content.appendChild(renderBreadcrumb(meta.breadcrumb, meta.title.split(' ').slice(0,4).join(' ')));
  content.appendChild(renderHero(meta));
  const guideSec = renderGuide(guide);
  if (guideSec) content.appendChild(guideSec);
  if (products && products.length) {
    content.appendChild(renderTable(products));
    content.appendChild(renderProducts(products));
  }
  if (verdict && verdict.length) content.appendChild(renderVerdict(verdict));
  const faqSec = renderFAQ(faq);
  if (faqSec) content.appendChild(faqSec);
  const relatedSec = renderRelated(related);
  if (relatedSec) content.appendChild(relatedSec);

  document.getElementById('loading').style.display = 'none';
  content.style.display = 'block';
}

const dataFile = window.DATA_FILE || new URLSearchParams(location.search).get('data') || 'data/wireless-mouse.json';
render(dataFile).catch(() => {
  document.getElementById('loading').textContent = 'โหลดข้อมูลไม่ได้ กรุณาตรวจสอบไฟล์ JSON';
});
