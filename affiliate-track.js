/**
 * Sends an "affiliate_click" event to GA4 whenever a Shopee affiliate link is
 * clicked. Uses event delegation so it also covers links inside pre-rendered
 * article content, and keeps working if cards are added later.
 *
 * Every affiliate link opens in a new tab (target="_blank"), so the current page
 * is never unloaded — a plain gtag() call is enough, no beacon/redirect needed.
 */
(function () {
  'use strict';

  var AFFILIATE_HOST = 'shopee';
  var MAX_LEN = 100; // GA4 truncates parameter values beyond 100 chars

  function trim(value) {
    if (!value) return undefined;
    value = String(value).replace(/\s+/g, ' ').trim();
    return value ? value.slice(0, MAX_LEN) : undefined;
  }

  document.addEventListener('click', function (e) {
    var link = e.target.closest && e.target.closest('a[href*="' + AFFILIATE_HOST + '"]');
    if (!link) return;

    // middle-click and modifier-clicks still open the link, so they count too;
    // right-click (contextmenu) never fires this handler.
    if (e.button !== 0 && e.button !== 1) return;

    if (typeof window.gtag !== 'function') return;

    var isCard = link.classList.contains('btn');

    window.gtag('event', 'affiliate_click', {
      link_url:    trim(link.href),
      link_text:   trim(link.textContent),
      item_name:   trim(link.dataset.affItem) || trim(link.textContent),
      item_rank:   link.dataset.affRank ? Number(link.dataset.affRank) : undefined,
      placement:   isCard ? 'product_card' : 'in_article',
      article:     trim(location.pathname.replace(/^\/|\.html$/g, '')) || 'home',
      affiliate:   'shopee'
    });
  }, true);
})();
