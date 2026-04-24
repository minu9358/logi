// =====================================================================
// FlowEditor – 캔버스 기반 인터랙티브 플로우차트 엔진
// =====================================================================
class FlowEditor {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.nodes = [];
    this.edges = [];
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.selectedNode = null;
    this.selectedEdge = null;
    this.hoveredNode = null;
    this.draggingNode = null;
    this.dragOffX = 0;
    this.dragOffY = 0;
    this.isPanning = false;
    this.panStartX = 0;
    this.panStartY = 0;
    this.panOffStartX = 0;
    this.panOffStartY = 0;
    this.connectMode = false;
    this.connectFrom = null;
    this.mouseX = 0;
    this.mouseY = 0;
    this.onNodeSelect = null;
    this.onEdgeSelect = null;
    this.onDeselect = null;
    this._touches = [];
    this._pinchDist = 0;
    this._initEvents();
    this._resizeCanvas();
    window.addEventListener('resize', () => this._resizeCanvas());
  }

  loadData(data) {
    this.nodes = data.nodes.map(n => ({ ...n }));
    this.edges = data.edges.map(e => ({ ...e }));
    this.fitView();
    this.render();
  }

  getData() {
    return { nodes: this.nodes.map(n => ({ ...n })), edges: this.edges.map(e => ({ ...e })) };
  }

  _resizeCanvas() {
    const container = this.canvas.parentElement;
    this.canvas.width = container.clientWidth;
    this.canvas.height = container.clientHeight;
    this.render();
  }

  _toWorld(sx, sy) { return { x: (sx - this.offsetX) / this.scale, y: (sy - this.offsetY) / this.scale }; }
  _toScreen(wx, wy) { return { x: wx * this.scale + this.offsetX, y: wy * this.scale + this.offsetY }; }

  fitView() {
    if (!this.nodes.length) return;
    const pad = 60;
    const xs = this.nodes.map(n => n.x), ys = this.nodes.map(n => n.y);
    const minX = Math.min(...xs) - pad, minY = Math.min(...ys) - pad;
    const maxX = Math.max(...xs) + 160 + pad, maxY = Math.max(...ys) + 50 + pad;
    const scaleX = this.canvas.width / (maxX - minX);
    const scaleY = this.canvas.height / (maxY - minY);
    this.scale = Math.min(scaleX, scaleY, 1.4);
    this.offsetX = -minX * this.scale + (this.canvas.width - (maxX - minX) * this.scale) / 2;
    this.offsetY = -minY * this.scale + (this.canvas.height - (maxY - minY) * this.scale) / 2;
  }

  _initEvents() {
    const c = this.canvas;
    c.addEventListener('mousedown',   e => this._onMouseDown(e));
    c.addEventListener('mousemove',   e => this._onMouseMove(e));
    c.addEventListener('mouseup',     e => this._onMouseUp(e));
    c.addEventListener('wheel',       e => this._onWheel(e), { passive: false });
    c.addEventListener('dblclick',    e => this._onDblClick(e));
    c.addEventListener('contextmenu', e => { e.preventDefault(); this._onRightClick(e); });
    c.addEventListener('touchstart',  e => this._onTouchStart(e), { passive: false });
    c.addEventListener('touchmove',   e => this._onTouchMove(e),  { passive: false });
    c.addEventListener('touchend',    e => this._onTouchEnd(e));
  }

  _getPos(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  _nodeAt(sx, sy) {
    const w = this._toWorld(sx, sy);
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i];
      if (w.x >= n.x && w.x <= n.x + 200 && w.y >= n.y && w.y <= n.y + 56) return n;
    }
    return null;
  }

  _edgeAt(sx, sy) {
    const w = this._toWorld(sx, sy);
    for (const e of this.edges) {
      const fn = this.nodes.find(n => n.id === e.from);
      const tn = this.nodes.find(n => n.id === e.to);
      if (!fn || !tn) continue;
      const pts = [{ x: fn.x + 100, y: fn.y + 56 }, { x: tn.x + 100, y: tn.y }];
      if (this._pointNearPath(w, pts, 8 / this.scale)) return e;
    }
    return null;
  }

  _pointNearPath(p, pts, tol) {
    for (let i = 0; i < pts.length - 1; i++) {
      if (this._distToSegment(p, pts[i], pts[i + 1]) < tol) return true;
    }
    return false;
  }

  _distToSegment(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  _onMouseDown(e) {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      this.isPanning = true;
      const pos = this._getPos(e);
      this.panStartX = pos.x; this.panStartY = pos.y;
      this.panOffStartX = this.offsetX; this.panOffStartY = this.offsetY;
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;
    const pos = this._getPos(e);
    const node = this._nodeAt(pos.x, pos.y);
    if (this.connectMode) {
      if (node) {
        if (!this.connectFrom) { this.connectFrom = node; this.canvas.style.cursor = 'crosshair'; }
        else if (this.connectFrom.id !== node.id) { this._addEdge(this.connectFrom.id, node.id); this.connectFrom = null; this.toggleConnectMode(false); }
      }
      return;
    }
    if (node) {
      this.draggingNode = node;
      const w = this._toWorld(pos.x, pos.y);
      this.dragOffX = w.x - node.x; this.dragOffY = w.y - node.y;
      this._select(node, null);
    } else {
      const edge = this._edgeAt(pos.x, pos.y);
      if (edge) { this._select(null, edge); }
      else {
        this._deselect();
        this.isPanning = true;
        this.panStartX = pos.x; this.panStartY = pos.y;
        this.panOffStartX = this.offsetX; this.panOffStartY = this.offsetY;
        this.canvas.style.cursor = 'grabbing';
      }
    }
  }

  _onMouseMove(e) {
    const pos = this._getPos(e);
    this.mouseX = pos.x; this.mouseY = pos.y;
    if (this.isPanning) { this.offsetX = this.panOffStartX + (pos.x - this.panStartX); this.offsetY = this.panOffStartY + (pos.y - this.panStartY); this.render(); return; }
    if (this.draggingNode) { const w = this._toWorld(pos.x, pos.y); this.draggingNode.x = w.x - this.dragOffX; this.draggingNode.y = w.y - this.dragOffY; this.render(); return; }
    this.hoveredNode = this._nodeAt(pos.x, pos.y);
    this.canvas.style.cursor = this.hoveredNode ? 'pointer' : (this.connectMode ? 'crosshair' : 'default');
    this.render();
  }

  _onMouseUp() { this.draggingNode = null; this.isPanning = false; if (!this.connectMode) this.canvas.style.cursor = 'default'; }

  _onWheel(e) {
    e.preventDefault();
    const pos = this._getPos(e);
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.2, Math.min(3, this.scale * delta));
    this.offsetX = pos.x - (pos.x - this.offsetX) * (newScale / this.scale);
    this.offsetY = pos.y - (pos.y - this.offsetY) * (newScale / this.scale);
    this.scale = newScale;
    this.render();
  }

  _onDblClick(e) { const pos = this._getPos(e); const node = this._nodeAt(pos.x, pos.y); if (node && this.onNodeDblClick) this.onNodeDblClick(node); }
  _onRightClick(e) { const pos = this._getPos(e); const node = this._nodeAt(pos.x, pos.y); const edge = node ? null : this._edgeAt(pos.x, pos.y); if (this.onContextMenu) this.onContextMenu(node, edge, pos.x, pos.y); }

  _onTouchStart(e) {
    e.preventDefault();
    this._touches = Array.from(e.touches);
    if (e.touches.length === 1) { const t = e.touches[0]; this._onMouseDown({ button: 0, clientX: t.clientX, clientY: t.clientY, altKey: false }); }
  }

  _onTouchMove(e) {
    e.preventDefault();
    if (e.touches.length === 2) {
      const t1 = e.touches[0], t2 = e.touches[1];
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      if (this._pinchDist) {
        const delta = dist / this._pinchDist;
        const mx = (t1.clientX + t2.clientX) / 2, my = (t1.clientY + t2.clientY) / 2;
        const r = this.canvas.getBoundingClientRect();
        const px = mx - r.left, py = my - r.top;
        const newScale = Math.max(0.2, Math.min(3, this.scale * delta));
        this.offsetX = px - (px - this.offsetX) * (newScale / this.scale);
        this.offsetY = py - (py - this.offsetY) * (newScale / this.scale);
        this.scale = newScale; this.render();
      }
      this._pinchDist = dist; return;
    }
    if (e.touches.length === 1) { const t = e.touches[0]; this._onMouseMove({ clientX: t.clientX, clientY: t.clientY }); }
  }

  _onTouchEnd() { this._pinchDist = 0; this._onMouseUp(); }

  _select(node, edge) { this.selectedNode = node; this.selectedEdge = edge; if (node && this.onNodeSelect) this.onNodeSelect(node); if (edge && this.onEdgeSelect) this.onEdgeSelect(edge); this.render(); }
  _deselect() { this.selectedNode = null; this.selectedEdge = null; if (this.onDeselect) this.onDeselect(); this.render(); }

  addNode(data) {
    const w = this._toWorld(this.canvas.width / 2, this.canvas.height / 2);
    const node = { id: 'node_' + Date.now(), group: 'A', label: '새 업무', x: w.x - 80, y: w.y - 22, color: '#4ade80', textColor: '#1a2e1a', description: '업무 설명을 입력하세요.', ...data };
    this.nodes.push(node); this._select(node, null); this.render(); return node;
  }

  deleteNode(nodeId) { this.nodes = this.nodes.filter(n => n.id !== nodeId); this.edges = this.edges.filter(e => e.from !== nodeId && e.to !== nodeId); if (this.selectedNode?.id === nodeId) this._deselect(); this.render(); }

  _addEdge(fromId, toId, label = '') {
    if (this.edges.find(e => e.from === fromId && e.to === toId)) return;
    const edge = { id: 'e_' + Date.now(), from: fromId, to: toId, label };
    this.edges.push(edge); this.render(); return edge;
  }

  deleteEdge(edgeId) { this.edges = this.edges.filter(e => e.id !== edgeId); if (this.selectedEdge?.id === edgeId) this._deselect(); this.render(); }
  updateNode(nodeId, updates) { const n = this.nodes.find(n => n.id === nodeId); if (!n) return; Object.assign(n, updates); if (this.selectedNode?.id === nodeId) this.selectedNode = n; this.render(); }
  updateEdge(edgeId, updates) { const e = this.edges.find(e => e.id === edgeId); if (!e) return; Object.assign(e, updates); if (this.selectedEdge?.id === edgeId) this.selectedEdge = e; this.render(); }

  toggleConnectMode(on) {
    this.connectMode = on !== undefined ? on : !this.connectMode;
    this.connectFrom = null;
    this.canvas.style.cursor = this.connectMode ? 'crosshair' : 'default';
    if (this.onConnectModeChange) this.onConnectModeChange(this.connectMode);
    this.render();
  }

  render() {
    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    this._drawGrid(ctx, W, H);
    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);
    for (const e of this.edges) this._drawEdge(ctx, e);
    if (this.connectMode && this.connectFrom) {
      const fn = this.connectFrom, fw = this._toWorld(this.mouseX, this.mouseY);
      ctx.save(); ctx.strokeStyle = '#facc15'; ctx.lineWidth = 2 / this.scale; ctx.setLineDash([6 / this.scale, 4 / this.scale]);
      ctx.beginPath(); ctx.moveTo(fn.x + 100, fn.y + 28); ctx.lineTo(fw.x, fw.y); ctx.stroke(); ctx.restore();
    }
    for (const n of this.nodes) this._drawNode(ctx, n);
    ctx.restore();
  }

  _drawGrid(ctx, W, H) {
    const step = 40 * this.scale;
    const ox = ((this.offsetX % step) + step) % step, oy = ((this.offsetY % step) + step) % step;
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
    for (let x = ox; x < W; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = oy; y < H; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.restore();
  }

  _drawEdge(ctx, e) {
    const fn = this.nodes.find(n => n.id === e.from), tn = this.nodes.find(n => n.id === e.to);
    if (!fn || !tn) return;
    const nw = 200, nh = 56, selected = this.selectedEdge?.id === e.id;
    const fcx = fn.x + nw / 2, fcy = fn.y + nh / 2, tcx = tn.x + nw / 2, tcy = tn.y + nh / 2;
    const dx = tcx - fcx, dy = tcy - fcy;
    let sx, sy, ex, ey, cpx1, cpy1, cpx2, cpy2;
    if (Math.abs(dy) >= Math.abs(dx)) {
      if (dy >= 0) { sx = fcx; sy = fn.y + nh; ex = tcx; ey = tn.y; } else { sx = fcx; sy = fn.y; ex = tcx; ey = tn.y + nh; }
      const midY = (sy + ey) / 2; cpx1 = sx; cpy1 = midY; cpx2 = ex; cpy2 = midY;
    } else {
      if (dx >= 0) { sx = fn.x + nw; sy = fcy; ex = tn.x; ey = tcy; } else { sx = fn.x; sy = fcy; ex = tn.x + nw; ey = tcy; }
      const midX = (sx + ex) / 2; cpx1 = midX; cpy1 = sy; cpx2 = midX; cpy2 = ey;
    }
    ctx.save();
    ctx.strokeStyle = selected ? '#facc15' : (e.bidirectional ? '#a78bfa' : '#94a3b8');
    ctx.lineWidth = selected ? 3 / this.scale : 1.5 / this.scale;
    ctx.shadowColor = selected ? '#facc15' : 'transparent';
    ctx.shadowBlur = selected ? 8 / this.scale : 0;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.bezierCurveTo(cpx1, cpy1, cpx2, cpy2, ex, ey); ctx.stroke();
    this._drawArrow(ctx, cpx2, cpy2, ex, ey, selected);
    if (e.bidirectional) this._drawArrow(ctx, cpx1, cpy1, sx, sy, selected);
    if (e.label) {
      const lx = (sx + ex) / 2, ly = (sy + ey) / 2;
      ctx.font = `600 ${14 / this.scale}px "Noto Sans KR", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const tw = ctx.measureText(e.label).width;
      ctx.fillStyle = 'rgba(15,20,30,0.9)';
      ctx.fillRect(lx - tw / 2 - 6 / this.scale, ly - 10 / this.scale, tw + 12 / this.scale, 20 / this.scale);
      ctx.fillStyle = '#e2e8f0'; ctx.fillText(e.label, lx, ly);
    }
    ctx.restore();
  }

  _drawArrow(ctx, cpx, cpy, ex, ey, selected) {
    const angle = Math.atan2(ey - cpy, ex - cpx), size = 12 / this.scale;
    ctx.beginPath(); ctx.moveTo(ex, ey);
    ctx.lineTo(ex - size * Math.cos(angle - Math.PI / 6), ey - size * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(ex - size * Math.cos(angle + Math.PI / 6), ey - size * Math.sin(angle + Math.PI / 6));
    ctx.closePath(); ctx.fillStyle = selected ? '#facc15' : '#94a3b8'; ctx.fill();
  }

  _drawNode(ctx, n) {
    const nw = 200, nh = 56, r = 12;
    const selected = this.selectedNode?.id === n.id, hovered = this.hoveredNode?.id === n.id, connectSrc = this.connectFrom?.id === n.id;
    ctx.save();
    if (selected || hovered) { ctx.shadowColor = selected ? '#facc15' : n.color; ctx.shadowBlur = (selected ? 20 : 12) / this.scale; }
    ctx.beginPath();
    ctx.moveTo(n.x + r, n.y); ctx.lineTo(n.x + nw - r, n.y); ctx.quadraticCurveTo(n.x + nw, n.y, n.x + nw, n.y + r);
    ctx.lineTo(n.x + nw, n.y + nh - r); ctx.quadraticCurveTo(n.x + nw, n.y + nh, n.x + nw - r, n.y + nh);
    ctx.lineTo(n.x + r, n.y + nh); ctx.quadraticCurveTo(n.x, n.y + nh, n.x, n.y + nh - r);
    ctx.lineTo(n.x, n.y + r); ctx.quadraticCurveTo(n.x, n.y, n.x + r, n.y); ctx.closePath();
    ctx.fillStyle = n.color || '#4ade80'; ctx.fill();
    if (selected) { ctx.strokeStyle = '#facc15'; ctx.lineWidth = 2.5 / this.scale; ctx.stroke(); }
    else if (hovered || connectSrc) { ctx.strokeStyle = n.color; ctx.lineWidth = 2 / this.scale; ctx.globalAlpha = 0.8; ctx.stroke(); }
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    ctx.font = `700 ${15 / this.scale}px "Noto Sans KR", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = n.textColor || '#1a2e1a';
    const maxW = nw - 20;
    const lines = this._wrapText(ctx, n.label, maxW);
    if (lines.length === 1) { ctx.fillText(lines[0], n.x + nw / 2, n.y + nh / 2, maxW); }
    else {
      const lineH = 18 / this.scale, totalH = lines.length * lineH;
      lines.forEach((line, i) => ctx.fillText(line, n.x + nw / 2, n.y + nh / 2 - totalH / 2 + i * lineH + lineH / 2, maxW));
    }
    ctx.restore();
  }

  _wrapText(ctx, text, maxW) {
    const words = text.split(' '), lines = [];
    let cur = '';
    for (const word of words) {
      const test = cur ? cur + ' ' + word : word;
      if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = word; } else { cur = test; }
    }
    if (cur) lines.push(cur);
    return lines;
  }
}
