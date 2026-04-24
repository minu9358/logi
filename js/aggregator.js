/* ════════════════════════════════════════════════════════════
   매핑관리 & 출고집계  v3
   ─────────────────────────────────────────────────────────────
   데이터 구조:
   ┌ 채널 마스터 (LS_CHANNELS)
   │  { id, name, dozone_code, is_own }
   │
   ├ 품목 마스터 (LS_ITEMS)
   │  { id, item_code, item_name, ratio }
   │  ratio = 본사 기준단위 배수 (기본값 1)
   │
   ├ 채널별 상품매핑 (LS_MAPPING)  ← 핵심 테이블
   │  {
   │    id, channel_id,
   │    sku,        ← 채널 고유 SKU/코드 (선택) — 매칭 1순위
   │    excel_name, ← 엑셀/주문서에 표기된 상품명 — 매칭 2순위
   │    items: [   ← 번들 품목 목록 (복수 품목 지원)
   │      { item_id, ratio }  ← ratio = 수량배수 (null이면 품목 마스터 기본값)
   │    ]
   │  }
   │  ※ 구형 호환: item_id + ratio 필드 있으면 items 배열로 자동 변환
   │
   │  매칭 우선순위:
   │    ① SKU 완전일치  →  ② 엑셀상품명 완전일치
   │    →  ③ 정규화 일치  →  ④ 부분포함 일치
   │
   └ 결과: 더존 출력 포맷
     채널명 | 더존코드 | 품번(item_code) | 품명 | 수량
   ════════════════════════════════════════════════════════════ */

const LS_CHANNELS = 'agg_channels_v3';
const LS_ITEMS    = 'agg_items_v3';
const LS_MAPPING  = 'agg_mapping_v3';

// ── 컬럼 자동 감지 키워드 ───────────────────────────────────
// 헤더 행에서 키워드를 찾아 열 인덱스를 자동으로 결정합니다.
// 헤더가 없는 파일은 아래 fallback 고정 인덱스를 사용합니다.
const OWN_PRODUCT_KEYWORDS = /상품명|품명|제품명|상품|품목|옵션.*품목|주문.*상품|product|item.?name/i;
const OWN_QTY_KEYWORDS     = /수량|qty|quantity|주문.*수량|출고.*수량/i;
const OWN_CANCEL_KEYWORDS  = /취소|cancel|반품|환불/i;

const SAB_MALL_KEYWORDS    = /쇼핑몰|몰.*명|채널|mall|shop.*name|판매처/i;
const SAB_PRODUCT_KEYWORDS = /상품명|품명|제품명|상품|item.?name|product/i;
const SAB_QTY_KEYWORDS     = /수량|qty|quantity/i;
const OWN_SKU_KEYWORDS     = /sku|상품코드|품번코드|옵션코드|item.?code|product.?code|자사코드/i;
const SAB_SKU_KEYWORDS     = /sku|상품코드|품번코드|옵션코드|item.?code|product.?code|쇼핑몰.*코드|채널.*코드/i;

// fallback 고정 인덱스 (헤더에서 못 찾은 경우)
// 자사몰 양식 A: G열=품명, H열=수량 (기본)
const OWN_COL_PRODUCT_FB  = 6;   // G열
const OWN_COL_QTY_FB      = 7;   // H열
// 자사몰 양식 B: 다른 배치일 때를 위한 대체 fallback
const OWN_COL_PRODUCT_FB2 = 7;   // H열
const OWN_COL_QTY_FB2     = 8;   // I열
const SAB_COL_MALL_FB     = 0;   // A열
const SAB_COL_PRODUCT_FB  = 2;   // C열
const SAB_COL_QTY_FB      = 3;   // D열

/* 헤더 배열에서 키워드에 맞는 첫 번째 열 인덱스 반환 */
function detectCol(headers, regex, fallback) {
  const idx = headers.findIndex(h => regex.test(String(h).trim()));
  return idx !== -1 ? idx : fallback;
}

/**
 * 자사몰 전용: 헤더가 없을 때 데이터 내용으로 품명·수량 열을 추론합니다.
 * - 품명 후보: 문자열이 길고 숫자가 아닌 값이 많은 열
 * - 수량 후보: 값이 양의 정수이고 범위가 작은 열
 * 반환값: { colProduct, colQty }
 */
function detectOwnColsByContent(rows) {
  if (!rows || rows.length === 0) return { colProduct: OWN_COL_PRODUCT_FB, colQty: OWN_COL_QTY_FB };

  const sample = rows.slice(0, Math.min(10, rows.length));
  const colCount = Math.max(...sample.map(r => r.length));
  if (colCount === 0) return { colProduct: OWN_COL_PRODUCT_FB, colQty: OWN_COL_QTY_FB };

  // 열별 통계
  const stats = [];
  for (let c = 0; c < colCount; c++) {
    let textLen = 0, numCount = 0, filledCount = 0;
    sample.forEach(r => {
      const v = String(r[c] ?? '').trim();
      if (!v) return;
      filledCount++;
      const n = Number(v.replace(/,/g,''));
      if (!isNaN(n) && v !== '') numCount++;
      else textLen += v.length;
    });
    stats.push({ col: c, textLen, numCount, filledCount,
      avgTextLen: filledCount > 0 ? textLen / filledCount : 0 });
  }

  // 품명: 평균 텍스트 길이가 가장 긴 열
  const productCand = [...stats]
    .filter(s => s.filledCount >= Math.ceil(sample.length * 0.5))
    .sort((a, b) => b.avgTextLen - a.avgTextLen);
  const colProduct = productCand.length > 0 ? productCand[0].col : OWN_COL_PRODUCT_FB;

  // 수량: 숫자가 많고 텍스트 길이가 짧은 열 중 품명 열이 아닌 것
  const qtyCand = [...stats]
    .filter(s => s.col !== colProduct && s.filledCount >= Math.ceil(sample.length * 0.5))
    .sort((a, b) => b.numCount - a.numCount || a.avgTextLen - b.avgTextLen);
  const colQty = qtyCand.length > 0 ? qtyCand[0].col : OWN_COL_QTY_FB;

  return { colProduct, colQty };
}

// ── 기본 채널 목록 ───────────────────────────────────────────
const DEFAULT_CHANNELS = [
  { name: '공홈(자사몰)',   dozone_code: '12005', is_own: true  },
  { name: 'A/S',           dozone_code: '010000', is_own: false },
  { name: '스마트스토어',  dozone_code: '12000',  is_own: false },
  { name: '카카오',        dozone_code: '82396',  is_own: false },
  { name: '쿠팡',          dozone_code: '12004',  is_own: false },
  { name: '11번가',        dozone_code: '12003',  is_own: false },
  { name: '옥션',          dozone_code: '12002',  is_own: false },
  { name: '지마켓',        dozone_code: '12008',  is_own: false },
];

// ── 상태 ────────────────────────────────────────────────────
let channels  = [];   // [{id, name, dozone_code, is_own}]
let items     = [];   // [{id, item_code, item_name, ratio}]
let mappings  = [];   // [{id, channel_id, excel_name, item_id}]
let rawOwn    = null; // {headers, rows}
let rawSabang = null;
let lastResult = [];  // 집계 결과
let unmatchedList = [];
let pendingOwn    = [];  // 업로드 후 대기 행 [{mall, excel_name}]
let pendingSabang = [];
let toastTimer    = null;

// ── 초기화 ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadAll();
  const d = document.getElementById('aggDate');
  if (d) d.value = todayStr();
  renderAll();
});

function loadAll() {
  channels = loadLS(LS_CHANNELS, null);
  if (!channels || !channels.length) {
    channels = DEFAULT_CHANNELS.map(c => ({ id: genId(), ...c }));
    saveLS(LS_CHANNELS, channels);
  }
  items    = loadLS(LS_ITEMS,   []);
  mappings = loadLS(LS_MAPPING, []);

  // ── 구형 데이터 마이그레이션: item_id+ratio → items 배열 ──
  let needsSave = false;
  mappings = mappings.map(m => {
    if (!m.items && m.item_id) {
      needsSave = true;
      return {
        id: m.id, channel_id: m.channel_id,
        sku: m.sku || '', excel_name: m.excel_name || '',
        items: [{ item_id: m.item_id, ratio: m.ratio ?? null }]
      };
    }
    if (!m.items) {
      needsSave = true;
      return { ...m, items: [] };
    }
    return m;
  });
  if (needsSave) saveLS(LS_MAPPING, mappings);
}
function loadLS(key, def) {
  try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; }
}
function saveLS(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

function renderAll() {
  renderChannelTable();
  renderItemTable();
  renderMappingSection();
}

// ── 탭 전환 ──────────────────────────────────────────────────
function switchTab(name) {
  ['upload','channel','item','mapping'].forEach(t => {
    const el = document.getElementById('tab-' + t);
    if (el) el.style.display = t === name ? 'flex' : 'none';
    const btn = document.querySelector(`.ag-tab[data-tab="${t}"]`);
    if (btn) btn.classList.toggle('active', t === name);
  });
  if (name === 'channel') renderChannelTable();
  if (name === 'item')    renderItemTable();
  if (name === 'mapping') renderMappingSection();
}

// ════════════════════════════════════════════════════════════
//  탭 1 : 파일 업로드 & 집계
// ════════════════════════════════════════════════════════════
function onDragOver(e)  { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }
function onDragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
function onDrop(e, ch)  {
  e.preventDefault(); e.currentTarget.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) processUploadFile(file, ch);
}
function handleFile(e, ch) {
  const file = e.target.files[0];
  if (file) processUploadFile(file, ch);
  e.target.value = '';
}

function processUploadFile(file, ch) {
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const wb  = XLSX.read(new Uint8Array(ev.target.result), { type:'array' });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' });
      const clean = raw.filter(r => r.some(c => String(c).trim() !== ''));
      if (!clean.length) { showToast('⚠️ 파일에 데이터가 없습니다.'); return; }

      // ── 헤더 자동 감지 ──────────────────────────────────────
      // 첫 행이 헤더인지 판별: 숫자가 아닌 텍스트 셀이 2개 이상이면 헤더로 간주
      const firstRow    = clean[0].map(h => String(h).trim());
      const hasHeader   = firstRow.filter(h => h && isNaN(Number(h))).length >= 2;
      const headerRow   = hasHeader ? firstRow : [];
      const dataRows    = clean.slice(hasHeader ? 1 : 0);

      if (ch === 'own') {
        // 자사몰: SKU·품명·수량 열 자동 감지
        let colSku     = detectCol(headerRow, OWN_SKU_KEYWORDS,     -1);  // SKU는 없어도 됨
        let colProduct = detectCol(headerRow, OWN_PRODUCT_KEYWORDS, -1);
        let colQty     = detectCol(headerRow, OWN_QTY_KEYWORDS,     -1);
        let detectMode = 'header';

        // 2단계: 헤더 감지 실패 시 데이터 내용 기반 추론
        if (colProduct === -1 || colQty === -1 || colProduct === colQty) {
          const inferred = detectOwnColsByContent(dataRows);
          if (colProduct === -1 || colProduct === colQty) colProduct = inferred.colProduct;
          if (colQty === -1 || colProduct === colQty)     colQty     = inferred.colQty;
          detectMode = headerRow.length > 0 ? 'content' : 'fallback';
        }

        // 3단계: 그래도 같으면 G/H 고정값 사용
        if (colProduct === colQty) {
          colProduct = OWN_COL_PRODUCT_FB;
          colQty     = OWN_COL_QTY_FB;
          detectMode = 'fallback';
        }
        if (colSku === colProduct || colSku === colQty) colSku = -1;

        rawOwn = { headers: headerRow, rows: dataRows, colProduct, colQty, colSku, detectMode };
        showFileStatus('own', file.name, headerRow, dataRows.slice(0, 5), colProduct, colQty, detectMode, colSku);
      } else {
        // 사방넷: 쇼핑몰·SKU·상품명·수량 열 자동 감지
        const colMall    = detectCol(headerRow, SAB_MALL_KEYWORDS,    SAB_COL_MALL_FB);
        const colProduct = detectCol(headerRow, SAB_PRODUCT_KEYWORDS, SAB_COL_PRODUCT_FB);
        const colQty     = detectCol(headerRow, SAB_QTY_KEYWORDS,     SAB_COL_QTY_FB);
        let   colSku     = detectCol(headerRow, SAB_SKU_KEYWORDS,     -1);
        if (colSku === colMall || colSku === colProduct || colSku === colQty) colSku = -1;
        rawSabang = { headers: headerRow, rows: dataRows, colMall, colProduct, colQty, colSku };
        showFileStatus('sabang', file.name, headerRow, dataRows.slice(0, 5), colMall, colProduct, colQty, colSku);
      }
      showToast(`✅ ${file.name} 로드 완료 (${dataRows.length}행)`);
    } catch(err) { showToast('❌ 파싱 오류: ' + err.message); }
  };
  reader.readAsArrayBuffer(file);
}

function colLabel(headers, idx) {
  const letter = String.fromCharCode(65 + idx);
  const name   = headers[idx] ? escHtml(headers[idx]) : '';
  return name ? `<b>${name}</b> (${letter}열)` : `<b>${letter}열</b>`;
}

function showFileStatus(ch, filename, headers, previewRows, ...colArgs) {
  const isOwn = ch === 'own';
  const dropEl   = document.getElementById(isOwn ? 'dropOwn'    : 'dropSabang');
  const statusEl = document.getElementById(isOwn ? 'statusOwn'  : 'statusSabang');
  const nameEl   = document.getElementById(isOwn ? 'fileOwnName': 'fileSabangName');
  const colEl    = document.getElementById(isOwn ? 'colInfoOwn' : 'colInfoSabang');
  const prevEl   = document.getElementById(isOwn ? 'previewOwn' : 'previewSabang');

  dropEl.style.display   = 'none';
  statusEl.style.display = 'block';
  nameEl.textContent     = filename;

  if (isOwn) {
    const [colProduct, colQty, detectMode, colSku] = colArgs;
    let detectedBadge;
    if (detectMode === 'header') {
      detectedBadge = '<span class="detect-badge detect-auto">✨ 헤더 자동감지</span>';
    } else if (detectMode === 'content') {
      detectedBadge = '<span class="detect-badge detect-auto" style="background:#8b5cf6">🔍 내용 기반 감지</span>';
    } else {
      detectedBadge = '<span class="detect-badge detect-fb">📌 고정 컬럼 (G/H열)</span>';
    }
    const skuBadge = (colSku != null && colSku >= 0)
      ? `<span class="col-badge col-badge-sku"><i class="fas fa-barcode"></i> SKU: ${colLabel(headers, colSku)}</span>` : '';
    colEl.innerHTML = `
      ${detectedBadge}
      ${skuBadge}
      <span class="col-badge"><i class="fas fa-tag"></i> 품명: ${colLabel(headers, colProduct)}</span>
      <span class="col-badge"><i class="fas fa-hashtag"></i> 수량: ${colLabel(headers, colQty)}</span>`;
    const highlightCols = [colProduct, colQty, ...(colSku >= 0 ? [colSku] : [])];
    buildPreview(prevEl, headers, previewRows, highlightCols);
  } else {
    const [colMall, colProduct, colQty, colSku] = colArgs;
    const detected = (colMall !== SAB_COL_MALL_FB || colProduct !== SAB_COL_PRODUCT_FB || colQty !== SAB_COL_QTY_FB)
      ? '<span class="detect-badge detect-auto">✨ 헤더 자동감지</span>'
      : '<span class="detect-badge detect-fb">고정 컬럼 (A/C/D열)</span>';
    const skuBadge = (colSku != null && colSku >= 0)
      ? `<span class="col-badge col-badge-sku"><i class="fas fa-barcode"></i> SKU: ${colLabel(headers, colSku)}</span>` : '';
    colEl.innerHTML = `
      ${detected}
      <span class="col-badge"><i class="fas fa-store"></i> 쇼핑몰: ${colLabel(headers, colMall)}</span>
      ${skuBadge}
      <span class="col-badge"><i class="fas fa-tag"></i> 상품명: ${colLabel(headers, colProduct)}</span>
      <span class="col-badge"><i class="fas fa-hashtag"></i> 수량: ${colLabel(headers, colQty)}</span>`;
    const highlightCols = [colMall, colProduct, colQty, ...(colSku >= 0 ? [colSku] : [])];
    buildPreview(prevEl, headers, previewRows, highlightCols);
  }
}

function buildPreview(el, headers, rows, highlightCols) {
  if (!rows.length) { el.innerHTML = ''; return; }
  const thRow = headers.map((h, i) =>
    `<th class="${highlightCols.includes(i) ? 'col-highlight' : ''}">${escHtml(String(h)) || '(' + String.fromCharCode(65+i) + ')'}</th>`
  ).join('');
  const trs = rows.map(r =>
    `<tr>${headers.map((_, i) =>
      `<td class="${highlightCols.includes(i) ? 'col-highlight' : ''}">${escHtml(String(r[i]??''))}</td>`
    ).join('')}</tr>`
  ).join('');
  el.innerHTML = `<table><thead><tr>${thRow}</tr></thead><tbody>${trs}</tbody></table>`;
}

function clearFile(ch) {
  if (ch === 'own') {
    rawOwn = null;
    document.getElementById('dropOwn').style.display   = 'flex';
    document.getElementById('statusOwn').style.display = 'none';
  } else {
    rawSabang = null;
    document.getElementById('dropSabang').style.display   = 'flex';
    document.getElementById('statusSabang').style.display = 'none';
  }
}

/**
 * 매핑 번들 아이템 하나의 수량배수 결정
 * 우선순위: ① 번들항목 ratio → ② 품목 마스터 ratio → ③ 1
 */
function resolveBundleRatio(bundleItem) {
  if (bundleItem.ratio != null && !isNaN(Number(bundleItem.ratio)) && Number(bundleItem.ratio) > 0) {
    return Number(bundleItem.ratio);
  }
  const it = items.find(x => x.id === bundleItem.item_id);
  return it ? (Number(it.ratio) || 1) : 1;
}

/**
 * 매핑 1건에서 번들 정규 배열 반환
 * 구형(item_id/ratio)과 신형(items[]) 모두 처리
 */
function getBundleItems(mp) {
  if (mp.items && mp.items.length) return mp.items;
  if (mp.item_id) return [{ item_id: mp.item_id, ratio: mp.ratio ?? null }];
  return [];
}

// ── 집계 실행 ────────────────────────────────────────────────
function runAggregation() {
  if (!rawOwn && !rawSabang) {
    showToast('⚠️ 자사몰 또는 사방넷 파일을 업로드해주세요.');
    return;
  }

  // 결과 맵: { channel_id+item_id → {channel, item, qty} }
  const resultMap = {};
  unmatchedList = [];

  function addResult(channelId, itemId, qty) {
    const key = channelId + '|' + itemId;
    if (!resultMap[key]) resultMap[key] = { channelId, itemId, qty: 0 };
    resultMap[key].qty += qty;
  }
  function addUnmatched(excel_name, channelName, skuCode) {
    const key = (skuCode || '') + '|' + excel_name + '|' + channelName;
    if (!unmatchedList.find(u => u._key === key)) {
      unmatchedList.push({ _key: key, excel_name, channelName, skuCode: skuCode || '' });
    }
  }

  // ── 자사몰(공홈) 처리 ──────────────────────────────────────
  if (rawOwn) {
    const ownChannel = channels.find(c => c.is_own);
    if (!ownChannel) {
      showToast('⚠️ 공홈 채널이 없습니다. 채널 탭에서 공홈 토글을 ON 하세요.');
    } else {
      const colP   = rawOwn.colProduct;
      const colQ   = rawOwn.colQty;
      const colSku = rawOwn.colSku ?? -1;
      rawOwn.rows.forEach(row => {
        const excelName = String(row[colP] ?? '').trim();
        const skuCode   = colSku >= 0 ? String(row[colSku] ?? '').trim() : '';
        const qty       = parseNum(row[colQ]);
        if (!excelName && !skuCode) return;
        if (qty <= 0) return;
        const mp = findMapping(excelName, ownChannel.id, skuCode);
        if (mp) {
          // 번들 지원: items 배열의 각 품목에 대해 별도 집계
          const bundleItems = getBundleItems(mp);
          if (bundleItems.length) {
            bundleItems.forEach(bi => {
              const ratio = resolveBundleRatio(bi);
              addResult(ownChannel.id, bi.item_id, Math.round(qty * ratio));
            });
          } else {
            addUnmatched(excelName || skuCode, ownChannel.name, skuCode);
          }
        } else {
          addUnmatched(excelName || skuCode, ownChannel.name, skuCode);
        }
      });
    }
  }

  // ── 사방넷 처리 ─────────────────────────────────────────────
  if (rawSabang) {
    const colM   = rawSabang.colMall;
    const colP   = rawSabang.colProduct;
    const colQ   = rawSabang.colQty;
    const colSku = rawSabang.colSku ?? -1;
    rawSabang.rows.forEach(row => {
      const mallName  = String(row[colM] ?? '').trim();
      const excelName = String(row[colP] ?? '').trim();
      const skuCode   = colSku >= 0 ? String(row[colSku] ?? '').trim() : '';
      const qty       = parseNum(row[colQ]);
      if (!excelName && !skuCode) return;
      if (qty <= 0) return;

      // 쇼핑몰명으로 채널 찾기 (부분 일치 포함)
      const ch = findChannelByName(mallName);
      if (!ch) {
        addUnmatched(excelName || skuCode, mallName || '(쇼핑몰명 없음)', skuCode);
        return;
      }
      const mp = findMapping(excelName, ch.id, skuCode);
      if (mp) {
        // 번들 지원: items 배열의 각 품목에 대해 별도 집계
        const bundleItems = getBundleItems(mp);
        if (bundleItems.length) {
          bundleItems.forEach(bi => {
            const ratio = resolveBundleRatio(bi);
            addResult(ch.id, bi.item_id, Math.round(qty * ratio));
          });
        } else {
          addUnmatched(excelName || skuCode, ch.name, skuCode);
        }
      } else {
        addUnmatched(excelName || skuCode, ch.name, skuCode);
      }
    });
  }

  // ── 결과 정렬 및 렌더링 ──────────────────────────────────────
  // 채널 순서 기준 정렬
  const channelOrder = channels.map(c => c.id);
  lastResult = Object.values(resultMap).sort((a, b) => {
    const ci = channelOrder.indexOf(a.channelId) - channelOrder.indexOf(b.channelId);
    if (ci !== 0) return ci;
    const ia = items.find(it => it.id === a.itemId);
    const ib = items.find(it => it.id === b.itemId);
    return (ia?.item_code || '').localeCompare(ib?.item_code || '');
  });

  renderResult();
}

function findChannelByName(mallName) {
  if (!mallName) return null;
  const norm = mallName.replace(/\s/g, '').toLowerCase();
  // 완전 일치
  let ch = channels.find(c => c.name.replace(/\s/g,'').toLowerCase() === norm);
  if (ch) return ch;
  // 포함 매칭
  ch = channels.find(c => {
    const cn = c.name.replace(/\s/g,'').toLowerCase();
    return norm.includes(cn) || cn.includes(norm);
  });
  return ch || null;
}

/**
 * 채널 매핑 조회 — SKU 우선 → 품명 폴백
 * @param {string} excelName  엑셀/주문서 상품명
 * @param {string} channelId  채널 ID
 * @param {string} [skuCode]  엑셀에서 읽은 SKU/상품코드 (있으면 최우선 매칭)
 */
function findMapping(excelName, channelId, skuCode) {
  const norm = s => String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
  const chMappings = mappings.filter(x => x.channel_id === channelId);

  // ① SKU 완전 일치 (skuCode가 있고 매핑에 sku가 있을 때)
  if (skuCode) {
    const normSku = norm(skuCode);
    const m = chMappings.find(x => x.sku && norm(x.sku) === normSku);
    if (m) return m;
  }

  const normEx = norm(excelName);

  // ② 엑셀 상품명 완전 일치
  let m = chMappings.find(x => x.excel_name === excelName);
  if (m) return m;

  // ③ 정규화 일치 (공백·대소문자 무시)
  m = chMappings.find(x => norm(x.excel_name) === normEx);
  if (m) return m;

  // ④ 후미 ", 숫자" 제거 후 일치
  const stripTrailingNum = s => s.replace(/,\s*\d+\s*$/, '').trim();
  const normExStripped = norm(stripTrailingNum(excelName));
  m = chMappings.find(x => norm(stripTrailingNum(x.excel_name)) === normExStripped);
  if (m) return m;

  // ⑤ 포함 매칭 (최소 5자, 짧은 쪽이 긴 쪽에 포함)
  m = chMappings.find(x => {
    const a = norm(x.excel_name).replace(/\s/g,'');
    const b = normEx.replace(/\s/g,'');
    if (a.length < 5 || b.length < 5) return false;
    return a.includes(b) || b.includes(a);
  });
  return m || null;
}

function parseNum(v) {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(String(v).replace(/,/g,''));
  return isNaN(n) ? 0 : Math.max(0, n);
}

// ── 결과 렌더링 ──────────────────────────────────────────────
function renderResult() {
  const sec = document.getElementById('resultSection');
  sec.style.display = 'block';

  const dateVal = document.getElementById('aggDate').value;
  document.getElementById('resultDateLabel').textContent = dateVal ? fmtDate(dateVal) : '';

  // KPI
  const totalQty     = lastResult.reduce((s, r) => s + r.qty, 0);
  const totalItems   = new Set(lastResult.map(r => r.itemId)).size;
  const totalChannels= new Set(lastResult.map(r => r.channelId)).size;
  document.getElementById('resultKpi').innerHTML = `
    <div class="result-kpi-item">
      <div class="result-kpi-label">총 출고 수량</div>
      <div class="result-kpi-val kpi-total">${totalQty.toLocaleString()}</div>
    </div>
    <div class="result-kpi-item">
      <div class="result-kpi-label">집계 품목 수</div>
      <div class="result-kpi-val kpi-own">${totalItems}</div>
    </div>
    <div class="result-kpi-item">
      <div class="result-kpi-label">채널 수</div>
      <div class="result-kpi-val kpi-sabang">${totalChannels}</div>
    </div>
    <div class="result-kpi-item">
      <div class="result-kpi-label">미매핑</div>
      <div class="result-kpi-val" style="color:${unmatchedList.length?'var(--warn-color)':'var(--ok-color)'}">
        ${unmatchedList.length}건
      </div>
    </div>`;

  // 결과 테이블
  const tbody = document.getElementById('resultBody');
  if (!lastResult.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-row"><i class="fas fa-inbox"></i> 집계된 데이터가 없습니다. 매핑을 확인하세요.</td></tr>`;
  } else {
    tbody.innerHTML = lastResult.map((r, i) => {
      const ch   = channels.find(c => c.id === r.channelId);
      const item = items.find(it => it.id === r.itemId);
      return `<tr>
        <td class="no-cell">${i+1}</td>
        <td><span class="ch-name-badge">${escHtml(ch?.name || '?')}</span></td>
        <td class="dozone-code-cell">${escHtml(ch?.dozone_code || '—')}</td>
        <td class="code-cell">${escHtml(item?.item_code || '—')}</td>
        <td>${escHtml(item?.item_name || '(품목 미등록)')}</td>
        <td class="total-val">${r.qty.toLocaleString()}</td>
      </tr>`;
    }).join('');
  }

  // 합계 행
  document.getElementById('resultFoot').innerHTML = `
    <tr>
      <td colspan="5" style="color:var(--text-sub);font-size:12px;text-align:right">합 계</td>
      <td class="total-val">${totalQty.toLocaleString()}</td>
    </tr>`;

  // 미매핑
  const btnUm  = document.getElementById('btnUnmatched');
  const umSec  = document.getElementById('unmatchedSection');
  if (unmatchedList.length) {
    btnUm.style.display = 'inline-flex';
    document.getElementById('unmatchedCnt').textContent = unmatchedList.length;
    document.getElementById('unmatchedBody').innerHTML = unmatchedList.map(u => `
      <div class="unmatched-chip">
        <span class="chip-ch badge-warn">${escHtml(u.channelName)}</span>
        ${u.skuCode ? `<span class="chip-sku"><i class="fas fa-barcode"></i> ${escHtml(u.skuCode)}</span>` : ''}
        ${escHtml(u.excel_name)}
      </div>`).join('');
    umSec.style.display = 'block';
  } else {
    btnUm.style.display = 'none';
    umSec.style.display = 'none';
  }

  // ── 진단 패널 ──────────────────────────────────────────────
  renderDiagPanel();

  setTimeout(() => sec.scrollIntoView({ behavior:'smooth', block:'start' }), 100);
  showToast(`✅ 집계 완료 — ${lastResult.length}행, 총 ${totalQty.toLocaleString()}개`);

  // 출고집계 페이지에 자동 누적 저장
  if (lastResult.length > 0) {
    setTimeout(pushToShipment, 600);
  }
}

// ── 진단 패널 렌더링 ────────────────────────────────────────
function renderDiagPanel() {
  const sec     = document.getElementById('diagSection');
  const bodyEl  = document.getElementById('diagBody');
  if (!sec || !bodyEl) return;

  const ownChannel = channels.find(c => c.is_own);
  const ownMappings = ownChannel ? mappings.filter(m => m.channel_id === ownChannel.id) : [];

  // 자사몰 파일에서 실제 감지된 열의 값 (최대 20개)
  const ownColP = rawOwn?.colProduct ?? OWN_COL_PRODUCT_FB;
  const ownColQ = rawOwn?.colQty     ?? OWN_COL_QTY_FB;
  const ownHeaders = rawOwn?.headers ?? [];
  const pColName = ownHeaders[ownColP] || String.fromCharCode(65 + ownColP) + '열';
  const qColName = ownHeaders[ownColQ] || String.fromCharCode(65 + ownColQ) + '열';
  const detectModeLabel = rawOwn?.detectMode === 'header'  ? '✨ 헤더 자동감지'
                        : rawOwn?.detectMode === 'content' ? '🔍 내용 기반 감지'
                        : '📌 고정 컬럼';

  const readNames = rawOwn
    ? rawOwn.rows.slice(0, 20).map((r, i) => {
        const name = String(r[ownColP] ?? '').trim();
        const qty  = parseNum(r[ownColQ]);
        const mp   = ownChannel ? findMapping(name, ownChannel.id) : null;
        const status = !name ? '빈 행' : qty <= 0 ? '⚠️ 수량 0' : mp ? '✅ 매핑됨' : '❌ 미매핑';
        return `<tr class="${mp ? 'diag-ok' : (name && qty > 0 ? 'diag-fail' : 'diag-skip')}">
          <td>${i+2}</td>
          <td class="diag-name">${escHtml(name||'(빈 값)')}</td>
          <td>${qty || '—'}</td>
          <td>${status}</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="4" class="empty-row">파일 미업로드</td></tr>';

  // 저장된 공홈 매핑 목록 (번들 지원)
  const savedRows = ownMappings.length
    ? ownMappings.map(m => {
        const bundleItems = getBundleItems(m);
        if (!bundleItems.length) {
          return `<tr>
            <td class="diag-name">${escHtml(m.excel_name)}</td>
            <td colspan="2" style="color:var(--warn-color);font-size:12px">⚠️ 품목 미설정</td>
          </tr>`;
        }
        return bundleItems.map((bi, bi_idx) => {
          const it = items.find(x => x.id === bi.item_id);
          const ratio = resolveBundleRatio(bi);
          return `<tr>
            ${bi_idx === 0
              ? `<td class="diag-name" rowspan="${bundleItems.length}">${escHtml(m.excel_name)}${bundleItems.length > 1 ? ' <span class="bundle-badge"><i class="fas fa-layer-group"></i> 번들</span>' : ''}</td>`
              : ''}
            <td class="code-cell">${escHtml(it?.item_code||'?')} ${ratio !== 1 ? `<span class="ratio-set-badge" style="font-size:10px">×${ratio}</span>` : ''}</td>
            <td>${escHtml(it?.item_name||'?')}</td>
          </tr>`;
        }).join('');
      }).join('')
    : '<tr><td colspan="3" class="empty-row">저장된 매핑 없음</td></tr>';

  sec.style.display = 'block';
  bodyEl.innerHTML = `
    <div class="diag-grid">
      <div class="diag-panel">
        <div class="diag-panel-title">📂 [${detectModeLabel}] 품명: ${escHtml(pColName)} · 수량: ${escHtml(qColName)} — 최대 20행</div>
        <div style="overflow-x:auto">
          <table class="ag-table">
            <thead><tr><th>행</th><th>G열 읽힌 값 (엑셀 상품명)</th><th>H열 수량</th><th>매핑 상태</th></tr></thead>
            <tbody>${readNames}</tbody>
          </table>
        </div>
        <div class="diag-note"><i class="fas fa-circle-info"></i>
          위 "G열 읽힌 값"과 아래 "저장된 매핑의 엑셀 상품명"이 <b>정확히 일치</b>해야 집계됩니다.
        </div>
      </div>
      <div class="diag-panel">
        <div class="diag-panel-title">🔗 저장된 공홈 매핑 (${ownMappings.length}건)</div>
        <div style="overflow-x:auto">
          <table class="ag-table">
            <thead><tr><th>매핑 키 (저장된 엑셀 상품명)</th><th>품번</th><th>품명</th></tr></thead>
            <tbody>${savedRows}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function toggleDiag() {
  const body = document.getElementById('diagBody');
  if (!body) return;
  const isHidden = body.style.display === 'none';
  body.style.display = isHidden ? 'block' : 'none';
  const hint = document.querySelector('.diag-toggle-hint');
  if (hint) hint.textContent = isHidden ? '클릭하여 접기' : '클릭하여 펼치기';
}

// ── 미매핑 처리 모달 ────────────────────────────────────────
function showUnmatched() {
  const body = document.getElementById('unmatchedModalBody');
  const itemOpts = itemOptsHtml('');
  body.innerHTML = unmatchedList.map((u, i) => `
    <div class="unmatched-row">
      <div class="unmatched-row-info">
        <span class="unmatched-row-ch badge-warn">${escHtml(u.channelName)}</span>
        ${u.skuCode ? `<span class="unmatched-sku-chip"><i class="fas fa-barcode"></i> ${escHtml(u.skuCode)}</span>` : ''}
        <span class="unmatched-row-name">${escHtml(u.excel_name)}</span>
      </div>
      <div class="unmatched-row-controls">
        <select class="ag-field-input ag-field-select unmatched-row-select" id="umItem_${i}">
          ${itemOpts}
        </select>
        <div class="ratio-inline-wrap">
          <span class="ratio-inline-x">×</span>
          <input type="number" class="ratio-inline-input" id="umRatio_${i}"
            value="1" min="0.01" step="0.01" title="수량배수"/>
        </div>
      </div>
    </div>`).join('');

  // 품목 선택 시 마스터 ratio 자동 채우기
  unmatchedList.forEach((u, i) => {
    const sel = document.getElementById(`umItem_${i}`);
    if (sel) sel.addEventListener('change', () => {
      const it = items.find(x => x.id === sel.value);
      const ratioInp = document.getElementById(`umRatio_${i}`);
      if (ratioInp && it) ratioInp.value = it.ratio || 1;
    });
  });

  document.getElementById('unmatchedModal').classList.add('show');
}
function closeUnmatchedModal() {
  document.getElementById('unmatchedModal').classList.remove('show');
}
function applyUnmatchedMapping() {
  let added = 0;
  unmatchedList.forEach((u, i) => {
    const sel      = document.getElementById(`umItem_${i}`);
    const ratioInp = document.getElementById(`umRatio_${i}`);
    if (!sel || !sel.value) return;
    const ch = findChannelByName(u.channelName) || channels.find(c => c.name === u.channelName);
    if (!ch) return;
    // SKU 중복 체크
    const alreadyBySku  = u.skuCode && mappings.find(m => m.channel_id === ch.id && m.sku === u.skuCode);
    const alreadyByName = mappings.find(m => m.channel_id === ch.id && m.excel_name === u.excel_name);
    if (alreadyBySku || alreadyByName) return;
    const ratio = parseFloat(ratioInp?.value) || null;
    // items 배열 형식으로 저장
    mappings.push({
      id:         genId(),
      channel_id: ch.id,
      sku:        u.skuCode || '',
      excel_name: u.excel_name,
      items: [{
        item_id: sel.value,
        ratio:   (ratio && ratio !== 1) ? ratio : null
      }]
    });
    added++;
  });
  saveLS(LS_MAPPING, mappings);
  closeUnmatchedModal();
  if (added > 0) {
    showToast(`✅ ${added}건 매핑 추가 후 재집계합니다.`);
    setTimeout(runAggregation, 400);
  } else {
    showToast('선택된 매핑이 없습니다.');
  }
}

// ── 클립보드 복사 ────────────────────────────────────────────
function copyResult() {
  if (!lastResult.length) { showToast('집계 결과가 없습니다.'); return; }
  const dateVal = document.getElementById('aggDate').value;
  const header  = `[출고 집계] ${dateVal ? fmtDate(dateVal) : ''}`;
  const cols    = ['채널명', '더존코드', '품번', '품명', '수량'];
  const lines   = [
    header, '',
    cols.join('\t'),
    ...lastResult.map(r => {
      const ch   = channels.find(c => c.id === r.channelId);
      const item = items.find(it => it.id === r.itemId);
      return [ch?.name||'', ch?.dozone_code||'', item?.item_code||'', item?.item_name||'', r.qty].join('\t');
    })
  ];
  navigator.clipboard.writeText(lines.join('\n'))
    .then(() => showToast('📋 복사 완료! 구글 시트에 바로 붙여넣기 하세요.'))
    .catch(() => showToast('❌ 복사 실패'));
}

// ── 엑셀 다운로드 ────────────────────────────────────────────
function exportExcel() {
  if (!lastResult.length) { showToast('집계 결과가 없습니다.'); return; }
  const dateVal = document.getElementById('aggDate').value;
  const wsData  = [
    ['채널명', '더존코드', '품번', '품명', '수량'],
    ...lastResult.map(r => {
      const ch   = channels.find(c => c.id === r.channelId);
      const item = items.find(it => it.id === r.itemId);
      return [ch?.name||'', ch?.dozone_code||'', item?.item_code||'', item?.item_name||'', r.qty];
    })
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = [{ wch:16 },{ wch:10 },{ wch:12 },{ wch:28 },{ wch:8 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '출고집계');
  XLSX.writeFile(wb, `출고집계_${dateVal || todayStr()}.xlsx`);
  showToast('📥 엑셀 다운로드 완료!');
}

// ════════════════════════════════════════════════════════════
//  탭 2 : 채널 관리
// ════════════════════════════════════════════════════════════
function renderChannelTable() {
  const tbody = document.getElementById('channelBody');
  if (!channels.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-row"><i class="fas fa-inbox"></i> 채널이 없습니다.</td></tr>`;
    return;
  }
  tbody.innerHTML = channels.map((c, i) => `
    <tr>
      <td class="no-cell">${i+1}</td>
      <td>
        <input type="text" class="inline-input" value="${escHtml(c.name)}"
          onchange="updateChannel('${c.id}','name',this.value)" placeholder="채널명"/>
      </td>
      <td>
        <input type="text" class="inline-input dozone-input" value="${escHtml(c.dozone_code)}"
          onchange="updateChannel('${c.id}','dozone_code',this.value)" placeholder="더존코드"/>
      </td>
      <td style="text-align:center">
        <label class="toggle-switch">
          <input type="checkbox" ${c.is_own ? 'checked' : ''}
            onchange="updateChannel('${c.id}','is_own',this.checked)"/>
          <span class="toggle-slider"></span>
        </label>
        <span style="font-size:11px;color:var(--text-muted);margin-left:4px">${c.is_own ? '공홈' : ''}</span>
      </td>
      <td class="no-print" style="text-align:center">
        <button class="tbl-btn tbl-btn-del" onclick="deleteChannel('${c.id}')" title="삭제"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`).join('');
}

function updateChannel(id, field, val) {
  const idx = channels.findIndex(c => c.id === id);
  if (idx === -1) return;
  // is_own 은 하나만 true
  if (field === 'is_own' && val === true) {
    channels.forEach(c => c.is_own = false);
  }
  channels[idx][field] = val;
  saveLS(LS_CHANNELS, channels);
  renderChannelTable();
}

function addChannel() {
  channels.push({ id: genId(), name: '새 채널', dozone_code: '', is_own: false });
  saveLS(LS_CHANNELS, channels);
  renderChannelTable();
  showToast('✅ 채널 추가됨 — 이름과 더존코드를 입력하세요.');
}

function deleteChannel(id) {
  const ch = channels.find(c => c.id === id);
  if (!ch) return;
  if (!confirm(`'${ch.name}' 채널을 삭제합니까?\n관련 매핑도 함께 삭제됩니다.`)) return;
  channels  = channels.filter(c => c.id !== id);
  mappings  = mappings.filter(m => m.channel_id !== id);
  saveLS(LS_CHANNELS, channels);
  saveLS(LS_MAPPING,  mappings);
  renderChannelTable();
  showToast('🗑️ 삭제되었습니다.');
}

// ════════════════════════════════════════════════════════════
//  탭 3 : 품목 마스터
// ════════════════════════════════════════════════════════════
function renderItemTable() {
  const search   = (document.getElementById('itemSearch')?.value || '').toLowerCase();
  const filtered = items.filter(it =>
    it.item_code.toLowerCase().includes(search) || it.item_name.toLowerCase().includes(search)
  );
  const countEl = document.getElementById('itemCount');
  if (countEl) countEl.textContent = `${items.length}개`;
  const guideEl = document.getElementById('itemGuide');
  if (guideEl) guideEl.style.display = items.length === 0 ? 'flex' : 'none';

  const tbody = document.getElementById('itemBody');
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-row"><i class="fas fa-inbox"></i> ${items.length ? '검색 결과 없음' : '품목이 없습니다.'}</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map((it, i) => {
    const ratio = Number(it.ratio) || 1;
    return `<tr>
      <td class="no-cell">${i+1}</td>
      <td class="code-cell">${escHtml(it.item_code)}</td>
      <td>${escHtml(it.item_name)}</td>
      <td>
        <div class="ratio-inline-wrap">
          <span class="ratio-inline-x">×</span>
          <input type="number" class="ratio-inline-input"
            value="${ratio}" min="0.01" step="0.01"
            onchange="updateItemRatio('${it.id}',this.value)"
            onkeydown="if(event.key==='Enter'){updateItemRatio('${it.id}',this.value);this.blur();}"
            title="세트 품목이면 실제 개수"/>
          ${ratio !== 1 ? `<span class="ratio-set-badge">세트</span>` : ''}
        </div>
      </td>
      <td class="no-print" style="text-align:center;display:flex;gap:4px;align-items:center;justify-content:center">
        <button class="tbl-btn tbl-btn-edit" onclick="openItemModal('${it.id}')" title="수정"><i class="fas fa-pen"></i></button>
        <button class="tbl-btn tbl-btn-del"  onclick="deleteItem('${it.id}')" title="삭제"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('');
}

function updateItemRatio(id, val) {
  const idx = items.findIndex(it => it.id === id);
  if (idx === -1) return;
  items[idx].ratio = Math.max(0.01, parseFloat(val) || 1);
  saveLS(LS_ITEMS, items);
  renderItemTable();
  showToast(`✅ 환산비율 ×${items[idx].ratio} 저장`);
}

function openItemModal(id) {
  if (id) {
    const it = items.find(x => x.id === id);
    if (!it) return;
    document.getElementById('itemModalTitle').innerHTML = '<i class="fas fa-pen"></i> 품목 수정';
    document.getElementById('itemModalId').value        = it.id;
    document.getElementById('itemCode').value           = it.item_code;
    document.getElementById('itemName').value           = it.item_name;
    document.getElementById('itemRatio').value          = it.ratio || 1;
    document.getElementById('itemMemo').value           = it.memo  || '';
  } else {
    document.getElementById('itemModalTitle').innerHTML = '<i class="fas fa-plus"></i> 품목 추가';
    document.getElementById('itemModalId').value = '';
    document.getElementById('itemCode').value    = '';
    document.getElementById('itemName').value    = '';
    document.getElementById('itemRatio').value   = 1;
    document.getElementById('itemMemo').value    = '';
  }
  document.getElementById('itemModal').classList.add('show');
}
function closeItemModal() { document.getElementById('itemModal').classList.remove('show'); }

function saveItem() {
  const id    = document.getElementById('itemModalId').value;
  const code  = document.getElementById('itemCode').value.trim();
  const name  = document.getElementById('itemName').value.trim();
  const ratio = parseFloat(document.getElementById('itemRatio').value) || 1;
  const memo  = document.getElementById('itemMemo').value.trim();
  if (!code) { showToast('품번을 입력해주세요.'); return; }
  if (!name) { showToast('품명을 입력해주세요.'); return; }
  if (id) {
    const idx = items.findIndex(it => it.id === id);
    if (idx !== -1) items[idx] = { id, item_code: code, item_name: name, ratio, memo };
  } else {
    if (items.find(it => it.item_code === code)) { showToast('⚠️ 이미 등록된 품번입니다.'); return; }
    items.push({ id: genId(), item_code: code, item_name: name, ratio, memo });
  }
  saveLS(LS_ITEMS, items);
  closeItemModal();
  renderItemTable();
  showToast(id ? '✅ 수정되었습니다.' : `✅ '${name}' 추가 완료`);
}

function deleteItem(id) {
  const it = items.find(x => x.id === id);
  if (!it) return;
  if (!confirm(`'${it.item_name}' 품목을 삭제합니까?\n관련 매핑도 삭제됩니다.`)) return;
  items = items.filter(x => x.id !== id);

  // 번들 구조 고려: items 배열 내 해당 품목 제거, 비어진 매핑은 삭제
  mappings = mappings
    .map(m => {
      if (m.item_id === id) return null; // 구형 단일 매핑
      if (!m.items) return null;
      const filtered = m.items.filter(bi => bi.item_id !== id);
      if (!filtered.length) return null; // 모든 품목 제거되면 매핑 삭제
      return { ...m, items: filtered };
    })
    .filter(Boolean);

  saveLS(LS_ITEMS,   items);
  saveLS(LS_MAPPING, mappings);
  renderItemTable();
  showToast('🗑️ 삭제되었습니다.');
}

// 품목 엑셀 가져오기 (A열=품번, B열=품명)
function importItems(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const wb  = XLSX.read(new Uint8Array(ev.target.result), { type:'array' });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' });
      const firstA = String(raw[0]?.[0]||'').trim();
      const isHeader = /품번|코드|code|item/i.test(firstA);
      const dataRows = raw.slice(isHeader ? 1 : 0);
      let added = 0, skipped = 0;
      dataRows.forEach(row => {
        const code  = String(row[0]||'').trim();
        const name  = String(row[1]||'').trim();
        const ratio = parseFloat(String(row[2]||'1')) || 1;
        if (!code || !name) { skipped++; return; }
        if (items.find(it => it.item_code === code)) { skipped++; return; }
        items.push({ id: genId(), item_code: code, item_name: name, ratio, memo: '' });
        added++;
      });
      saveLS(LS_ITEMS, items);
      renderItemTable();
      showToast(`✅ ${added}개 품목 가져오기 완료 (${skipped}건 스킵)`);
    } catch(err) { showToast('❌ 오류: ' + err.message); }
  };
  reader.readAsArrayBuffer(file);
  e.target.value = '';
}

function exportItems() {
  if (!items.length) { showToast('품목 데이터가 없습니다.'); return; }
  const ws = XLSX.utils.aoa_to_sheet([
    ['품번', '품명', '환산비율', '메모'],
    ...items.map(it => [it.item_code, it.item_name, it.ratio||1, it.memo||''])
  ]);
  ws['!cols'] = [{ wch:14 },{ wch:30 },{ wch:8 },{ wch:20 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '품목마스터');
  XLSX.writeFile(wb, `품목마스터_${todayStr()}.xlsx`);
  showToast('📥 내보내기 완료!');
}

// ════════════════════════════════════════════════════════════
//  탭 4 : 채널 매핑
//  엑셀 업로드 → 대기 행 생성 → 드롭다운 매칭 → 저장
// ════════════════════════════════════════════════════════════

/* 품목 드롭다운 옵션 HTML */
function itemOptsHtml(selectedId) {
  return '<option value="">— 품목 선택 —</option>' +
    items.map(it =>
      `<option value="${it.id}" ${it.id === selectedId ? 'selected' : ''}>${escHtml(it.item_code)} ${escHtml(it.item_name)}</option>`
    ).join('');
}

/* 저장된 매핑 1행 HTML — 번들(items 배열) 지원 + 인라인 편집 */
function savedMappingRowHtml(m) {
  const skuDisplay = m.sku
    ? `<span class="sku-chip"><i class="fas fa-barcode"></i> ${escHtml(m.sku)}</span>`
    : `<span class="sku-empty">—</span>`;

  const bundleItems = getBundleItems(m);
  const isBundle = bundleItems.length > 1;

  const rowspan = (bundleItems.length || 1) + 1;
  const skuTd   = `<td class="map-sku-cell" rowspan="${rowspan}">${skuDisplay}</td>`;
  const nameTd  = `<td class="map-excel-name" rowspan="${rowspan}">${escHtml(m.excel_name) || '<span class="sku-empty">품명 없음</span>'}${isBundle ? `<div class="bundle-badge"><i class="fas fa-layer-group"></i> 번들 ${bundleItems.length}개 품목</div>` : ''}</td>`;
  const delTd   = `<td class="no-print" style="text-align:center" rowspan="${rowspan}">
    <button class="tbl-btn tbl-btn-del" onclick="deleteMapping('${m.id}')" title="삭제"><i class="fas fa-trash"></i></button>
  </td>`;

  if (!bundleItems.length) {
    return `<tr>
      ${skuTd}${nameTd}
      <td colspan="3" style="color:var(--warn-color);font-size:12px"><i class="fas fa-triangle-exclamation"></i> 품목 미설정 — 매핑 탭에서 수정하세요</td>
      ${delTd}
    </tr>`;
  }

  const itemRows = bundleItems.map((bi, bi_idx) => {
    const it = items.find(x => x.id === bi.item_id);
    const masterRatio = it ? (Number(it.ratio) || 1) : 1;
    const ratio = (bi.ratio != null && !isNaN(Number(bi.ratio)) && Number(bi.ratio) > 0)
      ? Number(bi.ratio) : masterRatio;
    const isCustom = bi.ratio != null && Number(bi.ratio) !== masterRatio;

    const unitMatch = (it?.item_name || '').match(/(\d+)개입/);
    const baseUnit  = unitMatch ? parseInt(unitMatch[1]) : null;
    let ratioDisplay;
    if (ratio === 1) {
      ratioDisplay = `<span class="ratio-hint-text">${baseUnit ? `×1 (${baseUnit}개 최소단위)` : '×1 (최소단위)'}</span>`;
    } else {
      const unitInfo = baseUnit ? ` <span class="ratio-calc">(${baseUnit * ratio}개입)</span>` : '';
      ratioDisplay = `<span class="ratio-set-badge${isCustom ? ' ratio-custom' : ''}">×${ratio}${unitInfo}</span>`;
    }

    const itemSelect = `<select class="ag-field-input ag-field-select"
      onchange="savedBundleItemChange('${m.id}',${bi_idx},this.value)"
      style="min-width:160px;font-size:12px">
      ${itemOptsHtml(bi.item_id||'')}
    </select>`;

    const delBiBtn = bundleItems.length > 1
      ? `<button class="tbl-btn tbl-btn-del" onclick="savedBundleItemRemove('${m.id}',${bi_idx})"
          title="이 품목 제거" style="font-size:10px;padding:2px 5px;margin-left:4px">
          <i class="fas fa-xmark"></i>
        </button>` : '';

    const isFirst = bi_idx === 0;
    return `<tr class="${bi_idx > 0 ? 'bundle-sub-row' : ''}">
      ${isFirst ? skuTd : ''}
      ${isFirst ? nameTd : ''}
      <td class="code-cell" style="font-size:11px;color:var(--text-muted)">${escHtml(it?.item_code||'—')}</td>
      <td>
        <div style="display:flex;align-items:center;gap:4px">
          ${bi_idx > 0 ? '<span style="font-size:10px;color:var(--text-muted);white-space:nowrap">+</span>' : ''}
          ${itemSelect}
          ${delBiBtn}
        </div>
      </td>
      <td class="ratio-edit-cell">
        <div class="ratio-inline-wrap">
          <span class="ratio-inline-x">×</span>
          <input type="number" class="ratio-inline-input"
            value="${ratio}" min="0.01" step="0.01"
            onchange="saveBundleItemRatio('${m.id}',${bi_idx},this.value)"
            onkeydown="if(event.key==='Enter'){saveBundleItemRatio('${m.id}',${bi_idx},this.value);this.blur();}"
            title="5개입=×1 · 10개입=×2 · 20개입=×4 · 40개입=×8"/>
          ${ratioDisplay}
        </div>
        ${isCustom ? '<div style="font-size:10px;color:var(--accent-color);margin-top:2px">⚡ 이 상품만 개별설정</div>' : ''}
      </td>
      ${isFirst ? delTd : ''}
    </tr>`;
  }).join('');

const addRow = `<tr>
    <td style="padding:5px 10px;background:rgba(34,211,200,0.03);border-top:1px dashed var(--border2);white-space:nowrap" colspan="3">
      <button onclick="savedBundleItemAdd('${m.id}')"
        style="display:inline-flex;align-items:center;gap:5px;white-space:nowrap;padding:4px 14px;font-size:11px;color:var(--primary);border:1px dashed var(--primary);background:transparent;border-radius:4px;cursor:pointer">
        <i class="fas fa-plus"></i> 품목 추가 (번들)
      </button>
    </td>
  </tr>`;

  return itemRows + addRow;
}

/* 저장된 매핑에 번들 품목 추가 */
function savedBundleItemAdd(mappingId) {
  const mp = mappings.find(m => m.id === mappingId);
  if (!mp) return;
  if (!mp.items || !mp.items.length) {
    mp.items = mp.item_id ? [{ item_id: mp.item_id, ratio: mp.ratio ?? null }] : [];
  }
  mp.items.push({ item_id: '', ratio: null });
  saveLS(LS_MAPPING, mappings);
  renderMappingSection();
}

/* 저장된 매핑 번들 품목 삭제 */
function savedBundleItemRemove(mappingId, biIdx) {
  const mp = mappings.find(m => m.id === mappingId);
  if (!mp || !mp.items || mp.items.length <= 1) return;
  mp.items.splice(biIdx, 1);
  saveLS(LS_MAPPING, mappings);
  renderMappingSection();
  showToast('🗑️ 품목이 제거되었습니다.');
}

/* 저장된 매핑 번들 품목 변경 */
function savedBundleItemChange(mappingId, biIdx, itemId) {
  const mp = mappings.find(m => m.id === mappingId);
  if (!mp) return;
  if (!mp.items) mp.items = [];
  if (!mp.items[biIdx]) mp.items[biIdx] = { item_id: '', ratio: null };
  mp.items[biIdx].item_id = itemId;
  if (mp.items[biIdx].ratio == null) {
    const selItem = items.find(x => x.id === itemId);
    if (selItem) mp.items[biIdx].ratio = Number(selItem.ratio) || 1;
  }
  saveLS(LS_MAPPING, mappings);
  renderMappingSection();
  showToast('✅ 품목이 변경되었습니다.');
}


/* 채널별 저장된 매핑 렌더링 */
function renderMappingSection() {
  const wrap = document.getElementById('mappingSectionWrap');
  if (!wrap) return;
  if (!channels.length) {
    wrap.innerHTML = `<div class="map-upload-hint" style="margin:20px"><i class="fas fa-circle-info"></i> 채널 탭에서 먼저 채널을 등록하세요.</div>`;
    return;
  }
  wrap.innerHTML = channels.map(ch => buildChannelMappingPanel(ch)).join('');
}

function buildChannelMappingPanel(ch) {
  const saved = mappings.filter(m => m.channel_id === ch.id);
  const savedRows = saved.map(m => savedMappingRowHtml(m)).join('');

  const isOwn = ch.is_own;
  const colHint = isOwn
    ? 'A열=SKU/상품코드(선택) &nbsp;·&nbsp; B열=상품명 &nbsp;·&nbsp; C열=수량배수(선택)'
    : 'A열=SKU/상품코드(선택) &nbsp;·&nbsp; B열=상품명 &nbsp;·&nbsp; C열=수량배수(선택)';

  return `
  <div class="map-section" id="mapPanel_${ch.id}">
    <div class="map-section-header">
      <div class="map-section-title">
        <span class="map-channel-badge ${isOwn ? 'badge-own' : 'badge-sabang'}">
          <i class="fas fa-${isOwn ? 'store' : 'shopping-cart'}"></i> ${escHtml(ch.name)}
        </span>
        <span style="font-size:12px;color:var(--text-muted)">더존코드: <b style="color:var(--text-sub)">${escHtml(ch.dozone_code||'—')}</b></span>
      </div>
      <div class="map-section-actions">
        <label class="ag-btn btn-map-upload" title="${escHtml(colHint)}">
          <i class="fas fa-file-excel"></i> 엑셀 업로드
          <input type="file" accept=".xlsx,.xls,.csv" style="display:none"
                 onchange="loadMappingExcel(event,'${ch.id}')"/>
        </label>
        <button class="ag-btn btn-map-add" onclick="addMappingRow('${ch.id}')">
          <i class="fas fa-plus"></i> 행 추가
        </button>
      </div>
    </div>

    <div class="map-upload-hint">
      <i class="fas fa-circle-info"></i>
      <span>
        엑셀 형식: <b>${colHint}</b>
        &nbsp;→&nbsp; 업로드 후 드롭다운으로 본사 품목을 선택하고 <b>[매핑 저장]</b>을 누르세요.<br>
        <span style="color:var(--text-muted);font-size:11.5px">
          <i class="fas fa-barcode" style="color:#fbbf24"></i> SKU코드가 있으면 상품명 불일치 없이 <b>정확하게</b> 매칭됩니다.
          수량배수(×2, ×4 등)를 설정하면 묶음단위가 자동 환산됩니다.
        </span>
      </span>
    </div>

    <!-- 대기 행 -->
    <div id="pendingWrap_${ch.id}" style="display:none">
      <div class="map-pending-header">
        <span class="map-pending-label"><i class="fas fa-pen-to-square"></i> 매핑 대기 — 품목과 환산비율을 설정하세요</span>
        <div style="display:flex;gap:8px">
          <button class="ag-btn btn-map-clear" onclick="clearPending('${ch.id}')"><i class="fas fa-xmark"></i> 초기화</button>
          <button class="ag-btn btn-map-save"  onclick="savePendingMapping('${ch.id}')"><i class="fas fa-check"></i> 매핑 저장</button>
        </div>
      </div>
      <div class="map-pending-hint">
        <i class="fas fa-circle-info"></i>
        <b>환산비율</b>: 이 상품명 1주문 = 최소단위 몇 개? &nbsp;|&nbsp;
        <b>5개입→×1</b> &nbsp; <b>10개입→×2</b> &nbsp; <b>20개입→×4</b> &nbsp; <b>40개입→×8</b>
        <span style="color:var(--text-muted)">&nbsp;(품목 선택 시 마스터 비율 자동 적용, 개별 조정 가능)</span>
      </div>
      <div class="map-pending-table-wrap">
        <table class="ag-table map-pending-table">
          <thead><tr>
            <th style="width:32px"></th>
            <th style="width:110px">채널 SKU <span class="col-hint-text">코드(선택)</span></th>
            <th>엑셀 상품명 <span class="col-hint-text">주문서 그대로</span></th>
            <th>→ 본사 품목 <span class="col-hint-text">(번들은 + 추가)</span></th>
            <th style="width:110px">수량배수 <i class="fas fa-circle-question" title="주문 1건 = 본사 기준단위 몇 개?"></i></th>
            <th style="width:70px">번들추가</th>
          </tr></thead>
          <tbody id="pendingBody_${ch.id}"></tbody>
        </table>
      </div>
    </div>

    <!-- 저장된 매핑 -->
    <div class="map-saved-header">
      <i class="fas fa-list-check"></i> 저장된 매핑
      <span class="map-saved-count">${saved.length}건</span>
    </div>
    <div class="map-saved-table-wrap">
      <table class="ag-table">
        <thead><tr>
          <th style="width:110px">채널 SKU <span class="col-hint-text">코드</span></th>
          <th>엑셀 상품명 <span class="col-hint-text">(주문서 표기)</span></th>
          <th style="width:80px">본사 품번</th>
          <th>본사 품명</th>
          <th style="width:130px">수량배수 <span class="col-hint-text">(×배수)</span></th>
          <th class="no-print" style="width:44px">삭제</th>
        </tr></thead>
        <tbody>${savedRows || `<tr><td colspan="6" class="empty-row"><i class="fas fa-inbox"></i> 저장된 매핑이 없습니다.</td></tr>`}</tbody>
      </table>
    </div>
  </div>`;
}

/* 엑셀 업로드 → 대기 행 */
function loadMappingExcel(e, channelId) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const wb  = XLSX.read(new Uint8Array(ev.target.result), { type:'array' });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' });
      const firstA   = String(raw[0]?.[0]||'').trim();
      const isHeader = /쇼핑몰|자사몰|채널|상품|품명|mall|channel|name/i.test(firstA);
      const dataRows = raw.slice(isHeader ? 1 : 0)
        .filter(r => String(r[0]||'').trim() || String(r[1]||'').trim());

      if (!dataRows.length) { showToast('⚠️ 데이터가 없습니다.'); return; }

      // 엑셀 컬럼 구조: A열=SKU(선택), B열=상품명, C열=수량배수(선택)
      //   또는 구형: A열=쇼핑몰/자사몰명, B열=상품명
      // → 첫 번째 열이 SKU 패턴(영숫자)이면 SKU로, 아니면 채널명으로 간주
      const looksLikeSku = v => /^[A-Za-z0-9\-_]{2,30}$/.test(String(v||'').trim());
      const firstColIsSku = dataRows.slice(0,3).filter(r=>String(r[0]||'').trim()).every(r => looksLikeSku(r[0]));

      const saved = mappings.filter(m => m.channel_id === channelId);
      const newRows = dataRows.map(r => {
        const col0 = String(r[0]||'').trim();
        const col1 = String(r[1]||'').trim();
        const col2 = String(r[2]||'').trim();
        const sku        = firstColIsSku ? col0 : '';
        const excel_name = firstColIsSku ? col1 : (col1 || col0);
        const ratio      = parseFloat(col2) || null;
        // 번들 배열 초기화 (엑셀 업로드 시에는 단일 품목부터 시작)
        return { sku, excel_name, bundleItems: [{ item_id: '', ratio }] };
      }).filter(r => (r.sku || r.excel_name) &&
        !saved.find(m => (r.sku && m.sku === r.sku) || (r.excel_name && m.excel_name === r.excel_name)));

      if (!newRows.length) { showToast('ℹ️ 모두 이미 매핑된 상품입니다.'); return; }

      // pendingRows 를 채널별로 관리
      if (!window._pending) window._pending = {};
      window._pending[channelId] = newRows;

      renderPendingTable(channelId);
      showToast(`✅ ${newRows.length}행 로드 — 드롭다운으로 품목 선택 후 [매핑 저장]`);
    } catch(err) { showToast('❌ 파싱 오류: ' + err.message); }
  };
  reader.readAsArrayBuffer(file);
  e.target.value = '';
}

/* 행 수동 추가 */
function addMappingRow(channelId) {
  if (!window._pending) window._pending = {};
  if (!window._pending[channelId]) window._pending[channelId] = [];
  // 빈 번들 행 추가: bundleItems에 빈 첫 번째 품목 포함
  window._pending[channelId].push({ sku: '', excel_name: '', bundleItems: [{ item_id: '', ratio: null }] });
  renderPendingTable(channelId);
  // 마지막 입력란 포커스
  const tbody = document.getElementById('pendingBody_' + channelId);
  if (tbody) {
    const inputs = tbody.querySelectorAll('.pending-src-input');
    if (inputs.length) inputs[inputs.length-1].focus();
  }
}

/* 대기 행 렌더링 — 번들(다중 품목) 지원 */
function renderPendingTable(channelId) {
  const pending  = (window._pending || {})[channelId] || [];
  const wrapEl   = document.getElementById('pendingWrap_'  + channelId);
  const bodyEl   = document.getElementById('pendingBody_'  + channelId);
  if (!wrapEl || !bodyEl) return;

  if (!pending.length) { wrapEl.style.display = 'none'; return; }
  wrapEl.style.display = 'block';

  // 각 대기 행 = { sku, excel_name, bundleItems: [{item_id, ratio}] }
  const rows = pending.map((row, i) => {
    // 번들 배열 정규화 (없으면 빈 1개)
    const bundleItems = row.bundleItems && row.bundleItems.length
      ? row.bundleItems
      : [{ item_id: row.item_id || '', ratio: row.ratio != null ? row.ratio : null }];

    // 첫 번째 번들 아이템: rowspan으로 SKU/품명 셀과 합치기
    const bundleRows = bundleItems.map((bi, bi_idx) => {
      const selItem    = items.find(x => x.id === bi.item_id);
      const masterRatio = selItem ? (Number(selItem.ratio)||1) : 1;
      const currentRatio = bi.ratio != null ? bi.ratio : masterRatio;
      const isFirst = bi_idx === 0;
      const rowspan  = bundleItems.length;

      const skuTd = isFirst ? `
        <td rowspan="${rowspan}" style="vertical-align:top;padding-top:6px">
          <input type="text" class="ag-field-input pending-sku-input"
            value="${escHtml(row.sku||'')}" placeholder="SKU/상품코드"
            oninput="updatePendingRow('${channelId}',${i},'sku',this.value)"
            style="min-width:90px" title="채널 고유 SKU 또는 상품코드 (있으면 우선 매칭)"/>
        </td>` : '';

      const nameTd = isFirst ? `
        <td rowspan="${rowspan}" style="vertical-align:top;padding-top:6px">
          <input type="text" class="ag-field-input pending-src-input"
            value="${escHtml(row.excel_name||'')}" placeholder="엑셀 상품명 그대로"
            oninput="updatePendingRow('${channelId}',${i},'excel_name',this.value)"
            style="min-width:160px"/>
        </td>` : '';

      const noTd = isFirst ? `<td class="no-cell" rowspan="${rowspan}" style="vertical-align:top;padding-top:8px">${i+1}</td>` : '';

      const ratioBadge = (() => {
        if (!selItem) return '<span class="ratio-hint-text">×1</span>';
        const um = (selItem.item_name||'').match(/(\d+)개입/);
        const bu = um ? parseInt(um[1]) : null;
        if (currentRatio === 1) return `<span class="ratio-hint-text">×1${bu?` (${bu}개 최소단위)`:''}</span>`;
        return `<span class="ratio-set-badge ratio-custom">×${currentRatio}${bu?` <span class="ratio-calc">(${bu*currentRatio}개입)</span>`:''}</span>`;
      })();

      const addBtnTd = isFirst ? `
        <td rowspan="${rowspan}" style="vertical-align:top;padding-top:4px;text-align:center;white-space:nowrap">
          <button class="tbl-btn tbl-btn-add-bundle" onclick="addBundleItem('${channelId}',${i})"
            title="이 상품에 품목 추가 (번들)" style="font-size:11px;padding:3px 6px">
            <i class="fas fa-plus"></i> 품목
          </button>
          ${bundleItems.length > 1 ? `<br><span style="font-size:10px;color:var(--accent-color);margin-top:2px;display:block">번들 ${bundleItems.length}개</span>` : ''}
        </td>` : '';

      const delBiBtn = bundleItems.length > 1
        ? `<button class="tbl-btn tbl-btn-del" onclick="removeBundleItem('${channelId}',${i},${bi_idx})"
            title="이 품목 제거" style="font-size:10px;padding:2px 5px;margin-left:4px">
            <i class="fas fa-xmark"></i>
          </button>` : '';

      return `<tr class="${bi_idx > 0 ? 'bundle-sub-row' : ''}">
        ${noTd}
        ${skuTd}
        ${nameTd}
        <td>
          <div style="display:flex;align-items:center;gap:4px">
            ${bi_idx > 0 ? '<span style="font-size:10px;color:var(--text-muted);white-space:nowrap">+ 추가품목</span>' : ''}
            <select class="ag-field-input ag-field-select"
              onchange="onPendingBundleItemSelect('${channelId}',${i},${bi_idx},this.value)"
              style="min-width:180px">
              ${itemOptsHtml(bi.item_id||'')}
            </select>
            ${delBiBtn}
          </div>
        </td>
        <td>
          <div class="ratio-inline-wrap" style="flex-wrap:wrap;gap:4px">
            <span class="ratio-inline-x">×</span>
            <input type="number" class="ratio-inline-input"
              id="pendRatio_${channelId}_${i}_${bi_idx}"
              value="${currentRatio}" min="0.01" step="0.01"
              oninput="updateBundleItemRatio('${channelId}',${i},${bi_idx},parseFloat(this.value)||1)"
              title="5개입=×1 · 10개입=×2 · 20개입=×4 · 40개입=×8"/>
            ${ratioBadge}
          </div>
        </td>
        ${addBtnTd}
      </tr>`;
    }).join('');

    return bundleRows;
  }).join('');

  bodyEl.innerHTML = rows;
}

/* 번들 품목 추가 */
function addBundleItem(channelId, rowIdx) {
  const arr = (window._pending || {})[channelId];
  if (!arr || !arr[rowIdx]) return;
  const row = arr[rowIdx];
  // bundleItems 배열 정규화
  if (!row.bundleItems) {
    row.bundleItems = [{ item_id: row.item_id || '', ratio: row.ratio != null ? row.ratio : null }];
  }
  row.bundleItems.push({ item_id: '', ratio: null });
  renderPendingTable(channelId);
}

/* 번들 품목 제거 */
function removeBundleItem(channelId, rowIdx, biIdx) {
  const arr = (window._pending || {})[channelId];
  if (!arr || !arr[rowIdx]) return;
  const row = arr[rowIdx];
  if (!row.bundleItems || row.bundleItems.length <= 1) return;
  row.bundleItems.splice(biIdx, 1);
  renderPendingTable(channelId);
}

/* 번들 품목 선택 시 마스터 ratio 자동 반영 */
function onPendingBundleItemSelect(channelId, rowIdx, biIdx, itemId) {
  const arr = (window._pending || {})[channelId];
  if (!arr || !arr[rowIdx]) return;
  const row = arr[rowIdx];

  // bundleItems 정규화
  if (!row.bundleItems) {
    row.bundleItems = [{ item_id: row.item_id || '', ratio: row.ratio != null ? row.ratio : null }];
  }
  if (!row.bundleItems[biIdx]) row.bundleItems[biIdx] = { item_id: '', ratio: null };

  row.bundleItems[biIdx].item_id = itemId;
  const selItem = items.find(x => x.id === itemId);
  if (selItem && row.bundleItems[biIdx].ratio == null) {
    row.bundleItems[biIdx].ratio = Number(selItem.ratio) || 1;
  }
  renderPendingTable(channelId);
}

/* 번들 품목 ratio 업데이트 */
function updateBundleItemRatio(channelId, rowIdx, biIdx, val) {
  const arr = (window._pending || {})[channelId];
  if (!arr || !arr[rowIdx]) return;
  const row = arr[rowIdx];
  if (!row.bundleItems) {
    row.bundleItems = [{ item_id: row.item_id || '', ratio: row.ratio != null ? row.ratio : null }];
  }
  if (!row.bundleItems[biIdx]) row.bundleItems[biIdx] = { item_id: '', ratio: null };
  row.bundleItems[biIdx].ratio = Math.max(0.01, val);
}

/* 기존 단일 품목 선택 핸들러 — 번들 첫 번째 항목으로 위임 */
function onPendingItemSelect(channelId, idx, itemId) {
  onPendingBundleItemSelect(channelId, idx, 0, itemId);
}

function updatePendingRow(channelId, idx, field, val) {
  if (!window._pending) return;
  const arr = window._pending[channelId];
  if (!arr || !arr[idx]) return;
  arr[idx][field] = val;
}

function clearPending(channelId) {
  if (window._pending) window._pending[channelId] = [];
  renderPendingTable(channelId);
}

/* 매핑 저장 — 번들(다중 품목) items 배열 형식으로 저장 */
function savePendingMapping(channelId) {
  const pending = (window._pending || {})[channelId] || [];
  let added = 0, updated = 0, noItem = 0, skipped = 0;

  pending.forEach(row => {
    const sku        = (row.sku        || '').trim();
    const excel_name = (row.excel_name || '').trim();
    if (!sku && !excel_name) { skipped++; return; }

    // 번들 품목 배열 정규화
    let bundleItems = row.bundleItems && row.bundleItems.length
      ? row.bundleItems
      : [{ item_id: (row.item_id || '').trim(), ratio: row.ratio != null ? row.ratio : null }];

    // 유효한 품목만 필터링
    bundleItems = bundleItems.filter(bi => bi.item_id);
    if (!bundleItems.length) { noItem++; return; }

    // ratio 정규화
    bundleItems = bundleItems.map(bi => ({
      item_id: bi.item_id,
      ratio:   bi.ratio != null ? Math.max(0.01, Number(bi.ratio) || 1) : null
    }));

    // SKU 기준으로 먼저 중복 찾기, 없으면 excel_name 기준
    let existsIdx = sku
      ? mappings.findIndex(m => m.channel_id === channelId && m.sku === sku)
      : -1;
    if (existsIdx === -1 && excel_name) {
      existsIdx = mappings.findIndex(m => m.channel_id === channelId && m.excel_name === excel_name);
    }

    if (existsIdx !== -1) {
      if (sku)        mappings[existsIdx].sku = sku;
      if (excel_name) mappings[existsIdx].excel_name = excel_name;
      mappings[existsIdx].items = bundleItems;
      // 하위 호환 필드 정리
      delete mappings[existsIdx].item_id;
      delete mappings[existsIdx].ratio;
      updated++;
    } else {
      mappings.push({ id: genId(), channel_id: channelId, sku, excel_name, items: bundleItems });
      added++;
    }
  });
  saveLS(LS_MAPPING, mappings);
  if (window._pending) window._pending[channelId] = [];
  renderMappingSection();
  if (noItem > 0) showToast(`⚠️ ${noItem}행 품목 미선택으로 스킵. ${added}건 저장 / ${updated}건 수정.`);
  else            showToast(`✅ ${added}건 추가, ${updated}건 수정 완료!`);
}

/* 저장된 매핑 환산비율 수정 — 번들 품목별 개별 ratio 저장 */
function saveBundleItemRatio(mappingId, biIdx, val) {
  const ratio = Math.max(0.01, parseFloat(val) || 1);
  const mp    = mappings.find(m => m.id === mappingId);
  if (!mp) return;

  // items 배열 정규화
  if (!mp.items || !mp.items.length) {
    if (mp.item_id) {
      mp.items = [{ item_id: mp.item_id, ratio: mp.ratio ?? null }];
    } else {
      mp.items = [{ item_id: '', ratio: null }];
    }
  }
  if (!mp.items[biIdx]) return;
  mp.items[biIdx].ratio = ratio;

  saveLS(LS_MAPPING, mappings);
  renderMappingSection();
  showToast(`✅ 환산비율 ×${ratio} 저장 (다른 매핑에는 영향 없음)`);
}

/* 하위 호환: 기존 단일 ratio 저장 (현재는 번들 0번째 항목으로 위임) */
function saveMappingRatio(mappingId, val) {
  saveBundleItemRatio(mappingId, 0, val);
}

/* 저장된 매핑 삭제 */
function deleteMapping(mappingId) {
  if (!confirm('이 매핑을 삭제하시겠습니까?')) return;
  mappings = mappings.filter(m => m.id !== mappingId);
  saveLS(LS_MAPPING, mappings);
  renderMappingSection();
  showToast('🗑️ 삭제되었습니다.');
}

// ════════════════════════════════════════════════════════════
//  유틸
// ════════════════════════════════════════════════════════════
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function escHtml(s) {
  return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function todayStr() { return new Date().toISOString().slice(0,10); }
function fmtDate(str) {
  if (!str) return '';
  const [y,m,d] = str.split('-');
  return `${y}.${m}.${d}`;
}
function showToast(msg) {
  const el = document.getElementById('agToast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 3200);
}

// 모달 배경 클릭 닫기
document.addEventListener('DOMContentLoaded', () => {
  ['itemModal','unmatchedModal'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', e => {
      if (e.target.id === id) document.getElementById(id).classList.remove('show');
    });
  });

  // 20:00 자동 초기화 스케줄러 시작
  scheduleResetAt20();
});

// ════════════════════════════════════════════════════════════
//  출고집계 연동 — pushToShipment
// ════════════════════════════════════════════════════════════

const SHIP_RECORDS_KEY = 'shipment_records_v1';  // shipment.js와 공유하는 키
const AGG_RESET_KEY    = 'agg_last_reset_date';  // 마지막 초기화 날짜 기록

/**
 * 집계 결과(lastResult)를 shipment_records_v1에 누적 저장합니다.
 * - 채널명(채널 마스터) + 더존코드 기준으로 동일 날짜·동일 집계세션 중복 방지
 * - source:'aggregator', sessionId 필드로 식별
 */
function pushToShipment() {
  if (!lastResult || !lastResult.length) return;

  const dateVal  = document.getElementById('aggDate')?.value || todayStr();
  const sessionId = genId();   // 이번 집계 세션 고유 ID

  // 기존 records 로드
  let records = [];
  try { records = JSON.parse(localStorage.getItem(SHIP_RECORDS_KEY)) || []; } catch { records = []; }

  // 채널별로 수량 합산해서 레코드 생성
  // 같은 채널 내 여러 품목 수량은 합산 (채널 총 출고량 기준)
  const byChannel = {};
  lastResult.forEach(r => {
    const ch   = channels.find(c => c.id === r.channelId);
    const item = items.find(it => it.id === r.itemId);
    if (!ch) return;
    const key = ch.id;
    if (!byChannel[key]) {
      byChannel[key] = {
        channelId:   ch.id,
        channelName: ch.name,
        dozoneCode:  ch.dozone_code || '',
        qty: 0,
        items: []
      };
    }
    byChannel[key].qty += r.qty;
    byChannel[key].items.push({
      item_code: item?.item_code || '?',
      item_name: item?.item_name || '(미등록)',
      qty:       r.qty
    });
  });

  // records에 추가
  let added = 0;
  Object.values(byChannel).forEach(ch => {
    const rec = {
      id:          genId(),
      date:        dateVal,
      channel:     ch.channelName,
      slot:        '종일',
      count:       ch.qty,
      memo:        `매핑관리 집계 (${ch.items.map(it => `${it.item_code}×${it.qty}`).join(', ')})`,
      source:      'aggregator',   // 출처 표시
      sessionId:   sessionId,
      dozoneCode:  ch.dozoneCode,
      items:       ch.items
    };
    records.push(rec);
    added++;
  });

  localStorage.setItem(SHIP_RECORDS_KEY, JSON.stringify(records));
  showToast(`📦 출고집계에 ${added}개 채널 데이터 전송 완료!`);
}

/**
 * 매일 20:00에 당일 집계(aggregator 출처) 데이터를 아카이브에 보존하고
 * 다음 집계를 위해 초기화합니다.
 * - 실제 초기화: aggregator 출처 레코드 중 당일 날짜 것은 유지(이미 저장됨)
 *   rawOwn / rawSabang 업로드 파일을 초기화 (새 파일 업로드 유도)
 */
function scheduleResetAt20() {
  checkAndReset20();          // 페이지 로드 시 즉시 체크
  setInterval(checkAndReset20, 60 * 1000);  // 1분마다 체크
}

function checkAndReset20() {
  const now      = new Date();
  const today    = now.toISOString().slice(0, 10);
  const hour     = now.getHours();
  const lastReset = localStorage.getItem(AGG_RESET_KEY) || '';

  // 오늘 20:00 이후이고 아직 오늘 초기화 안 했으면 실행
  if (hour >= 20 && lastReset !== today) {
    performDailyReset(today);
  }
}

function performDailyReset(dateStr) {
  // 초기화 날짜 기록
  localStorage.setItem(AGG_RESET_KEY, dateStr);

  // 업로드 파일 상태만 초기화 (records는 보존)
  rawOwn    = null;
  rawSabang = null;

  // UI 초기화
  const dropOwn    = document.getElementById('dropOwn');
  const statusOwn  = document.getElementById('statusOwn');
  const dropSab    = document.getElementById('dropSabang');
  const statusSab  = document.getElementById('statusSabang');
  if (dropOwn)   dropOwn.style.display   = 'flex';
  if (statusOwn) statusOwn.style.display = 'none';
  if (dropSab)   dropSab.style.display   = 'flex';
  if (statusSab) statusSab.style.display = 'none';

  // 결과 섹션 숨김
  const resultSec = document.getElementById('resultSection');
  if (resultSec) resultSec.style.display = 'none';
  lastResult = [];

  showToast(`🔄 [20:00 자동초기화] ${dateStr} 집계 데이터가 출고집계에 저장되었습니다.`);
  console.log(`[aggregator] 20:00 자동초기화 완료 — ${dateStr}`);
}
