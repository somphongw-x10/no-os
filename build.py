#!/usr/bin/env python3
"""
Static pre-render (SSG) for pick / no-os.com — homepage + article pages.

Source of truth = articles.json + categories.json + data/*.json (edit these).
This script bakes the rendered content + JSON-LD directly into index.html and
each article's .html so that crawlers and AI answer engines that don't run
JavaScript still see the full content.

Idempotent: safe to run repeatedly. Run before committing:  python3 build.py
"""
import json, re, os, sys
from html import escape
from urllib.parse import quote

BASE = "https://pick.no-os.com/"
ROOT = os.path.dirname(os.path.abspath(__file__))

# ---------- render helpers (ported 1:1 from article.js) ----------

def render_breadcrumb(breadcrumb, current_label):
    out = ['<div class="crumb">']
    for b in breadcrumb:
        out.append(f'<a href="{b["href"]}">{b["label"]}</a><span class="sep">/</span>')
    out.append(current_label)
    out.append('</div>')
    return ''.join(out)

def render_hero(meta):
    return (f'<header class="hero"><h1>{meta["title"]}</h1>'
            f'<p class="lead">{meta["description"]}</p>'
            f'<span class="updated">อัปเดต {meta["updatedDate"]}</span></header>')

def render_guide(guide):
    if not guide:
        return ''
    out = ['<section class="section guide-section">']
    for block in guide:
        if block.get('heading'):
            out.append(f'<h2>{block["heading"]}</h2>')
        if block.get('image'):
            alt = escape(block.get('imageAlt') or block.get('heading') or '', quote=True)
            out.append(f'<img src="{block["image"]}" alt="{alt}" loading="lazy" class="guide-img">')
        for p in block.get('paragraphs', []):
            out.append(f'<p class="guide-p">{p}</p>')
        if block.get('list'):
            out.append('<ul class="guide-list">')
            for li in block['list']:
                out.append(f'<li>{li}</li>')
            out.append('</ul>')
    out.append('</section>')
    return ''.join(out)

def render_table(products):
    rows = ''.join(
        f'<tr><td>{p["name"]}</td><td class="pricetag">{p["price"]}</td>'
        f'<td>{p["tableTag"]}</td><td>{p["tableWho"]}</td></tr>'
        for p in products)
    return ('<section class="section"><h2>สรุปเร็ว ถ้าไม่อยากอ่านทั้งหมด</h2>'
            '<table class="qtable"><thead><tr><th>รุ่น</th><th>ราคา</th><th>เด่น</th>'
            f'<th>เหมาะกับ</th></tr></thead><tbody>{rows}</tbody></table></section>')

PLACEHOLDER = ('<div class="img-placeholder"><svg width="40" height="40" fill="none" '
               'stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">'
               '<rect x="3" y="3" width="18" height="18" rx="2"/>'
               '<circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>'
               '<span>วางรูปสินค้าที่นี่</span></div>')

# Compact fallback used inside the onerror attribute. Must be HTML-escaped so the
# inner double quotes don't terminate the attribute early (the full SVG placeholder
# is only used when there is no src at all, where no escaping is needed).
_FALLBACK_JS = ('this.parentNode.innerHTML=\'<div class="img-placeholder">'
                '<span>วางรูปสินค้าที่นี่</span></div>\'')

def render_image(src, alt):
    if src:
        onerror = escape(_FALLBACK_JS, quote=True)
        return (f'<div class="card-img"><img alt="{escape(alt, quote=True)}" loading="lazy" '
                f'src="{src}" onerror="{onerror}"></div>')
    return f'<div class="card-img">{PLACEHOLDER}</div>'

def render_card(p):
    specs = ''.join(f'<li><span>{s["label"]}</span><span>{s["value"]}</span></li>' for s in p['specs'])
    pros = ''.join(f'<li>{x}</li>' for x in p['pros'])
    cons = ''.join(f'<li>{x}</li>' for x in p['cons'])
    return (f'<article class="card"><div class="card-inner">{render_image(p.get("image"), p["name"])}'
            f'<div class="card-body"><div class="card-head">'
            f'<h3><span class="rank">{p["rank"]}</span>{p["name"]}</h3>'
            f'<div class="price-tag">ราคา Shopee: <b>{p["price"]}</b></div></div>'
            f'<p class="desc">{p["summary"]}</p><ul class="specs">{specs}</ul>'
            f'<div class="pros-cons"><div class="pros"><div class="t">ข้อดี</div><ul>{pros}</ul></div>'
            f'<div class="cons"><div class="t">ข้อเสีย</div><ul>{cons}</ul></div></div>'
            f'<div class="fit"><b>เหมาะสำหรับ:</b> {p["bestFor"]}</div>'
            f'<a class="btn" href="{p["shopeeUrl"]}" target="_blank" rel="noopener">ดูราคาล่าสุดบน Shopee →</a>'
            f'</div></div></article>')

def render_products(products):
    return ('<section class="section"><h2>เปรียบเทียบทีละรุ่น</h2>'
            + ''.join(render_card(p) for p in products) + '</section>')

def render_verdict(items):
    lis = ''.join(f'<li><b>{i["condition"]}</b> → {i["pick"]}</li>' for i in items)
    return ('<section class="section"><div class="verdict"><h2>สรุป — ซื้อรุ่นไหนดี?</h2>'
            f'<ul>{lis}</ul></div><p class="disclaim">ราคาอาจเปลี่ยนแปลงตามโปรโมชั่นและคูปอง Shopee'
            ' — เช็คหน้าร้านก่อนซื้อเสมอ • บทความนี้มีลิงก์ affiliate เมื่อคุณซื้อผ่านลิงก์ '
            'เราอาจได้รับค่าคอมมิชชั่นโดยที่คุณไม่ต้องจ่ายเพิ่ม</p></section>')

def render_faq(faq):
    if not faq:
        return ''
    items = ''.join(f'<div class="faq-item"><h3 class="faq-q">{it["q"]}</h3>'
                    f'<div class="faq-a">{it["a"]}</div></div>' for it in faq)
    return f'<section class="section faq-section"><h2>คำถามที่พบบ่อย (FAQ)</h2>{items}</section>'

def render_related(related):
    if not related:
        return ''
    cards = ''.join(f'<a class="related-card" href="{r["url"]}"><div class="related-cat">{r["category"]}</div>'
                    f'<div class="related-title">{r["title"]}</div>'
                    f'<div class="related-cta">อ่านเพิ่มเติม →</div></a>' for r in related)
    return f'<section class="section"><h2>บทความที่เกี่ยวข้อง</h2><div class="related-grid">{cards}</div></section>'

# ---------- JSON-LD ----------

def build_jsonld(data, canonical_url, image_url):
    meta = data['meta']
    products = data.get('products')
    faq = data.get('faq')
    date_pub = meta.get('datePublished')
    date_mod = meta.get('dateModified') or meta.get('datePublished')
    graph = [
        {
            "@type": "BreadcrumbList",
            "itemListElement": [
                *[{"@type": "ListItem", "position": i + 1, "name": b["label"],
                   "item": BASE.rstrip('/') + b["href"]} for i, b in enumerate(meta['breadcrumb'])],
                {"@type": "ListItem", "position": len(meta['breadcrumb']) + 1, "name": meta['title']},
            ],
        },
        {
            "@type": "Article",
            "headline": meta['title'],
            "description": meta['description'],
            **({"image": image_url} if image_url else {}),
            "datePublished": date_pub,
            "dateModified": date_mod,
            "publisher": {"@type": "Organization", "name": "no-os.com", "url": "https://pick.no-os.com"},
            "mainEntityOfPage": {"@type": "WebPage", "@id": canonical_url},
        },
    ]
    if products:
        graph.append({
            "@type": "ItemList", "name": meta['title'], "numberOfItems": len(products),
            "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": p["name"], "url": p["shopeeUrl"]}
                                for i, p in enumerate(products)],
        })
    if faq:
        graph.append({
            "@type": "FAQPage",
            "mainEntity": [{"@type": "Question", "name": it["q"],
                            "acceptedAnswer": {"@type": "Answer", "text": re.sub(r'<[^>]+>', '', it["a"])}}
                           for it in faq],
        })
    return {"@context": "https://schema.org", "@graph": graph}

# ---------- assemble & write ----------

def render_content(data):
    meta = data['meta']
    current_label = ' '.join(meta['title'].split(' ')[:4])
    parts = [render_breadcrumb(meta['breadcrumb'], current_label), render_hero(meta)]
    parts.append(render_guide(data.get('guide')))
    if data.get('products'):
        parts.append(render_table(data['products']))
        parts.append(render_products(data['products']))
    if data.get('verdict'):
        parts.append(render_verdict(data['verdict']))
    parts.append(render_faq(data.get('faq')))
    parts.append(render_related(data.get('related')))
    return ''.join(parts)

WRAP_RE = re.compile(r'<(?:main|div) class="wrap">.*?</(?:main|div)>(?=\s*<footer)', re.DOTALL)
LDJSON_RE = re.compile(r'\s*<script type="application/ld\+json">.*?</script>', re.DOTALL)
DATAFILE_RE = re.compile(r'\s*<script>window\.DATA_FILE=.*?</script>', re.DOTALL)
ARTICLEJS_RE = re.compile(r'\s*<script src="article\.js"></script>', re.DOTALL)

def build_article(art, missing_images):
    html_path = os.path.join(ROOT, art['url'] + '.html')
    data_path = os.path.join(ROOT, art['data'])
    if not os.path.exists(html_path):
        print(f"  !! missing HTML shell: {html_path}")
        return False
    data = json.load(open(data_path, encoding='utf-8'))

    canonical_url = BASE + art['url']
    image_url = BASE + art['image'] if art.get('image') else None

    # warn on missing referenced images
    for ref in re.findall(r'images/[^\s"\'<>]+', json.dumps(data, ensure_ascii=False)):
        if not os.path.exists(os.path.join(ROOT, ref)):
            missing_images.add(ref)

    content = render_content(data)
    jsonld = json.dumps(build_jsonld(data, canonical_url, image_url), ensure_ascii=False)

    html = open(html_path, encoding='utf-8').read()
    html = LDJSON_RE.sub('', html)
    html = DATAFILE_RE.sub('', html)
    html = ARTICLEJS_RE.sub('', html)
    new_main = f'<main class="wrap"><div id="content">{content}</div></main>'
    if not WRAP_RE.search(html):
        print(f"  !! could not locate content wrap in {art['url']}.html")
        return False
    html = WRAP_RE.sub(new_main, html, count=1)
    html = html.replace('</head>', f'<script type="application/ld+json">{jsonld}</script>\n</head>', 1)
    open(html_path, 'w', encoding='utf-8').write(html)
    return True

# ---------- homepage ----------

# Content between these markers is regenerated on every build; anything outside
# them is hand-maintained. Keeps index.html idempotent like the article pages.
def region_re(name):
    return re.compile(r'(<!--BUILD:%s-->).*?(<!--/BUILD:%s-->)' % (name, name), re.DOTALL)

def render_cat_groups(articles, groups, cat_meta):
    out, counter = [], 0
    for g in groups:
        cats = list(dict.fromkeys(a['category'] for a in articles if a.get('group') == g['name']))
        if not cats:
            continue
        out.append('<div class="cat-group"><div class="cat-group-head">'
                   f'<span class="g-th">{g["name"]}</span><span class="g-en">{g["en"]}</span></div>'
                   '<div class="cat-grid">')
        for cat in cats:
            counter += 1
            meta = cat_meta.get(cat, {'en': '', 'img': '', 'desc': ''})
            href = '/?cat=' + quote(cat) + '#articles'
            out.append(
                f'<a class="cat-card" href="{href}"><div class="cat-card-img">'
                f'<img src="{meta["img"]}" alt="{escape(cat, quote=True)}" loading="lazy">'
                f'<div class="cat-card-num">{counter:02d}</div></div>'
                f'<div class="cat-card-body"><div class="cat-card-th">{cat}</div>'
                f'<div class="cat-card-en">{meta["en"]}</div>'
                f'<div class="cat-card-desc">{meta["desc"]}</div></div></a>')
        out.append('</div></div>')
    return ''.join(out)

def render_cat_filter(groups):
    pills = ['<button class="cat-btn active" data-group="">ทั้งหมด</button>']
    pills += [f'<button class="cat-btn" data-group="{escape(g["name"], quote=True)}">{g["name"]}</button>'
              for g in groups]
    return ''.join(pills)

def render_article_grid(articles):
    out = []
    for a in articles:
        href = a.get('url') or f'article.html?data={a["data"]}'
        img = (f'<img class="acard-img" src="{a["image"]}" alt="{escape(a["title"], quote=True)}" '
               f'loading="lazy" onerror="this.style.display=\'none\'">') if a.get('image') else \
              f'<div class="acard-img-placeholder">{PLACEHOLDER_SVG}</div>'
        out.append(
            f'<a class="acard" href="{href}" data-cat="{escape(a["category"], quote=True)}" '
            f'data-group="{escape(a.get("group", ""), quote=True)}">{img}'
            f'<div class="acard-body"><div class="acard-cat">{a["category"]}</div>'
            f'<div class="acard-title">{a["title"]}</div>'
            f'<div class="acard-desc">{a["description"]}</div>'
            f'<div class="acard-footer"><span>อัปเดต {a["updatedDate"]}</span>'
            f'<span class="acard-cta">อ่านเพิ่มเติม →</span></div></div></a>')
    return ''.join(out)

PLACEHOLDER_SVG = ('<svg width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" '
                   'viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/>'
                   '<circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>')

def build_home(articles):
    path = os.path.join(ROOT, 'index.html')
    cats = json.load(open(os.path.join(ROOT, 'categories.json'), encoding='utf-8'))
    html = open(path, encoding='utf-8').read()
    regions = {
        'cat-groups':   render_cat_groups(articles, cats['groups'], cats['categories']),
        'cat-filter':   render_cat_filter(cats['groups']),
        'article-grid': render_article_grid(articles),
    }
    for name, content in regions.items():
        rx = region_re(name)
        if not rx.search(html):
            print(f"  !! could not locate <!--BUILD:{name}--> region in index.html")
            return False
        html = rx.sub(lambda m: m.group(1) + content + m.group(2), html, count=1)
    open(path, 'w', encoding='utf-8').write(html)
    return True

def main():
    articles = json.load(open(os.path.join(ROOT, 'articles.json'), encoding='utf-8'))
    missing_images = set()
    ok = 0
    for art in articles:
        if build_article(art, missing_images):
            ok += 1
            print(f"  ✓ {art['url']}.html")
    print(f"\nBuilt {ok}/{len(articles)} article pages.")
    if build_home(articles):
        print("Built index.html (categories + article grid).")
    if missing_images:
        print("WARNING missing image files:")
        for m in sorted(missing_images):
            print("  -", m)
        sys.exit(1)

if __name__ == '__main__':
    main()
