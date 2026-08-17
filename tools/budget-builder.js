/**
 * Budget builder.
 *
 * Reads /tools/budget-data.json — real products, prices and affiliate links
 * extracted from the site's own article data at build time. Nothing here is
 * invented; if a category has no product in an article, it simply does not
 * appear.
 *
 * Allocation is a plain greedy pass down a fixed priority order (body impact
 * first, decoration last), not an optimiser: the point is to answer "what do I
 * buy first", and a greedy pass down an explained order is something the reader
 * can check and disagree with.
 */
(function () {
  'use strict';

  // category key in the data file -> display order & label
  var PRIORITY = [
    { cat: 'เก้าอี้',   label: 'เก้าอี้',        why: 'รับน้ำหนักคุณ 8 ชั่วโมง แก้ทีหลังไม่ได้ด้วยของอื่น' },
    { cat: 'มอนิเตอร์', label: 'จอมอนิเตอร์',    why: 'กำหนดว่าคอจะก้มหรือตรงทั้งวัน' },
    { cat: 'เมาส์',     label: 'เมาส์',          why: 'ข้อมือบิดค้างถ้าขนาดไม่พอดีมือ' },
    { cat: 'หูฟัง',     label: 'หูฟัง',          why: 'สิ่งที่คนอื่นได้ยินคุณตอนประชุม' },
    { cat: 'คีย์บอร์ด', label: 'คีย์บอร์ด',      why: 'ของติดเครื่องมักยังพอใช้ได้ อัปเกรดทีหลังได้' },
    { cat: 'โคมไฟ',    label: 'โคมไฟตั้งโต๊ะ',   why: 'คนลงทุนน้อยสุดทั้งที่กระทบตามากสุด' },
    { cat: 'โต๊ะ',      label: 'โต๊ะ',           why: 'ถ้าโต๊ะเดิมสูงผิด แก้ด้วยเก้าอี้+ที่วางเท้าก่อนได้' },
    { cat: 'USB Hub',  label: 'USB Hub',       why: 'จำเป็นถ้าพอร์ตโน้ตบุ๊กไม่พอ' },
    { cat: 'หัวชาร์จ',  label: 'หัวชาร์จ',       why: 'ตัวเดียวจ่ายไฟให้โน้ตบุ๊กและมือถือพร้อมกัน' },
    { cat: 'ปลั๊กพ่วง', label: 'ปลั๊กพ่วง',      why: 'เรื่องความปลอดภัย อย่าประหยัดจุดนี้' },
    { cat: 'จัดสายไฟ',  label: 'ที่จัดสายไฟ',    why: 'ทำครั้งเดียวจบ' },
    { cat: 'แผ่นรองโต๊ะ', label: 'แผ่นรองโต๊ะ',  why: 'ช่วยเรื่องเสียงและรอยขีดข่วน' },
  ];

  var DATA = null;

  function $(id) { return document.getElementById(id); }
  function fmt(n) { return Math.round(n).toLocaleString('th-TH'); }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function inCat(cat) {
    return (DATA.categories[cat] || []).filter(function (p) { return p.price > 0; });
  }

  /** Cheapest product in a category — the entry point for a budget build. */
  function cheapest(cat) {
    var list = inCat(cat);
    if (!list.length) return null;
    return list.reduce(function (a, b) { return b.price < a.price ? b : a; });
  }

  /**
   * The next step up from `current` within `extra` more baht.
   *
   * "Better" means a lower rank number — rank 1 is our top pick in that article,
   * not simply the most expensive model. Once a category is already at rank 1
   * there is nothing to upgrade to, and the money genuinely should stay in the
   * reader's pocket.
   */
  function upgrade(cat, current, extra) {
    var better = inCat(cat).filter(function (p) {
      return p.rank < current.rank && (p.price - current.price) <= extra;
    });
    if (!better.length) return null;
    return better.sort(function (a, b) { return a.rank - b.rank || a.price - b.price; })[0];
  }

  function owned() {
    var set = {};
    PRIORITY.forEach(function (p) {
      var el = document.getElementById('own-' + encodeURIComponent(p.cat));
      if (el && el.checked) set[p.cat] = true;
    });
    return set;
  }

  /**
   * Two passes, because one greedy pass gets it wrong in both directions.
   *
   *   Pass 1 — cover as many categories as possible with the cheapest option in
   *            each. Coverage beats quality: a desk with no monitor is worse
   *            than a desk with a cheap monitor.
   *   Pass 2 — spend whatever is left upgrading toward our top pick, in priority
   *            order, so the money goes to the things that affect the body most.
   *
   * If money is still left after pass 2, everything is already at rank 1 and we
   * say so instead of inventing something to spend it on.
   */
  function build() {
    var budget = parseInt($('budget').value, 10) || 0;
    var have = owned();
    var left = budget;

    var picked = [];
    var skipped = [];

    PRIORITY.forEach(function (p) {
      if (have[p.cat]) return;
      var c = cheapest(p.cat);
      if (!c) return;
      if (c.price <= left) {
        picked.push({ meta: p, item: c });
        left -= c.price;
      } else {
        skipped.push({ meta: p, cheapest: c });
      }
    });

    var upgraded = 0;
    var changed = true;
    while (changed && left > 0) {
      changed = false;
      for (var i = 0; i < picked.length; i++) {
        var better = upgrade(picked[i].meta.cat, picked[i].item, left);
        if (better) {
          left -= better.price - picked[i].item.price;
          picked[i].item = better;
          upgraded++;
          changed = true;
        }
      }
    }

    render(budget, picked, skipped, left, have, upgraded);
  }

  function itemRow(rank, meta, item) {
    return '<li class="buy-item">' +
      '<span class="buy-rank">' + rank + '</span>' +
      '<div><div class="buy-cat">' + esc(meta.label) + '</div>' +
      '<div class="buy-name">' + esc(item.name) + '</div>' +
      '<div class="buy-links">' +
        '<a href="/' + esc(item.article) + '">อ่านรีวิวเปรียบเทียบ</a>' +
        (item.shopeeUrl
          ? ' · <a href="' + esc(item.shopeeUrl) + '" target="_blank" rel="sponsored noopener" ' +
            'data-aff-item="' + esc(item.name) + '" data-aff-rank="' + rank + '">ดูราคาบน Shopee →</a>'
          : '') +
      '</div></div>' +
      '<span class="buy-price">' + fmt(item.price) + '฿</span></li>';
  }

  function render(budget, picked, skipped, left, have, upgraded) {
    var total = picked.reduce(function (s, p) { return s + p.item.price; }, 0);
    var allTopPick = picked.length > 0 && picked.every(function (p) { return p.item.rank === 1; });
    var html = '';

    if (!picked.length) {
      html += '<div class="status status-warn"><span class="status-icon">△</span><div>' +
              '<b>งบยังไม่พอสำหรับชิ้นแรก</b>' +
              (skipped.length
                ? 'ชิ้นที่ถูกที่สุดในลำดับแรกคือ ' + esc(skipped[0].cheapest.name) +
                  ' ราคา ' + fmt(skipped[0].cheapest.price) + ' บาท'
                : 'ลองเพิ่มงบหรือติ๊กของที่มีอยู่แล้วออก') +
              '</div></div>';
    } else {
      html += '<div class="status status-ok"><span class="status-icon">✓</span><div>' +
              '<b>จัดได้ ' + picked.length + ' ชิ้น จากงบ ' + fmt(budget) + ' บาท</b>' +
              'รวม ' + fmt(total) + ' บาท เหลือ ' + fmt(left) + ' บาท' +
              (Object.keys(have).length ? ' (ข้ามของที่คุณมีอยู่แล้ว ' + Object.keys(have).length + ' หมวด)' : '') +
              '</div></div>';

      html += '<ul class="buy-list">';
      picked.forEach(function (p, i) { html += itemRow(i + 1, p.meta, p.item); });
      html += '</ul>';

      html += '<div class="buy-total"><span>รวมทั้งหมด</span>' +
              '<span class="amt">' + fmt(total) + ' ฿</span></div>';

      // An affiliate site has every incentive to spend the reader's whole budget.
      // Saying "you're done, keep the rest" is the point of the methodology page.
      if (allTopPick && left > 500 && !skipped.length) {
        html += '<div class="status status-ok" style="margin-top:16px">' +
                '<span class="status-icon">💰</span><div><b>ได้ของที่เราแนะนำครบทุกหมวดแล้ว</b>' +
                'เหลืองบอีก ' + fmt(left) + ' บาท และเราไม่มีรุ่นที่แนะนำให้จ่ายเพิ่มกว่านี้ ' +
                'เก็บไว้เถอะครับ — หรือถ้าอยากใช้ต่อ ให้ลงกับของที่วัดผลได้ เช่นเก้าอี้ที่ดีขึ้นอีกขั้น ' +
                'มากกว่าของตกแต่งที่ไม่มีหน้าที่</div></div>';
      }
    }

    if (skipped.length) {
      var needMore = skipped.reduce(function (s, p) { return s + p.cheapest.price; }, 0) - left;
      html += '<h3 style="margin:28px 0 8px;font-size:16px">ยังไม่ได้ในรอบนี้</h3>' +
              '<p class="tool-note" style="margin-top:0">เก็บเงินเพิ่มอีกราว <b>' +
              fmt(Math.max(needMore, 0)) + ' บาท</b> จะได้ครบทั้งชุด — หรือทยอยซื้อทีละชิ้นตามลำดับนี้ก็ได้</p>' +
              '<ul class="buy-list">';
      skipped.forEach(function (p) {
        html += '<li class="buy-item skipped"><span class="buy-rank">–</span>' +
                '<div><div class="buy-cat">' + esc(p.meta.label) + '</div>' +
                '<div class="buy-name">' + esc(p.cheapest.name) + '</div>' +
                '<div class="buy-links">' + esc(p.meta.why) + '</div></div>' +
                '<span class="buy-price">' + fmt(p.cheapest.price) + '฿</span></li>';
      });
      html += '</ul>';
    }

    html += '<p class="tool-note"><b>ราคาเป็นราคา ณ วันที่อัปเดตบทความแต่ละชิ้น</b> ' +
            'ราคาจริงบน Shopee เปลี่ยนตลอดเวลา โดยเฉพาะช่วงแคมเปญ — ให้เช็คหน้าร้านก่อนซื้อเสมอ ' +
            'ตัวเลขในนี้ใช้สำหรับวางแผนงบ ไม่ใช่ราคาที่รับประกัน<br>' +
            'ลิงก์ไป Shopee เป็นลิงก์ affiliate — คุณไม่จ่ายแพงขึ้น ' +
            '(<a href="/affiliate-disclosure">นโยบาย affiliate</a>)</p>';

    $('result-body').innerHTML = html;
    $('result').hidden = false;
  }

  function buildOwnedChips() {
    var wrap = $('owned');
    if (!wrap) return;
    wrap.innerHTML = PRIORITY.filter(function (p) {
      return DATA.categories[p.cat] && DATA.categories[p.cat].length;
    }).map(function (p) {
      return '<label class="chip"><input type="checkbox" id="own-' + encodeURIComponent(p.cat) + '">' +
             esc(p.label) + '</label>';
    }).join('');
    wrap.addEventListener('change', build);
  }

  function syncBudgetLabel() {
    $('budget-value').textContent = fmt(parseInt($('budget').value, 10)) + ' ฿';
  }

  function init() {
    var slider = $('budget');
    if (!slider) return;

    fetch('/tools/budget-data.json', { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.categories) {
          $('result-body').innerHTML =
            '<div class="status status-warn"><span class="status-icon">△</span><div>' +
            '<b>โหลดข้อมูลสินค้าไม่ได้</b>ลองรีเฟรชหน้าอีกครั้ง</div></div>';
          $('result').hidden = false;
          return;
        }
        DATA = data;
        buildOwnedChips();
        slider.addEventListener('input', function () { syncBudgetLabel(); build(); });
        var reset = $('reset');
        if (reset) {
          reset.addEventListener('click', function () {
            slider.value = 10000;
            PRIORITY.forEach(function (p) {
              var el = document.getElementById('own-' + encodeURIComponent(p.cat));
              if (el) el.checked = false;
            });
            syncBudgetLabel();
            build();
          });
        }
        syncBudgetLabel();
        build();
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
