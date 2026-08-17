/**
 * Desk & chair height calculator.
 *
 * Derived from stature using anthropometric proportions rather than one magic
 * multiplier, so the page can show its working:
 *
 *   chair seat  = popliteal height           ≈ 24.5–27% of stature
 *   desk        = seat + seated elbow height ≈ 40–43%   of stature
 *   monitor top = seated eye height          ≈ 69–72%   of stature
 *   standing    = standing elbow height      ≈ 60–63%   of stature
 *
 * Ranges, not single numbers: two people of the same height can differ by
 * several centimetres in leg length, and false precision here would be worse
 * than an honest range.
 */
(function () {
  'use strict';

  var R = {
    seat:     [0.245, 0.270],
    desk:     [0.400, 0.430],
    monitor:  [0.690, 0.720],
    standing: [0.600, 0.630],
  };

  // Distance from seat pan to elbow when sitting upright — the gap the desk has
  // to clear above the chair. Falls out of the two ranges above.
  var ELBOW_ABOVE_SEAT = 0.1575;

  var THAI_STANDARD_DESK = 75; // cm — what nearly every ready-made desk here is

  function $(id) { return document.getElementById(id); }
  function cm(n) { return Math.round(n); }
  function range(h, key) { return [cm(h * R[key][0]), cm(h * R[key][1])]; }
  function fmtRange(r) { return r[0] === r[1] ? String(r[0]) : r[0] + '–' + r[1]; }

  function card(label, value, note) {
    return '<div class="rcard"><div class="rcard-label">' + label + '</div>' +
           '<div class="rcard-value">' + value + '<span class="rcard-unit">ซม.</span></div>' +
           (note ? '<div class="rcard-note">' + note + '</div>' : '') + '</div>';
  }

  function banner(cls, icon, title, body) {
    return '<div class="status ' + cls + '"><span class="status-icon">' + icon + '</span>' +
           '<div><b>' + title + '</b>' + body + '</div></div>';
  }

  /**
   * Advice about the desk they already own. The useful part is not "your desk is
   * wrong" but the two numbers that fix it: what to set the chair to, and how
   * far their feet will then dangle.
   */
  function deskAdvice(h, deskR, seatR, actual) {
    if (!actual) return '';

    if (actual >= deskR[0] && actual <= deskR[1]) {
      return banner('status-ok', '✓', 'โต๊ะที่คุณมีอยู่พอดีแล้ว',
        'ความสูง ' + actual + ' ซม. อยู่ในช่วงที่เหมาะกับคุณ (' + fmtRange(deskR) + ' ซม.) ' +
        'ที่เหลือคือปรับเก้าอี้ให้อยู่ราว ' + fmtRange(seatR) + ' ซม. และยกขอบบนจอขึ้นให้ถึงระดับสายตา');
    }

    if (actual > deskR[1]) {
      var over = cm(actual - deskR[1]);
      // With a fixed desk, the chair has to come up to meet it.
      var chairNeeded = cm(actual - h * ELBOW_ABOVE_SEAT);
      var dangle = cm(chairNeeded - (seatR[0] + seatR[1]) / 2);

      return banner(over > 6 ? 'status-bad' : 'status-warn', over > 6 ? '!' : '△',
        'โต๊ะสูงเกินไปประมาณ ' + over + ' ซม.',
        'ถ้าใช้ความสูงเก้าอี้ปกติ คุณจะต้องยกไหล่ค้างทั้งวัน ซึ่งเป็นสาเหตุอันดับต้น ๆ ของอาการปวดบ่าและคอ<br>' +
        '<b>ไม่ต้องซื้อโต๊ะใหม่</b> — ปรับเก้าอี้ขึ้นเป็นราว <b>' + chairNeeded + ' ซม.</b> ' +
        'แล้วหาที่วางเท้าสูงประมาณ <b>' + Math.max(dangle, 0) + ' ซม.</b> มารอง ไม่ให้เท้าลอย ' +
        '(เท้าลอยคือสาเหตุของอาการชาขาและปวดหลังส่วนล่าง)' +
        (over > 6 ? '<br>ส่วนต่างระดับนี้ค่อนข้างมาก ถ้าปรับแล้วยังไม่สบาย โต๊ะปรับระดับจะแก้ได้ถาวรกว่า' : ''));
    }

    var under = cm(deskR[0] - actual);
    return banner(under > 6 ? 'status-bad' : 'status-warn', '△',
      'โต๊ะเตี้ยเกินไปประมาณ ' + under + ' ซม.',
      'โต๊ะที่เตี้ยเกินทำให้ต้องห่อไหล่และก้มคอ ซึ่งมักเจ็บกว่าโต๊ะที่สูงเกิน<br>' +
      'ทางแก้: หนุนขาโต๊ะด้วยแท่นรองขาโต๊ะสูงราว <b>' + under + ' ซม.</b> ' +
      'หรือถ้าเตี้ยไม่มาก ลดความสูงเก้าอี้ลงแล้วยกจอขึ้นด้วยขาตั้งจอแทน');
  }

  function calc() {
    var h = parseFloat($('height').value);
    var result = $('result');

    if (!h || h < 120 || h > 220) {
      result.hidden = true;
      return;
    }

    var seat = range(h, 'seat');
    var desk = range(h, 'desk');
    var mon = range(h, 'monitor');
    var stand = range(h, 'standing');

    var raw = parseFloat($('desk-actual').value);
    var actual = (raw >= 50 && raw <= 130) ? raw : null;

    var html = deskAdvice(h, desk, seat, actual);

    html += '<div class="result-grid">' +
            card('ความสูงโต๊ะ (นั่ง)', fmtRange(desk), 'ข้อศอก 90–110°') +
            card('ความสูงเบาะเก้าอี้', fmtRange(seat), 'เท้าวางเต็มฝ่าเท้า') +
            card('ขอบบนจอ จากพื้น', fmtRange(mon), 'ระดับสายตาหรือต่ำกว่านิดหน่อย') +
            card('ความสูงโต๊ะ (ยืน)', fmtRange(stand), 'สำหรับโต๊ะปรับระดับ') +
            '</div>';

    var vs = THAI_STANDARD_DESK - desk[1];
    html += '<p class="tool-note">โต๊ะสำเร็จรูปทั่วไปในไทยสูง <b>75 ซม.</b> — ' +
            (vs > 2
              ? 'สูงกว่าช่วงที่เหมาะกับคุณราว <b>' + cm(vs) + ' ซม.</b>'
              : vs < -2
                ? 'เตี้ยกว่าช่วงที่เหมาะกับคุณราว <b>' + cm(-vs) + ' ซม.</b>'
                : 'ซึ่งอยู่ในช่วงที่พอดีกับคุณ') +
            '<br>ตัวเลขทั้งหมดเป็นค่าประมาณจากส่วนสูง สัดส่วนร่างกายแต่ละคนต่างกัน ' +
            'ให้ใช้เป็นจุดตั้งต้นแล้วปรับตามความรู้สึกจริง — เกณฑ์ที่แม่นที่สุดคือไหล่ผ่อนคลายและข้อศอกราว 90°</p>';

    $('result-body').innerHTML = html;
    result.hidden = false;
  }

  function init() {
    var h = $('height');
    if (!h) return;
    var d = $('desk-actual');

    [h, d].forEach(function (el) {
      if (!el) return;
      el.addEventListener('input', calc);
      el.addEventListener('change', calc);
    });

    var reset = $('reset');
    if (reset) {
      reset.addEventListener('click', function () {
        h.value = '';
        if (d) d.value = '';
        $('result').hidden = true;
        h.focus();
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
