/* =============================================
   물류팀 업무 공유 - share.js
   ============================================= */

// ── 팀원 목록 (members.js getMembers() 우선, 없으면 기본값)
let MEMBERS = typeof getMembers === 'function'
  ? getMembers()
  : ['김민우', '김도훈', '고성진', '장휘인', '석미경', '김구현'];

// 팀원 변경 이벤트 수신 → 카드 목록 재렌더
window.addEventListener('membersChanged', (e) => {
  MEMBERS = e.detail;
  loadAllMembers();
});

// ── 섹션 정의 ──────────────────────────────────
const SECTIONS = [
  { key: 'done_today',  icon: 'fas fa-check-circle',   label: '체크 사항',            color: '#16a34a' },
  { key: 'shared_work', icon: 'fas fa-share-nodes',    label: '공유 사항',             color: '#2563eb' },
];

// ── 전역 상태 ──────────────────────────────────
let currentDate   = '';
let memberRecords = {};   // { '김민우': { id, done_today:[], shared_work:[], not_shared:[], memo:'' }, ... }
let toastTimer    = null;

// ── 초기화 ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('shareDate').value = today;
  currentDate = today;
  updateDateBanner(today);

  // 텔레그램 설정 고정값 (항상 그룹 채팅방으로 전송)
  const DEFAULT_TG_TOKEN  = '8665540067:AAFmSiDZ9Ygnf3-ZsFU4E1oxxSqkqe8XOLQ';
  const DEFAULT_TG_CHATID = '-5070526255';
  document.getElementById('tgToken').value  = DEFAULT_TG_TOKEN;
  document.getElementById('tgChatId').value = DEFAULT_TG_CHATID;
  localStorage.setItem('tg_bot_token', DEFAULT_TG_TOKEN);
  localStorage.setItem('tg_chat_id',   DEFAULT_TG_CHATID);

  loadAllMembers();
});

// ── 날짜 배너 갱신 ───────────────────────────────
function updateDateBanner(dateStr) {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const d = new Date(dateStr);
  const day = days[d.getDay()];
  document.getElementById('dateBannerText').textContent =
    `📅 ${dateStr} (${day}요일) 팀원 업무 공유`;
}

// ── 전체 팀원 데이터 불러오기 ────────────────────
async function loadAllMembers() {
  const date = document.getElementById('shareDate').value;
  if (!date) return;
  currentDate = date;
  updateDateBanner(date);
  memberRecords = {};

  try {
    const res  = await fetch(`tables/team_share?search=${date}&limit=50`);
    const json = await res.json();
    const rows = (json.data || []).filter(r => r.share_date === date);
    rows.forEach(r => {
      memberRecords[r.member_name] = {
        id:          r.id,
        done_today:  safeJson(r.done_today),
        shared_work: safeJson(r.shared_work),
        memo:        r.memo || '',
        updated_time: r.updated_time || '',
      };
    });
  } catch (e) {
    console.error('로드 오류', e);
  }

  renderAllCards();
}

function safeJson(v) {
  try { return JSON.parse(v) || []; } catch { return []; }
}

// ── 전체 카드 렌더링 ─────────────────────────────
function renderAllCards() {
  const list = document.getElementById('memberList');
  list.innerHTML = '';

  MEMBERS.forEach((name, idx) => {
    const rec  = memberRecords[name] || null;
    const card = buildCard(name, idx, rec);
    list.appendChild(card);
  });
}

// ── 카드 빌드 ────────────────────────────────────
function buildCard(name, idx, rec) {
  const hasFill = rec && (
    rec.done_today.some(Boolean)  ||
    rec.shared_work.some(Boolean) ||
    rec.memo
  );

  const card = document.createElement('div');
  card.className = 'member-card';
  card.id = `card-${idx}`;

  // ── 헤더 ──
  const initials = name.slice(-2);
  const updatedStr = rec?.updated_time
    ? `<i class="fas fa-clock"></i> ${rec.updated_time} 저장`
    : '아직 입력 전';

  card.innerHTML = `
    <div class="member-card-header" onclick="toggleCard(${idx})">
      <div class="member-avatar av-${idx}">${initials}</div>
      <div class="member-info">
        <div class="member-name">${name} <span class="my-badge" style="display:none" id="mybadge-${idx}">내 항목</span></div>
        <div class="member-status">
          <span class="status-dot${hasFill ? ' filled' : ''}"></span>
          <span id="status-text-${idx}">${hasFill ? '작성 완료' : '미작성'}</span>
          &nbsp;·&nbsp; ${updatedStr}
        </div>
      </div>
      <i class="fas fa-chevron-down member-toggle-icon"></i>
    </div>
    <div class="member-card-body" id="body-${idx}"></div>
  `;

  // ── 본문 (입력 폼) ──
  const body = card.querySelector(`#body-${idx}`);
  body.appendChild(buildForm(name, idx, rec));

  return card;
}

// ── 폼 빌드 (입력 + 저장) ────────────────────────
function buildForm(name, idx, rec) {
  const wrap = document.createElement('div');

  // 마지막 수정 시각
  const updDiv = document.createElement('div');
  updDiv.className = 'member-updated';
  updDiv.id = `updated-${idx}`;
  if (rec?.updated_time) {
    updDiv.innerHTML = `<i class="fas fa-clock"></i> 마지막 저장: ${rec.updated_time}`;
  }
  wrap.appendChild(updDiv);

  // 섹션들
  const secGroup = document.createElement('div');
  secGroup.className = 'sh-section-group';

  SECTIONS.forEach(sec => {
    const existing = rec?.[sec.key] || [];
    const secEl = document.createElement('div');
    secEl.className = 'sh-input-section';
    secEl.innerHTML = `
      <div class="sh-input-label" style="color:${sec.color}">
        <i class="${sec.icon}" style="color:${sec.color}"></i> ${sec.label}
      </div>
      <div class="sh-rows-wrap" id="rows-${idx}-${sec.key}"></div>
      <button class="sh-add-row-btn" onclick="addShRow(${idx},'${sec.key}')">
        <i class="fas fa-plus"></i> 추가
      </button>
    `;
    secGroup.appendChild(secEl);

    // 기존 데이터 채우기
    const container = secEl.querySelector(`#rows-${idx}-${sec.key}`);
    const items = existing.filter(Boolean);
    if (items.length > 0) {
      items.forEach(v => appendShRow(container, v));
    } else {
      appendShRow(container, '');
    }
  });

  // 메모
  const memoSec = document.createElement('div');
  memoSec.className = 'sh-input-section';
  memoSec.innerHTML = `
    <div class="sh-input-label" style="color:#64748b">
      <i class="fas fa-comment-dots"></i> 기타 전달사항
    </div>
    <textarea class="sh-memo-textarea" id="memo-${idx}" rows="3" placeholder="">${escH(rec?.memo || '')}</textarea>
  `;
  secGroup.appendChild(memoSec);
  wrap.appendChild(secGroup);

  // 저장 버튼
  const footer = document.createElement('div');
  footer.className = 'sh-card-footer';
  footer.innerHTML = `
    <button class="sh-btn sh-btn-member-save" onclick="saveMember('${name}', ${idx})">
      <i class="fas fa-floppy-disk"></i> ${name} 저장
    </button>
  `;
  wrap.appendChild(footer);
  return wrap;
}

// ── 행 추가 ──────────────────────────────────────
function addShRow(memberIdx, secKey) {
  const container = document.getElementById(`rows-${memberIdx}-${secKey}`);
  if (!container) return;
  appendShRow(container, '');
}

function appendShRow(container, value) {
  const row = document.createElement('div');
  row.className = 'sh-row';
  row.innerHTML = `
    <input type="text" value="${escH(value)}" placeholder="내용을 입력하세요"/>
    <button class="sh-row-del" onclick="this.closest('.sh-row').remove()" title="삭제">
      <i class="fas fa-xmark"></i>
    </button>
  `;
  container.appendChild(row);
  // 포커스
  const inp = row.querySelector('input');
  if (!value) setTimeout(() => inp.focus(), 50);
}

// ── 행 데이터 수집 ───────────────────────────────
function collectShRows(memberIdx, secKey) {
  const container = document.getElementById(`rows-${memberIdx}-${secKey}`);
  if (!container) return [];
  return Array.from(container.querySelectorAll('.sh-row input'))
    .map(i => i.value.trim())
    .filter(Boolean);
}

// ── 특정 팀원 저장 ───────────────────────────────
async function saveMember(name, idx) {
  const date = document.getElementById('shareDate').value;
  if (!date) { toast('날짜를 선택해주세요.', 'error'); return; }

  const done_today  = collectShRows(idx, 'done_today');
  const shared_work = collectShRows(idx, 'shared_work');
  const memo        = document.getElementById(`memo-${idx}`)?.value.trim() || '';
  const now         = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

  const recId = `${date}_${name}`;

  const payload = {
    id:           recId,
    share_date:   date,
    member_name:  name,
    done_today:   JSON.stringify(done_today),
    shared_work:  JSON.stringify(shared_work),
    memo:         memo,
    updated_time: now,
  };

  try {
    const existing = memberRecords[name];
    let res;

    if (existing?.id) {
      // 기존 레코드 업데이트
      res = await fetch(`tables/team_share/${existing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      // 신규 생성
      res = await fetch('tables/team_share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }

    if (!res.ok) throw new Error(await res.text());
    const saved = await res.json();

    // 로컬 캐시 업데이트
    memberRecords[name] = {
      id:          saved.id,
      done_today,
      shared_work,
      memo,
      updated_time: now,
    };

    // 상태 텍스트 갱신
    const hasFill = done_today.length || shared_work.length || memo;
    const dot = document.querySelector(`#card-${idx} .status-dot`);
    if (dot) dot.classList.toggle('filled', !!hasFill);
    const st = document.getElementById(`status-text-${idx}`);
    if (st) st.textContent = hasFill ? '작성 완료' : '미작성';
    const upd = document.getElementById(`updated-${idx}`);
    if (upd) upd.innerHTML = `<i class="fas fa-clock"></i> 마지막 저장: ${now}`;

    toast(`✅ ${name} 저장 완료!`, 'success');
  } catch (e) {
    console.error(e);
    toast(`❌ ${name} 저장 실패`, 'error');
  }
}

// ── 전체 저장 ────────────────────────────────────
async function saveAll() {
  for (let i = 0; i < MEMBERS.length; i++) {
    await saveMember(MEMBERS[i], i);
    await new Promise(r => setTimeout(r, 150));
  }
  toast('✅ 전체 저장 완료!', 'success');
}

// ── 카드 토글 ────────────────────────────────────
function toggleCard(idx) {
  const card = document.getElementById(`card-${idx}`);
  if (card) card.classList.toggle('open');
}

// ── 텔레그램 모달 ────────────────────────────────
function openTgModal() {
  document.getElementById('tgPreview').value = buildTgMessage();
  document.getElementById('tgModal').classList.add('active');
}
function closeTgModal() {
  document.getElementById('tgModal').classList.remove('active');
}
function closeTgModalOutside(e) {
  if (e.target === document.getElementById('tgModal')) closeTgModal();
}
function saveTgSettings() {
  localStorage.setItem('tg_bot_token', document.getElementById('tgToken').value.trim());
  localStorage.setItem('tg_chat_id',   document.getElementById('tgChatId').value.trim());
  toast('✅ 텔레그램 설정 저장!', 'success');
}

// ── 텔레그램 메시지 빌드 ─────────────────────────
function buildTgMessage() {
  const date  = document.getElementById('shareDate').value || '-';
  const days  = ['일','월','화','수','목','금','토'];
  const day   = days[new Date(date).getDay()];

  const lines = [
    `👥 물류팀 업무 공유`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `📅 ${date} (${day}요일)`,
    ``,
  ];

  MEMBERS.forEach((name, idx) => {
    const rec = memberRecords[name];
    const hasFill = rec && (
      rec.done_today.length  ||
      rec.shared_work.length ||
      rec.memo
    );

    lines.push(`━━━ 👤 ${name} ━━━`);

    if (!hasFill) {
      lines.push(`  - 미작성`);
    } else {
      if (rec.done_today.length) {
        lines.push(`✅ 체크 사항`);
        rec.done_today.forEach(v => lines.push(`  • ${v}`));
      }
      if (rec.shared_work.length) {
        lines.push(`📢 공유 사항`);
        rec.shared_work.forEach(v => lines.push(`  • ${v}`));
      }
      if (rec.memo) {
        lines.push(`💬 전달사항: ${rec.memo}`);
      }
    }
    lines.push(``);
  });

  lines.push(`━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`🕐 ${new Date().toLocaleTimeString('ko-KR')}`);

  return lines.join('\n');
}

// ── 실제 텔레그램 전송 ───────────────────────────
async function sendTelegram() {
  const token  = document.getElementById('tgToken').value.trim();
  const chatId = document.getElementById('tgChatId').value.trim();
  if (!token || !chatId) { toast('❌ Bot Token과 Chat ID를 입력해주세요.', 'error'); return; }

  const text = document.getElementById('tgPreview').value;
  try {
    const res  = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const json = await res.json();
    if (json.ok) {
      toast('✈️ 텔레그램 전송 성공!', 'success');
      closeTgModal();
    } else {
      toast(`❌ 전송 실패: ${json.description || '오류'}`, 'error');
    }
  } catch {
    toast('❌ 네트워크 오류', 'error');
  }
}

// ── 유틸 ─────────────────────────────────────────
function escH(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toast(msg, type = '') {
  const el = document.getElementById('shToast');
  el.textContent = msg;
  el.className = `sh-toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}
