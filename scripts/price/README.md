# Price tracker

เก็บราคา Shopee ของสินค้าทุกตัวบนเว็บทุกวัน แล้วแสดงเป็นกราฟ + ป้าย "ถูกสุดใน N วัน" บนหน้าบทความ

รันบน GitHub Actions ฟรี ไม่มี dependency ไม่ต้องมีเซิร์ฟเวอร์

**ทำไมต้องมี:** Google อัปเดต quality/spam ปี 2026 ตีเว็บ affiliate ที่เป็น "ตารางเทียบสเปคแบบเทมเพลต ไม่มีการทดสอบเองหรือรูปเอง" หนักที่สุด ราคาย้อนหลังคือ **ข้อมูลปฐมภูมิที่ผลิตได้โดยไม่ต้องซื้อสินค้ามาทดสอบ** — และไม่มีเว็บไทยเจ้าไหนทำ

> ⏰ ข้อมูลย้อนหลังสร้างย้อนหลังไม่ได้ ทุกวันที่ยังไม่รัน = คูเมืองที่หายไปหนึ่งวัน

---

## โครงสร้าง

```
scripts/price/
  lib/shopee.mjs        client เรียก Shopee Affiliate API (เซ็น signature, retry, parse URL)
  introspect.mjs        ดึง GraphQL schema จริงมายืนยันชื่อฟิลด์  ← รันก่อนเพื่อน
  seed-products.mjs     อ่าน articles.json → data/*.json → คลาย short link → prices/products.json
  fetch-prices.mjs      ดึงราคาวันละครั้ง → prices/history/<itemId>.json
  build-summary.mjs     คำนวณสถิติ 7/30/90 วัน → prices/latest.json
  mock-data.mjs         สร้างข้อมูลปลอมไว้ดูหน้าตาก่อน API พร้อม
  test.mjs              ชุดทดสอบ 25 เคส ไม่ต้องใช้ credential

prices/                 ข้อมูล (สร้างอัตโนมัติ commit ลง repo)
  products.json         แคตตาล็อก: shopeeUrl → itemId/shopId
  history/<itemId>.json ประวัติราคา จุดละวัน
  latest.json           ← ไฟล์เดียวที่หน้าเว็บโหลด

price-widget.js/.css    วิดเจ็ตบนหน้าบทความ (อยู่ root ตามแบบ article.js/article.css)
.github/workflows/      price-tracker.yml (cron รายวัน) · price-seed.yml (กดรันเอง)
```

`build.py` อ่าน `prices/products.json` แล้วฝัง `<div class="pk-price" data-item="...">` ลงในการ์ดสินค้าให้เอง — **ถ้าไฟล์ยังไม่มี build ก็ผ่านปกติ ไม่มีวิดเจ็ตเท่านั้น**

---

## ติดตั้ง

### 1. ดูหน้าตาก่อน (ไม่ต้องมี credential)

```bash
node scripts/price/mock-data.mjs      # สร้างข้อมูลปลอม 90 วันจากสินค้าจริง 8 ตัวแรก
node scripts/price/build-summary.mjs
python3 build.py
npx serve .                          # เปิด http://localhost:3000/wireless-mouse-under-500
```

ลบทิ้งด้วย `node scripts/price/mock-data.mjs --clean` แล้ว `python3 build.py` อีกครั้ง

### 2. เอา credential จาก Shopee

1. https://affiliate.shopee.co.th → เมนู **Open API** (https://affiliate.shopee.co.th/open_api/list)
2. สร้าง App → ได้ **App ID** + **Secret** (Secret โชว์ครั้งเดียว เก็บไว้ให้ดี)

ถ้าเมนูยังไม่เปิดให้บัญชีคุณ ต้องยื่นขอสิทธิ์กับ Shopee ก่อน

### 3. ใส่ GitHub Secrets

repo → Settings → Secrets and variables → Actions → New repository secret

| ชื่อ | ค่า |
|---|---|
| `SHOPEE_APP_ID` | App ID |
| `SHOPEE_SECRET` | Secret |

### 4. ยืนยัน schema — อย่าข้าม

ชื่อฟิลด์ใน API ต่างกันตามประเทศและเวอร์ชัน:

```bash
SHOPEE_APP_ID=xxx SHOPEE_SECRET=yyy node scripts/price/introspect.mjs
```

เอาผลลัพธ์ไปเทียบกับ `PRODUCT_FIELDS` ใน `fetch-prices.mjs` **ถ้าชื่อไหนไม่ตรง แก้ที่นั่นที่เดียว**

### 5. Seed แคตตาล็อก

ลิงก์ Shopee บนเว็บนี้เป็น short link (`s.shopee.co.th/xxx`) ทั้ง 131 ตัว ซึ่งไม่มี id อยู่ในตัว ต้องยิงตาม redirect ทีละอันเพื่อหา `shopId`/`itemId`

รันที่ **Actions → Seed price catalogue → Run workflow** (ต้องมีเน็ต) หรือรันในเครื่อง:

```bash
node scripts/price/seed-products.mjs
```

ผลลัพธ์เข้า `prices/products.json` — ตัวที่คลายไม่ออกจะถูกบันทึกไว้พร้อม `"enabled": false` และคำอธิบาย ให้เปิดไฟล์เติม id เองได้

รันซ้ำได้ตลอด id ที่คลายแล้วจะถูก cache ไว้ ไม่ยิงซ้ำ (ใช้ `--force` ถ้าอยากคลายใหม่หมด)

### 6. เก็บราคาครั้งแรก

```bash
SHOPEE_APP_ID=xxx SHOPEE_SECRET=yyy node scripts/price/fetch-prices.mjs
node scripts/price/build-summary.mjs
python3 build.py
git add prices *.html && git commit -m "data: first price snapshot" && git push
```

จากนั้น Actions รันเองทุกวัน 09:10 น. (เวลาไทย)

---

## วิดเจ็ตทำงานยังไง

`build.py` ฝัง 2 อย่างลงในการ์ดสินค้าที่มี itemId:

```html
<div class="price-tag" data-pk-fallback="9876543210">ราคา Shopee: <b>409 บาท</b></div>
...
<div class="pk-price" data-item="9876543210" data-no-cta></div>
```

- ราคาที่เขียนมือ **ยังอยู่ใน HTML** → crawler, คนปิด JS และสินค้าที่ยังไม่มีประวัติ ยังเห็นตัวเลข
- พอวิดเจ็ตโหลดสำเร็จ มัน**อัปเดตตัวเลขนั้นให้เป็นราคาล่าสุด**ในที่เดิม (มีจุดเขียวกำกับ) ไม่ใช่ซ่อน — ราคายังอยู่ตรงที่ตาคนมองหา และหน้าเว็บไม่เคยโชว์ตัวเลขขัดกันเอง
- `data-no-cta` = ไม่สร้างปุ่มซื้อซ้ำ ปุ่มเดิมของคุณ (พร้อม `data-aff-item` ที่ affiliate-track.js ใช้) ยังทำงานเหมือนเดิม

attribute เสริม:

| attribute | ผล |
|---|---|
| `data-compact` | แสดงแค่ราคา + ป้าย ไม่มีกราฟ (เหมาะกับตารางเปรียบเทียบ) |
| `data-link="..."` | บังคับ URL ปุ่มซื้อ |
| `data-no-cta` | ไม่สร้างปุ่มซื้อ |

ตั้ง `"widget": false` ในรายการสินค้าใน `prices/products.json` เพื่อซ่อนวิดเจ็ตของตัวนั้นโดยไม่หยุดเก็บข้อมูล

---

## การตัดสินใจออกแบบ

**ป้าย "ถูกสุดใน N วัน" ขึ้นเฉพาะ 30 กับ 90 วัน ไม่ขึ้นที่ 7 วัน**
"ถูกสุดใน 7 วัน" จริงตามตัวเลข แต่อ่านแล้วเหมือนโม้ เว็บที่กำลังสร้างความน่าเชื่อถือจากศูนย์ เสียเครดิตหนึ่งครั้งแพงกว่าคลิกที่ได้มา และต้องมีข้อมูล ≥14 จุด + ครอบคลุมช่วงนั้น ≥60% ป้ายถึงจะขึ้น

**หนึ่งจุดต่อสินค้าต่อวัน** รันซ้ำวันเดิม = เขียนทับจุดเดิม ไม่ append ซ้ำ → workflow ที่ retry ปลอดภัย

**สินค้าตัวไหนพังก็ข้ามไป ไม่ล้มทั้งงาน** เสีย 1 SKU ต้องไม่ทำให้อีก 130 ตัวไม่ได้ข้อมูลของวันนั้น แต่ถ้าพัง**ทั้งหมด** จะ fail ทันที เพราะนั่นแปลว่า credential หรือ schema มีปัญหา

**`enabled` กับ `widget` แยกกัน** `enabled: false` = ไม่ยิง API (เช่นสินค้าเลิกขาย) แต่วิดเจ็ตยังโชว์ประวัติที่มีอยู่ ถ้าอยากซ่อนวิดเจ็ตใช้ `widget: false`

**ประวัติแยกไฟล์ต่อ itemId** ไฟล์เล็ก git diff อ่านง่าย และหน้าเว็บโหลดแค่ `latest.json` ไฟล์เดียว (ย่อเหลือ 90 จุด)

**วิดเจ็ตจองพื้นที่ก่อนโหลด** กัน CLS · ไม่มีข้อมูล = ซ่อนทั้งอัน ไม่โชว์กล่องว่าง · กราฟเป็น inline SVG ไม่พึ่ง Chart.js ไม่มี request นอก

**เรียกผ่าน Affiliate Open API ไม่ใช่ scrape** ถูก ToS เสถียร ไม่โดนบล็อก หน่วง 1.2 วิ ระหว่าง request

**บรรทัด "เก็บข้อมูลเองทุกวันตั้งแต่..."** คือส่วนที่สร้าง E-E-A-T — บอก Google และคนอ่านว่าตัวเลขนี้มาจากไหนและเมื่อไหร่ **ห้ามตัดออก**

---

## แก้ปัญหา

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| `Invalid Signature` | signature = `SHA256(AppId + Timestamp + Payload + Secret)` โดย Payload ต้องเป็น JSON string ตัวเดียวกับที่ส่งจริงเป๊ะทุกไบต์ และนาฬิกาเครื่องต้องตรง (คลาดเกิน ~5 นาทีไม่ผ่าน) |
| `Cannot query field "xxx"` | ชื่อฟิลด์ไม่ตรง schema → รัน `introspect.mjs` แล้วแก้ `PRODUCT_FIELDS` |
| ทุกตัว `no offer returned` | สินค้าไม่อยู่ในแคตตาล็อก affiliate หรือ `shopId`/`itemId` สลับกัน |
| seed คลาย link ไม่ออก | short link อาจตาย/เปลี่ยน → เปิด `prices/products.json` เติม id เอง หรือแก้ลิงก์ใน `data/*.json` |
| วิดเจ็ตไม่โผล่ | เช็คว่า `prices/latest.json` มี itemId นั้น และ `python3 build.py` รันหลัง seed แล้ว |
| Actions ไม่รันตามเวลา | GitHub cron ที่นาที `:00` มักถูกหน่วง ไฟล์นี้ตั้ง `:10` แล้ว |
| push ชนกัน | workflow rebase แล้ว retry เอง 3 ครั้ง |

```bash
node scripts/price/test.mjs   # 25 เคส ไม่ต้องใช้เน็ตหรือ credential
```

---

## ขั้นต่อไป

1. **หน้า `/deals`** — รวมสินค้าที่วันนี้ราคาต่ำสุด อ่านจาก `prices/latest.json` ตรง ๆ เป็นหน้าที่คนกลับมาดูซ้ำ
2. **หน้า `/data`** — เปิดข้อมูลราคาย้อนหลังเป็นตาราง ให้ AI search และคนอื่นอ้างอิง = citation magnet
3. **แจ้งเตือนราคา** — เก็บอีเมล ส่งเมื่อของที่สนใจแตะราคาต่ำสุด
4. **บทความ 9.9 / 10.10** — *"อันไหนลดจริง อันไหนขึ้นราคาก่อนลด"* ← จุดสูงสุดของคูเมืองนี้
