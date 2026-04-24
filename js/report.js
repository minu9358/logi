/* =============================================
   물류팀 일일 업무 현황 - 메인 스크립트
   ============================================= */

// ── 오전/오후 코스 정의 ───────────────────────────────
const AM_COURSES = [1, 2];          // 오전: 1, 2코스
const PM_COURSES = [3, 4, 5, 6, 7, 8]; // 오후: 3~8코스

// 기타 행 타입 placeholder
const ROW_CONFIG = {
  am_extra:        { placeholders: ['업무 내용', '비고'] },
  pm_extra:        { placeholders: ['업무 내용', '비고'] },
  online_delivery: { placeholders: ['채널/내역', '건수'] },
  online_return:   { placeholders: ['반품 내역', '건수'] },
  extra_work:      { placeholders: ['업무 내용', '비고'] },
  tomorrow_plan:   { placeholders: ['이름', '인수인계 사항'] },
};

// ── 전역 상태 ──────────────────────────────────────────
let currentDate      = '';
let currentRecordId  = null;
let currentAmCourse  = '';   // 오전 코스: 'A'~'E' | ''
let currentPmCourse  = '';   // 오후 코스: 'A'~'E' | ''

// ── 초기화 ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('reportDate').value = today;
  currentDate = today;

  // 포장 행 초기 생성
  buildPackRows('amPackRows', AM_COURSES, '');
  buildPackRows('pmPackRows', PM_COURSES, '');

  // 기타 행 초기 1개
  addRowsN('amExtraRows',       'am_extra',       1);
  addRowsN('pmExtraRows',       'pm_extra',       1);
  addRowsN('onlineDeliveryRows','online_delivery',1);
  addRowsN('onlineReturnRows',  'online_return',  1);
  addRowsN('extraWorkRows',     'extra_work',     1);
  addRowsN('tomorrowPlanRows',  'tomorrow_plan',  1);

  // 텔레그램 설정 고정값 (항상 그룹 채팅방으로 전송)
  const DEFAULT_TG_TOKEN  = '8665540067:AAFmSiDZ9Ygnf3-ZsFU4E1oxxSqkqe8XOLQ';
  const DEFAULT_TG_CHATID = '-5070526255';
  document.getElementById('tgBotToken').value = DEFAULT_TG_TOKEN;
  document.getElementById('tgChatId').value   = DEFAULT_TG_CHATID;
  localStorage.setItem('tg_bot_token', DEFAULT_TG_TOKEN);
  localStorage.setItem('tg_chat_id',   DEFAULT_TG_CHATID);

  loadReport();
});

// ── 코스 선택 (오전) ──────────────────────────────────
function selectAmCourse(code) {
  currentAmCourse = code;
  // 오전 버튼 활성화
  document.querySelectorAll('.am-course-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.course === code);
  });
  // 오전 라벨
  const lbl = document.getElementById('amCourseLabel');
  lbl.textContent = `${code} 선택됨`;
  lbl.classList.add('has-course');
  // 오전 포장행 갱신
  refreshCourseLabels('amPackRows', AM_COURSES, code);
}

// ── 코스 선택 (오후) ──────────────────────────────────
function selectPmCourse(code) {
  currentPmCourse = code;
  // 오후 버튼 활성화
  document.querySelectorAll('.pm-course-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.course === code);
  });
  // 오후 라벨
  const lbl = document.getElementById('pmCourseLabel');
  lbl.textContent = `${code} 선택됨`;
  lbl.classList.add('has-course');
  // 오후 포장행 갱신
  refreshCourseLabels('pmPackRows', PM_COURSES, code);
}

// 코스 레이블 갱신 (코스 구분 선택 시)
function refreshCourseLabels(containerId, courseNums, code) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  const rows = wrap.querySelectorAll('.pack-row');
  rows.forEach((row, i) => {
    const lbl = row.querySelector('.pack-course-label');
    if (!lbl) return;
    const num = courseNums[i];
    if (code) {
      lbl.textContent = `${code}${num} 코스`;
      lbl.classList.remove('no-course');
    } else {
      lbl.textContent = `${num} 코스`;
      lbl.classList.add('no-course');
    }
  });
}

// ── 포장 현황 행 생성 ─────────────────────────────────
// courseNums: [1,2] 또는 [3,4,5,6,7,8]
// code: 'A'~'E' 또는 ''
function buildPackRows(containerId, courseNums, code, savedValues = {}) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  wrap.innerHTML = '';
  courseNums.forEach(num => {
    const labelText = code ? `${code}${num} 코스` : `${num} 코스`;
    const boxes = savedValues[num] || '';
    const row = document.createElement('div');
    row.className = 'pack-row';
    row.dataset.courseNum = num;
    row.innerHTML = `
      <span class="pack-course-label${code ? '' : ' no-course'}">${labelText}</span>
      <input type="number" class="pack-boxes-input" min="0" value="${escHtml(String(boxes))}" placeholder=""/>
      <span class="pack-boxes-unit">박스</span>
    `;
    wrap.appendChild(row);
  });
}

// ── 포장 현황 데이터 수집 ─────────────────────────────
function collectPackRows(containerId) {
  const result = [];
  const rows = document.querySelectorAll(`#${containerId} .pack-row`);
  rows.forEach(row => {
    const label = row.querySelector('.pack-course-label')?.textContent || '';
    const boxes = row.querySelector('.pack-boxes-input')?.value.trim() || '';
    result.push({ main: label, qty: boxes });
  });
  return result;
}

// ── 일반 행 추가 ──────────────────────────────────────
function addRow(containerId, type, val1 = '', val2 = '') {
  const container = document.getElementById(containerId);
  if (!container) return;
  const cfg = ROW_CONFIG[type] || { placeholders: ['내용', '비고'] };
  const row = document.createElement('div');

  // 내일 업무계획은 이름(왼쪽) + 인수인계 사항(오른쪽) 레이아웃
  if (type === 'tomorrow_plan') {
    row.className = 'row-item plan-row';
    row.innerHTML = `
      <input type="text" class="row-main plan-name-input" placeholder="이름" value="${escHtml(val1)}"/>
      <input type="text" class="qty-input plan-note-input" placeholder="인수인계 사항" value="${escHtml(val2)}"/>
      <button class="row-del-btn" onclick="removeRow(this)" title="삭제"><i class="fas fa-xmark"></i></button>
    `;
  } else {
    row.className = 'row-item';
    row.innerHTML = `
      <input type="text" class="row-main" placeholder="${cfg.placeholders[0]}" value="${escHtml(val1)}"/>
      <input type="text" class="qty-input"  placeholder="${cfg.placeholders[1]}" value="${escHtml(val2)}"/>
      <button class="row-del-btn" onclick="removeRow(this)" title="삭제"><i class="fas fa-xmark"></i></button>
    `;
  }
  container.appendChild(row);
}

function addRowsN(containerId, type, n) {
  for (let i = 0; i < n; i++) addRow(containerId, type);
}

function removeRow(btn) {
  btn.closest('.row-item').remove();
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── 일반 행 데이터 수집 ───────────────────────────────
function collectRows(containerId) {
  const result = [];
  document.querySelectorAll(`#${containerId} .row-item`).forEach(row => {
    const main = row.querySelector('.row-main')?.value.trim() || '';
    const qty  = row.querySelector('.qty-input')?.value.trim()  || '';
    if (main || qty) result.push({ main, qty });
  });
  return result;
}

// ── 전체 데이터 수집 ──────────────────────────────────
function collectAllData() {
  return {
    report_date:           document.getElementById('reportDate').value,
    reporter:              document.getElementById('reporter').value.trim(),
    worker_count:          parseInt(document.getElementById('workerCount').value) || 0,
    am_course_code:        currentAmCourse,
    pm_course_code:        currentPmCourse,
    am_pack:               collectPackRows('amPackRows'),
    am_extra:              collectRows('amExtraRows'),
    am_issue:              document.getElementById('amIssue').value.trim(),
    pm_pack:               collectPackRows('pmPackRows'),
    pm_extra:              collectRows('pmExtraRows'),
    pm_issue:              document.getElementById('pmIssue').value.trim(),
    online_delivery_count: parseInt(document.getElementById('onlineDeliveryCount').value) || 0,
    online_return_count:   parseInt(document.getElementById('onlineReturnCount').value) || 0,
    online_delivery:       collectRows('onlineDeliveryRows'),
    online_return:         collectRows('onlineReturnRows'),
    extra_work:            collectRows('extraWorkRows'),
    special_note:          document.getElementById('specialNote').value.trim(),
    tomorrow_plan:         collectRows('tomorrowPlanRows'),
    telegram_sent:         false,
  };
}

// ── 복원: 포장 행 ─────────────────────────────────────
// rows = [{main:'A1 코스', qty:'10'}, ...]
function restorePackRows(containerId, courseNums, rows, code) {
  // rows를 courseNum → qty 맵으로 변환
  const savedValues = {};
  if (Array.isArray(rows)) {
    rows.forEach((r, i) => {
      const num = courseNums[i];
      if (num !== undefined) savedValues[num] = r.qty || '';
    });
  }
  buildPackRows(containerId, courseNums, code, savedValues);
}

// ── 복원: 일반 행 ─────────────────────────────────────
function fillRows(containerId, type, rows, defaultN = 1) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  if (!Array.isArray(rows) || rows.length === 0) {
    addRowsN(containerId, type, defaultN);
    return;
  }
  rows.forEach(r => addRow(containerId, type, r.main || '', r.qty || ''));
}

// ── 전체 복원 ─────────────────────────────────────────
function fillAllData(data) {
  if (!data) return;
  document.getElementById('reporter').value    = data.reporter || '';
  document.getElementById('workerCount').value = data.worker_count || '';

  // 오전 코스 복원
  const amCode = data.am_course_code || '';
  currentAmCourse = amCode;
  document.querySelectorAll('.am-course-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.course === amCode);
  });
  const amLbl = document.getElementById('amCourseLabel');
  if (amCode) {
    amLbl.textContent = `${amCode} 선택됨`;
    amLbl.classList.add('has-course');
  } else {
    amLbl.textContent = '선택 안 됨';
    amLbl.classList.remove('has-course');
  }

  // 오후 코스 복원
  const pmCode = data.pm_course_code || '';
  currentPmCourse = pmCode;
  document.querySelectorAll('.pm-course-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.course === pmCode);
  });
  const pmLbl = document.getElementById('pmCourseLabel');
  if (pmCode) {
    pmLbl.textContent = `${pmCode} 선택됨`;
    pmLbl.classList.add('has-course');
  } else {
    pmLbl.textContent = '선택 안 됨';
    pmLbl.classList.remove('has-course');
  }

  // 포장 행 복원
  restorePackRows('amPackRows', AM_COURSES, data.am_pack, amCode);
  restorePackRows('pmPackRows', PM_COURSES, data.pm_pack, pmCode);

  // 일반 행 복원
  fillRows('amExtraRows', 'am_extra', data.am_extra, 1);
  document.getElementById('amIssue').value = data.am_issue || '';

  fillRows('pmExtraRows', 'pm_extra', data.pm_extra, 1);
  document.getElementById('pmIssue').value = data.pm_issue || '';

  document.getElementById('onlineDeliveryCount').value = data.online_delivery_count || '';
  document.getElementById('onlineReturnCount').value   = data.online_return_count   || '';
  fillRows('onlineDeliveryRows', 'online_delivery', data.online_delivery, 1);
  fillRows('onlineReturnRows',   'online_return',   data.online_return,   1);

  fillRows('extraWorkRows',    'extra_work',   data.extra_work,   1);
  document.getElementById('specialNote').value = data.special_note || '';
  fillRows('tomorrowPlanRows', 'tomorrow_plan', data.tomorrow_plan, 1);
}

// ── 저장 ──────────────────────────────────────────────
async function saveReport() {
  const data = collectAllData();
  const date = data.report_date;
  if (!date) { showToast('날짜를 먼저 선택해주세요.', 'error'); return; }

  const payload = {
    id:                    date,
    report_date:           date,
    reporter:              data.reporter,
    worker_count:          data.worker_count,
    am_inbound:            JSON.stringify(data.am_pack),    // 기존 필드 재사용
    am_outbound:           JSON.stringify(data.am_extra),
    am_stock:              data.am_course_code + '|' + data.pm_course_code, // 코스 저장
    am_issue:              data.am_issue,
    pm_inbound:            JSON.stringify(data.pm_pack),
    pm_outbound:           JSON.stringify(data.pm_extra),
    pm_stock:              '[]',
    pm_issue:              data.pm_issue,
    online_delivery_count: data.online_delivery_count,
    online_return_count:   data.online_return_count,
    online_delivery:       JSON.stringify(data.online_delivery),
    online_return:         JSON.stringify(data.online_return),
    extra_work:            JSON.stringify(data.extra_work),
    special_note:          data.special_note,
    tomorrow_plan:         JSON.stringify(data.tomorrow_plan),
    telegram_sent:         data.telegram_sent,
  };

  try {
    let res;
    if (currentRecordId) {
      res = await fetch(`tables/daily_report/${currentRecordId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      res = await fetch('tables/daily_report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }
    if (!res.ok) throw new Error(await res.text());
    const saved = await res.json();
    currentRecordId = saved.id;
    setBadge(true);
    showToast('✅ 보고서가 저장되었습니다!', 'success');
  } catch (e) {
    console.error(e);
    showToast('❌ 저장에 실패했습니다.', 'error');
  }
}

// ── 불러오기 ──────────────────────────────────────────
async function loadReport() {
  const date = document.getElementById('reportDate').value;
  if (!date) return;
  currentDate     = date;
  currentRecordId = null;
  setBadge(false);

  try {
    const res  = await fetch(`tables/daily_report?search=${date}&limit=5`);
    if (!res.ok) throw new Error();
    const json = await res.json();
    const records = (json.data || []).filter(r => r.report_date === date);

    if (records.length === 0) {
      resetForm();
      showToast(`📅 ${date} 보고서가 없습니다. 새로 작성하세요.`, 'info');
      return;
    }

    const rec = records[0];
    currentRecordId = rec.id;

    const parseArr = (v) => { try { return JSON.parse(v) || []; } catch { return []; } };

    fillAllData({
      reporter:              rec.reporter,
      worker_count:          rec.worker_count,
      am_course_code:        (rec.am_stock || '').split('|')[0] || '',
      pm_course_code:        (rec.am_stock || '').split('|')[1] || '',
      am_pack:               parseArr(rec.am_inbound),
      am_extra:              parseArr(rec.am_outbound),
      am_issue:              rec.am_issue,
      pm_pack:               parseArr(rec.pm_inbound),
      pm_extra:              parseArr(rec.pm_outbound),
      pm_issue:              rec.pm_issue,
      online_delivery_count: rec.online_delivery_count,
      online_return_count:   rec.online_return_count,
      online_delivery:       parseArr(rec.online_delivery),
      online_return:         parseArr(rec.online_return),
      extra_work:            parseArr(rec.extra_work),
      special_note:          rec.special_note,
      tomorrow_plan:         parseArr(rec.tomorrow_plan),
    });
    setBadge(true);
    showToast(`📂 ${date} 보고서를 불러왔습니다.`, 'success');
  } catch (e) {
    console.error(e);
  }
}

// ── 폼 리셋 ───────────────────────────────────────────
function resetForm() {
  ['reporter','amIssue','pmIssue','specialNote'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('workerCount').value = '';
  document.getElementById('onlineDeliveryCount').value = '';
  document.getElementById('onlineReturnCount').value = '';

  // 코스 구분 초기화
  currentAmCourse = '';
  currentPmCourse = '';
  document.querySelectorAll('.am-course-btn, .pm-course-btn').forEach(btn => btn.classList.remove('active'));
  const amLbl = document.getElementById('amCourseLabel');
  amLbl.textContent = '선택 안 됨';
  amLbl.classList.remove('has-course');
  const pmLbl = document.getElementById('pmCourseLabel');
  pmLbl.textContent = '선택 안 됨';
  pmLbl.classList.remove('has-course');

  // 포장 행 재생성
  buildPackRows('amPackRows', AM_COURSES, '');
  buildPackRows('pmPackRows', PM_COURSES, '');

  // 기타 행 재생성
  const resetMap = [
    ['amExtraRows',       'am_extra',       1],
    ['pmExtraRows',       'pm_extra',       1],
    ['onlineDeliveryRows','online_delivery',1],
    ['onlineReturnRows',  'online_return',  1],
    ['extraWorkRows',     'extra_work',     1],
    ['tomorrowPlanRows',  'tomorrow_plan',  1],
  ];
  resetMap.forEach(([cid, type, n]) => {
    const el = document.getElementById(cid);
    if (el) { el.innerHTML = ''; addRowsN(cid, type, n); }
  });
}

// ── 배지 ──────────────────────────────────────────────
function setBadge(saved) {
  const badge = document.getElementById('saveBadge');
  badge.textContent = saved ? '✔ 저장됨' : '미저장';
  badge.classList.toggle('saved', saved);
}

// ── 인쇄 ──────────────────────────────────────────────
function printReport() { window.print(); }

// ── 텔레그램 모달 ─────────────────────────────────────
async function openTelegramModal() {
  // 일일 보고 메시지 먼저
  let msg = buildTelegramMessage();
  // 팀원 공유 내용 불러오기
  const shareMsg = await fetchShareMessage();
  if (shareMsg) msg += '\n\n' + shareMsg;
  document.getElementById('tgPreview').value = msg;
  document.getElementById('telegramModal').classList.add('active');
}

// ── 팀원 공유 내용 가져오기 (index → share 통합용) ────
async function fetchShareMessage() {
  const MEMBERS_LIST = ['김민우','김도훈','고성진','장휘인','석미경','김구현'];
  const date = document.getElementById('reportDate').value;
  if (!date) return '';
  try {
    const res  = await fetch(`tables/team_share?search=${date}&limit=50`);
    const json = await res.json();
    const rows = (json.data || []).filter(r => r.share_date === date);
    if (rows.length === 0) return '';

    const map = {};
    rows.forEach(r => {
      map[r.member_name] = {
        done_today:  safeJsonParse(r.done_today),
        shared_work: safeJsonParse(r.shared_work),
        memo:        r.memo || '',
      };
    });

    const lines = [
      `━━━━━━━━━━━━━━━━━━━━`,
      `👥 팀원 업무 공유`,
      `━━━━━━━━━━━━━━━━━━━━`,
    ];
    MEMBERS_LIST.forEach(name => {
      const rec = map[name];
      lines.push(`━━━ 👤 ${name} ━━━`);
      if (!rec) { lines.push('  - 미작성'); lines.push(''); return; }
      const hasFill = rec.done_today.length || rec.shared_work.length || rec.memo;
      if (!hasFill) { lines.push('  - 미작성'); lines.push(''); return; }
      if (rec.done_today.length)  { lines.push('✅ 체크 사항'); rec.done_today.forEach(v => lines.push(`  • ${v}`)); }
      if (rec.shared_work.length) { lines.push('📢 공유 사항'); rec.shared_work.forEach(v => lines.push(`  • ${v}`)); }
      if (rec.memo) lines.push(`💬 전달사항: ${rec.memo}`);
      lines.push('');
    });
    return lines.join('\n');
  } catch { return ''; }
}

function safeJsonParse(v) {
  try { return JSON.parse(v) || []; } catch { return []; }
}
function closeTelegramModal(e) {
  if (e && e.target !== document.getElementById('telegramModal')) return;
  document.getElementById('telegramModal').classList.remove('active');
}
function saveTgSettings() {
  localStorage.setItem('tg_bot_token', document.getElementById('tgBotToken').value.trim());
  localStorage.setItem('tg_chat_id',   document.getElementById('tgChatId').value.trim());
  showToast('✅ 텔레그램 설정이 저장되었습니다.', 'success');
}

// ── 텔레그램 메시지 빌드 ──────────────────────────────
function buildTelegramMessage() {
  const d = collectAllData();
  const date    = d.report_date || '-';
  const dayName = date ? ['일','월','화','수','목','금','토'][new Date(date).getDay()] : '';

  const fmtPack = (rows) => {
    if (!Array.isArray(rows) || rows.length === 0) return '  - 없음';
    return rows.map(r => `  • ${r.main}${r.qty ? ': ' + r.qty + '박스' : ''}`).join('\n');
  };
  const fmtRows = (rows) => {
    if (!Array.isArray(rows) || rows.length === 0) return '  - 없음';
    return rows.map(r => `  • ${r.main}${r.qty ? ' [' + r.qty + ']' : ''}`).join('\n');
  };
  const fmtTomorrowPlan = (rows) => {
    if (!Array.isArray(rows) || rows.length === 0) return '  - 없음';
    return rows.map(r => {
      if (r.main && r.qty) return `  👤 ${r.main}: ${r.qty}`;
      if (r.main) return `  👤 ${r.main}`;
      if (r.qty)  return `  → ${r.qty}`;
      return '';
    }).filter(Boolean).join('\n');
  };

  const amTag = d.am_course_code ? ` [${d.am_course_code}]` : '';
  const pmTag = d.pm_course_code ? ` [${d.pm_course_code}]` : '';

  return [
    `📦 물류팀 일일 업무 현황`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `📅 날짜: ${date} (${dayName})`,
    `✍️ 작성자: ${d.reporter || '-'}`,
    `👥 출근 인원: ${d.worker_count || 0}명`,
    ``,
    `━━━ ☀️ 오전 업무${amTag} ━━━`,
    `📦 포장 현황:`,
    fmtPack(d.am_pack),
    d.am_extra?.length ? `📋 기타 업무:\n${fmtRows(d.am_extra)}` : '',
    d.am_issue ? `⚠️ 특이사항: ${d.am_issue}` : '',
    ``,
    `━━━ 🌙 오후 업무${pmTag} ━━━`,
    `📦 포장 현황:`,
    fmtPack(d.pm_pack),
    d.pm_extra?.length ? `📋 기타 업무:\n${fmtRows(d.pm_extra)}` : '',
    d.pm_issue ? `⚠️ 특이사항: ${d.pm_issue}` : '',
    ``,
    `━━━ 🌐 온라인 배송 ━━━`,
    `📦 출고 ${d.online_delivery_count}건 / 반품 ${d.online_return_count}건`,
    `[배송 내역]\n${fmtRows(d.online_delivery)}`,
    `[반품 내역]\n${fmtRows(d.online_return)}`,
    ``,
    `━━━ 📋 기타 추가 업무 ━━━`,
    fmtRows(d.extra_work),
    ``,
    `━━━ 📢 특이사항·전달사항 ━━━`,
    d.special_note || '  - 없음',
    ``,
    `━━━ 📅 내일 업무 계획 ━━━`,
    fmtTomorrowPlan(d.tomorrow_plan),
    ``,
    `━━━━━━━━━━━━━━━━━━━━`,
    `🕐 보고 시각: ${new Date().toLocaleTimeString('ko-KR')}`,
  ].filter(l => l !== undefined && l !== '').join('\n');
}

// ── 텔레그램 전송 ─────────────────────────────────────
async function sendTelegram() {
  const token  = document.getElementById('tgBotToken').value.trim();
  const chatId = document.getElementById('tgChatId').value.trim();
  if (!token || !chatId) { showToast('❌ Bot Token과 Chat ID를 입력해주세요.', 'error'); return; }

  try {
    const res  = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: document.getElementById('tgPreview').value,
      }),
    });
    const json = await res.json();
    if (json.ok) {
      showToast('✈️ 텔레그램 전송 성공!', 'success');
      closeTelegramModal();
      if (currentRecordId) {
        await fetch(`tables/daily_report/${currentRecordId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ telegram_sent: true }),
        });
      }
    } else {
      showToast(`❌ 전송 실패: ${json.description || '알 수 없는 오류'}`, 'error');
    }
  } catch (e) {
    showToast('❌ 네트워크 오류가 발생했습니다.', 'error');
    console.error(e);
  }
}

// ── 토스트 알림 ───────────────────────────────────────
let toastTimer;
function showToast(msg, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}
