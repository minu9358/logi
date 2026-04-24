/* =============================================
   물류팀 업무 분장표 – 메인 스크립트
   ============================================= */

// ── 팀원 목록 (members.js의 getMembers()로 동적 로드)
let MEMBERS = typeof getMembers === 'function' ? getMembers() : ['김민우', '석미경', '고성진', '장휘인', '김도훈', '김구현'];

// ── 로컬스토리지 키
const STORAGE_KEY   = 'duty_assignments_v2';
const DUTY_ROWS_KEY = 'duty_rows_v2';

// ── 기본 데이터
const DEFAULT_ROWS = [
  { id:'r0',  cat1:'입고',      cat2:'정기 반복', task:'입고 예정 일정 확인 (매일)',        marks:{ 김민우:'primary',   석미경:'none',      고성진:'none',      장휘인:'none',      김도훈:'secondary', 김구현:'none' } },
  { id:'r1',  cat1:'입고',      cat2:'정기 반복', task:'입고 차량 접수 및 안내',            marks:{ 김민우:'primary',   석미경:'none',      고성진:'none',      장휘인:'none',      김도훈:'secondary', 김구현:'none' } },
  { id:'r2',  cat1:'입고',      cat2:'정기 반복', task:'입고 수량·품목 검수',              marks:{ 김민우:'primary',   석미경:'none',      고성진:'none',      장휘인:'primary',   김도훈:'secondary', 김구현:'none' } },
  { id:'r3',  cat1:'입고',      cat2:'정기 반복', task:'입고 데이터 시스템 등록',          marks:{ 김민우:'primary',   석미경:'none',      고성진:'none',      장휘인:'secondary', 김도훈:'none',      김구현:'none' } },
  { id:'r4',  cat1:'입고',      cat2:'정기 반복', task:'직영·판매점 A/S 관리',            marks:{ 김민우:'primary',   석미경:'secondary', 고성진:'secondary', 장휘인:'secondary', 김도훈:'primary',   김구현:'secondary'} },
  { id:'r5',  cat1:'입고',      cat2:'관리·운영', task:'협력업체(운송사) 관계 관리',       marks:{ 김민우:'primary',   석미경:'none',      고성진:'secondary', 장휘인:'none',      김도훈:'secondary', 김구현:'none' } },
  { id:'r6',  cat1:'입고',      cat2:'관리·운영', task:'입고 장비(지게차 등) 운영·점검',  marks:{ 김민우:'secondary', 석미경:'none',      고성진:'primary',   장휘인:'primary',   김도훈:'none',      김구현:'none' } },
  { id:'r7',  cat1:'입고',      cat2:'돌발·지원', task:'긴급 입고 대응',                  marks:{ 김민우:'primary',   석미경:'none',      고성진:'none',      장휘인:'secondary', 김도훈:'secondary', 김구현:'none' } },
  { id:'r8',  cat1:'입고',      cat2:'돌발·지원', task:'입고 수량 오류 클레임 처리',       marks:{ 김민우:'primary',   석미경:'none',      고성진:'none',      장휘인:'none',      김도훈:'none',      김구현:'none' } },
  { id:'r9',  cat1:'출고',      cat2:'정기 반복', task:'출고 지시서 확인 및 피킹',         marks:{ 김민우:'primary',   석미경:'primary',   고성진:'primary',   장휘인:'primary',   김도훈:'primary',   김구현:'primary'  } },
  { id:'r10', cat1:'출고',      cat2:'정기 반복', task:'출고 포장 및 라벨링',              marks:{ 김민우:'primary',   석미경:'primary',   고성진:'primary',   장휘인:'primary',   김도훈:'primary',   김구현:'primary'  } },
  { id:'r11', cat1:'출고',      cat2:'정기 반복', task:'출고 차량 배차 및 상차',           marks:{ 김민우:'primary',   석미경:'primary',   고성진:'primary',   장휘인:'primary',   김도훈:'primary',   김구현:'primary'  } },
  { id:'r12', cat1:'출고',      cat2:'정기 반복', task:'배송 완료 확인 및 피드백',         marks:{ 김민우:'primary',   석미경:'none',      고성진:'none',      장휘인:'none',      김도훈:'none',      김구현:'none' } },
  { id:'r13', cat1:'출고',      cat2:'프로젝트성',task:'신규 배송처 출고 프로세스 셋업',   marks:{ 김민우:'primary',   석미경:'none',      고성진:'none',      장휘인:'none',      김도훈:'secondary', 김구현:'none' } },
  { id:'r14', cat1:'출고',      cat2:'돌발·지원', task:'긴급 출고 요청 대응',             marks:{ 김민우:'primary',   석미경:'none',      고성진:'primary',   장휘인:'none',      김도훈:'none',      김구현:'none' } },
  { id:'r15', cat1:'출고',      cat2:'돌발·지원', task:'출고 오류(오피킹·오배송) 처리',   marks:{ 김민우:'primary',   석미경:'none',      고성진:'none',      장휘인:'none',      김도훈:'none',      김구현:'none' } },
  { id:'r16', cat1:'재고관리',  cat2:'정기 반복', task:'일일 재고 현황 확인·보고',         marks:{ 김민우:'primary',   석미경:'primary',   고성진:'primary',   장휘인:'primary',   김도훈:'primary',   김구현:'primary'  } },
  { id:'r17', cat1:'재고관리',  cat2:'정기 반복', task:'주간 재고 실사',                  marks:{ 김민우:'primary',   석미경:'primary',   고성진:'primary',   장휘인:'primary',   김도훈:'primary',   김구현:'primary'  } },
  { id:'r18', cat1:'재고관리',  cat2:'정기 반복', task:'월간 전체 재고 실사',             marks:{ 김민우:'primary',   석미경:'primary',   고성진:'primary',   장휘인:'primary',   김도훈:'primary',   김구현:'primary'  } },
  { id:'r19', cat1:'재고관리',  cat2:'정기 반복', task:'유통기한·로케이션 관리',          marks:{ 김민우:'secondary', 석미경:'secondary', 고성진:'primary',   장휘인:'primary',   김도훈:'secondary', 김구현:'secondary'} },
  { id:'r20', cat1:'재고관리',  cat2:'관리·운영', task:'창고 레이아웃·로케이션 운영',     marks:{ 김민우:'primary',   석미경:'none',      고성진:'none',      장휘인:'primary',   김도훈:'none',      김구현:'none' } },
  { id:'r21', cat1:'재고관리',  cat2:'관리·운영', task:'재고 관리',                       marks:{ 김민우:'primary',   석미경:'none',      고성진:'none',      장휘인:'primary',   김도훈:'none',      김구현:'none' } },
  { id:'r22', cat1:'재고관리',  cat2:'돌발·지원', task:'재고 불일치 원인 조사 및 조정',    marks:{ 김민우:'primary',   석미경:'secondary', 고성진:'secondary', 장휘인:'secondary', 김도훈:'secondary', 김구현:'secondary'} },
  { id:'r23', cat1:'사무처리',  cat2:'정기 반복', task:'보고서 작성',                     marks:{ 김민우:'primary',   석미경:'none',      고성진:'none',      장휘인:'none',      김도훈:'none',      김구현:'none' } },
  { id:'r24', cat1:'사무처리',  cat2:'정기 반복', task:'주간·월간 실적 자료 정리',         marks:{ 김민우:'primary',   석미경:'none',      고성진:'none',      장휘인:'none',      김도훈:'none',      김구현:'none' } },
  { id:'r25', cat1:'사무처리',  cat2:'정기 반복', task:'세금계산서·거래명세서 처리',       marks:{ 김민우:'primary',   석미경:'none',      고성진:'none',      장휘인:'none',      김도훈:'none',      김구현:'none' } },
  { id:'r26', cat1:'사무처리',  cat2:'정기 반복', task:'비용 정산 및 지출 관리',          marks:{ 김민우:'primary',   석미경:'none',      고성진:'none',      장휘인:'none',      김도훈:'none',      김구현:'none' } },
  { id:'r27', cat1:'사무처리',  cat2:'관리·운영', task:'문서·서류 보관·관리',             marks:{ 김민우:'primary',   석미경:'none',      고성진:'none',      장휘인:'none',      김도훈:'none',      김구현:'none' } },
  { id:'r28', cat1:'사무처리',  cat2:'관리·운영', task:'물류 관련 계약서 관리',           marks:{ 김민우:'primary',   석미경:'none',      고성진:'none',      장휘인:'none',      김도훈:'none',      김구현:'none' } },
  { id:'r29', cat1:'사무처리',  cat2:'프로젝트성',task:'업무 프로세스 개선 문서화',        marks:{ 김민우:'primary',   석미경:'none',      고성진:'none',      장휘인:'none',      김도훈:'none',      김구현:'none' } },
  { id:'r30', cat1:'사무처리',  cat2:'돌발·지원', task:'감사·점검 대응 자료 준비',        marks:{ 김민우:'primary',   석미경:'none',      고성진:'none',      장휘인:'none',      김도훈:'none',      김구현:'none' } },
  { id:'r31', cat1:'본사소통',  cat2:'정기 반복', task:'본사 지시사항 공유 및 전달',      marks:{ 김민우:'primary',   석미경:'none',      고성진:'none',      장휘인:'none',      김도훈:'none',      김구현:'none' } },
  { id:'r32', cat1:'본사소통',  cat2:'정기 반복', task:'실적 보고',                       marks:{ 김민우:'primary',   석미경:'none',      고성진:'none',      장휘인:'none',      김도훈:'none',      김구현:'none' } },
  { id:'r33', cat1:'본사소통',  cat2:'관리·운영', task:'타부서 협업 요청 조율',           marks:{ 김민우:'primary',   석미경:'none',      고성진:'none',      장휘인:'none',      김도훈:'none',      김구현:'none' } },
  { id:'r34', cat1:'본사소통',  cat2:'프로젝트성',task:'본사 프로젝트 참여 및 지원',       marks:{ 김민우:'primary',   석미경:'none',      고성진:'none',      장휘인:'none',      김도훈:'none',      김구현:'none' } },
  { id:'r35', cat1:'본사소통',  cat2:'돌발·지원', task:'본사 긴급 요청 대응',             marks:{ 김민우:'primary',   석미경:'none',      고성진:'none',      장휘인:'none',      김도훈:'none',      김구현:'none' } },
  { id:'r36', cat1:'소모품관련',cat2:'정기 반복', task:'박스 재고 확인 및 발주',           marks:{ 김민우:'none',      석미경:'none',      고성진:'none',      장휘인:'secondary', 김도훈:'none',      김구현:'primary'  } },
  { id:'r37', cat1:'소모품관련',cat2:'정기 반복', task:'쇼핑백/무지봉투 재고확인 및 발주', marks:{ 김민우:'primary',   석미경:'primary',   고성진:'none',      장휘인:'none',      김도훈:'secondary', 김구현:'none' } },
  { id:'r38', cat1:'소모품관련',cat2:'정기 반복', task:'직영점 소모품 재고확인 및 발주',   marks:{ 김민우:'none',      석미경:'primary',   고성진:'none',      장휘인:'none',      김도훈:'primary',   김구현:'none' } },
];

// ── 행 데이터 로드
let dutyRows = loadRows();

function loadRows() {
  try {
    const s = localStorage.getItem(DUTY_ROWS_KEY);
    if (s) return JSON.parse(s);
  } catch(e) {}
  return JSON.parse(JSON.stringify(DEFAULT_ROWS));
}

function saveRows() {
  try { localStorage.setItem(DUTY_ROWS_KEY, JSON.stringify(dutyRows)); } catch(e) {}
}

// ── 유틸
function genId() { return 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2,6); }
function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── 상태
function cycleState(s) {
  if (s === 'none')      return 'primary';
  if (s === 'primary')   return 'secondary';
  if (s === 'secondary') return 'none';
  return 'primary';
}
function stateToMark(s) {
  if (s === 'primary')   return '●';
  if (s === 'secondary') return '○';
  return '−';
}
function stateToTip(s) {
  if (s === 'primary')   return '주담당 → 부담당';
  if (s === 'secondary') return '부담당 → 없음';
  return '클릭: 주담당 설정';
}

// ── 대분류 목록
function getCat1List() {
  const seen = new Set();
  dutyRows.forEach(r => { if(r.cat1) seen.add(r.cat1); });
  return [...seen];
}

// ── 중분류 정렬 순서 (정기반복→관리운영→돌발지원→프로젝트성→기타)
const CAT2_ORDER = ['정기 반복', '관리·운영', '돌발·지원', '프로젝트성'];
// 각 순서 슬롯의 식별 키워드
const CAT2_KEYWORDS = ['정기', '관리', '돌발', '프로젝트'];
function getCat2Order(cat2) {
  if (!cat2) return CAT2_ORDER.length;
  const idx = CAT2_KEYWORDS.findIndex(kw => cat2.includes(kw));
  return idx === -1 ? CAT2_ORDER.length : idx;
}

// ── 중분류 뱃지 클래스
function getCat2Class(cat2) {
  if (!cat2) return 'cat2-etc';
  if (cat2.includes('정기'))    return 'cat2-regular';
  if (cat2.includes('관리') || cat2.includes('운영')) return 'cat2-manage';
  if (cat2.includes('프로젝트')) return 'cat2-project';
  if (cat2.includes('돌발') || cat2.includes('지원')) return 'cat2-urgent';
  return 'cat2-etc';
}

// ── 아이콘
function getCat1Icon(cat1) {
  const icons = { '입고':'fa-truck-ramp-box','출고':'fa-box-open','재고관리':'fa-boxes-stacked',
                  '사무처리':'fa-file-lines','본사소통':'fa-building','소모품관련':'fa-box' };
  return `<i class="fas ${icons[cat1]||'fa-circle-dot'}"></i>`;
}

// ── 색상 클래스
const CAT1_COLORS = ['cat-입고','cat-출고','cat-재고관리','cat-사무처리','cat-본사소통','cat-소모품관련'];
const EXTRA_COLORS = ['cat-extra1','cat-extra2','cat-extra3','cat-extra4'];
let cat1ColorMap = {};
function getCat1Class(cat1) {
  if (!cat1ColorMap[cat1]) {
    getCat1List().forEach((c, i) => {
      if (!cat1ColorMap[c])
        cat1ColorMap[c] = CAT1_COLORS[i] || EXTRA_COLORS[i % EXTRA_COLORS.length] || 'cat-extra1';
    });
  }
  return cat1ColorMap[cat1] || 'cat-extra1';
}

// ── 통계
function updateStats() {
  const wrap = document.getElementById('dutyStats');
  if (!wrap) return;
  const counts = {};
  MEMBERS.forEach(m => { counts[m] = { primary:0, secondary:0 }; });
  dutyRows.forEach(row => {
    MEMBERS.forEach(m => {
      const s = row.marks?.[m] || 'none';
      if (s === 'primary')   counts[m].primary++;
      if (s === 'secondary') counts[m].secondary++;
    });
  });
  wrap.innerHTML = MEMBERS.map(m => `
    <div class="stat-card">
      <div class="stat-name">${m}</div>
      <div class="stat-counts">
        <span class="stat-primary">●${counts[m].primary}</span>
        <span class="stat-label">/</span>
        <span class="stat-secondary">○${counts[m].secondary}</span>
      </div>
    </div>
  `).join('');
}

// ════════════════════════════════════════
//  드래그앤드롭 상태
// ════════════════════════════════════════
let dragSrcId   = null;   // 드래그 중인 행의 rowId
let dragSrcCat1 = null;   // 드래그 중인 행의 대분류
let dropIndicator = null; // 삽입 위치 표시 줄

function getDragIndicator() {
  if (!dropIndicator) {
    dropIndicator = document.createElement('tr');
    dropIndicator.className = 'drag-drop-indicator';
    dropIndicator.innerHTML = `<td colspan="10"><div class="drag-indicator-line"></div></td>`;
  }
  return dropIndicator;
}

// ── 테이블 렌더링
function renderTable() {
  cat1ColorMap = {};

  const tbody = document.getElementById('dutyBody');
  tbody.innerHTML = '';

  const spanMap = {};
  dutyRows.forEach(r => { spanMap[r.cat1] = (spanMap[r.cat1]||0)+1; });
  const rendered = {};

  dutyRows.forEach((row) => {
    const colorCls = getCat1Class(row.cat1);
    const tr = document.createElement('tr');
    tr.className = colorCls;
    tr.dataset.rowId  = row.id;
    tr.dataset.rowCat = row.cat1;
    tr.draggable = true;

    // ── 드래그 핸들 셀
    const tdHandle = document.createElement('td');
    tdHandle.className = 'drag-handle-cell no-print';
    tdHandle.innerHTML = '<span class="drag-handle" title="드래그하여 순서 변경"><i class="fas fa-grip-vertical"></i></span>';
    tr.appendChild(tdHandle);

    // ── 대분류 셀
    if (!rendered[row.cat1]) {
      rendered[row.cat1] = true;
      const td = document.createElement('td');
      td.className = 'cat1-cell';
      td.rowSpan = spanMap[row.cat1];
      td.innerHTML = getCat1Icon(row.cat1) + '<br>' + row.cat1;
      tr.appendChild(td);
    }

    // ── 중분류 셀
    const tdCat2 = document.createElement('td');
    tdCat2.className = 'cat2-cell';
    tdCat2.innerHTML = `<span class="cat2-badge ${getCat2Class(row.cat2)}">${escHtml(row.cat2)}</span>`;
    tr.appendChild(tdCat2);

    // ── 업무 내용 셀
    const tdTask = document.createElement('td');
    tdTask.className = 'task-cell';
    tdTask.innerHTML = `
      <span class="task-text">${escHtml(row.task)}</span>
      <span class="task-actions no-print">
        <button class="task-action-btn edit-btn" data-id="${row.id}" title="수정"><i class="fas fa-pen"></i></button>
        <button class="task-action-btn del-btn"  data-id="${row.id}" title="삭제"><i class="fas fa-trash"></i></button>
      </span>
    `;
    tdTask.querySelector('.edit-btn').addEventListener('click', () => openEditModal(row.id));
    tdTask.querySelector('.del-btn').addEventListener('click',  () => deleteRow(row.id));
    tr.appendChild(tdTask);

    // ── 담당자 셀
    MEMBERS.forEach(member => {
      const state = row.marks?.[member] || 'none';
      const td = document.createElement('td');
      td.className = 'mark-cell';
      const btn = document.createElement('button');
      btn.className = 'mark-btn';
      btn.dataset.state = state;
      btn.dataset.tip   = stateToTip(state);
      btn.textContent   = stateToMark(state);
      btn.setAttribute('aria-label', `${member} ${stateToTip(state)}`);
      btn.addEventListener('click', () => {
        const ns = cycleState(btn.dataset.state);
        row.marks[member] = ns;
        btn.dataset.state = ns;
        btn.dataset.tip   = stateToTip(ns);
        btn.textContent   = stateToMark(ns);
        saveRows();
        updateStats();
        showToast(`${member}: ${ns==='primary'?'주담당●':ns==='secondary'?'부담당○':'담당없음'} 변경`);
      });
      td.appendChild(btn);
      tr.appendChild(td);
    });

    // ── 드래그 이벤트
    tr.addEventListener('dragstart', onDragStart);
    tr.addEventListener('dragend',   onDragEnd);
    tr.addEventListener('dragover',  onDragOver);
    tr.addEventListener('dragleave', onDragLeave);
    tr.addEventListener('drop',      onDrop);

    tbody.appendChild(tr);
  });

  // 대분류 마지막 행 구분선
  const groups = {};
  dutyRows.forEach((r,i) => { groups[r.cat1] = i; });
  const allRows = tbody.querySelectorAll('tr');
  Object.values(groups).forEach(lastIdx => {
    if (allRows[lastIdx]) allRows[lastIdx].classList.add('cat1-last-row');
  });
}

// ════════════════════════════════════════
//  드래그앤드롭 핸들러
// ════════════════════════════════════════
function onDragStart(e) {
  dragSrcId   = this.dataset.rowId;
  dragSrcCat1 = this.dataset.rowCat;
  this.classList.add('drag-dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragSrcId);
}

function onDragEnd() {
  dragSrcId = null;
  dragSrcCat1 = null;
  document.querySelectorAll('tr.drag-dragging').forEach(r => r.classList.remove('drag-dragging'));
  document.querySelectorAll('tr.drag-over-top').forEach(r => r.classList.remove('drag-over-top'));
  document.querySelectorAll('tr.drag-over-bottom').forEach(r => r.classList.remove('drag-over-bottom'));
  const ind = document.querySelector('.drag-drop-indicator');
  if (ind) ind.remove();
}

function onDragOver(e) {
  if (!dragSrcId) return;
  // 다른 대분류로는 이동 불가
  if (this.dataset.rowCat !== dragSrcCat1) {
    e.dataTransfer.dropEffect = 'none';
    return;
  }
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  // 마우스가 행 상단 절반이면 위에, 하단 절반이면 아래에 인디케이터 표시
  const rect = this.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;
  const ind  = getDragIndicator();

  document.querySelectorAll('tr.drag-over-top').forEach(r => r.classList.remove('drag-over-top'));
  document.querySelectorAll('tr.drag-over-bottom').forEach(r => r.classList.remove('drag-over-bottom'));

  if (e.clientY < midY) {
    this.classList.add('drag-over-top');
    this.parentNode.insertBefore(ind, this);
  } else {
    this.classList.add('drag-over-bottom');
    this.parentNode.insertBefore(ind, this.nextSibling);
  }
}

function onDragLeave() {
  this.classList.remove('drag-over-top');
  this.classList.remove('drag-over-bottom');
}

function onDrop(e) {
  e.preventDefault();
  if (!dragSrcId || this.dataset.rowId === dragSrcId) { onDragEnd(); return; }
  // 대분류가 다르면 무시
  if (this.dataset.rowCat !== dragSrcCat1) { onDragEnd(); return; }

  const rect = this.getBoundingClientRect();
  const insertBefore = e.clientY < rect.top + rect.height / 2;

  // dutyRows 배열에서 순서 변경
  const srcIdx  = dutyRows.findIndex(r => r.id === dragSrcId);
  const destIdx = dutyRows.findIndex(r => r.id === this.dataset.rowId);
  if (srcIdx === -1 || destIdx === -1) { onDragEnd(); return; }

  const [moved] = dutyRows.splice(srcIdx, 1);
  const newDest = dutyRows.findIndex(r => r.id === this.dataset.rowId);
  dutyRows.splice(insertBefore ? newDest : newDest + 1, 0, moved);

  saveRows();
  onDragEnd();
  renderTable();
  updateStats();
  showToast('↕ 순서가 변경되었습니다.');
}

// ── 행 삭제
function deleteRow(id) {
  const row = dutyRows.find(r => r.id === id);
  if (!row) return;
  if (!confirm(`"${row.task}" 항목을 삭제하겠습니까?`)) return;
  dutyRows = dutyRows.filter(r => r.id !== id);
  saveRows();
  renderTable();
  updateStats();
  showToast('🗑️ 항목이 삭제되었습니다.');
}

// ════════════════════════════════════════
//  모달 관련 – 상태를 JS 객체로 관리
// ════════════════════════════════════════

// 모달 내 담당 상태 (HTML 속성에 의존하지 않음)
let modalMemberState = {};
MEMBERS.forEach(m => { modalMemberState[m] = 'none'; });

// 모달 담당 버튼 UI 동기화
function syncModalMemberBtns() {
  MEMBERS.forEach(m => {
    const btn = document.querySelector(`.modal-mark-btn[data-member="${m}"]`);
    if (!btn) return;
    const s = modalMemberState[m] || 'none';
    btn.textContent   = stateToMark(s);
    btn.dataset.state = s;
    btn.className     = `modal-mark-btn state-${s}`;
    btn.dataset.member = m;
  });
}

/** 모달 담당자 목록 영역을 현재 MEMBERS 기준으로 다시 빌드 */
function rebuildModalMembers() {
  const wrap = document.querySelector('.modal-members');
  if (!wrap) return;
  wrap.innerHTML = MEMBERS.map(m => `
    <div class="modal-member-item">
      <span class="modal-member-name">${m}</span>
      <button class="modal-mark-btn state-none" data-member="${m}" data-state="none">−</button>
    </div>
  `).join('');
  // 클릭 이벤트 재바인딩
  wrap.querySelectorAll('.modal-mark-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const member = btn.dataset.member;
      if (!member) return;
      const next = cycleState(modalMemberState[member] || 'none');
      modalMemberState[member] = next;
      syncModalMemberBtns();
    });
  });
}

// 대분류 옵션
function buildCat1Options(sel, selected) {
  const list = getCat1List();
  sel.innerHTML = list.map(c =>
    `<option value="${escHtml(c)}"${c===selected?' selected':''}>${escHtml(c)}</option>`
  ).join('');
  sel.innerHTML += `<option value="__new__">+ 새 대분류 추가</option>`;
  if (selected === '__new__') sel.value = '__new__';
}

// 중분류 옵션
function buildCat2Options(sel, cat1, selected) {
  const existing = [...new Set(dutyRows.filter(r=>r.cat1===cat1).map(r=>r.cat2))];
  // 기본 4개 없으면 추가
  ['정기 반복','관리·운영','돌발·지원','프로젝트성'].forEach(c => {
    if (!existing.includes(c)) existing.push(c);
  });
  // 정기반복→관리운영→돌발지원→프로젝트성→기타 순으로 정렬
  existing.sort((a, b) => getCat2Order(a) - getCat2Order(b));
  sel.innerHTML = existing.map(c =>
    `<option value="${escHtml(c)}"${c===selected?' selected':''}>${escHtml(c)}</option>`
  ).join('');
  sel.innerHTML += `<option value="__new__">+ 새 중분류 추가</option>`;
  if (selected === '__new__') sel.value = '__new__';
}

function toggleCat1New() {
  const val = document.getElementById('modalCat1').value;
  document.getElementById('cat1NewWrap').style.display = val === '__new__' ? 'block' : 'none';
  if (val !== '__new__') {
    buildCat2Options(document.getElementById('modalCat2'), val, '');
    toggleCat2New();
  }
}
function toggleCat2New() {
  const val = document.getElementById('modalCat2').value;
  document.getElementById('cat2NewWrap').style.display = val === '__new__' ? 'block' : 'none';
}

// 모달 열기 – 신규
function openAddModal(prefillCat1 = '') {
  const modal = document.getElementById('editModal');

  document.getElementById('modalTitle').innerHTML = '<i class="fas fa-plus"></i> 새 업무 추가';
  document.getElementById('modalRowId').value = '';
  document.getElementById('modalTask').value = '';
  document.getElementById('modalCat1New').value = '';
  document.getElementById('modalCat2New').value = '';

  const firstCat1 = prefillCat1 || getCat1List()[0] || '';
  buildCat1Options(document.getElementById('modalCat1'), firstCat1);
  buildCat2Options(document.getElementById('modalCat2'), firstCat1, '');

  // 담당 상태 초기화
  MEMBERS.forEach(m => { modalMemberState[m] = 'none'; });
  syncModalMemberBtns();

  toggleCat1New();
  toggleCat2New();

  modal.classList.add('show');
  document.body.style.overflow = 'hidden';
}

// 모달 열기 – 수정
function openEditModal(id) {
  const row = dutyRows.find(r => r.id === id);
  if (!row) return;
  const modal = document.getElementById('editModal');

  document.getElementById('modalTitle').innerHTML = '<i class="fas fa-pen"></i> 업무 수정';
  document.getElementById('modalRowId').value = id;
  document.getElementById('modalTask').value = row.task;
  document.getElementById('modalCat1New').value = '';
  document.getElementById('modalCat2New').value = '';

  buildCat1Options(document.getElementById('modalCat1'), row.cat1);
  buildCat2Options(document.getElementById('modalCat2'), row.cat1, row.cat2);

  // 담당 상태 복원
  MEMBERS.forEach(m => { modalMemberState[m] = row.marks?.[m] || 'none'; });
  syncModalMemberBtns();

  toggleCat1New();
  toggleCat2New();

  modal.classList.add('show');
  document.body.style.overflow = 'hidden';
}

// 모달 닫기
function closeModal() {
  document.getElementById('editModal').classList.remove('show');
  document.body.style.overflow = '';
}

// 모달 저장
function saveModal() {
  let cat1Val = document.getElementById('modalCat1').value;
  if (cat1Val === '__new__') {
    cat1Val = document.getElementById('modalCat1New').value.trim();
    if (!cat1Val) { alert('새 대분류 이름을 입력해주세요.'); return; }
  }
  let cat2Val = document.getElementById('modalCat2').value;
  if (cat2Val === '__new__') {
    cat2Val = document.getElementById('modalCat2New').value.trim();
    if (!cat2Val) { alert('새 중분류 이름을 입력해주세요.'); return; }
  }
  const taskVal = document.getElementById('modalTask').value.trim();
  if (!taskVal) { alert('업무 내용을 입력해주세요.'); return; }
  if (!cat1Val) { alert('대분류를 선택해주세요.'); return; }
  if (!cat2Val) { alert('중분류를 선택해주세요.'); return; }

  // JS 객체에서 marks 수집
  const marks = {};
  MEMBERS.forEach(m => { marks[m] = modalMemberState[m] || 'none'; });

  const rowId = document.getElementById('modalRowId').value;
  if (rowId) {
    // 수정 – cat1/cat2 변경 시 순서 재배치
    dutyRows = dutyRows.filter(r => r.id !== rowId); // 기존 행 제거 후 재삽입
    const updatedRow = { id: rowId, cat1: cat1Val, cat2: cat2Val, task: taskVal, marks };
    const newOrder = getCat2Order(cat2Val);
    let insertIdx = -1;
    for (let i = 0; i < dutyRows.length; i++) {
      const r = dutyRows[i];
      if (r.cat1 !== cat1Val) continue;
      if (getCat2Order(r.cat2) > newOrder) { insertIdx = i; break; }
      insertIdx = i + 1;
    }
    if (insertIdx === -1) insertIdx = dutyRows.length;
    dutyRows.splice(insertIdx, 0, updatedRow);
    showToast('✅ 수정되었습니다.');
  } else {
    // 추가 – 중분류 순서(정기반복→관리운영→돌발지원→프로젝트성→기타) 위치에 삽입
    const newRow = { id: genId(), cat1: cat1Val, cat2: cat2Val, task: taskVal, marks };
    const newOrder = getCat2Order(cat2Val);

    // 같은 cat1 행들 중 새 행이 들어갈 위치 탐색
    // ① 같은 cat1 & 같은/이전 cat2 그룹의 마지막 행 뒤에 삽입
    // ② 같은 cat1 행이 아예 없으면 배열 끝에 추가
    let insertIdx = -1;
    for (let i = 0; i < dutyRows.length; i++) {
      const r = dutyRows[i];
      if (r.cat1 !== cat1Val) continue;
      const rOrder = getCat2Order(r.cat2);
      // 현재 행의 cat2 순서가 새 행보다 크거나 같으면 여기 직전에 삽입
      if (rOrder > newOrder) {
        insertIdx = i;
        break;
      }
      // 새 행보다 작거나 같으면 계속 뒤로
      insertIdx = i + 1;
    }
    if (insertIdx === -1) insertIdx = dutyRows.length; // 같은 cat1 없음 → 맨 끝
    dutyRows.splice(insertIdx, 0, newRow);
    showToast('✅ 추가되었습니다.');
  }

  saveRows();
  closeModal();
  renderTable();
  updateStats();
}

// ── 초기화
function resetAll() {
  if (!confirm('모든 업무 항목과 담당 설정을 원본으로 초기화하겠습니까?\n(추가/수정한 항목 포함 전부 삭제됩니다)')) return;
  dutyRows = JSON.parse(JSON.stringify(DEFAULT_ROWS));
  cat1ColorMap = {};
  saveRows();
  renderTable();
  updateStats();
  showToast('✅ 원본으로 초기화되었습니다.');
}

// ── 토스트
let _toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('dutyToast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

// ── 통계 카드 영역 주입
function injectStatsBar() {
  const main = document.querySelector('.duty-main');
  if (!main || document.getElementById('dutyStats')) return;
  const d = document.createElement('div');
  d.className = 'duty-stats no-print';
  d.id = 'dutyStats';
  main.insertBefore(d, main.firstChild);
}

// ════════════════════════════════════════
//  DOMContentLoaded – 이벤트 바인딩
// ════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {

  // 모달 배경 클릭 시 닫기
  document.getElementById('editModal').addEventListener('click', e => {
    if (e.target.id === 'editModal') closeModal();
  });

  // 팀원 변경 이벤트 수신 (index.html에서 팀원 추가/수정 시)
  window.addEventListener('membersChanged', (e) => {
    MEMBERS = e.detail;
    modalMemberState = {};
    MEMBERS.forEach(m => { modalMemberState[m] = 'none'; });
    rebuildModalMembers();
    renderTable();
    updateStats();
  });

  injectStatsBar();
  rebuildModalMembers();
  renderTable();
  updateStats();
});
