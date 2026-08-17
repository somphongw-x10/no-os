/**
 * pick. price widget — vanilla, zero dependencies, no external requests.
 *
 * Usage in an article:
 *   <div class="pk-price" data-item="9876543210"></div>
 *   <script src="/assets/price-widget.js" defer></script>
 *
 * Optional attributes:
 *   data-link="https://s.shopee.co.th/xxxx"   override the buy button URL
 *   data-compact                              badge + price only, no chart
 *   data-no-cta                               skip the buy button (the page already has one)
 *
 * When a widget renders successfully it hides any element marked
 * data-pk-fallback="<same itemId>" — that is the hand-written price baked into
 * the page, which stays visible for crawlers, no-JS visitors, and any product
 * the tracker has no data for yet.
 *
 * The widget fetches /prices/latest.json ONCE per page no matter how many widgets
 * are on it, and renders nothing at all if the product has no data yet — a broken
 * or empty widget looks worse than no widget.
 */
(function () {
  'use strict';

  var DATA_URL = window.PK_PRICE_DATA_URL || '/prices/latest.json';
  var FMT = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 });
  var DATE_FMT = new Intl.DateTimeFormat('th-TH', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
  });

  var cache = null;

  function load() {
    if (cache) return cache;
    cache = fetch(DATA_URL, { credentials: 'omit' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .catch(function () {
        return null;
      });
    return cache;
  }

  function fmtDate(iso) {
    var parts = String(iso).split('-');
    if (parts.length !== 3) return iso;
    return DATE_FMT.format(new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2])));
  }

  /** Build a sparkline as inline SVG. No library, no layout shift. */
  function sparkline(series, opts) {
    var w = opts.width;
    var h = opts.height;
    var pad = 3;

    var values = series.map(function (p) { return p[1]; });
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var range = max - min || 1;

    var stepX = series.length > 1 ? (w - pad * 2) / (series.length - 1) : 0;

    var pts = series.map(function (p, i) {
      var x = pad + i * stepX;
      var y = pad + (1 - (p[1] - min) / range) * (h - pad * 2);
      return [x, y];
    });

    var line = pts
      .map(function (pt, i) {
        return (i === 0 ? 'M' : 'L') + pt[0].toFixed(1) + ' ' + pt[1].toFixed(1);
      })
      .join(' ');

    var area = line + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + (h - pad) +
               ' L' + pts[0][0].toFixed(1) + ' ' + (h - pad) + ' Z';

    var last = pts[pts.length - 1];

    // Mark the cheapest day so the eye lands on it immediately.
    var lowIdx = values.indexOf(min);
    var lowPt = pts[lowIdx];

    return (
      '<svg class="pk-spark" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" ' +
      'role="img" aria-label="กราฟราคาย้อนหลัง ' + series.length + ' จุด ต่ำสุด ' + FMT.format(min) +
      ' บาท สูงสุด ' + FMT.format(max) + ' บาท" preserveAspectRatio="none">' +
      '<path class="pk-spark-area" d="' + area + '"/>' +
      '<path class="pk-spark-line" d="' + line + '"/>' +
      (lowIdx !== values.length - 1
        ? '<circle class="pk-spark-low" cx="' + lowPt[0].toFixed(1) + '" cy="' + lowPt[1].toFixed(1) + '" r="2.5"/>'
        : '') +
      '<circle class="pk-spark-now" cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="3"/>' +
      '</svg>'
    );
  }

  function render(el, p) {
    var compact = el.hasAttribute('data-compact');
    var link = el.getAttribute('data-link') || p.offerLink;

    var html = '';

    // ---- headline row -------------------------------------------------
    html += '<div class="pk-price-head">';
    html += '<span class="pk-price-now">' + FMT.format(p.current) + '<span class="pk-baht">฿</span></span>';

    if (p.lowestBadgeDays) {
      html += '<span class="pk-badge pk-badge-low">🔥 ถูกสุดใน ' + p.lowestBadgeDays + ' วัน</span>';
    } else {
      var w30 = p.windows && p.windows['30'];
      if (w30 && typeof w30.vsAvg === 'number') {
        if (w30.vsAvg <= -5) {
          html += '<span class="pk-badge pk-badge-good">ต่ำกว่าค่าเฉลี่ย ' + Math.abs(w30.vsAvg) + '%</span>';
        } else if (w30.vsAvg >= 5) {
          html += '<span class="pk-badge pk-badge-warn">สูงกว่าค่าเฉลี่ย ' + w30.vsAvg + '%</span>';
        }
      }
    }
    html += '</div>';

    if (!compact) {
      // ---- chart ------------------------------------------------------
      if (p.spark && p.spark.length >= 2) {
        html += '<div class="pk-spark-wrap">' + sparkline(p.spark, { width: 280, height: 48 }) + '</div>';
        html += '<div class="pk-spark-axis"><span>' + fmtDate(p.spark[0][0]) + '</span>' +
                '<span>' + fmtDate(p.spark[p.spark.length - 1][0]) + '</span></div>';
      }

      // ---- stats ------------------------------------------------------
      var win = (p.windows && (p.windows['90'] || p.windows['30'] || p.windows['7'])) || null;
      if (win) {
        var days = p.windows['90'] ? 90 : p.windows['30'] ? 30 : 7;
        var money = function (n) {
          return FMT.format(Math.round(n)) + '<span class="pk-unit">฿</span>';
        };
        html += '<dl class="pk-stats">';
        html += '<div><dt>ต่ำสุด ' + days + ' วัน</dt><dd>' + money(win.min) + '</dd></div>';
        html += '<div><dt>เฉลี่ย ' + days + ' วัน</dt><dd>' + money(win.avg) + '</dd></div>';
        html += '<div><dt>สูงสุด ' + days + ' วัน</dt><dd>' + money(win.max) + '</dd></div>';
        html += '</dl>';
      }
    }

    // ---- CTA ----------------------------------------------------------
    if (link && !el.hasAttribute('data-no-cta')) {
      html += '<a class="pk-buy" href="' + link + '" target="_blank" rel="nofollow sponsored noopener">' +
              'ดูราคาล่าสุดที่ Shopee</a>';
    }

    // ---- provenance ----------------------------------------------------
    // Saying where the number came from and when is the whole point of doing this.
    html += '<p class="pk-note">ราคา ณ ' + fmtDate(p.currentDate) +
            (compact
              ? ''
              : ' · เก็บข้อมูลเองทุกวันตั้งแต่ ' + fmtDate(p.firstSeen) +
                ' (' + p.totalPoints + ' วัน)') +
            '</p>';

    el.innerHTML = html;
    el.hidden = false;
    el.setAttribute('data-state', 'ready');

    // Refresh the hand-written price baked into the card head, so the number a
    // reader sees while scanning matches the live one in the widget. Updating it
    // in place beats hiding it: the price stays where the eye expects it, and the
    // static value still ships in the HTML for crawlers and no-JS visitors.
    var fallbacks = document.querySelectorAll(
      '[data-pk-fallback="' + String(p.itemId).replace(/"/g, '') + '"]'
    );
    Array.prototype.forEach.call(fallbacks, function (node) {
      var b = node.querySelector('b');
      if (!b) {
        node.hidden = true;
        return;
      }
      b.textContent = FMT.format(p.current) + ' บาท';
      node.classList.add('pk-live');
      node.title = 'ราคาล่าสุด ณ ' + fmtDate(p.currentDate);
    });
  }

  function init() {
    var nodes = document.querySelectorAll('.pk-price[data-item]');
    if (!nodes.length) return;

    // Reserve space up front so filling the widget doesn't shift the article (CLS).
    Array.prototype.forEach.call(nodes, function (el) {
      if (!el.hasAttribute('data-compact')) el.style.minHeight = '190px';
      el.setAttribute('data-state', 'loading');
    });

    load().then(function (data) {
      Array.prototype.forEach.call(nodes, function (el) {
        var id = el.getAttribute('data-item');
        var p = data && data.products && data.products[id];

        if (!p || typeof p.current !== 'number') {
          // No data yet — remove the placeholder entirely rather than show an empty box.
          el.hidden = true;
          el.style.minHeight = '';
          el.setAttribute('data-state', 'empty');
          return;
        }

        el.style.minHeight = '';
        render(el, p);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
