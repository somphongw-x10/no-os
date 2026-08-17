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
            # optional "level": 3 nests a block under the preceding h2 (defaults to h2)
            lv = 3 if block.get('level') == 3 else 2
            out.append(f'<h{lv}>{block["heading"]}</h{lv}>')
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

# ---------- live price widget ----------
# prices/products.json maps each shopeeUrl to the Shopee itemId that the daily
# price tracker collects history for. It is optional: before the tracker has run
# for the first time the file does not exist, and every page simply builds
# without widgets. See tools/price/README.md.

PRICE_IDS = {}          # shopeeUrl -> itemId, filled in main()
GROUP_PAGES = {}        # group name -> group dict (only groups that get a page)
_page_uses_widget = False  # set by render_card, read by build_article

def load_price_ids():
    path = os.path.join(ROOT, 'prices', 'products.json')
    if not os.path.exists(path):
        print("  (no prices/products.json yet — building without price widgets)")
        return {}
    try:
        data = json.load(open(path, encoding='utf-8'))
    except (json.JSONDecodeError, OSError) as e:
        print(f"  !! prices/products.json unreadable ({e}) — building without price widgets")
        return {}
    # "enabled" controls whether the daily job calls the API for this product;
    # it must NOT gate the widget, or mocked/paused products would silently lose
    # the price history they already have. Use "widget": false to hide one.
    ids = {p['shopeeUrl']: p['itemId'] for p in data.get('products', [])
           if p.get('itemId') and p.get('widget', True)}
    print(f"  price widgets: {len(ids)} products have a tracked itemId")
    return ids

def render_card(p):
    global _page_uses_widget
    specs = ''.join(f'<li><span>{s["label"]}</span><span>{s["value"]}</span></li>' for s in p['specs'])
    pros = ''.join(f'<li>{x}</li>' for x in p['pros'])
    cons = ''.join(f'<li>{x}</li>' for x in p['cons'])

    item_id = PRICE_IDS.get(p['shopeeUrl'])
    if item_id:
        _page_uses_widget = True
        # The hand-written price stays in the HTML so crawlers, no-JS visitors and
        # any product without history still see a number. The widget hides it once
        # a live price renders, so the page never shows two figures at once.
        price_tag = (f'<div class="price-tag" data-pk-fallback="{item_id}">'
                     f'ราคา Shopee: <b>{p["price"]}</b></div>')
        widget = f'<div class="pk-price" data-item="{item_id}" data-no-cta></div>'
    else:
        price_tag = f'<div class="price-tag">ราคา Shopee: <b>{p["price"]}</b></div>'
        widget = ''

    return (f'<article class="card"><div class="card-inner">{render_image(p.get("image"), p["name"])}'
            f'<div class="card-body"><div class="card-head">'
            f'<h3><span class="rank">{p["rank"]}</span>{p["name"]}</h3>'
            f'{price_tag}</div>'
            f'<p class="desc">{p["summary"]}</p><ul class="specs">{specs}</ul>'
            f'<div class="pros-cons"><div class="pros"><div class="t">ข้อดี</div><ul>{pros}</ul></div>'
            f'<div class="cons"><div class="t">ข้อเสีย</div><ul>{cons}</ul></div></div>'
            f'<div class="fit"><b>เหมาะสำหรับ:</b> {p["bestFor"]}</div>'
            f'{widget}'
            f'<a class="btn" href="{p["shopeeUrl"]}" target="_blank" rel="sponsored noopener" '
            f'data-aff-item="{escape(p["name"], quote=True)}" data-aff-rank="{p["rank"]}">'
            f'ดูราคาล่าสุดบน Shopee →</a>'
            f'</div></div></article>')

def render_products(products):
    return ('<section class="section"><h2>เปรียบเทียบทีละรุ่น</h2>'
            + ''.join(render_card(p) for p in products) + '</section>')

def render_verdict(items):
    lis = ''.join(f'<li><b>{i["condition"]}</b> → {i["pick"]}</li>' for i in items)
    # The disclaimer is the one block that appears on all 29 articles, so it is also
    # where the trust pages get linked from — every article now points at how the
    # picks are made and how the site earns money.
    return ('<section class="section"><div class="verdict"><h2>สรุป — ซื้อรุ่นไหนดี?</h2>'
            f'<ul>{lis}</ul></div><p class="disclaim">ราคาอาจเปลี่ยนแปลงตามโปรโมชั่นและคูปอง Shopee'
            ' — เช็คหน้าร้านก่อนซื้อเสมอ • บทความนี้มีลิงก์ affiliate เมื่อคุณซื้อผ่านลิงก์ '
            'เราอาจได้รับค่าคอมมิชชั่นโดยที่คุณไม่ต้องจ่ายเพิ่ม '
            '(<a href="/affiliate-disclosure">นโยบาย affiliate</a>) • '
            'เราไม่ได้ทดสอบสินค้าทุกชิ้นด้วยตัวเอง '
            '<a href="/methodology">อ่านวิธีที่เราคัดเลือก</a></p></section>')

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
            # Author is the organisation, not a person — that is weaker for E-E-A-T
            # than a named byline, so it is pointed at /about and /methodology,
            # which say who writes this and how the picks are made.
            "author": {"@type": "Organization", "name": "no-os.com",
                       "url": BASE + "about"},
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
AFFTRACK_RE = re.compile(r'\s*<script src="affiliate-track\.js" defer></script>', re.DOTALL)
AFFTRACK_TAG = '<script src="affiliate-track.js" defer></script>'
CONSENT_JS_RE = re.compile(r'\s*<script src="cookie-consent\.js" defer></script>', re.DOTALL)
CONSENT_JS_TAG = '<script src="cookie-consent.js" defer></script>'
# Google Consent Mode v2 default — analytics denied until the visitor accepts.
# Injected before the gtag loader so the default is queued before config runs.
# A returning visitor who already granted starts granted (no analytics gap).
CONSENT_HEAD_RE = re.compile(r'\s*<!--CC-DEFAULT-->.*?<!--/CC-DEFAULT-->', re.DOTALL)
CONSENT_HEAD = (
    '<!--CC-DEFAULT--><script>\n'
    '  window.dataLayer = window.dataLayer || [];\n'
    '  function gtag(){dataLayer.push(arguments);}\n'
    '  (function(){var c="denied";try{if(localStorage.getItem("cookieConsent")==="granted")c="granted";}catch(e){}\n'
    '    gtag("consent","default",{ad_storage:"denied",ad_user_data:"denied",'
    'ad_personalization:"denied",analytics_storage:c,wait_for_update:500});})();\n'
    '</script><!--/CC-DEFAULT-->')
GTAG_MARKER = '<!-- Google tag (gtag.js) -->'
# max-image-preview:large is what makes a page eligible for a full-size image in
# Google Discover — a big traffic source in Thailand. Rewritten on every build so
# the shells stay consistent no matter how they were authored.
ROBOTS_RE = re.compile(r'<meta name="robots" content="[^"]*">')
ROBOTS_TAG = '<meta name="robots" content="index, follow, max-image-preview:large">'
# og:image is rewritten from articles.json on every build rather than left in the
# shell. Otherwise adding or changing an article's image later silently fails to
# update the social preview — which is exactly what happened once already.
OGIMAGE_RE = re.compile(
    r'\s*<meta (?:property="og:image"|name="twitter:image") content="[^"]*">')
PRICEWIDGET_CSS_RE = re.compile(r'\s*<link rel="stylesheet" href="/price-widget\.css">')
PRICEWIDGET_JS_RE = re.compile(r'\s*<script src="/price-widget\.js" defer></script>')
PRICEWIDGET_CSS_TAG = '<link rel="stylesheet" href="/price-widget.css">'
PRICEWIDGET_JS_TAG = '<script src="/price-widget.js" defer></script>'
FAVICON_RE = re.compile(r'\s*<link rel="(?:icon|apple-touch-icon)"[^>]*>', re.DOTALL)
FAVICON_TAGS = ('<link rel="icon" href="/favicon.ico" sizes="any">\n'
                '<link rel="icon" type="image/png" sizes="512x512" href="/icon-512.png">\n'
                '<link rel="apple-touch-icon" href="/apple-touch-icon.png">')

def ensure_article_shell(art):
    """Create <slug>.html if it does not exist yet.

    Adding an article should only mean: write data/<name>.json and add an entry
    to articles.json. Everything below is placeholder scaffolding — build_article
    immediately rewrites the head, topbar, content, footer and JSON-LD from the
    data file, so this only has to contain the anchors those substitutions look
    for (the gtag marker, a .wrap main, and a footer).
    """
    path = os.path.join(ROOT, art['url'] + '.html')
    if os.path.exists(path):
        return

    canonical = BASE + art['url']
    image = BASE + art['image'] if art.get('image') else ''
    title = escape(art['title'], quote=True)
    desc = escape(art['description'], quote=True)

    open(path, 'w', encoding='utf-8').write(f'''<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{art['title']} | no-os.com</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{canonical}">
<meta property="og:title" content="{title} | no-os.com">
<meta property="og:description" content="{desc}">
<meta property="og:type" content="article">
{f'<meta property="og:image" content="{image}">' if image else ''}
<meta property="og:site_name" content="no-os.com">
<meta property="og:locale" content="th_TH">
<meta name="twitter:card" content="summary_large_image">
{f'<meta name="twitter:image" content="{image}">' if image else ''}
<meta property="og:url" content="{canonical}">
<meta name="robots" content="index, follow">
<link rel="stylesheet" href="article.css">
{GTAG}
</head>
<body>
{TOPBAR}
<main class="wrap"><div id="content"></div></main>
{FOOTER}
</body>
</html>
''')
    print(f"  + created shell {art['url']}.html")


def build_article(art, missing_images):
    global _page_uses_widget
    _page_uses_widget = False
    ensure_article_shell(art)
    html_path = os.path.join(ROOT, art['url'] + '.html')
    data_path = os.path.join(ROOT, art['data'])
    if not os.path.exists(html_path):
        print(f"  !! missing HTML shell: {html_path}")
        return False
    data = json.load(open(data_path, encoding='utf-8'))

    # Point the second breadcrumb level at this article's group page instead of
    # /wfh, which only 302s back to the homepage. Every article then links to its
    # hub and the hub links back — done here rather than in the 29 data files so
    # the content stays the single source of truth for content only.
    group = GROUP_PAGES.get(art.get('group'))
    if group:
        data['meta'] = dict(data['meta'])
        home = [c for c in data['meta'].get('breadcrumb', []) if c.get('href') == '/']
        data['meta']['breadcrumb'] = (home or [{'label': 'หน้าแรก', 'href': '/'}]) + [
            {'label': group['name'], 'href': f'/category/{group["slug"]}'}
        ]

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
    html = AFFTRACK_RE.sub('', html)   # re-inserted below, keeps the build idempotent
    html = CONSENT_JS_RE.sub('', html)
    html = CONSENT_HEAD_RE.sub('', html)
    html = FAVICON_RE.sub('', html)
    # Stripped here and re-added below only when the page actually has a widget,
    # so removing a product from data/*.json also removes its assets.
    html = PRICEWIDGET_CSS_RE.sub('', html)
    html = PRICEWIDGET_JS_RE.sub('', html)
    html = ROBOTS_RE.sub(ROBOTS_TAG, html, count=1)
    html = OGIMAGE_RE.sub('', html)
    html = FOOTER_RE.sub(lambda _: FOOTER, html, count=1)
    if TOPBAR_RE.search(html):
        html = TOPBAR_RE.sub(lambda _: TOPBAR, html, count=1)
    else:
        print(f"  !! {art['url']}.html: topbar markup not recognised — nav left as-is")
    new_main = f'<main class="wrap"><div id="content">{content}</div></main>'
    if not WRAP_RE.search(html):
        print(f"  !! could not locate content wrap in {art['url']}.html")
        return False
    html = WRAP_RE.sub(new_main, html, count=1)
    html = html.replace(GTAG_MARKER, f'{CONSENT_HEAD}\n{GTAG_MARKER}', 1)
    if image_url:
        html = html.replace(
            '</head>',
            f'<meta property="og:image" content="{image_url}">\n'
            f'<meta name="twitter:image" content="{image_url}">\n</head>', 1)
    html = html.replace('</head>', f'{FAVICON_TAGS}\n</head>', 1)
    html = html.replace('</head>', f'<script type="application/ld+json">{jsonld}</script>\n</head>', 1)
    if _page_uses_widget:
        html = html.replace('</head>', f'{PRICEWIDGET_CSS_TAG}\n</head>', 1)
    html = html.replace('</body>', f'{AFFTRACK_TAG}\n{CONSENT_JS_TAG}\n</body>', 1)
    if _page_uses_widget:
        html = html.replace('</body>', f'{PRICEWIDGET_JS_TAG}\n</body>', 1)
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

    if FOOTER_RE.search(html):
        html = FOOTER_RE.sub(lambda _: FOOTER, html, count=1)
    else:
        print("  !! index.html has no <footer> to update — its links may still be dead")
    # index.html's topbar carries an extra mobile-nav and JS hooks, so it is not
    # swapped wholesale like the article shells. Patch the one nav link instead:
    # /?group=… is a client-side filter on this same page, and the real category
    # page is a better destination. Idempotent — after the first pass the old
    # string no longer exists.
    old_link = '<a href="/?group=ไอเดียการจัดโต๊ะ#articles">ไอเดียการจัดโต๊ะ</a>'
    new_link = ('<a href="/tools">เครื่องมือ</a>\n'
                '      <a href="/category/desk-setup-ideas">ไอเดียการจัดโต๊ะ</a>')
    if old_link in html:
        html = html.replace(old_link, new_link)
    elif 'href="/tools"' not in html:
        print("  !! index.html nav could not be updated — no link to /tools")

    # The promo banner points at the same filter; send it to the group page too.
    html = html.replace('href="/?group=ไอเดียการจัดโต๊ะ#articles" class="btn-banner"',
                        'href="/category/desk-setup-ideas" class="btn-banner"')

    html = ROBOTS_RE.sub(ROBOTS_TAG, html, count=1)

    open(path, 'w', encoding='utf-8').write(html)
    return True

# ---------- category (group) pages ----------
# One page per GROUP, not per category. 15 of the 22 categories have a single
# article each; a page listing one link is a doorway page, which current search
# guidance treats as spam. The four groups have 4–10 articles apiece and each
# carries a real buying guide, so they stand on their own.

# Rewritten into every page on each build (same as the footer), so the nav stays
# in one place. The old markup pointed at /?group=…#articles, a client-side
# filter on the homepage; it now points at the real category page.
TOPBAR = '''<div class="topbar">
  <div class="topbar-left">
    <a class="logo" href="/">pick<span>.</span></a>
    <nav class="nav">
      <a href="/tools">เครื่องมือ</a>
      <a href="/category/desk-setup-ideas">ไอเดียการจัดโต๊ะ</a>
      <a href="/#articles">คู่มือการซื้อ</a>
    </nav>
  </div>
  <div class="topbar-right">
    <div class="hamburger"><span></span><span></span><span></span></div>
  </div>
</div>'''

# Anchored on the hamburger so the three closing </div>s are unambiguous — a lazy
# `.*?</div></div>` would stop one tag early and break the markup.
TOPBAR_RE = re.compile(
    r'<div class="topbar">.*?<div class="hamburger">.*?</div>\s*</div>\s*</div>',
    re.DOTALL)

# Same shape as the footer that was already in the shells — only the links change,
# so there is no layout risk. Rewritten into every page on each build, which is how
# the four dead href="#" links get fixed across all 33 pages at once.
FOOTER = '''<footer>
  no-os.com — เปรียบเทียบอุปกรณ์ WFH สเปคคุ้มราคา &nbsp;·&nbsp;
  <a href="/about">เกี่ยวกับเรา</a> &nbsp;·&nbsp;
  <a href="/methodology">วิธีการคัดเลือก</a> &nbsp;·&nbsp;
  <a href="/affiliate-disclosure">นโยบาย affiliate</a> &nbsp;·&nbsp;
  <a href="/privacy">ความเป็นส่วนตัว</a> &nbsp;·&nbsp;
  <a href="/contact">ติดต่อเรา</a>
</footer>'''

FOOTER_RE = re.compile(r'<footer>.*?</footer>', re.DOTALL)

GTAG = '''<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-H34CQWMFHN"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-H34CQWMFHN');
</script>'''


def group_url(slug):
    return f'/category/{slug}'


def render_group_articles(articles):
    cards = []
    for a in articles:
        href = '/' + (a.get('url') or '')
        img = (f'<img class="acard-img" src="/{a["image"]}" alt="{escape(a["title"], quote=True)}" '
               f'loading="lazy" onerror="this.style.display=\'none\'">') if a.get('image') else \
              f'<div class="acard-img-placeholder">{PLACEHOLDER_SVG}</div>'
        cards.append(
            f'<a class="acard" href="{href}">{img}'
            f'<div class="acard-body"><div class="acard-cat">{a["category"]}</div>'
            f'<div class="acard-title">{a["title"]}</div>'
            f'<div class="acard-desc">{a["description"]}</div>'
            f'<div class="acard-footer"><span>อัปเดต {a["updatedDate"]}</span>'
            f'<span class="acard-cta">อ่านเพิ่มเติม →</span></div></div></a>')
    return f'<div class="acard-grid">{"".join(cards)}</div>'


def render_sibling_groups(groups, current_slug, counts):
    links = []
    for g in groups:
        if g['slug'] == current_slug:
            continue
        links.append(
            f'<a class="grouplink" href="{group_url(g["slug"])}">'
            f'<div class="grouplink-th">{g["name"]}</div>'
            f'<div class="grouplink-en">{g["en"]}</div>'
            f'<div class="grouplink-n">{counts.get(g["name"], 0)} บทความ</div></a>')
    return f'<div class="grouplinks">{"".join(links)}</div>'


def build_group_jsonld(g, arts, canonical_url):
    return {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "หน้าแรก", "item": BASE},
                    {"@type": "ListItem", "position": 2, "name": g['name']},
                ],
            },
            {
                "@type": "CollectionPage",
                "name": g['title'],
                "description": g['description'],
                "url": canonical_url,
                "isPartOf": {"@type": "WebSite", "name": "no-os.com", "url": BASE},
                "publisher": {"@type": "Organization", "name": "no-os.com", "url": BASE.rstrip('/')},
            },
            {
                "@type": "ItemList",
                "name": g['title'],
                "numberOfItems": len(arts),
                "itemListElement": [
                    {"@type": "ListItem", "position": i + 1, "name": a['title'],
                     "url": BASE + a['url']}
                    for i, a in enumerate(arts)
                ],
            },
        ],
    }


def build_categories(articles, cats):
    out_dir = os.path.join(ROOT, 'category')
    os.makedirs(out_dir, exist_ok=True)

    groups = [g for g in cats['groups'] if g.get('slug')]
    if not groups:
        print("  !! no group has a 'slug' in categories.json — skipping category pages")
        return []

    counts = {}
    for g in cats['groups']:
        counts[g['name']] = sum(1 for a in articles if a.get('group') == g['name'])

    built = []
    for g in groups:
        arts = [a for a in articles if a.get('group') == g['name']]
        if len(arts) < 3:
            # Guard against this silently becoming a thin page later on.
            print(f"  !! group '{g['name']}' has only {len(arts)} article(s) — page skipped")
            continue

        canonical_url = BASE + f'category/{g["slug"]}'
        og_image = BASE + arts[0]['image'] if arts[0].get('image') else ''
        jsonld = json.dumps(build_group_jsonld(g, arts, canonical_url), ensure_ascii=False)

        content = (
            f'<div class="crumb"><a href="/">หน้าแรก</a><span class="sep">/</span>{g["name"]}</div>'
            f'<header class="hero"><h1>{g["title"]}</h1>'
            f'<p class="lead">{g["lead"]}</p></header>'
            + render_guide(g['intro']) +
            f'<section class="section"><h2>บทความในหมวดนี้ ({len(arts)})</h2>'
            f'{render_group_articles(arts)}</section>'
            f'<section class="section"><h2>หมวดอื่นที่เกี่ยวข้อง</h2>'
            f'{render_sibling_groups(groups, g["slug"], counts)}</section>'
        )

        html = f'''<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{g["title"]} | no-os.com</title>
<meta name="description" content="{escape(g["description"], quote=True)}">
<link rel="canonical" href="{canonical_url}">
<meta property="og:title" content="{escape(g["title"], quote=True)} | no-os.com">
<meta property="og:description" content="{escape(g["description"], quote=True)}">
<meta property="og:type" content="website">
<meta property="og:url" content="{canonical_url}">
<meta property="og:site_name" content="no-os.com">
<meta property="og:locale" content="th_TH">
{f'<meta property="og:image" content="{og_image}">' if og_image else ''}
<meta name="twitter:card" content="summary_large_image">
{f'<meta name="twitter:image" content="{og_image}">' if og_image else ''}
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="stylesheet" href="/article.css">
<link rel="stylesheet" href="/category.css">
{CONSENT_HEAD}
{GTAG}
{FAVICON_TAGS}
<script type="application/ld+json">{jsonld}</script>
</head>
<body>
{TOPBAR}
<main class="wrap"><div id="content">{content}</div></main>
{FOOTER}
{CONSENT_JS_TAG.replace('src="cookie-consent.js"', 'src="/cookie-consent.js"')}
</body>
</html>
'''
        open(os.path.join(out_dir, g['slug'] + '.html'), 'w', encoding='utf-8').write(html)
        built.append((g, arts))
        print(f"  ✓ category/{g['slug']}.html ({len(arts)} articles)")

    return built


# ---------- static trust pages (about / methodology / …) ----------
# Content lives in pages.json. These exist because a site that recommends things
# and earns a commission has to say who is behind it, how the picks are made and
# how it makes money — otherwise there is no reason for a reader (or a search
# engine) to trust the recommendation.

PAGE_SCHEMA_TYPE = {
    'about': 'AboutPage',
    'contact': 'ContactPage',
}


def render_page_shell(slug, title, description, lead, updated, body_html, jsonld,
                      og_image='', extra_css=''):
    return f'''<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title} | no-os.com</title>
<meta name="description" content="{escape(description, quote=True)}">
<link rel="canonical" href="{BASE}{slug}">
<meta property="og:title" content="{escape(title, quote=True)} | no-os.com">
<meta property="og:description" content="{escape(description, quote=True)}">
<meta property="og:type" content="website">
<meta property="og:url" content="{BASE}{slug}">
<meta property="og:site_name" content="no-os.com">
<meta property="og:locale" content="th_TH">
{f'<meta property="og:image" content="{og_image}">' if og_image else ''}
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="stylesheet" href="/article.css">{extra_css}
{CONSENT_HEAD}
{GTAG}
{FAVICON_TAGS}
<script type="application/ld+json">{jsonld}</script>
</head>
<body>
{TOPBAR}
<main class="wrap"><div id="content">{body_html}</div></main>
{FOOTER}
<script src="/cookie-consent.js" defer></script>
</body>
</html>
'''


def build_pages(pages_doc):
    site = pages_doc.get('site', {})
    email = site.get('contactEmail', '')
    if 'CHANGE_ME' in email:
        print("  !! pages.json still has the placeholder contactEmail — "
              "set a real address before publishing /contact")

    built = []
    for p in pages_doc.get('pages', []):
        slug = p['slug']
        canonical = BASE + slug

        jsonld = json.dumps({
            "@context": "https://schema.org",
            "@graph": [
                {
                    "@type": "BreadcrumbList",
                    "itemListElement": [
                        {"@type": "ListItem", "position": 1, "name": "หน้าแรก", "item": BASE},
                        {"@type": "ListItem", "position": 2, "name": p['title']},
                    ],
                },
                {
                    "@type": PAGE_SCHEMA_TYPE.get(slug, 'WebPage'),
                    "name": p['title'],
                    "description": p['description'],
                    "url": canonical,
                    "inLanguage": "th-TH",
                    "isPartOf": {"@type": "WebSite", "name": "no-os.com", "url": BASE},
                    "publisher": {"@type": "Organization", "name": "no-os.com",
                                  "url": BASE.rstrip('/')},
                },
            ],
        }, ensure_ascii=False)

        body = (
            f'<div class="crumb"><a href="/">หน้าแรก</a><span class="sep">/</span>'
            f'{p.get("nav", p["title"])}</div>'
            f'<header class="hero"><h1>{p["title"]}</h1>'
            f'<p class="lead">{p["lead"]}</p>'
            f'<span class="updated">อัปเดต {p["updated"]}</span></header>'
            + render_guide(p['blocks'])
        )

        html = render_page_shell(slug, p['title'], p['description'], p['lead'],
                                 p['updated'], body, jsonld)

        # Placeholders such as {{contactEmail}} are filled from pages.json["site"].
        for key, value in site.items():
            html = html.replace('{{' + key + '}}', str(value))

        open(os.path.join(ROOT, slug + '.html'), 'w', encoding='utf-8').write(html)
        built.append(p)
        print(f"  ✓ {slug}.html")

    return built


# ---------- interactive tools ----------
# Copy lives in tools.json, calculator logic in tools/<slug>.js. The form markup
# is here because each tool's inputs are bespoke; everything else (head, chrome,
# schema, intro/FAQ prose) is shared.

TOOL_FORMS = {
    'desk-height': '''
<div class="tool">
  <div class="tool-form">
    <div class="field">
      <label for="height">ส่วนสูงของคุณ</label>
      <div class="hint">วัดโดยไม่ใส่รองเท้า</div>
      <input type="number" id="height" min="120" max="220" step="1" placeholder="เช่น 168" inputmode="numeric">
    </div>
    <div class="field">
      <label for="desk-actual">ความสูงโต๊ะที่คุณมีอยู่ (ถ้ามี)</label>
      <div class="hint">วัดจากพื้นถึงหน้าโต๊ะ — ใส่แล้วเราจะบอกวิธีปรับให้พอดี ไม่ต้องซื้อใหม่</div>
      <input type="number" id="desk-actual" min="50" max="130" step="0.5" placeholder="เช่น 75" inputmode="decimal">
    </div>
    <div class="tool-actions"><button type="button" id="reset" class="ghost">ล้างค่า</button></div>
  </div>
  <div class="result" id="result" hidden><div id="result-body"></div></div>
</div>''',

    'power-load': '''
<div class="tool">
  <div class="tool-form">
    <div class="field">
      <label for="amps">พิกัดกระแสของปลั๊กพ่วง</label>
      <div class="hint">ดูตัวเลขที่พิมพ์บนตัวปลั๊ก ถ้าหาไม่เจอ ส่วนใหญ่คือ 10A</div>
      <select id="amps">
        <option value="10">10A — พบบ่อยที่สุด (สูงสุด 2,300 วัตต์)</option>
        <option value="16">16A — รุ่นรับโหลดสูง (สูงสุด 3,680 วัตต์)</option>
        <option value="6">6A — ปลั๊กเล็ก/รุ่นเก่า (สูงสุด 1,380 วัตต์)</option>
      </select>
    </div>
    <div class="field">
      <div class="fieldset-label">เลือกอุปกรณ์ที่เสียบกับปลั๊กพ่วงตัวเดียวกัน</div>
      <div id="devices"></div>
    </div>
    <div class="field">
      <label for="extra">อุปกรณ์อื่น (วัตต์)</label>
      <div class="hint">ถ้ามีของที่ไม่อยู่ในรายการ ดูตัวเลขวัตต์จากฉลากแล้วใส่รวมมาที่นี่</div>
      <input type="number" id="extra" min="0" max="5000" step="10" placeholder="0" inputmode="numeric">
    </div>
    <div class="tool-actions"><button type="button" id="reset" class="ghost">ล้างค่า</button></div>
  </div>
  <div class="result" id="result" hidden><div id="result-body"></div></div>
</div>''',

    'budget-builder': '''
<div class="tool">
  <div class="tool-form">
    <div class="field">
      <label for="budget">งบที่มี</label>
      <div class="range-row">
        <input type="range" id="budget" min="1000" max="60000" step="500" value="10000">
        <span class="range-value" id="budget-value">10,000 ฿</span>
      </div>
    </div>
    <div class="field">
      <div class="fieldset-label">มีอะไรอยู่แล้วบ้าง</div>
      <div class="hint">ติ๊กของที่ยังใช้ได้ดี งบจะถูกย้ายไปให้ชิ้นถัดไปในลำดับ</div>
      <div class="chips" id="owned"></div>
    </div>
    <div class="tool-actions"><button type="button" id="reset" class="ghost">เริ่มใหม่</button></div>
  </div>
  <div class="result" id="result" hidden><div id="result-body"></div></div>
</div>''',
}


def render_faq_blocks(faq):
    if not faq:
        return ''
    items = ''.join(f'<div class="faq-item"><h3 class="faq-q">{it["q"]}</h3>'
                    f'<div class="faq-a">{it["a"]}</div></div>' for it in faq)
    return f'<section class="section faq-section"><h2>คำถามที่พบบ่อย</h2>{items}</section>'


def render_sources(sources):
    if not sources:
        return ''
    lis = ''.join(f'<li><a href="{s["url"]}" target="_blank" rel="noopener">{s["label"]}</a></li>'
                  for s in sources)
    return ('<section class="section"><h2>อ้างอิง</h2>'
            f'<ul class="guide-list">{lis}</ul></section>')


def build_budget_data(articles):
    """Extract real products from the site's own article data for the budget builder.

    Nothing is invented: a category only appears if an article actually
    recommends products in it, with the price and affiliate link as published.
    """
    cats = {}
    for art in articles:
        data_path = os.path.join(ROOT, art['data'])
        if not os.path.exists(data_path):
            continue
        data = json.load(open(data_path, encoding='utf-8'))
        for p in data.get('products', []):
            m = re.search(r'([\d,]+(?:\.\d+)?)', str(p.get('price', '')))
            if not m:
                continue
            price = float(m.group(1).replace(',', ''))
            if price <= 0:
                continue
            # rank is stored as a string in some data files ("1") and an int in
            # others. Left as-is the browser would compare them as text, so
            # "10" would sort before "2" and the ranking logic would be quietly
            # wrong. Normalise here, once.
            try:
                rank = int(str(p.get('rank', 99)).strip())
            except (TypeError, ValueError):
                rank = 99

            cats.setdefault(art['category'], []).append({
                'name': p['name'],
                'price': price,
                'rank': rank,
                'article': art['url'],
                'shopeeUrl': p.get('shopeeUrl', ''),
            })

    out_dir = os.path.join(ROOT, 'tools')
    os.makedirs(out_dir, exist_ok=True)
    payload = {'generatedAt': None, 'categories': cats}
    open(os.path.join(out_dir, 'budget-data.json'), 'w', encoding='utf-8').write(
        json.dumps(payload, ensure_ascii=False))

    total = sum(len(v) for v in cats.values())
    print(f"  ✓ tools/budget-data.json ({total} products across {len(cats)} categories)")
    return cats


def build_tools(doc, articles):
    tools = doc.get('tools', [])
    if not tools:
        return []

    os.makedirs(os.path.join(ROOT, 'tools'), exist_ok=True)
    build_budget_data(articles)

    css = '\n<link rel="stylesheet" href="/tools.css">'

    for t in tools:
        slug = t['slug']
        canonical = BASE + 'tools/' + slug

        graph = [
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "หน้าแรก", "item": BASE},
                    {"@type": "ListItem", "position": 2, "name": "เครื่องมือ", "item": BASE + "tools"},
                    {"@type": "ListItem", "position": 3, "name": t['nav']},
                ],
            },
            {
                "@type": "WebApplication",
                "name": t['title'],
                "description": t['description'],
                "url": canonical,
                "applicationCategory": "UtilitiesApplication",
                "operatingSystem": "Web",
                "inLanguage": "th-TH",
                "offers": {"@type": "Offer", "price": "0", "priceCurrency": "THB"},
                "publisher": {"@type": "Organization", "name": "no-os.com", "url": BASE.rstrip('/')},
            },
        ]
        if t.get('faq'):
            graph.append({
                "@type": "FAQPage",
                "mainEntity": [
                    {"@type": "Question", "name": it['q'],
                     "acceptedAnswer": {"@type": "Answer", "text": re.sub(r'<[^>]+>', '', it['a'])}}
                    for it in t['faq']
                ],
            })

        body = (
            f'<div class="crumb"><a href="/">หน้าแรก</a><span class="sep">/</span>'
            f'<a href="/tools">เครื่องมือ</a><span class="sep">/</span>{t["nav"]}</div>'
            f'<header class="hero"><h1>{t["title"]}</h1><p class="lead">{t["lead"]}</p></header>'
            + TOOL_FORMS.get(slug, '')
            + render_guide(t.get('intro'))
            + render_guide(t.get('how'))
            + render_faq_blocks(t.get('faq'))
            + render_sources(t.get('sources'))
        )

        html = render_page_shell('tools/' + slug, t['title'], t['description'], t['lead'],
                                 '', body,
                                 json.dumps({"@context": "https://schema.org", "@graph": graph},
                                            ensure_ascii=False),
                                 extra_css=css)
        html = html.replace('</body>', f'<script src="/tools/{slug}.js" defer></script>\n</body>', 1)

        open(os.path.join(ROOT, 'tools', slug + '.html'), 'w', encoding='utf-8').write(html)
        print(f"  ✓ tools/{slug}.html")

    # hub page
    hub = doc['hub']
    cards = ''.join(
        f'<a class="toolcard" href="/tools/{t["slug"]}">'
        f'<div class="toolcard-title">{t["cardTitle"]}</div>'
        f'<div class="toolcard-desc">{t["cardDesc"]}</div>'
        f'<div class="toolcard-cta">เปิดเครื่องมือ →</div></a>' for t in tools)

    hub_graph = [
        {
            "@type": "BreadcrumbList",
            "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "หน้าแรก", "item": BASE},
                {"@type": "ListItem", "position": 2, "name": "เครื่องมือ"},
            ],
        },
        {
            "@type": "CollectionPage",
            "name": hub['title'],
            "description": hub['description'],
            "url": BASE + 'tools',
            "inLanguage": "th-TH",
            "publisher": {"@type": "Organization", "name": "no-os.com", "url": BASE.rstrip('/')},
        },
        {
            "@type": "ItemList",
            "numberOfItems": len(tools),
            "itemListElement": [
                {"@type": "ListItem", "position": i + 1, "name": t['cardTitle'],
                 "url": BASE + 'tools/' + t['slug']}
                for i, t in enumerate(tools)
            ],
        },
    ]

    hub_body = (
        f'<div class="crumb"><a href="/">หน้าแรก</a><span class="sep">/</span>เครื่องมือ</div>'
        f'<header class="hero"><h1>{hub["title"]}</h1><p class="lead">{hub["lead"]}</p></header>'
        f'<section class="section"><div class="toolgrid">{cards}</div></section>'
    )
    hub_html = render_page_shell('tools', hub['title'], hub['description'], hub['lead'], '',
                                 hub_body,
                                 json.dumps({"@context": "https://schema.org", "@graph": hub_graph},
                                            ensure_ascii=False),
                                 extra_css=css)
    open(os.path.join(ROOT, 'tools', 'index.html'), 'w', encoding='utf-8').write(hub_html)
    print("  ✓ tools/index.html")

    return tools


# ---------- legacy shells ----------
# article.html is the old client-rendered shell (every article.html?data=… URL is
# 301'd away now) and comparison-template.html is a scratch template. Both still
# resolve over HTTP and render almost no content, which is exactly the kind of
# thin page that drags a small site's quality signals down. Neither is in the
# sitemap; this keeps them out of the index too.
NOINDEX_FILES = ['article.html', 'comparison-template.html']
NOINDEX_TAG = '<meta name="robots" content="noindex, follow">'


def build_noindex_legacy():
    for name in NOINDEX_FILES:
        path = os.path.join(ROOT, name)
        if not os.path.exists(path):
            continue
        html = open(path, encoding='utf-8').read()
        if ROBOTS_RE.search(html):
            new = ROBOTS_RE.sub(NOINDEX_TAG, html, count=1)
        elif '</head>' in html:
            new = html.replace('</head>', f'{NOINDEX_TAG}\n</head>', 1)
        else:
            print(f"  !! {name} has no <head> — left alone")
            continue
        if new != html:
            open(path, 'w', encoding='utf-8').write(new)
            print(f"  ✓ {name} → noindex")


# ---------- sitemap ----------

def build_sitemap(articles, built_groups, built_pages, built_tools):
    """Regenerate sitemap.xml from articles.json + the category pages.

    Existing <lastmod> values are carried over per URL. Stamping everything with
    today's date on every build would be a false freshness signal, so only URLs
    that are genuinely new get today's date.
    """
    from datetime import date
    path = os.path.join(ROOT, 'sitemap.xml')
    today = date.today().isoformat()

    previous = {}
    if os.path.exists(path):
        old = open(path, encoding='utf-8').read()
        for loc, mod in re.findall(r'<loc>([^<]+)</loc>\s*<lastmod>([^<]+)</lastmod>', old):
            previous[loc] = mod

    entries = [(BASE, '1.0', 'weekly')]
    entries += [(BASE + f'category/{g["slug"]}', '0.9', 'weekly') for g, _ in built_groups]
    entries += [(BASE + a['url'], '0.8', 'weekly') for a in articles]
    if built_tools:
        entries.append((BASE + 'tools', '0.9', 'monthly'))
        entries += [(BASE + 'tools/' + t['slug'], '0.9', 'monthly') for t in built_tools]
    # Trust pages change rarely and are not what we want ranking, but they must be
    # crawlable — they are what a reviewer checks before trusting the rest.
    entries += [(BASE + p['slug'], '0.4', 'yearly') for p in built_pages]

    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for loc, priority, freq in entries:
        lines += ['  <url>',
                  f'    <loc>{loc}</loc>',
                  f'    <lastmod>{previous.get(loc, today)}</lastmod>',
                  f'    <changefreq>{freq}</changefreq>',
                  f'    <priority>{priority}</priority>',
                  '  </url>']
    lines.append('</urlset>')
    open(path, 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    print(f"Built sitemap.xml ({len(entries)} URLs).")


def main():
    global PRICE_IDS, GROUP_PAGES
    articles = json.load(open(os.path.join(ROOT, 'articles.json'), encoding='utf-8'))
    cats = json.load(open(os.path.join(ROOT, 'categories.json'), encoding='utf-8'))
    PRICE_IDS = load_price_ids()
    # group name -> (slug, label); used to add a group crumb to every article
    GROUP_PAGES = {g['name']: g for g in cats['groups']
                   if g.get('slug') and sum(1 for a in articles if a.get('group') == g['name']) >= 3}
    missing_images = set()
    ok = 0
    for art in articles:
        if build_article(art, missing_images):
            ok += 1
            print(f"  ✓ {art['url']}.html")
    print(f"\nBuilt {ok}/{len(articles)} article pages.")
    built_groups = build_categories(articles, cats)

    pages_path = os.path.join(ROOT, 'pages.json')
    built_pages = []
    if os.path.exists(pages_path):
        built_pages = build_pages(json.load(open(pages_path, encoding='utf-8')))
    else:
        print("  (no pages.json — skipping about/methodology/contact)")

    tools_path = os.path.join(ROOT, 'tools.json')
    built_tools = []
    if os.path.exists(tools_path):
        built_tools = build_tools(json.load(open(tools_path, encoding='utf-8')), articles)
    else:
        print("  (no tools.json — skipping /tools)")

    build_noindex_legacy()

    if build_home(articles):
        print("Built index.html (categories + article grid).")
    build_sitemap(articles, built_groups, built_pages, built_tools)
    if missing_images:
        print("WARNING missing image files:")
        for m in sorted(missing_images):
            print("  -", m)
        sys.exit(1)

if __name__ == '__main__':
    main()
