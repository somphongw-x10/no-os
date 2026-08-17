/**
 * Power-strip load checker (Thailand: 230 V mains).
 *
 *   max watts = rated amps × 230
 *
 * The warning threshold is 80% of rating, not 100%: running near the full
 * rating for hours heats the cable and sockets, and TIS 2432-2555 itself is
 * specified for an ambient of ≤40°C (≤35°C average under continuous use).
 *
 * Device wattages are typical figures for models sold in Thailand and are
 * labelled as estimates in the UI — the real number is on the device's label.
 */
(function () {
  'use strict';

  var VOLTS = 230;
  var SAFE_FRACTION = 0.8;

  // [id, label, watts, group]
  var DEVICES = [
    ['laptop',    'โน้ตบุ๊ก + อะแดปเตอร์', 65,   'โต๊ะทำงาน'],
    ['desktop',   'คอมตั้งโต๊ะ',           350,  'โต๊ะทำงาน'],
    ['monitor',   'จอมอนิเตอร์',           30,   'โต๊ะทำงาน'],
    ['monitor2',  'จอมอนิเตอร์ ตัวที่ 2',   30,   'โต๊ะทำงาน'],
    ['lamp',      'โคมไฟตั้งโต๊ะ LED',      10,   'โต๊ะทำงาน'],
    ['router',    'เราเตอร์ / ONU',        15,   'โต๊ะทำงาน'],
    ['speaker',   'ลำโพงตั้งโต๊ะ',          20,   'โต๊ะทำงาน'],
    ['printer',   'ปรินเตอร์ (ตอนพิมพ์)',   400,  'โต๊ะทำงาน'],
    ['charger',   'ที่ชาร์จมือถือ / GaN',   45,   'โต๊ะทำงาน'],
    ['hub',       'USB Hub มีไฟเลี้ยง',     20,   'โต๊ะทำงาน'],

    ['fan',       'พัดลมตั้งพื้น',          60,   'ในห้อง'],
    ['aircon_p',  'แอร์เคลื่อนที่',         1200, 'ในห้อง'],
    ['tv',        'ทีวี',                  120,  'ในห้อง'],
    ['humid',     'เครื่องฟอกอากาศ',        50,   'ในห้อง'],

    ['kettle',    'กาต้มน้ำไฟฟ้า',          1800, 'ให้ความร้อน ⚠'],
    ['microwave', 'ไมโครเวฟ',              1000, 'ให้ความร้อน ⚠'],
    ['iron',      'เตารีด',                1600, 'ให้ความร้อน ⚠'],
    ['heater',    'ฮีตเตอร์ / เครื่องทำน้ำอุ่น', 2000, 'ให้ความร้อน ⚠'],
    ['coffee',    'เครื่องชงกาแฟ',          1000, 'ให้ความร้อน ⚠'],
    ['rice',      'หม้อหุงข้าว',            700,  'ให้ความร้อน ⚠'],
    ['dryer',     'ไดร์เป่าผม',             1500, 'ให้ความร้อน ⚠'],
  ];

  var HEAT_GROUP = 'ให้ความร้อน ⚠';

  function $(id) { return document.getElementById(id); }
  function fmt(n) { return n.toLocaleString('th-TH'); }

  function selected() {
    return DEVICES.filter(function (d) {
      var el = document.getElementById('dev-' + d[0]);
      return el && el.checked;
    });
  }

  function calc() {
    var amps = parseFloat($('amps').value) || 10;
    var extra = parseFloat($('extra').value) || 0;

    var picked = selected();
    var total = picked.reduce(function (s, d) { return s + d[2]; }, 0) + extra;

    var max = amps * VOLTS;
    var safe = max * SAFE_FRACTION;
    var pct = total / max;

    var cls, icon, title, body;

    if (total === 0) {
      $('result').hidden = true;
      return;
    }

    if (total > max) {
      cls = 'status-bad'; icon = '!';
      title = 'เกินพิกัด — อันตราย';
      body = 'รวม ' + fmt(total) + ' วัตต์ เกินพิกัดของปลั๊ก (' + fmt(max) + ' วัตต์) อยู่ ' +
             fmt(total - max) + ' วัตต์ ต้องถอดอุปกรณ์ออกหรือแยกไปเสียบเต้ารับผนังอีกจุด ' +
             'การใช้งานแบบนี้ทำให้สายร้อนจนละลายและเกิดเพลิงไหม้ได้';
    } else if (total > safe) {
      cls = 'status-warn'; icon = '△';
      title = 'ใกล้เต็มพิกัดเกินไป';
      // Past the 80% line the "headroom left" figure goes negative — say how much
      // to take off instead.
      body = 'รวม ' + fmt(total) + ' วัตต์ คิดเป็น ' + Math.round(pct * 100) + '% ของพิกัด ' +
             'ยังไม่เกินพิกัด แต่การใช้เกิน 80% ต่อเนื่องทำให้สายและเต้ารับร้อนสะสม ' +
             'ควรย้ายอุปกรณ์ที่กินไฟรวมราว <b>' + fmt(Math.ceil(total - safe)) + ' วัตต์</b> ' +
             'ไปเสียบเต้ารับผนังแทน';
    } else {
      cls = 'status-ok'; icon = '✓';
      title = 'ปลอดภัย';
      body = 'รวม ' + fmt(total) + ' วัตต์ คิดเป็น ' + Math.round(pct * 100) + '% ของพิกัด ' +
             'ยังเสียบเพิ่มได้อีกราว ' + fmt(Math.round(safe - total)) + ' วัตต์ ก่อนถึงเกณฑ์เตือนที่ 80%';
    }

    var barPct = Math.min(pct * 100, 100);
    var barColor = total > max ? '#a11212' : total > safe ? '#d08700' : '#0b6b45';

    var html = '<div class="status ' + cls + '"><span class="status-icon">' + icon + '</span>' +
               '<div><b>' + title + '</b>' + body + '</div></div>';

    html += '<div class="meter"><div class="meter-fill" style="width:' + barPct + '%;background:' + barColor + '"></div></div>' +
            '<div class="meter-scale"><span>0</span><span>เกณฑ์เตือน ' + fmt(Math.round(safe)) + ' W</span>' +
            '<span>พิกัด ' + fmt(max) + ' W</span></div>';

    html += '<div class="result-grid" style="margin-top:16px">' +
            '<div class="rcard"><div class="rcard-label">กำลังไฟรวม</div>' +
            '<div class="rcard-value">' + fmt(total) + '<span class="rcard-unit">วัตต์</span></div></div>' +
            '<div class="rcard"><div class="rcard-label">พิกัดปลั๊ก</div>' +
            '<div class="rcard-value">' + fmt(max) + '<span class="rcard-unit">วัตต์</span></div>' +
            '<div class="rcard-note">' + amps + 'A × ' + VOLTS + 'V</div></div>' +
            '<div class="rcard"><div class="rcard-label">กระแสที่ดึงจริง</div>' +
            '<div class="rcard-value">' + (total / VOLTS).toFixed(1) + '<span class="rcard-unit">แอมป์</span></div></div>' +
            '</div>';

    // Heating appliances are the actual cause of nearly every power-strip fire —
    // call them out separately even when the total is within budget.
    var heaters = picked.filter(function (d) { return d[3] === HEAT_GROUP; });
    if (heaters.length) {
      html += '<div class="status status-warn" style="margin-top:16px">' +
              '<span class="status-icon">🔥</span><div><b>มีอุปกรณ์ให้ความร้อนอยู่ในรายการ</b>' +
              heaters.map(function (d) { return d[1]; }).join(', ') +
              ' — อุปกรณ์ให้ความร้อนดึงกระแสสูงต่อเนื่องและเป็นสาเหตุของเหตุไฟไหม้จากปลั๊กพ่วงเกือบทุกกรณี ' +
              '<b>ควรเสียบเต้ารับผนังโดยตรง</b> ไม่ควรผ่านปลั๊กพ่วง แม้กำลังไฟรวมจะยังไม่เกินพิกัดก็ตาม</div></div>';
    }

    html += '<p class="tool-note">ค่าวัตต์ของแต่ละอุปกรณ์เป็นค่ากลางของรุ่นที่ขายทั่วไปในไทย ' +
            'ของจริงดูได้จากฉลากบนตัวเครื่องหรืออะแดปเตอร์ — ถ้าอยากแม่นกว่านี้ใส่เพิ่มเองในช่อง “อุปกรณ์อื่น” ' +
            'เราคำนวณด้วยค่าสูงสุดของอุปกรณ์ ซึ่งเป็นการเผื่อความปลอดภัย ของจริงมักกินน้อยกว่านี้</p>';

    $('result-body').innerHTML = html;
    $('result').hidden = false;
  }

  function buildChips() {
    var wrap = $('devices');
    if (!wrap) return;

    var groups = [];
    DEVICES.forEach(function (d) { if (groups.indexOf(d[3]) === -1) groups.push(d[3]); });

    wrap.innerHTML = groups.map(function (g) {
      var chips = DEVICES.filter(function (d) { return d[3] === g; }).map(function (d) {
        return '<label class="chip"><input type="checkbox" id="dev-' + d[0] + '">' +
               d[1] + ' <span class="w">' + d[2] + 'W</span></label>';
      }).join('');
      return '<div style="margin-bottom:18px"><div class="fieldset-label">' + g + '</div>' +
             '<div class="chips">' + chips + '</div></div>';
    }).join('');

    wrap.addEventListener('change', calc);
  }

  function init() {
    if (!$('devices')) return;
    buildChips();
    ['amps', 'extra'].forEach(function (id) {
      var el = $(id);
      if (el) { el.addEventListener('input', calc); el.addEventListener('change', calc); }
    });
    var reset = $('reset');
    if (reset) {
      reset.addEventListener('click', function () {
        DEVICES.forEach(function (d) {
          var el = document.getElementById('dev-' + d[0]);
          if (el) el.checked = false;
        });
        $('extra').value = '';
        $('result').hidden = true;
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
