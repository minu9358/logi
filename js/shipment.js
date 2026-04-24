/* ════════════════════════════════════════════════════
   물류팀 출고 집계 – shipment.js
   ════════════════════════════════════════════════════ */

// ── 상수 ────────────────────────────────────────────
const SHIP_KEY       = 'shipment_records_v1';
const CHANNEL_KEY    = 'shipment_channels_v1';
const SHIP_RESET_KEY = 'ship_last_reset_date';  // 20:00 자동 전환 기록용

const DEFAULT_CHANNELS = ['자사몰', '사방넷', '쿠팡', '네이버', '11번가', '기타'];

// ── 상태 ────────────────────────────────────────────
let records   = [];   // { id, date, channel, slot, count, memo }
let channels  = [];   // string[]
let chartInst = null;
let chartMode = 'all';
let sortCol   = 'date';
let sortAsc   = false;
let toastTimer = null;

// ── 초기화 ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadStorage();
  setToday();
  buildChannelSelects();
  setQfDate(todayStr());

  // Enter 키 빠른 저장
  document.getElementById('qfCount').addEventListener('keydown', e => {
    if (e.key === 'Enter') quickAdd();
  });
  document.getElementById('qfMemo').addEventListener('keydown', e => {
    if (e.key === 'Enter') quickAdd();
  });

  loadData();
  renderAggStatusBanner();
  scheduleShipReset20();
});

// ── localStorage ────────────────────────────────────
function loadStorage() {
  try { records  = JSON.parse(localStorage.getItem(SHIP_KEY))  || []; } catch { records  = []; }
  try { channels = JSON.parse(localStorage.getItem(CHANNEL_KEY)) || DEFAULT_CHANNELS.slice(); }
  catch { channels = DEFAULT_CHANNELS.slice(); }
  if (!channels.length) channels = DEFAULT_CHANNELS.slice();
}
function saveStorage() {
  localStorage.setItem(SHIP_KEY,    JSON.stringify(records));
  localStorage.setItem(CHANNEL_KEY, JSON.stringify(channels));
}

// ── 날짜 유틸 ───────────────────────────────────────
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function fmtDate(str) {
  if (!str) return '';
  const [y, m, d] = str.split('-');
  return `${y}.${m}.${d}`;
}
function daysBetween(from, to) {
  const a = new Date(from), b = new Date(to);
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

// ── 날짜 범위 버튼 ──────────────────────────────────
function setToday() {
  const t = todayStr();
  document.getElementById('dateFrom').value = t;
  document.getElementById('dateTo').value   = t;
}
function setThisWeek() {
  const now = new Date();
  const day = now.getDay(); // 0=일
  const mon = new Date(now); mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  document.getElementById('dateFrom').value = mon.toISOString().slice(0, 10);
  document.getElementById('dateTo').value   = sun.toISOString().slice(0, 10);
}
function setThisMonth() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const first = new Date(y, m, 1).toISOString().slice(0, 10);
  const last  = new Date(y, m + 1, 0).toISOString().slice(0, 10);
  document.getElementById('dateFrom').value = first;
  document.getElementById('dateTo').value   = last;
}

// ── 기간 필터링된 records ────────────────────────────
function getFilteredRecords() {
  const from = document.getElementById('dateFrom').value;
  const to   = document.getElementById('dateTo').value;
  if (!from || !to) return records.slice();
  return records.filter(r => r.date >= from && r.date <= to);
}

// ── 집계 조회 ────────────────────────────────────────
function loadData() {
  const filtered = getFilteredRecords();
  updateKPI(filtered);
  renderChannelSummary(filtered);
  renderChart(filtered);
  renderTable();
  buildFilterChannelSelect();
}

// ── KPI 업데이트 ────────────────────────────────────
function updateKPI(filtered) {
  const total   = filtered.reduce((s, r) => s + Number(r.count), 0);
  const today   = records.filter(r => r.date === todayStr()).reduce((s, r) => s + Number(r.count), 0);
  const from    = document.getElementById('dateFrom').value;
  const to      = document.getElementById('dateTo').value;
  const days    = (from && to) ? daysBetween(from, to) : 1;
  const avg     = filtered.length ? (total / days).toFixed(1) : '—';
  const chCnt   = new Set(filtered.map(r => r.channel)).size;

  document.getElementById('kpiTotal').textContent   = total.toLocaleString();
  document.getElementById('kpiToday').textContent   = today.toLocaleString();
  document.getElementById('kpiAvg').textContent     = avg;
  document.getElementById('kpiChannel').textContent = chCnt;
}

// ── 채널별 집계 바 ──────────────────────────────────
function renderChannelSummary(filtered) {
  const wrap = document.getElementById('channelSummary');
  if (!filtered.length) {
    wrap.innerHTML = `<div class="empty-state"><i class="fas fa-inbox"></i><span>조회 기간 내 데이터가 없습니다.</span></div>`;
    return;
  }

  // 채널별 합산
  const map = {};
  filtered.forEach(r => {
    const c = r.channel;
    if (!map[c]) map[c] = 0;
    map[c] += Number(r.count);
  });
  const total = Object.values(map).reduce((s, v) => s + v, 0) || 1;

  const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
  wrap.innerHTML = sorted.map(([ch, cnt]) => {
    const pct = ((cnt / total) * 100).toFixed(1);
    return `
      <div class="channel-bar">
        <span class="channel-name">${escHtml(ch)}</span>
        <div class="channel-bar-track">
          <div class="channel-bar-fill" style="width:${pct}%"></div>
        </div>
        <span class="channel-count">${cnt.toLocaleString()}</span>
        <span class="channel-pct">${pct}%</span>
      </div>`;
  }).join('');
}

// ── 차트 ────────────────────────────────────────────
function setChartMode(mode) {
  chartMode = mode;
  document.getElementById('chartToggleAll').classList.toggle('active',   mode === 'all');
  document.getElementById('chartToggleStack').classList.toggle('active', mode === 'stack');
  renderChart(getFilteredRecords());
}

function renderChart(filtered) {
  const ctx = document.getElementById('trendChart');
  if (!ctx) return;
  if (chartInst) { chartInst.destroy(); chartInst = null; }

  if (!filtered.length) return;

  // 날짜별 집계
  const dateMap = {};
  const chSet   = new Set();

  filtered.forEach(r => {
    const d = r.date, c = r.channel;
    if (!dateMap[d]) dateMap[d] = {};
    dateMap[d][c] = (dateMap[d][c] || 0) + Number(r.count);
    chSet.add(c);
  });

  const labels = Object.keys(dateMap).sort();
  const channelList = [...chSet];

  const COLORS = [
    'rgba(34,211,200,0.8)',  'rgba(56,189,248,0.8)',  'rgba(167,139,250,0.8)',
    'rgba(52,211,153,0.8)',  'rgba(251,191,36,0.8)',  'rgba(251,146,60,0.8)',
    'rgba(244,114,182,0.8)', 'rgba(248,113,113,0.8)', 'rgba(129,140,248,0.8)'
  ];

  let datasets;
  if (chartMode === 'all') {
    const totals = labels.map(d => Object.values(dateMap[d]).reduce((s, v) => s + v, 0));
    datasets = [{
      label: '출고 건수',
      data: totals,
      borderColor: 'rgba(34,211,200,0.9)',
      backgroundColor: 'rgba(34,211,200,0.12)',
      fill: true,
      tension: 0.35,
      pointBackgroundColor: 'rgba(34,211,200,1)',
      pointRadius: 4,
      pointHoverRadius: 6
    }];
  } else {
    datasets = channelList.map((ch, i) => ({
      label: ch,
      data: labels.map(d => dateMap[d][ch] || 0),
      backgroundColor: COLORS[i % COLORS.length],
      stack: 'stack'
    }));
  }

  chartInst = new Chart(ctx, {
    type: chartMode === 'stack' ? 'bar' : 'line',
    data: { labels: labels.map(fmtDate), datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: chartMode === 'stack',
          labels: { color: '#7d8fa3', font: { size: 11, family: "'Noto Sans KR', sans-serif" }, boxWidth: 12 }
        },
        tooltip: {
          backgroundColor: '#1d2535',
          titleColor: '#e2e8f0',
          bodyColor: '#7d8fa3',
          borderColor: '#2e3d52',
          borderWidth: 1,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString()}건`
          }
        }
      },
      scales: {
        x: {
          ticks:  { color: '#7d8fa3', font: { size: 11 } },
          grid:   { color: 'rgba(36,48,68,0.8)' }
        },
        y: {
          beginAtZero: true,
          stacked: chartMode === 'stack',
          ticks:  { color: '#7d8fa3', font: { size: 11 } },
          grid:   { color: 'rgba(36,48,68,0.8)' }
        }
      }
    }
  });
}

// ── 테이블 렌더링 ────────────────────────────────────
function renderTable() {
  const from    = document.getElementById('dateFrom').value;
  const to      = document.getElementById('dateTo').value;
  const search  = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const chFil   = document.getElementById('filterChannel')?.value || '';
  const slotFil = document.getElementById('filterSlot')?.value    || '';

  let rows = records.slice();

  // 기간 필터
  if (from && to) rows = rows.filter(r => r.date >= from && r.date <= to);
  // 검색
  if (search) rows = rows.filter(r =>
    r.channel.toLowerCase().includes(search) ||
    (r.memo || '').toLowerCase().includes(search)
  );
  // 채널 필터
  if (chFil) rows = rows.filter(r => r.channel === chFil);
  // 시간대 필터
  if (slotFil) rows = rows.filter(r => r.slot === slotFil);

  // 정렬
  rows.sort((a, b) => {
    let va = a[sortCol] ?? '', vb = b[sortCol] ?? '';
    if (sortCol === 'count') { va = Number(va); vb = Number(vb); }
    if (va < vb) return sortAsc ?  -1 : 1;
    if (va > vb) return sortAsc ?   1 : -1;
    return 0;
  });

  const tbody = document.getElementById('shipBody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-row"><i class="fas fa-inbox"></i> 데이터가 없습니다.</td></tr>`;
  } else {
    tbody.innerHTML = rows.map(r => {
      const isAgg = r.source === 'aggregator';
      const srcBadge = isAgg
        ? '<span class="src-badge src-agg" title="매핑관리 자동 집계"><i class="fas fa-layer-group"></i> 집계</span>'
        : '';
      return `<tr class="${isAgg ? 'row-from-agg' : ''}">
        <td>${fmtDate(r.date)}</td>
        <td>${escHtml(r.channel)} ${srcBadge}</td>
        <td><span class="slot-badge ${slotClass(r.slot)}">${escHtml(r.slot)}</span></td>
        <td class="count-cell">${Number(r.count).toLocaleString()}</td>
        <td class="memo-cell">${escHtml(r.memo || '—')}</td>
        <td class="no-print">
          <button class="tbl-btn tbl-btn-edit" onclick="openEditEntry('${r.id}')" title="수정"><i class="fas fa-pen"></i></button>
          <button class="tbl-btn tbl-btn-del"  onclick="deleteEntry('${r.id}')"   title="삭제"><i class="fas fa-trash"></i></button>
        </td>
      </tr>`;
    }).join('');
  }

  const foot = document.getElementById('tableFooter');
  const totalCnt = rows.reduce((s, r) => s + Number(r.count), 0);
  foot.innerHTML = `<span>총 <b>${rows.length}</b>건 표시 중</span><span>합계 <b>${totalCnt.toLocaleString()}</b>건</span>`;

  // 정렬 아이콘 업데이트
  document.querySelectorAll('.sh-table thead th.sortable').forEach(th => {
    const col = th.dataset.col;
    const ico = th.querySelector('i');
    if (col === sortCol) {
      ico.className = `fas fa-sort-${sortAsc ? 'up' : 'down'}`;
    } else {
      ico.className = 'fas fa-sort';
    }
  });
}

function slotClass(slot) {
  if (slot === '오전') return 'slot-am';
  if (slot === '오후') return 'slot-pm';
  return 'slot-all';
}

function sortBy(col) {
  if (sortCol === col) sortAsc = !sortAsc;
  else { sortCol = col; sortAsc = col !== 'date'; }
  renderTable();
}

// ── 채널 select 빌드 ────────────────────────────────
function buildChannelSelects() {
  buildOneChannelSelect(document.getElementById('qfChannel'));
  buildOneChannelSelect(document.getElementById('modalChannel'));
}
function buildOneChannelSelect(sel) {
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = channels.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('') +
    `<option value="__new__">+ 새 채널 추가</option>`;
  if (channels.includes(cur)) sel.value = cur;
}
function buildFilterChannelSelect() {
  const sel = document.getElementById('filterChannel');
  if (!sel) return;
  const cur = sel.value;
  const used = [...new Set(records.map(r => r.channel))].sort();
  sel.innerHTML = `<option value="">전체 채널</option>` +
    used.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
  if (used.includes(cur)) sel.value = cur;
}

// ── 빠른 입력 ────────────────────────────────────────
function setQfDate(d) { document.getElementById('qfDate').value = d; }

function handleQfChannelChange() {
  const val = document.getElementById('qfChannel').value;
  document.getElementById('qfNewChannelRow').style.display = val === '__new__' ? 'flex' : 'none';
  if (val === '__new__') document.getElementById('qfNewChannel').focus();
}
function handleNewChannelKey(e) {
  if (e.key === 'Enter') {
    const name = document.getElementById('qfNewChannel').value.trim();
    if (name && !channels.includes(name)) {
      channels.push(name);
      saveStorage();
      buildChannelSelects();
      document.getElementById('qfChannel').value = name;
      document.getElementById('qfNewChannelRow').style.display = 'none';
    }
  }
}

function quickAdd() {
  const date    = document.getElementById('qfDate').value;
  const chSel   = document.getElementById('qfChannel').value;
  const newCh   = document.getElementById('qfNewChannel').value.trim();
  const count   = Number(document.getElementById('qfCount').value);
  const slot    = document.getElementById('qfSlot').value;
  const memo    = document.getElementById('qfMemo').value.trim();

  let channel = chSel;
  if (chSel === '__new__') {
    if (!newCh) { showToast('새 채널명을 입력해주세요.'); return; }
    channel = newCh;
    if (!channels.includes(channel)) {
      channels.push(channel);
      saveStorage();
      buildChannelSelects();
    }
  }

  if (!date)    { showToast('날짜를 선택해주세요.'); return; }
  if (!channel) { showToast('채널을 선택해주세요.'); return; }
  if (isNaN(count) || count < 0) { showToast('건수를 올바르게 입력해주세요.'); return; }

  const rec = { id: genId(), date, channel, slot, count, memo };
  records.push(rec);
  saveStorage();

  // 초기화
  document.getElementById('qfCount').value = '';
  document.getElementById('qfMemo').value  = '';
  document.getElementById('qfNewChannelRow').style.display = 'none';
  document.getElementById('qfNewChannel').value = '';

  loadData();
  showToast(`✅ ${fmtDate(date)} / ${channel} / ${count.toLocaleString()}건 저장됨`);
}

// ── 삭제 ────────────────────────────────────────────
function deleteEntry(id) {
  if (!confirm('이 출고 데이터를 삭제하시겠습니까?')) return;
  records = records.filter(r => r.id !== id);
  saveStorage();
  loadData();
  showToast('🗑️ 삭제되었습니다.');
}

// ── 수정 모달 ────────────────────────────────────────
function openEntryModal() {
  // 새 데이터 추가 모달 (편의상 같은 모달 재활용)
  document.getElementById('entryModalTitle').innerHTML = '<i class="fas fa-plus-circle"></i> 출고 데이터 추가';
  document.getElementById('modalEntryId').value = '';
  document.getElementById('modalDate').value    = todayStr();
  document.getElementById('modalCount').value   = '';
  document.getElementById('modalMemo').value    = '';
  buildOneChannelSelect(document.getElementById('modalChannel'));
  document.getElementById('modalNewChannelRow').style.display = 'none';
  document.getElementById('editEntryModal').classList.add('show');
}
function openEditEntry(id) {
  const r = records.find(x => x.id === id);
  if (!r) return;
  document.getElementById('entryModalTitle').innerHTML = '<i class="fas fa-pen-to-square"></i> 출고 데이터 수정';
  document.getElementById('modalEntryId').value = r.id;
  document.getElementById('modalDate').value    = r.date;
  document.getElementById('modalSlot').value    = r.slot || '종일';
  document.getElementById('modalCount').value   = r.count;
  document.getElementById('modalMemo').value    = r.memo || '';
  buildOneChannelSelect(document.getElementById('modalChannel'));
  document.getElementById('modalChannel').value = r.channel;
  document.getElementById('modalNewChannelRow').style.display = 'none';
  document.getElementById('editEntryModal').classList.add('show');
}
function closeEntryModal() {
  document.getElementById('editEntryModal').classList.remove('show');
}
function handleModalChannelChange() {
  const val = document.getElementById('modalChannel').value;
  document.getElementById('modalNewChannelRow').style.display = val === '__new__' ? 'block' : 'none';
}
function saveEntry() {
  const id      = document.getElementById('modalEntryId').value;
  const date    = document.getElementById('modalDate').value;
  const chSel   = document.getElementById('modalChannel').value;
  const newCh   = document.getElementById('modalNewChannel')?.value.trim() || '';
  const slot    = document.getElementById('modalSlot').value;
  const count   = Number(document.getElementById('modalCount').value);
  const memo    = document.getElementById('modalMemo').value.trim();

  let channel = chSel;
  if (chSel === '__new__') {
    if (!newCh) { showToast('새 채널명을 입력해주세요.'); return; }
    channel = newCh;
    if (!channels.includes(channel)) { channels.push(channel); saveStorage(); buildChannelSelects(); }
  }

  if (!date)    { showToast('날짜를 선택해주세요.'); return; }
  if (!channel) { showToast('채널을 선택해주세요.'); return; }
  if (isNaN(count) || count < 0) { showToast('건수를 올바르게 입력해주세요.'); return; }

  if (id) {
    const idx = records.findIndex(r => r.id === id);
    if (idx !== -1) records[idx] = { id, date, channel, slot, count, memo };
  } else {
    records.push({ id: genId(), date, channel, slot, count, memo });
  }
  saveStorage();
  closeEntryModal();
  loadData();
  showToast(id ? '✅ 수정되었습니다.' : `✅ ${channel} ${count.toLocaleString()}건 추가됨`);
}

// 모달 배경 클릭 닫기
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('editEntryModal').addEventListener('click', e => {
    if (e.target === document.getElementById('editEntryModal')) closeEntryModal();
  });
  document.getElementById('channelModal').addEventListener('click', e => {
    if (e.target === document.getElementById('channelModal')) closeChannelModal();
  });
});

// ── 채널 관리 모달 ──────────────────────────────────
function openChannelModal() {
  renderChannelList();
  document.getElementById('channelModal').classList.add('show');
}
function closeChannelModal() {
  document.getElementById('channelModal').classList.remove('show');
  buildChannelSelects();
  buildFilterChannelSelect();
}
function renderChannelList() {
  const ul = document.getElementById('channelList');
  if (!channels.length) {
    ul.innerHTML = `<li style="color:var(--text-muted);font-size:13px;padding:8px 0;">채널이 없습니다.</li>`;
    return;
  }
  ul.innerHTML = channels.map((c, i) => `
    <li class="channel-item">
      <span>${escHtml(c)}</span>
      <button class="channel-del-btn" onclick="removeChannel(${i})" title="삭제"><i class="fas fa-trash"></i></button>
    </li>`).join('');
}
function addChannel() {
  const inp = document.getElementById('newChannelInput');
  const name = inp.value.trim();
  if (!name) { showToast('채널명을 입력해주세요.'); return; }
  if (channels.includes(name)) { showToast('이미 존재하는 채널입니다.'); return; }
  channels.push(name);
  saveStorage();
  inp.value = '';
  renderChannelList();
  showToast(`✅ '${name}' 채널이 추가되었습니다.`);
}
function removeChannel(idx) {
  const name = channels[idx];
  if (records.some(r => r.channel === name)) {
    if (!confirm(`'${name}' 채널의 출고 데이터가 있습니다.\n채널을 삭제해도 기록은 유지됩니다. 계속하시겠습니까?`)) return;
  }
  channels.splice(idx, 1);
  saveStorage();
  renderChannelList();
  showToast(`🗑️ '${name}' 채널이 삭제되었습니다.`);
}

// ── 매핑관리 연동 상태 배너 ───────────────────────────
function renderAggStatusBanner() {
  const banner = document.getElementById('aggStatusBanner');
  if (!banner) return;
  const today   = todayStr();
  const now     = new Date();
  const hour    = now.getHours();
  const aggRecs = records.filter(r => r.source === 'aggregator' && r.date === today);

  if (aggRecs.length === 0) {
    banner.innerHTML = `
      <i class="fas fa-circle-info" style="color:var(--text-muted)"></i>
      <span style="color:var(--text-sub)">매핑관리에서 집계 실행 시 이곳에 자동 누적됩니다.</span>
      <a href="aggregator.html" class="sh-btn sh-btn-aggregator" style="margin-left:auto;font-size:11.5px;padding:5px 12px">
        <i class="fas fa-layer-group"></i> 매핑관리 열기
      </a>`;
    banner.className = 'agg-status-banner banner-idle';
  } else {
    const total   = aggRecs.reduce((s, r) => s + Number(r.count), 0);
    const chNames = [...new Set(aggRecs.map(r => r.channel))].join(', ');
    const resetLabel = hour >= 20
      ? '<span class="banner-reset-badge done"><i class="fas fa-check-circle"></i> 20:00 완료</span>'
      : `<span class="banner-reset-badge pending"><i class="fas fa-clock"></i> 20:00 자동초기화 예정</span>`;
    banner.innerHTML = `
      <i class="fas fa-layer-group" style="color:var(--primary)"></i>
      <span>오늘 매핑집계 &nbsp;<b style="color:var(--primary)">${aggRecs.length}개 채널</b> &nbsp;·&nbsp; 총 <b style="color:var(--primary)">${total.toLocaleString()}</b>개 &nbsp;— ${chNames}</span>
      ${resetLabel}
      <a href="aggregator.html" class="sh-btn sh-btn-aggregator" style="margin-left:auto;font-size:11.5px;padding:5px 12px">
        <i class="fas fa-layer-group"></i> 매핑관리
      </a>`;
    banner.className = 'agg-status-banner banner-active';
  }
}

// ── 20:00 자동 전환 관리 ──────────────────────────────
function scheduleShipReset20() {
  checkShipReset20();
  setInterval(() => { checkShipReset20(); renderAggStatusBanner(); }, 60 * 1000);
}

function checkShipReset20() {
  const now       = new Date();
  const today     = now.toISOString().slice(0, 10);
  const hour      = now.getHours();
  const lastReset = localStorage.getItem(SHIP_RESET_KEY) || '';
  if (hour >= 20 && lastReset !== today) {
    localStorage.setItem(SHIP_RESET_KEY, today);
    renderAggStatusBanner();
    showToast(`🔄 [20:00 전환] 오늘 집계 데이터가 보존되었습니다. 내일 작업을 시작하세요.`);
    console.log(`[shipment] 20:00 스냅샷 완료 — ${today}`);
  }
}

// ── CSV 내보내기 ─────────────────────────────────────
function exportCSV() {
  const from = document.getElementById('dateFrom').value;
  const to   = document.getElementById('dateTo').value;
  let rows   = records.slice();
  if (from && to) rows = rows.filter(r => r.date >= from && r.date <= to);
  rows.sort((a, b) => a.date > b.date ? 1 : -1);

  const header = ['날짜', '채널', '시간대', '건수', '메모'];
  const lines  = [
    header.join(','),
    ...rows.map(r => [
      r.date,
      `"${(r.channel || '').replace(/"/g, '""')}"`,
      r.slot || '',
      r.count,
      `"${(r.memo || '').replace(/"/g, '""')}"`
    ].join(','))
  ];

  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `출고집계_${from || 'all'}_${to || 'all'}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('📥 CSV 다운로드가 시작되었습니다.');
}

// ── 유틸 ─────────────────────────────────────────────
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function showToast(msg) {
  const el = document.getElementById('shipToast');
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 2800);
}
