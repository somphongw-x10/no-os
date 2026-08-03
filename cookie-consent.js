/**
 * PDPA-friendly cookie consent banner for pick / no-os.com.
 *
 * Works together with the Consent Mode v2 default set in each page's <head>
 * (analytics_storage starts 'denied'). This script shows the banner only when
 * the visitor hasn't chosen yet, then updates Google consent + remembers the
 * choice in localStorage so GA can (or cannot) set analytics cookies.
 *
 * Self-contained: injects its own styles and markup, so it renders identically
 * on the homepage and every article page without touching their CSS.
 */
(function () {
  'use strict';

  var KEY = 'cookieConsent';          // 'granted' | 'denied'
  var stored;
  try { stored = localStorage.getItem(KEY); } catch (e) {}
  if (stored === 'granted' || stored === 'denied') return;   // already chosen

  function persist(value) {
    try { localStorage.setItem(KEY, value); } catch (e) {}
    if (typeof window.gtag === 'function') {
      window.gtag('consent', 'update', {
        analytics_storage: value === 'granted' ? 'granted' : 'denied'
      });
    }
  }

  var CSS =
    '.cc-banner{position:fixed;left:0;right:0;bottom:0;z-index:9999;' +
      'background:#fff;border-top:1px solid #DFDFDF;box-shadow:0 -4px 16px rgba(0,0,0,.08);' +
      'font-family:"Noto Sans Thai",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}' +
    '.cc-inner{max-width:1440px;margin:0 auto;padding:20px 40px;display:flex;align-items:center;' +
      'gap:32px;justify-content:space-between;flex-wrap:wrap;}' +
    '.cc-text{font-size:14px;line-height:1.6;color:#484848;max-width:760px;}' +
    '.cc-text strong{display:block;font-size:15px;color:#111;margin-bottom:4px;font-weight:700;}' +
    '.cc-text a{color:#00807a;text-decoration:underline;}' +
    '.cc-actions{display:flex;gap:12px;flex-shrink:0;}' +
    '.cc-btn{height:44px;padding:0 24px;border-radius:64px;font-size:14px;font-weight:600;cursor:pointer;' +
      'font-family:inherit;border:1px solid #111;background:#fff;color:#111;transition:background .15s,color .15s;}' +
    '.cc-btn:hover{background:#F5F5F5;}' +
    '.cc-accept{background:#00807a;border-color:#00807a;color:#fff;}' +
    '.cc-accept:hover{background:#016b66;}' +
    '@media(max-width:767px){.cc-inner{padding:16px 20px;gap:16px;}' +
      '.cc-actions{width:100%;}.cc-btn{flex:1;}}';

  function build() {
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    var banner = document.createElement('div');
    banner.className = 'cc-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-live', 'polite');
    banner.setAttribute('aria-label', 'การยินยอมใช้คุกกี้');
    banner.innerHTML =
      '<div class="cc-inner">' +
        '<div class="cc-text">' +
          '<strong>เว็บไซต์นี้ใช้คุกกี้</strong>' +
          'เราใช้คุกกี้เพื่อวิเคราะห์การเข้าชมเว็บไซต์ (Google Analytics) และปรับปรุงประสบการณ์การใช้งานให้ดีขึ้น ' +
          'คุณสามารถเลือกยอมรับหรือปฏิเสธคุกกี้เพื่อการวิเคราะห์ได้ คุกกี้ที่จำเป็นต่อการทำงานของเว็บไซต์จะยังคงทำงานอยู่เสมอ' +
        '</div>' +
        '<div class="cc-actions">' +
          '<button class="cc-btn cc-decline" type="button">ปฏิเสธ</button>' +
          '<button class="cc-btn cc-accept" type="button">ยอมรับ</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(banner);

    function close() {
      if (banner.parentNode) banner.parentNode.removeChild(banner);
    }
    banner.querySelector('.cc-accept').addEventListener('click', function () { persist('granted'); close(); });
    banner.querySelector('.cc-decline').addEventListener('click', function () { persist('denied'); close(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
