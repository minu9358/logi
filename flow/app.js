// =====================================================================
// app.js – 메인 앱 로직
// =====================================================================
(function () {
  'use strict';

  const STORAGE_KEY = 'logistics_flow_data_v4';
  const COLOR_PRESETS = ['#4ade80','#86efac','#22d3ee','#67e8f9','#c084fc','#a78bfa','#facc15','#fde047','#fb923c','#fdba74','#f87171','#fca5a5','#eab308','#94a3b8','#60a5fa','#f9a8d4'];

  const editor = new FlowEditor('flowCanvas');

  // ── 히스토리 ──────────────────────────────────────
  const history = []; let histIdx = -1; const MAX_HIST = 50;
  function snapshot() { const s = JSON.stringify(editor.getData()); if (history[histIdx] === s) return; history.splice(histIdx + 1); history.push(s); if (history.length > MAX_HIST) history.shift(); histIdx = history.length - 1; updateHistoryBtns(); }
  function undo() { if (histIdx <= 0) return; histIdx--; restoreSnapshot(history[histIdx]); toast('되돌렸습니다.', 'info'); }
  function redo() { if (histIdx >= history.length - 1) return; histIdx++; restoreSnapshot(history[histIdx]); toast('다시 실행했습니다.', 'info'); }
  function restoreSnapshot(json) { const d = JSON.parse(json); editor.nodes = d.nodes; editor.edges = d.edges; editor.selectedNode = null; editor.selectedEdge = null; showGuidePanel(); editor.render(); updateHistoryBtns(); }
  function updateHistoryBtns() { btnUndo.disabled = histIdx <= 0; btnRedo.disabled = histIdx >= history.length - 1; }

  // ── DOM 참조 ──────────────────────────────────────
  const btnFit = document.getElementById('btnFit');
  const btnZoomIn = document.getElementById('btnZoomIn');
  const btnZoomOut = document.getElementById('btnZoomOut');
  const btnAddNode = document.getElementById('btnAddNode');
  const btnConnect = document.getElementById('btnConnect');
  const btnDeleteSelected = document.getElementById('btnDeleteSelected');
  const btnUndo = document.getElementById('btnUndo');
  const btnRedo = document.getElementById('btnRedo');
  const btnSave = document.getElementById('btnSave');
  const btnExport = document.getElementById('btnExport');
  const btnImport = document.getElementById('btnImport');
  const btnHelp = document.getElementById('btnHelp');
  const panelGuide = document.getElementById('panelGuide');
  const panelNode = document.getElementById('panelNode');
  const panelEdge = document.getElementById('panelEdge');
  const sidePanel = document.getElementById('sidePanel');
  const statusMsg = document.getElementById('statusMsg');
  const zoomLabel = document.getElementById('zoomLabel');
  const nodeGroup = document.getElementById('nodeGroup');
  const nodeId = document.getElementById('nodeId');
  const nodeLabel = document.getElementById('nodeLabel');
  const nodeColor = document.getElementById('nodeColor');
  const nodeTextColor = document.getElementById('nodeTextColor');
  const nodeDesc = document.getElementById('nodeDesc');
  const colorPresets = document.getElementById('colorPresets');
  const connEdges = document.getElementById('connectedEdges');
  const edgeLabel = document.getElementById('edgeLabel');
  const edgeBidirectional = document.getElementById('edgeBidirectional');
  const edgeInfo = document.getElementById('edgeInfo');
  const modalAddNode = document.getElementById('modalAddNode');
  const modalJson = document.getElementById('modalJson');
  const modalHelp = document.getElementById('modalHelp');

  // ── 색상 프리셋 ────────────────────────────────────
  COLOR_PRESETS.forEach(c => {
    const dot = document.createElement('div');
    dot.className = 'preset-dot'; dot.style.background = c; dot.title = c;
    dot.addEventListener('click', () => {
      nodeColor.value = c;
      const r = parseInt(c.slice(1,3),16), g = parseInt(c.slice(3,5),16), b = parseInt(c.slice(5,7),16);
      nodeTextColor.value = (r*0.299 + g*0.587 + b*0.114) / 255 > 0.55 ? '#1a2e1a' : '#e2e8f0';
    });
    colorPresets.appendChild(dot);
  });

  // ── 패널 표시 ──────────────────────────────────────
  function showGuidePanel() { panelGuide.classList.remove('hidden'); panelNode.classList.add('hidden'); panelEdge.classList.add('hidden'); sidePanel.classList.remove('open'); }
  function showNodePanel(node) {
    panelGuide.classList.add('hidden'); panelNode.classList.remove('hidden'); panelEdge.classList.add('hidden'); sidePanel.classList.add('open');
    nodeGroup.value = node.group || 'A'; nodeId.value = node.id; nodeLabel.value = node.label;
    nodeColor.value = node.color || '#4ade80'; nodeTextColor.value = node.textColor || '#1a2e1a'; nodeDesc.value = node.description || '';
    renderConnectedEdges(node);
  }
  function showEdgePanel(edge) {
    panelGuide.classList.add('hidden'); panelNode.classList.add('hidden'); panelEdge.classList.remove('hidden'); sidePanel.classList.add('open');
    const fn = editor.nodes.find(n => n.id === edge.from), tn = editor.nodes.find(n => n.id === edge.to);
    edgeInfo.innerHTML = `<strong>${fn?.label || edge.from}</strong> → <strong>${tn?.label || edge.to}</strong>`;
    edgeLabel.value = edge.label || ''; edgeBidirectional.checked = !!edge.bidirectional;
  }
  function renderConnectedEdges(node) {
    connEdges.innerHTML = '';
    const related = editor.edges.filter(e => e.from === node.id || e.to === node.id);
    if (!related.length) { connEdges.innerHTML = '<p style="font-size:12px;color:var(--text2);padding:6px 0;">연결된 흐름이 없습니다.</p>'; return; }
    related.forEach(e => {
      const fn = editor.nodes.find(n => n.id === e.from), tn = editor.nodes.find(n => n.id === e.to);
      const div = document.createElement('div'); div.className = 'edge-item';
      const dir = e.from === node.id ? '→' : '←', other = e.from === node.id ? tn : fn;
      const lbl = e.label ? ` <em style="color:var(--accent)">(${e.label})</em>` : '';
      div.innerHTML = `<span>${dir} ${other?.label || '?'}${lbl}</span><button class="del-edge" title="삭제" data-eid="${e.id}"><i class="fas fa-times"></i></button>`;
      connEdges.appendChild(div);
    });
    connEdges.querySelectorAll('.del-edge').forEach(btn => {
      btn.addEventListener('click', () => { snapshot(); editor.deleteEdge(btn.dataset.eid); const cur = editor.selectedNode; if (cur) renderConnectedEdges(cur); toast('연결선이 삭제되었습니다.', 'info'); });
    });
  }

  // ── 에디터 콜백 ────────────────────────────────────
  editor.onNodeSelect = node => { setStatus(`📌 선택: ${node.label}  |  더블클릭: 빠른 이름 편집  |  Del: 삭제`); showNodePanel(node); updateZoom(); };
  editor.onEdgeSelect = edge => { const fn = editor.nodes.find(n => n.id === edge.from), tn = editor.nodes.find(n => n.id === edge.to); setStatus(`🔗 선택된 연결: ${fn?.label || '?'} → ${tn?.label || '?'}  |  Del: 삭제`); showEdgePanel(edge); updateZoom(); };
  editor.onDeselect = () => { setStatus('노드를 클릭하면 상세 정보가 표시됩니다.'); showGuidePanel(); updateZoom(); };
  editor.onConnectModeChange = on => { btnConnect.classList.toggle('active', on); setStatus(on ? '🔗 연결 모드: 출발 노드를 클릭하세요.' : '노드를 클릭하면 상세 정보가 표시됩니다.'); };
  editor.onNodeDblClick = node => showInlineEdit(node);
  editor.onContextMenu = (node, edge, sx, sy) => {
    const menu = document.getElementById('ctxMenu');
    const ctxEdit = document.getElementById('ctxEdit'), ctxConnect = document.getElementById('ctxConnect'), ctxDelete = document.getElementById('ctxDelete');
    ctxEdit.style.display = node ? '' : 'none'; ctxConnect.style.display = node ? '' : 'none';
    menu.style.left = sx + 'px'; menu.style.top = sy + 'px'; menu.classList.add('show');
    ctxEdit.onclick = () => { menu.classList.remove('show'); if (node) showNodePanel(node); };
    ctxConnect.onclick = () => { menu.classList.remove('show'); if (node) { editor.connectMode = true; editor.connectFrom = node; editor.canvas.style.cursor = 'crosshair'; editor.onConnectModeChange(true); setStatus(`🔗 연결 모드: "${node.label}"에서 연결할 대상 노드를 클릭하세요.`); } };
    ctxDelete.onclick = () => { menu.classList.remove('show'); if (node) { snapshot(); editor.deleteNode(node.id); toast('노드를 삭제했습니다.', 'info'); } else if (edge) { snapshot(); editor.deleteEdge(edge.id); toast('연결선을 삭제했습니다.', 'info'); } };
  };
  document.addEventListener('click', () => document.getElementById('ctxMenu').classList.remove('show'));

  // ── 인라인 편집 ────────────────────────────────────
  let inlineTarget = null;
  function showInlineEdit(node) {
    inlineTarget = node;
    const box = document.getElementById('inlineEdit'), inp = document.getElementById('inlineInput');
    const s = editor._toScreen(node.x, node.y), r = editor.canvas.getBoundingClientRect();
    box.style.left = (r.left + s.x + 2) + 'px'; box.style.top = (r.top + s.y + 2) + 'px';
    inp.style.width = (160 * editor.scale) + 'px'; inp.style.fontSize = (12 * editor.scale) + 'px';
    inp.value = node.label; box.classList.remove('hidden'); inp.focus(); inp.select();
  }
  function confirmInline() {
    if (!inlineTarget) return;
    const val = document.getElementById('inlineInput').value.trim();
    if (val && val !== inlineTarget.label) { snapshot(); editor.updateNode(inlineTarget.id, { label: val }); if (editor.selectedNode?.id === inlineTarget.id) nodeLabel.value = val; toast('업무명이 변경되었습니다.', 'success'); }
    document.getElementById('inlineEdit').classList.add('hidden'); inlineTarget = null;
  }
  document.getElementById('inlineConfirm').addEventListener('click', confirmInline);
  document.getElementById('inlineInput').addEventListener('keydown', e => { if (e.key === 'Enter') confirmInline(); if (e.key === 'Escape') { document.getElementById('inlineEdit').classList.add('hidden'); inlineTarget = null; } });

  // ── 툴바 버튼 ──────────────────────────────────────
  btnFit.addEventListener('click', () => { editor.fitView(); editor.render(); updateZoom(); });
  btnZoomIn.addEventListener('click', () => { editor.scale = Math.min(3, editor.scale * 1.2); editor.render(); updateZoom(); });
  btnZoomOut.addEventListener('click', () => { editor.scale = Math.max(0.2, editor.scale / 1.2); editor.render(); updateZoom(); });
  btnAddNode.addEventListener('click', () => openModal(modalAddNode));
  btnConnect.addEventListener('click', () => editor.toggleConnectMode());
  btnDeleteSelected.addEventListener('click', deleteSelected);
  btnUndo.addEventListener('click', undo);
  btnRedo.addEventListener('click', redo);
  btnSave.addEventListener('click', saveToLocalStorage);
  btnExport.addEventListener('click', exportJson);
  btnImport.addEventListener('click', importJson);
  btnHelp.addEventListener('click', () => openModal(modalHelp));
  document.getElementById('btnCloseSide').addEventListener('click', showGuidePanel);
  document.getElementById('btnCloseSideEdge').addEventListener('click', showGuidePanel);

  // ── 노드 폼 적용 ───────────────────────────────────
  document.getElementById('btnApplyNode').addEventListener('click', () => {
    const n = editor.selectedNode; if (!n) return;
    const oldId = n.id, newId = nodeId.value.trim() || oldId;
    snapshot();
    if (newId !== oldId) editor.edges.forEach(e => { if (e.from === oldId) e.from = newId; if (e.to === oldId) e.to = newId; });
    editor.updateNode(oldId, { id: newId, group: nodeGroup.value, label: nodeLabel.value.trim() || n.label, color: nodeColor.value, textColor: nodeTextColor.value, description: nodeDesc.value });
    if (newId !== oldId) editor.selectedNode = editor.nodes.find(x => x.id === newId) || null;
    toast('변경사항이 적용되었습니다.', 'success');
  });
  document.getElementById('btnDeleteNode').addEventListener('click', () => {
    const n = editor.selectedNode; if (!n) return;
    if (!confirm(`"${n.label}" 노드를 삭제하시겠습니까?\n연결된 모든 흐름도 함께 삭제됩니다.`)) return;
    snapshot(); editor.deleteNode(n.id); showGuidePanel(); toast('노드를 삭제했습니다.', 'info');
  });

  // ── 엣지 폼 적용 ───────────────────────────────────
  document.getElementById('btnApplyEdge').addEventListener('click', () => { const e = editor.selectedEdge; if (!e) return; snapshot(); editor.updateEdge(e.id, { label: edgeLabel.value.trim(), bidirectional: edgeBidirectional.checked }); toast('연결선이 수정되었습니다.', 'success'); });
  document.getElementById('btnDeleteEdge').addEventListener('click', () => { const e = editor.selectedEdge; if (!e) return; snapshot(); editor.deleteEdge(e.id); showGuidePanel(); toast('연결선을 삭제했습니다.', 'info'); });

  // ── 노드 추가 모달 ─────────────────────────────────
  document.getElementById('btnConfirmAddNode').addEventListener('click', () => {
    const id = document.getElementById('newNodeId').value.trim(), label = document.getElementById('newNodeLabel').value.trim();
    if (!label) { toast('업무명을 입력해주세요.', 'error'); return; }
    const grp = document.getElementById('newNodeGroup').value, desc = document.getElementById('newNodeDesc').value.trim();
    const gCol = GROUP_COLORS[grp] || GROUP_COLORS['A'];
    snapshot();
    const node = editor.addNode({ id: id || ('node_' + Date.now()), group: grp, label, color: gCol.bg, textColor: gCol.text, description: desc });
    document.getElementById('newNodeId').value = ''; document.getElementById('newNodeLabel').value = ''; document.getElementById('newNodeDesc').value = '';
    closeModal(modalAddNode); showNodePanel(node); toast(`"${label}" 노드가 추가되었습니다.`, 'success');
  });
  document.getElementById('btnCancelAddNode').addEventListener('click', () => closeModal(modalAddNode));
  document.getElementById('btnCloseAddNode').addEventListener('click',  () => closeModal(modalAddNode));

  // ── JSON 내보내기/불러오기 ─────────────────────────
  let jsonMode = 'export';
  function exportJson() { jsonMode = 'export'; document.getElementById('modalJsonTitle').innerHTML = '<i class="fas fa-file-export"></i> JSON 내보내기'; document.getElementById('jsonTextarea').value = JSON.stringify(editor.getData(), null, 2); document.getElementById('btnLoadJson').classList.add('hidden'); openModal(modalJson); }
  function importJson() { jsonMode = 'import'; document.getElementById('modalJsonTitle').innerHTML = '<i class="fas fa-file-import"></i> JSON 불러오기'; document.getElementById('jsonTextarea').value = ''; document.getElementById('jsonTextarea').placeholder = 'JSON 데이터를 붙여넣으세요...'; document.getElementById('btnLoadJson').classList.remove('hidden'); openModal(modalJson); }
  document.getElementById('btnCopyJson').addEventListener('click', () => { navigator.clipboard.writeText(document.getElementById('jsonTextarea').value).then(() => toast('클립보드에 복사됐습니다.', 'success')); });
  document.getElementById('btnLoadJson').addEventListener('click', () => { try { const data = JSON.parse(document.getElementById('jsonTextarea').value); if (!data.nodes || !data.edges) throw new Error('nodes, edges 필드가 필요합니다.'); snapshot(); editor.loadData(data); closeModal(modalJson); toast('데이터를 불러왔습니다.', 'success'); } catch (err) { toast('JSON 파싱 오류: ' + err.message, 'error'); } });
  document.getElementById('btnCloseJson').addEventListener('click',  () => closeModal(modalJson));
  document.getElementById('btnCloseJson2').addEventListener('click', () => closeModal(modalJson));
  document.getElementById('btnCloseHelp').addEventListener('click',  () => closeModal(modalHelp));
  document.getElementById('btnCloseHelp2').addEventListener('click', () => closeModal(modalHelp));

  // ── 저장/불러오기 ──────────────────────────────────
  function saveToLocalStorage() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(editor.getData())); toast('저장되었습니다. (브라우저 로컬스토리지)', 'success'); } catch (e) { toast('저장 실패: ' + e.message, 'error'); } }
  function loadFromLocalStorage() { try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) return JSON.parse(raw); } catch { } return null; }

  // ── 삭제 ───────────────────────────────────────────
  function deleteSelected() {
    if (editor.selectedNode) { const label = editor.selectedNode.label; snapshot(); editor.deleteNode(editor.selectedNode.id); showGuidePanel(); toast(`"${label}" 노드를 삭제했습니다.`, 'info'); }
    else if (editor.selectedEdge) { snapshot(); editor.deleteEdge(editor.selectedEdge.id); showGuidePanel(); toast('연결선을 삭제했습니다.', 'info'); }
  }

  // ── 단축키 ─────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
    if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
    else if (e.ctrlKey && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'Z')) { e.preventDefault(); redo(); }
    else if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveToLocalStorage(); }
    else if (e.key === 'Escape') { if (editor.connectMode) editor.toggleConnectMode(false); else editor._deselect(); }
    else if (e.key === 'f' || e.key === 'F') { editor.fitView(); editor.render(); updateZoom(); }
  });

  // ── 모달 헬퍼 ──────────────────────────────────────
  function openModal(modal) { modal.classList.remove('hidden'); }
  function closeModal(modal) { modal.classList.add('hidden'); }
  [modalAddNode, modalJson, modalHelp].forEach(m => m.addEventListener('click', e => { if (e.target === m) closeModal(m); }));

  // ── 유틸 ───────────────────────────────────────────
  function setStatus(msg) { statusMsg.textContent = msg; }
  function updateZoom() { zoomLabel.textContent = Math.round(editor.scale * 100) + '%'; }
  function toast(msg, type = 'info') { const el = document.createElement('div'); el.className = `toast ${type}`; el.textContent = msg; document.getElementById('toastContainer').appendChild(el); setTimeout(() => el.remove(), 3000); }

  const _origRender = editor.render.bind(editor);
  editor.render = function () { _origRender(); updateZoom(); };

  // ── 초기 로드 ──────────────────────────────────────
  function init() { const saved = loadFromLocalStorage(); editor.loadData(saved || DEFAULT_FLOW_DATA); snapshot(); updateHistoryBtns(); setStatus('물류 업무 플로우차트가 로드되었습니다. 노드를 클릭해 상세 정보를 확인하세요.'); }
  init();
})();
