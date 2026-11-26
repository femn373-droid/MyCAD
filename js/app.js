'use strict';
/*
 * MyCAD — 電気工事用 2D 配線図エディタ
 * 座標は実寸 mm（y は下向き）。用紙上の寸法 = 実寸 / 縮尺。
 */
(() => {
const $ = s => document.querySelector(s);
const cv = $('#cv'), ctx = cv.getContext('2d'), wrap = $('#canvasWrap');
const SYM = window.SYMBOLS;
const fillTextSafe = window.fillTextSafe;

const PAPER = { A4: [297, 210], A3: [420, 297], A2: [594, 420] };
const WIRE_TYPES = { ceiling: '天井隠ぺい', floor: '床隠ぺい', exposed: '露出', under: '地中埋設' };
const WIRE_DASH = { ceiling: [], floor: [2, 1], exposed: [0.3, 0.8], under: [3, 0.8, 0.4, 0.8] };
const LINE_STYLES = { wall: '壁（太線）', thin: '細線' };
const DEFAULT_LAYERS = [
  { id: 'under', name: '下絵', visible: true, locked: true },
  { id: 'arch', name: '建物', visible: true, locked: false },
  { id: 'elec', name: '電気', visible: true, locked: false },
  { id: 'dim', name: '寸法', visible: true, locked: false },
  { id: 'note', name: '文字', visible: true, locked: false },
];
const SCREEN_COLORS = { under: '#8a8a8a', arch: '#1a1a1a', elec: '#0b57d0', dim: '#1b7f3a', note: '#1a1a1a' };
const HILITE = '#ff6d00';
const SNAP_NAMES = { end: '端点', center: '中心', int: '交点', mid: '中点', near: '線上', grid: 'グリッド', ortho: '直交' };
const HINTS = {
  select: 'クリックで選択／ドラッグで移動／端点をドラッグで変形／Deleteで削除／R:回転 F:反転',
  line: 'クリックで連続線／数値+Enterで長さ指定／右クリック・Escで終了／Shift:水平垂直',
  wire: 'クリックで経由点／ダブルクリック・Enter・右クリックで確定／記号の中心に吸着',
  dim: '1点目 → 2点目 → 寸法線の位置をクリック',
  text: 'クリックした位置に文字を配置',
  sym: 'クリックで配置／壁に近づけると向きを合わせて吸着（カーソル側が部屋側）／R:回転 F:反転',
  paper: 'ドラッグで用紙枠（印刷範囲）を移動',
};
const PRI = { end: 0, center: 0, int: 1, mid: 2, near: 3, grid: 4 };

const clone = o => JSON.parse(JSON.stringify(o));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const deg = r => r * 180 / Math.PI;
const rad = d => d * Math.PI / 180;
const normDeg = d => ((Math.round(d * 1000) / 1000) % 360 + 360) % 360;
const today = () => { const d = new Date(); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function distToSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const q = { x: a.x + t * dx, y: a.y + t * dy };
  return { d: dist(p, q), q };
}
function segInter(a, b, c, d) {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { x: a.x + t * rx, y: a.y + t * ry };
}

/* ---------- 図面データ ---------- */
function newDoc() {
  return {
    app: 'MyCAD', version: 1,
    meta: { title: '', author: '', date: today() },
    scale: 50, grid: 910,
    paper: { size: 'A3', landscape: true, x: 0, y: 0 },
    layers: clone(DEFAULT_LAYERS),
    entities: [], nextId: 1,
  };
}
function normalize(d) {
  const n = newDoc();
  const out = Object.assign(n, d);
  out.meta = Object.assign(newDoc().meta, d.meta || {});
  out.paper = Object.assign(newDoc().paper, d.paper || {});
  const layers = Array.isArray(d.layers) ? d.layers : [];
  out.layers = DEFAULT_LAYERS.map(L => Object.assign({}, L, layers.find(x => x.id === L.id) || {}));
  out.entities = Array.isArray(d.entities) ? d.entities : [];
  out.nextId = Math.max(out.nextId || 1, ...out.entities.map(e => (e.id || 0) + 1), 1);
  return out;
}

let doc = newDoc();
const view = { ox: 0, oy: 0, z: 0.05 };
let dpr = window.devicePixelRatio || 1;
const st = {
  tool: 'select', pts: [], raw: { x: 0, y: 0 }, cur: { x: 0, y: 0 }, snap: null,
  mouse: null, mouseIn: false,
  ortho: false, osnap: true, gsnap: true, shift: false, space: false,
  input: '', sel: null, drag: null, pan: null,
  place: { kind: null, rot: 0, rotUser: 0, flip: false, label: '', w: 0 },
  lineStyle: 'wall', wireType: 'ceiling',
};
const undoStack = [], redoStack = [];
let fileHandle = null;

const paperSize = () => { const [w, h] = PAPER[doc.paper.size] || PAPER.A3; return doc.paper.landscape ? [w, h] : [h, w]; };
const layerOf = e => doc.layers.find(l => l.id === e.layer);
const isVisible = e => { const l = layerOf(e); return !l || l.visible; };
const isEditable = e => { const l = layerOf(e); return !l || (l.visible && !l.locked); };
const byId = id => doc.entities.find(e => e.id === id);
const selEnt = () => (st.sel != null ? byId(st.sel) : null);
const toWorld = (sx, sy) => ({ x: (sx - view.ox) / view.z, y: (sy - view.oy) / view.z });
const toScreen = p => ({ x: p.x * view.z + view.ox, y: p.y * view.z + view.oy });

/* ---------- 元に戻す ---------- */
function pushUndo() {
  undoStack.push(JSON.stringify(doc));
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(doc));
  doc = JSON.parse(undoStack.pop());
  afterDocLoad(false);
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(doc));
  doc = JSON.parse(redoStack.pop());
  afterDocLoad(false);
}
function changed() { scheduleAutosave(); refreshProps(); render(); }
function addEntity(e) { e.id = doc.nextId++; doc.entities.push(e); return e; }

/* ---------- 形状の補助 ---------- */
function segsOf(e) {
  if (e.type === 'line') return [[{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }]];
  if (e.type === 'wire') {
    const r = [];
    for (let i = 0; i < e.pts.length - 1; i++) r.push([e.pts[i], e.pts[i + 1]]);
    return r;
  }
  return [];
}
function keyPts(e) {
  switch (e.type) {
    case 'line': case 'dim': return [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }];
    case 'wire': return e.pts;
    default: return [];
  }
}
function setVertex(e, i, p) {
  if (e.type === 'wire') { e.pts[i] = { x: p.x, y: p.y }; return; }
  if (i === 0) { e.x1 = p.x; e.y1 = p.y; } else { e.x2 = p.x; e.y2 = p.y; }
}
function translateFrom(e, o, dx, dy) {
  switch (e.type) {
    case 'line': case 'dim':
      e.x1 = o.x1 + dx; e.y1 = o.y1 + dy; e.x2 = o.x2 + dx; e.y2 = o.y2 + dy; break;
    case 'wire': e.pts = o.pts.map(p => ({ x: p.x + dx, y: p.y + dy })); break;
    default: e.x = o.x + dx; e.y = o.y + dy;
  }
}
function toLocal(e, p) {
  const r = rad(e.rot || 0), c = Math.cos(r), s = Math.sin(r);
  const dx = p.x - e.x, dy = p.y - e.y;
  return { x: c * dx + s * dy, y: -s * dx + c * dy };
}
function dimGeom(e) {
  const a = { x: e.x1, y: e.y1 }, b = { x: e.x2, y: e.y2 };
  const len = dist(a, b);
  if (len < 1e-9) return null;
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const n = { x: -u.y, y: u.x };
  const o = e.off || 0;
  return { a, b, len, u, n, o,
    q1: { x: a.x + n.x * o, y: a.y + n.y * o }, q2: { x: b.x + n.x * o, y: b.y + n.y * o } };
}
function dimOffset(a, b, p) {
  const len = dist(a, b);
  if (len < 1e-9) return 0;
  const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  return (p.x - a.x) * n.x + (p.y - a.y) * n.y;
}
const measureCtx = document.createElement('canvas').getContext('2d');
function textWidth(text, size) {
  measureCtx.font = '100px "Hiragino Sans","Yu Gothic UI","Meiryo",sans-serif';
  return measureCtx.measureText(text).width * size / 100;
}

/* ---------- スナップ ---------- */
function snapAt(p, opt = {}) {
  const tol = 12 / view.z;
  let best = null;
  const take = (q, type, ang) => {
    const d = dist(p, q);
    if (d > tol) return;
    if (!best || PRI[type] < PRI[best.type] || (PRI[type] === PRI[best.type] && d < best.d)) {
      best = { x: q.x, y: q.y, type, d, ang };
    }
  };
  if (st.osnap) {
    const near = [];
    for (const e of doc.entities) {
      if (!isVisible(e) || e.id === opt.exclude) continue;
      if (e.type === 'sym') { if (!opt.near) take({ x: e.x, y: e.y }, 'center'); continue; }
      for (const q of keyPts(e)) take(q, 'end');
      for (const [a, b] of segsOf(e)) {
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        take({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, 'mid', ang);
        const r = distToSeg(p, a, b);
        if (r.d <= tol) { near.push([a, b]); if (opt.near) take(r.q, 'near', ang); }
      }
    }
    for (let i = 0; i < near.length; i++)
      for (let j = i + 1; j < near.length; j++) {
        const q = segInter(near[i][0], near[i][1], near[j][0], near[j][1]);
        if (q) take(q, 'int');
      }
  }
  if (best) return best;
  if (st.gsnap) {
    const g = doc.grid / 2;
    return { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g, type: 'grid' };
  }
  return { x: p.x, y: p.y, type: null };
}
function basePoint() {
  if ((st.tool === 'line' || st.tool === 'wire') && st.pts.length) return st.pts[st.pts.length - 1];
  if (st.tool === 'dim' && st.pts.length === 1) return st.pts[0];
  if (st.drag && st.drag.type === 'move') return st.drag.start;
  return null;
}
function updateCursor() {
  const def = st.tool === 'sym' ? SYM[st.place.kind] : null;
  let s = snapAt(st.raw, { near: !!(def && def.wall), exclude: st.drag && st.drag.id });
  const b = basePoint();
  if ((st.ortho || st.shift) && b) {
    const dx = s.x - b.x, dy = s.y - b.y;
    s = Math.abs(dx) >= Math.abs(dy) ? { x: s.x, y: b.y, type: 'ortho' } : { x: b.x, y: s.y, type: 'ortho' };
  }
  if (def) {
    let a = 0;
    if (def.wall && s.ang != null && (s.type === 'near' || s.type === 'mid')) {
      a = s.ang;
      let n = { x: -Math.sin(a), y: Math.cos(a) };
      if ((st.raw.x - s.x) * n.x + (st.raw.y - s.y) * n.y < 0) { a += Math.PI; n = { x: -n.x, y: -n.y }; }
      if (def.wallOff) {
        const off = def.wallOff * doc.scale;
        s = Object.assign({}, s, { x: s.x + n.x * off, y: s.y + n.y * off });
      }
    }
    st.place.rot = normDeg(deg(a) + st.place.rotUser);
  }
  st.snap = s;
  st.cur = { x: s.x, y: s.y };
}

/* ---------- 描画 ---------- */
function makeEnv(px, screen) {
  const S = doc.scale;
  return {
    S, px, screen, bg: '#fff',
    L: w => Math.max(w * S, 1 / px),        // 用紙mm → 実寸座標での線幅
    Lp: w => Math.max(w, 1 / (px * S)),     // 用紙mm座標系での線幅
  };
}
const colorFor = (e, g) => (g.screen ? (SCREEN_COLORS[e.layer] || '#111') : '#000');

function drawDoc(c, g) {
  const order = ['line', 'wire', 'sym', 'dim', 'text'];
  for (const L of doc.layers) {
    if (!L.visible) continue;
    const ents = doc.entities.filter(e => e.layer === L.id);
    for (const t of order) for (const e of ents) if (e.type === t) drawEntity(c, e, g, colorFor(e, g));
  }
  drawFrame(c, g);
}
function drawEntity(c, e, g, col) {
  c.save();
  c.strokeStyle = col; c.fillStyle = col; c.setLineDash([]);
  c.lineCap = 'round'; c.lineJoin = 'round';
  switch (e.type) {
    case 'line':
      c.lineWidth = g.L(e.style === 'wall' ? 0.5 : 0.18);
      c.beginPath(); c.moveTo(e.x1, e.y1); c.lineTo(e.x2, e.y2); c.stroke();
      break;
    case 'wire': drawWire(c, e, g); break;
    case 'sym': drawSym(c, e, g, col); break;
    case 'dim': drawDim(c, e, g); break;
    case 'text':
      c.translate(e.x, e.y); c.rotate(rad(e.rot || 0));
      c.textAlign = 'left'; c.textBaseline = 'alphabetic';
      fillTextSafe(c, e.text, 0, 0, (e.size || 3) * g.S);
      break;
  }
  c.restore();
}
function drawWire(c, e, g) {
  const S = g.S;
  if (e.pts.length < 2) return;
  c.lineWidth = g.L(0.3);
  c.setLineDash((WIRE_DASH[e.wtype] || []).map(v => v * S));
  c.beginPath();
  c.moveTo(e.pts[0].x, e.pts[0].y);
  for (let i = 1; i < e.pts.length; i++) c.lineTo(e.pts[i].x, e.pts[i].y);
  c.stroke();
  c.setLineDash([]);
  const n = e.count || 2;
  if (n >= 3) {  // 電線本数：3本以上は斜線で表す
    let bi = 0, bl = -1;
    for (let i = 0; i < e.pts.length - 1; i++) {
      const l = dist(e.pts[i], e.pts[i + 1]);
      if (l > bl) { bl = l; bi = i; }
    }
    const a = e.pts[bi], b = e.pts[bi + 1];
    if (bl < 1e-6) return;
    const u = { x: (b.x - a.x) / bl, y: (b.y - a.y) / bl };
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const th = rad(60);
    const d = { x: u.x * Math.cos(th) - u.y * Math.sin(th), y: u.x * Math.sin(th) + u.y * Math.cos(th) };
    const sp = 0.8 * S, h = 1.3 * S;
    c.lineWidth = g.L(0.25);
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const t = (i - (n - 1) / 2) * sp;
      const cx = m.x + u.x * t, cy = m.y + u.y * t;
      c.moveTo(cx - d.x * h, cy - d.y * h); c.lineTo(cx + d.x * h, cy + d.y * h);
    }
    c.stroke();
  }
}
function drawSym(c, e, g, col) {
  const d = SYM[e.kind];
  if (!d) return;
  c.save();
  c.translate(e.x, e.y);
  c.rotate(rad(e.rot || 0));
  if (e.flip) c.scale(-1, 1);
  if (d.unit === 'paper') {
    c.scale(g.S, g.S);
    window.drawSymbolShape(c, e, { fg: col, bg: g.bg, Lw: g.Lp, P: 1 });
  } else {
    window.drawSymbolShape(c, e, { fg: col, bg: g.bg, Lw: g.L, P: g.S });
  }
  c.restore();
  if (e.label && d.labelPos) {   // ラベルは常に正立させる
    const r = rad(e.rot || 0);
    const lx = d.labelPos.x * g.S, ly = d.labelPos.y * g.S;
    const wx = e.x + lx * Math.cos(r) - ly * Math.sin(r);
    const wy = e.y + lx * Math.sin(r) + ly * Math.cos(r);
    c.save();
    c.fillStyle = col; c.textAlign = 'center'; c.textBaseline = 'middle';
    fillTextSafe(c, e.label, wx, wy, (d.labelSize || 2) * g.S);
    c.restore();
  }
  if (g.screen && e.url) {   // 資料が紐づいている印
    c.save();
    c.fillStyle = '#e8710a';
    c.beginPath(); c.arc(e.x + 2.6 * g.S, e.y - 2.6 * g.S, Math.max(0.6 * g.S, 2 / g.px), 0, Math.PI * 2); c.fill();
    c.restore();
  }
}
function drawDim(c, e, g) {
  const G = dimGeom(e);
  if (!G) return;
  const S = g.S, { a, b, u, n, o, q1, q2 } = G;
  const sg = o >= 0 ? 1 : -1, gap = 1 * S, ext = 1.5 * S;
  c.lineWidth = g.L(0.13);
  c.beginPath();
  if (Math.abs(o) > gap) {
    c.moveTo(a.x + n.x * gap * sg, a.y + n.y * gap * sg); c.lineTo(q1.x + n.x * ext * sg, q1.y + n.y * ext * sg);
    c.moveTo(b.x + n.x * gap * sg, b.y + n.y * gap * sg); c.lineTo(q2.x + n.x * ext * sg, q2.y + n.y * ext * sg);
  }
  c.moveTo(q1.x, q1.y); c.lineTo(q2.x, q2.y);
  const t = 0.9 * S, dx = (u.x + n.x) * t, dy = (u.y + n.y) * t;
  for (const q of [q1, q2]) { c.moveTo(q.x - dx, q.y - dy); c.lineTo(q.x + dx, q.y + dy); }
  c.stroke();
  const txt = e.text || String(Math.round(G.len));
  let ang = Math.atan2(u.y, u.x);
  // 文字は下または右から読める向きにそろえる
  while (ang >= Math.PI / 2 - 1e-6) ang -= Math.PI;
  while (ang < -Math.PI / 2 - 1e-6) ang += Math.PI;
  c.save();
  c.translate((q1.x + q2.x) / 2, (q1.y + q2.y) / 2); c.rotate(ang);
  c.textAlign = 'center'; c.textBaseline = 'bottom';
  fillTextSafe(c, txt, 0, -0.5 * S, 2.5 * S);
  c.restore();
}
function drawFrame(c, g) {
  const [pw, ph] = paperSize(), S = g.S;
  const col = g.screen ? '#555' : '#000';
  c.save();
  c.translate(doc.paper.x, doc.paper.y); c.scale(S, S);
  c.strokeStyle = col; c.setLineDash([]);
  const m = 10;
  c.lineWidth = g.Lp(0.5); c.strokeRect(m, m, pw - 2 * m, ph - 2 * m);
  // 表題欄
  const tw = 110, th = 21, rh = 7, bx = pw - m - tw, by = ph - m - th;
  c.fillStyle = '#fff'; c.fillRect(bx, by, tw, th);
  c.lineWidth = g.Lp(0.35); c.strokeRect(bx, by, tw, th);
  c.lineWidth = g.Lp(0.18); c.beginPath();
  c.moveTo(bx, by + rh); c.lineTo(bx + tw, by + rh);
  c.moveTo(bx, by + rh * 2); c.lineTo(bx + tw, by + rh * 2);
  c.moveTo(bx + 16, by); c.lineTo(bx + 16, by + th);
  c.moveTo(bx + 58, by + rh); c.lineTo(bx + 58, by + th);
  c.moveTo(bx + 74, by + rh); c.lineTo(bx + 74, by + th);
  c.stroke();
  c.fillStyle = col; c.textBaseline = 'middle'; c.textAlign = 'center';
  const lab = (t, x, row) => fillTextSafe(c, t, x, by + rh * row + rh / 2, 2.6);
  lab('件名', bx + 8, 0); lab('縮尺', bx + 8, 1); lab('日付', bx + 8, 2);
  lab('用紙', bx + 66, 1); lab('作成', bx + 66, 2);
  c.textAlign = 'left';
  const val = (t, x, row, size) => fillTextSafe(c, t, x, by + rh * row + rh / 2, size || 3.2);
  val(doc.meta.title || '', bx + 19, 0, 3.6);
  val('1/' + doc.scale, bx + 19, 1); val(doc.meta.date || '', bx + 19, 2);
  val(doc.paper.size, bx + 77, 1); val(doc.meta.author || '', bx + 77, 2);
  c.restore();
}
function drawGrid(c) {
  const g = doc.grid, W = cv.clientWidth, H = cv.clientHeight;
  const tl = toWorld(0, 0), br = toWorld(W, H);
  const set = (step, color) => {
    if (step * view.z < 7) return;
    c.strokeStyle = color; c.lineWidth = 1 / view.z;
    c.beginPath();
    for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) { c.moveTo(x, tl.y); c.lineTo(x, br.y); }
    for (let y = Math.floor(tl.y / step) * step; y <= br.y; y += step) { c.moveTo(tl.x, y); c.lineTo(br.x, y); }
    c.stroke();
  };
  set(g / 2, 'rgba(60,90,140,.07)');
  set(g, 'rgba(60,90,140,.16)');
}
function drawPreview(c, g) {
  const p = st.cur, col = '#e8710a';
  c.save();
  c.globalAlpha = 0.8; c.strokeStyle = col; c.fillStyle = col; c.lineCap = 'round';
  switch (st.tool) {
    case 'line':
      if (st.pts.length) {
        const a = st.pts[st.pts.length - 1];
        c.lineWidth = g.L(st.lineStyle === 'wall' ? 0.5 : 0.18);
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(p.x, p.y); c.stroke();
      }
      break;
    case 'wire':
      if (st.pts.length) drawWire(c, { wtype: st.wireType, count: 2, pts: [...st.pts, p] }, g);
      break;
    case 'dim':
      if (st.pts.length === 1) {
        c.lineWidth = g.L(0.13);
        c.beginPath(); c.moveTo(st.pts[0].x, st.pts[0].y); c.lineTo(p.x, p.y); c.stroke();
      } else if (st.pts.length === 2) {
        const [a, b] = st.pts;
        drawDim(c, { x1: a.x, y1: a.y, x2: b.x, y2: b.y, off: dimOffset(a, b, p) }, g);
      }
      break;
    case 'sym': {
      const k = st.place.kind;
      drawSym(c, { type: 'sym', kind: k, x: p.x, y: p.y, rot: st.place.rot, flip: st.place.flip,
        label: st.place.label, w: st.place.w }, g, col);
      break;
    }
  }
  c.restore();
}
function drawSnapMarker() {
  const s = st.snap;
  if (!s || !st.mouse) return;
  const p = toScreen(s), r = 6;
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,.28)'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(p.x - 14, p.y); ctx.lineTo(p.x + 14, p.y); ctx.moveTo(p.x, p.y - 14); ctx.lineTo(p.x, p.y + 14);
  ctx.stroke();
  ctx.strokeStyle = '#e8710a'; ctx.lineWidth = 1.6; ctx.beginPath();
  switch (s.type) {
    case 'end': ctx.rect(p.x - r, p.y - r, r * 2, r * 2); break;
    case 'center': ctx.arc(p.x, p.y, r, 0, Math.PI * 2); break;
    case 'int': ctx.moveTo(p.x - r, p.y - r); ctx.lineTo(p.x + r, p.y + r); ctx.moveTo(p.x + r, p.y - r); ctx.lineTo(p.x - r, p.y + r); break;
    case 'mid': ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r, p.y + r * 0.8); ctx.lineTo(p.x - r, p.y + r * 0.8); ctx.closePath(); break;
    case 'near': ctx.moveTo(p.x - r, p.y - r); ctx.lineTo(p.x + r, p.y - r); ctx.lineTo(p.x - r, p.y + r); ctx.lineTo(p.x + r, p.y + r); ctx.closePath(); break;
    case 'grid': ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2); break;
  }
  ctx.stroke();
  const b = basePoint();
  if (b && st.tool !== 'select') {
    const len = dist(b, s);
    const label = st.input ? `長さ: ${st.input}▌` : `${Math.round(len)} mm`;
    ctx.font = '12px "Hiragino Sans","Yu Gothic UI","Meiryo",sans-serif';
    const w = ctx.measureText(label).width + 10;
    const mx = st.mouse.x + 16, my = st.mouse.y + 18;
    ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.strokeStyle = '#e8710a'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.rect(mx, my - 13, w, 19); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#7a3b00'; ctx.textBaseline = 'middle';
    ctx.fillText(label, mx + 5, my - 3);
  }
  ctx.restore();
}
function drawGrips(e) {
  ctx.save();
  ctx.fillStyle = '#fff'; ctx.strokeStyle = HILITE; ctx.lineWidth = 1.5;
  for (const q of keyPts(e)) {
    const p = toScreen(q);
    ctx.beginPath(); ctx.rect(p.x - 4, p.y - 4, 8, 8); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

let rafPending = false;
function render() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; renderNow(); });
}
function renderNow() {
  const W = cv.clientWidth, H = cv.clientHeight;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#e6e9ee'; ctx.fillRect(0, 0, W, H);
  ctx.setTransform(dpr * view.z, 0, 0, dpr * view.z, dpr * view.ox, dpr * view.oy);
  const g = makeEnv(view.z, true), [pw, ph] = paperSize(), S = doc.scale;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = 10 * dpr;
  ctx.fillStyle = '#fff'; ctx.fillRect(doc.paper.x, doc.paper.y, pw * S, ph * S);
  ctx.restore();
  drawGrid(ctx);
  drawDoc(ctx, g);
  const e = selEnt();
  if (e && isVisible(e)) { ctx.save(); ctx.globalAlpha = 0.9; drawEntity(ctx, e, g, HILITE); ctx.restore(); }
  drawPreview(ctx, g);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (e && isVisible(e)) drawGrips(e);
  if (st.mouseIn && !st.pan) drawSnapMarker();
}

/* ---------- 表示操作 ---------- */
function resize() {
  dpr = window.devicePixelRatio || 1;
  cv.width = Math.max(1, Math.round(wrap.clientWidth * dpr));
  cv.height = Math.max(1, Math.round(wrap.clientHeight * dpr));
  render();
}
function fit() {
  const [pw, ph] = paperSize(), S = doc.scale;
  const W = cv.clientWidth, H = cv.clientHeight;
  const z = Math.min(W / (pw * S), H / (ph * S)) * 0.92;
  view.z = z;
  view.ox = W / 2 - (doc.paper.x + pw * S / 2) * z;
  view.oy = H / 2 - (doc.paper.y + ph * S / 2) * z;
  render();
}
function zoomAt(sx, sy, f) {
  const w = toWorld(sx, sy);
  view.z = Math.min(20, Math.max(0.002, view.z * f));
  view.ox = sx - w.x * view.z;
  view.oy = sy - w.y * view.z;
  st.raw = toWorld(sx, sy);
  updateCursor();
  render();
}

/* ---------- 当たり判定 ---------- */
function entDist(e, p) {
  switch (e.type) {
    case 'line': case 'wire': {
      let m = Infinity;
      for (const [a, b] of segsOf(e)) m = Math.min(m, distToSeg(p, a, b).d);
      return m;
    }
    case 'dim': { const G = dimGeom(e); return G ? distToSeg(p, G.q1, G.q2).d : Infinity; }
    case 'sym': {
      const d = SYM[e.kind]; if (!d) return Infinity;
      const l = toLocal(e, p);
      if (d.unit === 'paper') return Math.max(0, Math.hypot(l.x, l.y) - (d.hit || 2) * doc.scale);
      const w = e.w || d.w, m = doc.scale;
      const top = e.kind === 'door' ? w : m;
      const inside = Math.abs(l.x) <= w / 2 && l.y >= -m && l.y <= top;
      return inside ? 0 : Infinity;
    }
    case 'text': {
      const s = (e.size || 3) * doc.scale, l = toLocal(e, p);
      const inside = l.x >= 0 && l.x <= textWidth(e.text, s) && l.y >= -s && l.y <= s * 0.25;
      return inside ? 0 : Infinity;
    }
  }
  return Infinity;
}
function hitTest(p, tol) {
  let best = null, bd = Infinity;
  for (let i = doc.entities.length - 1; i >= 0; i--) {
    const e = doc.entities[i];
    if (!isEditable(e)) continue;
    const d = entDist(e, p);
    if (d <= tol && d < bd) { bd = d; best = e; }
  }
  return best;
}
function vertexHit(e, p, tol) {
  const pts = keyPts(e);
  for (let i = 0; i < pts.length; i++) if (dist(pts[i], p) <= tol) return i;
  return null;
}

/* ---------- 道具 ---------- */
function setTool(t, kind) {
  st.tool = t; st.pts = []; st.input = '';
  if (t === 'sym') {
    const d = SYM[kind];
    Object.assign(st.place, { kind, rotUser: 0, rot: 0, flip: false, label: d.label || '', w: d.w || 0 });
  }
  if (t !== 'select') st.sel = null;
  updateToolUI(); refreshProps(); updateCursor(); updateStatus(); render();
}
function toolClick(p) {
  switch (st.tool) {
    case 'line':
      if (st.pts.length) {
        const a = st.pts[st.pts.length - 1];
        if (dist(a, p) > 1e-6) {
          pushUndo();
          addEntity({ type: 'line', layer: 'arch', style: st.lineStyle, x1: a.x, y1: a.y, x2: p.x, y2: p.y });
          changed();
        }
      }
      st.pts = [{ x: p.x, y: p.y }];
      break;
    case 'wire': {
      const last = st.pts[st.pts.length - 1];
      if (!last || dist(last, p) > 1e-6) st.pts.push({ x: p.x, y: p.y });
      break;
    }
    case 'dim':
      if (st.pts.length < 2) {
        if (st.pts.length === 1 && dist(st.pts[0], p) < 1e-6) break;
        st.pts.push({ x: p.x, y: p.y });
      } else {
        const [a, b] = st.pts;
        pushUndo();
        addEntity({ type: 'dim', layer: 'dim', x1: a.x, y1: a.y, x2: b.x, y2: b.y, off: dimOffset(a, b, p) });
        st.pts = [];
        changed();
      }
      break;
    case 'text': {
      const t = prompt('文字を入力してください', '');
      if (t) { pushUndo(); addEntity({ type: 'text', layer: 'note', x: p.x, y: p.y, text: t, size: 3, rot: 0 }); changed(); }
      break;
    }
    case 'sym': {
      const k = st.place.kind, d = SYM[k];
      pushUndo();
      const e = { type: 'sym', layer: d.cat === 'arch' ? 'arch' : 'elec', kind: k, x: p.x, y: p.y,
        rot: st.place.rot, flip: st.place.flip, label: st.place.label };
      if (d.w) e.w = st.place.w || d.w;
      addEntity(e);
      changed();
      break;
    }
  }
  updateCursor(); updateStatus(); render();
}
function finishWire() {
  const pts = st.pts.filter((p, i, a) => i === 0 || dist(p, a[i - 1]) > 1e-6);
  if (pts.length >= 2) {
    pushUndo();
    addEntity({ type: 'wire', layer: 'elec', wtype: st.wireType, count: 2, pts });
    changed();
  }
  st.pts = [];
  render();
}
function finishOrCancel() {
  if (st.tool === 'wire' && st.pts.length) finishWire();
  else if (st.pts.length) st.pts = [];
  else if (st.tool !== 'select') setTool('select');
  else { st.sel = null; refreshProps(); }
  st.input = '';
  updateStatus(); render();
}
function escape() {
  if (st.input) st.input = '';
  else if (st.pts.length) st.pts = [];
  else if (st.tool !== 'select') { setTool('select'); return; }
  else { st.sel = null; refreshProps(); }
  updateStatus(); render();
}
function applyInput() {
  const len = parseFloat(st.input);
  st.input = '';
  const b = basePoint();
  if (!(len > 0) || !b) { updateStatus(); render(); return; }
  const v = { x: st.cur.x - b.x, y: st.cur.y - b.y }, l = Math.hypot(v.x, v.y);
  const dir = l > 1e-9 ? { x: v.x / l, y: v.y / l } : { x: 1, y: 0 };
  toolClick({ x: b.x + dir.x * len, y: b.y + dir.y * len });
}
function deleteSel() {
  const e = selEnt();
  if (!e || !isEditable(e)) return;
  pushUndo();
  doc.entities = doc.entities.filter(x => x !== e);
  st.sel = null;
  changed();
}
function rotateOrFlip(kind) {
  if (st.tool === 'sym') {
    if (kind === 'rot') st.place.rotUser = normDeg(st.place.rotUser + 90);
    else st.place.flip = !st.place.flip;
    updateCursor(); render(); return;
  }
  const e = selEnt();
  if (!e || !isEditable(e) || (e.type !== 'sym' && e.type !== 'text')) return;
  pushUndo();
  if (kind === 'rot') e.rot = normDeg((e.rot || 0) + 90);
  else if (e.type === 'sym') e.flip = !e.flip;
  changed();
}

/* ---------- マウス ---------- */
function screenPos(ev) { const r = cv.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }
cv.addEventListener('mousemove', ev => {
  const s = screenPos(ev);
  st.mouse = s; st.mouseIn = true;
  if (st.pan) {
    view.ox = st.pan.ox + s.x - st.pan.sx; view.oy = st.pan.oy + s.y - st.pan.sy;
    render(); return;
  }
  st.raw = toWorld(s.x, s.y); st.shift = ev.shiftKey;
  updateCursor();
  if (st.drag) dragMove();
  updateStatus(); render();
});
cv.addEventListener('mouseleave', () => { st.mouseIn = false; render(); });
cv.addEventListener('mousedown', ev => {
  cv.focus();
  const s = screenPos(ev);
  if (ev.button === 1 || (ev.button === 0 && st.space)) {
    st.pan = { sx: s.x, sy: s.y, ox: view.ox, oy: view.oy };
    ev.preventDefault(); return;
  }
  if (ev.button === 2) { finishOrCancel(); return; }
  if (ev.button !== 0) return;
  st.raw = toWorld(s.x, s.y); st.shift = ev.shiftKey;
  updateCursor();
  if (st.tool === 'select') selectPress();
  else if (st.tool === 'paper') {
    st.drag = { type: 'paper', start: { ...st.raw }, orig: { x: doc.paper.x, y: doc.paper.y }, before: JSON.stringify(doc), moved: false };
  } else toolClick(st.cur);
});
window.addEventListener('mouseup', () => {
  if (st.pan) { st.pan = null; return; }
  if (st.drag) { const moved = st.drag.moved; st.drag = null; if (moved) changed(); updateCursor(); render(); }
});
cv.addEventListener('dblclick', () => {
  if (st.tool === 'wire') { finishWire(); return; }
  const e = selEnt();
  if (st.tool === 'select' && e && e.type === 'text' && isEditable(e)) {
    const t = prompt('文字', e.text);
    if (t != null && t !== e.text) { pushUndo(); e.text = t; changed(); }
  }
});
cv.addEventListener('contextmenu', ev => ev.preventDefault());
cv.addEventListener('wheel', ev => {
  ev.preventDefault();
  const s = screenPos(ev);
  zoomAt(s.x, s.y, Math.exp(-ev.deltaY * 0.0015));
}, { passive: false });

function selectPress() {
  const tol = 8 / view.z, cur = selEnt();
  if (cur && isEditable(cur)) {
    const vi = vertexHit(cur, st.raw, tol);
    if (vi != null) { st.drag = { type: 'vertex', id: cur.id, vi, before: JSON.stringify(doc), moved: false }; return; }
  }
  const h = hitTest(st.raw, tol);
  st.sel = h ? h.id : null;
  if (h) {
    const s = snapAt(st.raw, { exclude: h.id });
    st.drag = { type: 'move', id: h.id, start: { x: s.x, y: s.y }, orig: clone(h), before: JSON.stringify(doc), moved: false };
  }
  refreshProps(); render();
}
function markMoved(d) {
  if (d.moved) return;
  undoStack.push(d.before); if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
  d.moved = true;
}
function dragMove() {
  const d = st.drag, e = d.id != null ? byId(d.id) : null;
  if (d.type === 'move' && e) {
    const dx = st.cur.x - d.start.x, dy = st.cur.y - d.start.y;
    if (!d.moved && !dx && !dy) return;
    markMoved(d); translateFrom(e, d.orig, dx, dy);
  } else if (d.type === 'vertex' && e) {
    const p = keyPts(e)[d.vi];
    if (!d.moved && p.x === st.cur.x && p.y === st.cur.y) return;
    markMoved(d); setVertex(e, d.vi, st.cur);
  } else if (d.type === 'paper') {
    const g = doc.grid / 2;
    const dx = Math.round((st.raw.x - d.start.x) / g) * g, dy = Math.round((st.raw.y - d.start.y) / g) * g;
    if (!d.moved && !dx && !dy) return;
    markMoved(d); doc.paper.x = d.orig.x + dx; doc.paper.y = d.orig.y + dy;
  }
}

/* ---------- キーボード ---------- */
window.addEventListener('keydown', ev => {
  const tag = (ev.target.tagName || '').toLowerCase();
  if (['input', 'select', 'textarea'].includes(tag)) return;
  const k = ev.key, lk = k.toLowerCase();
  if (ev.ctrlKey || ev.metaKey) {
    if (lk === 'z' && !ev.shiftKey) undo();
    else if (lk === 'y' || (lk === 'z' && ev.shiftKey)) redo();
    else if (lk === 's') save(ev.shiftKey);
    else if (lk === 'o') openFile();
    else if (lk === 'p') printDoc();
    else return;
    ev.preventDefault(); return;
  }
  if (k === ' ') { st.space = true; ev.preventDefault(); return; }
  if (k === 'Shift') { st.shift = true; updateCursor(); render(); return; }
  if (/^[0-9.]$/.test(k) && ['line', 'wire', 'dim'].includes(st.tool) && basePoint()) {
    st.input += k; updateStatus(); render(); return;
  }
  if (k === 'Backspace' && st.input) { st.input = st.input.slice(0, -1); updateStatus(); render(); ev.preventDefault(); return; }
  if (k === 'Enter') { if (st.input) applyInput(); else finishOrCancel(); ev.preventDefault(); return; }
  if (k === 'Escape') { escape(); return; }
  if (k === 'Delete' || k === 'Backspace') { deleteSel(); ev.preventDefault(); return; }
  if (k === 'F3') { toggle('osnap'); ev.preventDefault(); return; }
  if (k === 'F8') { toggle('ortho'); ev.preventDefault(); return; }
  if (k === 'F9') { toggle('gsnap'); ev.preventDefault(); return; }
  if (k === 'Home') { fit(); return; }
  if (lk === 'r') { rotateOrFlip('rot'); return; }
  if (lk === 'f') { rotateOrFlip('flip'); return; }
  const map = { v: 'select', l: 'line', w: 'wire', d: 'dim', t: 'text', p: 'paper' };
  if (map[lk]) setTool(map[lk]);
});
window.addEventListener('keyup', ev => {
  if (ev.key === ' ') st.space = false;
  if (ev.key === 'Shift') { st.shift = false; updateCursor(); render(); }
});

/* ---------- UI ---------- */
function toggle(name) {
  st[name] = !st[name];
  updateToolUI(); updateCursor(); render();
}
function updateToolUI() {
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === st.tool));
  document.querySelectorAll('.pal button').forEach(b => b.classList.toggle('active', st.tool === 'sym' && b.dataset.kind === st.place.kind));
  $('#osnapBtn').classList.toggle('on', st.osnap);
  $('#gsnapBtn').classList.toggle('on', st.gsnap);
  $('#orthoBtn').classList.toggle('on', st.ortho);
}
function updateStatus() {
  $('#stCoord').textContent = `X ${Math.round(st.cur.x - doc.paper.x)}  Y ${Math.round(st.cur.y - doc.paper.y)}`;
  $('#stSnap').textContent = st.snap && st.snap.type ? `[${SNAP_NAMES[st.snap.type]}]` : '';
  $('#stInput').textContent = st.input ? `長さ入力: ${st.input}` : '';
  $('#stHint').textContent = HINTS[st.tool] || '';
}
let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'class') n.className = v;
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids) if (c != null) n.append(c);
  return n;
}
function row(label, input) { return el('label', { class: 'prop' }, el('span', {}, label), input); }
function selectBox(options, value, onChange) {
  const s = el('select', { onchange: () => onChange(s.value) });
  for (const [v, t] of Object.entries(options)) s.append(el('option', { value: v }, t));
  s.value = value;
  return s;
}
function textBox(value, onChange, attrs) {
  const i = el('input', Object.assign({ type: 'text' }, attrs || {}));
  i.value = value == null ? '' : value;
  i.addEventListener('change', () => onChange(i.value));
  return i;
}
function numBox(value, onChange, attrs) {
  const i = el('input', Object.assign({ type: 'number' }, attrs || {}));
  i.value = value == null ? '' : value;
  i.addEventListener('change', () => { const v = parseFloat(i.value); if (!isNaN(v)) onChange(v); });
  return i;
}
function labelBox(value, labels, onChange) {
  const id = 'dl' + Math.random().toString(36).slice(2);
  const i = textBox(value, onChange, { list: id });
  const dl = el('datalist', { id });
  for (const l of labels || []) dl.append(el('option', { value: l }));
  const w = el('div', { class: 'inline' }, i, dl);
  return w;
}

function refreshProps() {
  const box = $('#props'), title = $('#propsTitle');
  box.textContent = '';
  if (st.tool === 'sym') {
    const d = SYM[st.place.kind];
    title.textContent = `配置: ${d.name}`;
    if (d.labelPos) box.append(row('傍記', labelBox(st.place.label, d.labels, v => { st.place.label = v; render(); })));
    if (d.w) box.append(row('幅 mm', numBox(st.place.w, v => { st.place.w = v; render(); }, { step: 10, min: 100 })));
    box.append(el('div', { class: 'empty' }, 'R:90°回転　F:反転'));
    return;
  }
  const e = selEnt();
  title.textContent = 'プロパティ';
  if (!e) { box.append(el('div', { class: 'empty' }, '図形を選択すると、ここで編集できます')); return; }
  const set = (key, v) => { pushUndo(); e[key] = v; changed(); };
  const locked = !isEditable(e);
  switch (e.type) {
    case 'line':
      title.textContent = '線';
      box.append(row('線種', selectBox(LINE_STYLES, e.style, v => set('style', v))));
      box.append(row('長さ', el('span', {}, `${Math.round(dist({ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }))} mm`)));
      break;
    case 'wire':
      title.textContent = '配線';
      box.append(row('種類', selectBox(WIRE_TYPES, e.wtype, v => set('wtype', v))));
      box.append(row('電線本数', numBox(e.count || 2, v => set('count', Math.max(1, Math.round(v))), { min: 1, max: 9, step: 1 })));
      break;
    case 'dim': {
      title.textContent = '寸法';
      const G = dimGeom(e);
      box.append(row('実寸', el('span', {}, `${G ? Math.round(G.len) : 0} mm`)));
      box.append(row('表示値', textBox(e.text || '', v => set('text', v), { placeholder: '空欄で実寸を表示' })));
      box.append(row('離れ mm', numBox(Math.round(e.off || 0), v => set('off', v), { step: 50 })));
      break;
    }
    case 'text':
      title.textContent = '文字';
      box.append(row('内容', textBox(e.text, v => set('text', v))));
      box.append(row('大きさ', numBox(e.size || 3, v => set('size', v), { step: 0.5, min: 1 })));
      box.append(row('回転°', numBox(e.rot || 0, v => set('rot', normDeg(v)), { step: 90 })));
      break;
    case 'sym': {
      const d = SYM[e.kind] || { name: e.kind };
      title.textContent = d.name;
      if (d.labelPos) box.append(row('傍記', labelBox(e.label, d.labels, v => set('label', v))));
      if (d.w) box.append(row('幅 mm', numBox(e.w || d.w, v => set('w', v), { step: 10, min: 100 })));
      box.append(row('回転°', numBox(Math.round(e.rot || 0), v => set('rot', normDeg(v)), { step: 90 })));
      box.append(row('反転', el('input', { type: 'checkbox', checked: !!e.flip, onchange: ev => set('flip', ev.target.checked) })));
      if (d.cat === 'elec') {
        box.append(row('品番', textBox(e.model || '', v => set('model', v), { placeholder: '例: WN1001' })));
        const url = textBox(e.url || '', v => set('url', v.trim()), { placeholder: 'https://… 説明書・図面' });
        const open = el('button', { type: 'button', title: '資料を開く', onclick: ev => { ev.preventDefault(); if (e.url) window.open(e.url, '_blank', 'noopener'); } }, '開く');
        box.append(row('資料', el('div', { class: 'inline' }, url, open)));
        const memo = el('textarea', {});
        memo.value = e.note || '';
        memo.addEventListener('change', () => set('note', memo.value));
        box.append(row('メモ', memo));
      }
      break;
    }
  }
  if (locked) box.querySelectorAll('input,select,textarea').forEach(n => { n.disabled = true; });
}
function refreshLayers() {
  const box = $('#layers');
  box.textContent = '';
  for (const L of doc.layers) {
    const vis = el('input', { type: 'checkbox', checked: L.visible, title: '表示', onchange: ev => { L.visible = ev.target.checked; changed(); } });
    const lock = el('button', { type: 'button', title: 'ロック（編集禁止）', onclick: () => { L.locked = !L.locked; refreshLayers(); changed(); } }, L.locked ? '🔒' : '🔓');
    box.append(el('div', { class: 'layer' }, vis, el('span', { class: 'swatch', style: `background:${SCREEN_COLORS[L.id]}` }), el('span', { class: 'name' }, L.name), lock));
  }
}
function refreshSettings() {
  $('#setTitle').value = doc.meta.title || '';
  $('#setScale').value = String(doc.scale);
  $('#setPaper').value = doc.paper.size;
  $('#setOrient').value = doc.paper.landscape ? '1' : '0';
  $('#setGrid').value = String(doc.grid);
  $('#setDate').value = doc.meta.date || '';
  $('#setAuthor').value = doc.meta.author || '';
}
function bindSettings() {
  const on = (id, fn) => $(id).addEventListener('change', ev => { pushUndo(); fn(ev.target.value); changed(); });
  on('#setTitle', v => { doc.meta.title = v; });
  on('#setScale', v => { doc.scale = +v; });
  on('#setPaper', v => { doc.paper.size = v; });
  on('#setOrient', v => { doc.paper.landscape = v === '1'; });
  on('#setGrid', v => { doc.grid = +v; });
  on('#setDate', v => { doc.meta.date = v; });
  on('#setAuthor', v => { doc.meta.author = v; });
}
function afterDocLoad(doFit) {
  if (st.sel != null && !selEnt()) st.sel = null;
  refreshSettings(); refreshLayers(); refreshProps(); scheduleAutosave();
  if (doFit) fit(); else render();
}

function symIcon(kind) {
  const d = SYM[kind], s = 40, r = window.devicePixelRatio || 1;
  const c = el('canvas', { width: s * r, height: s * r, style: `width:${s}px;height:${s}px` });
  const x = c.getContext('2d');
  x.scale(r, r); x.translate(s / 2, s / 2);
  x.lineCap = 'round';
  if (d.unit === 'paper') {
    const k = 5;
    x.scale(k, k);
    window.drawSymbolShape(x, { kind, w: d.w }, { fg: '#222', bg: '#fff', Lw: w => Math.max(w, 1 / k), P: 1 });
    if (d.label && d.labelPos && d.labelPos.y === 0) {
      x.fillStyle = '#222'; x.textAlign = 'center'; x.textBaseline = 'middle';
      fillTextSafe(x, d.label, 0, 0, d.labelSize);
    }
  } else {
    const k = 30 / d.w, P = 60;
    if (kind === 'door') x.translate(0, -12);
    x.scale(k, k);
    x.strokeStyle = '#222'; x.lineWidth = 0.5 * P;
    x.beginPath(); x.moveTo(-d.w * 0.62, 0); x.lineTo(d.w * 0.62, 0); x.stroke();
    window.drawSymbolShape(x, { kind, w: d.w }, { fg: '#222', bg: '#fff', Lw: w => Math.max(w * P, 1 / k), P });
  }
  return c;
}
function buildPalette() {
  for (const [kind, d] of Object.entries(SYM)) {
    const b = el('button', { type: 'button', title: d.name, 'data-kind': kind, onclick: () => setTool('sym', kind) }, symIcon(kind), el('span', {}, d.name));
    $(d.cat === 'arch' ? '#palArch' : '#palElec').append(b);
  }
}

/* ---------- 保存・読み込み・印刷 ---------- */
let autosaveTimer = 0;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try { localStorage.setItem('mycad.autosave', JSON.stringify(doc)); } catch (e) { /* 保存できない環境 */ }
  }, 400);
}
function fileName() { return (doc.meta.title || '図面').replace(/[\\/:*?"<>|]/g, '_') + '.mycad.json'; }
async function save(saveAs) {
  const data = JSON.stringify(doc);
  if (window.showSaveFilePicker) {
    try {
      if (!fileHandle || saveAs) {
        fileHandle = await window.showSaveFilePicker({ suggestedName: fileName(),
          types: [{ description: 'MyCAD 図面', accept: { 'application/json': ['.json'] } }] });
      }
      const w = await fileHandle.createWritable();
      await w.write(data); await w.close();
      toast(`保存しました: ${fileHandle.name}`);
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      console.warn(err);
    }
  }
  const a = el('a', { href: URL.createObjectURL(new Blob([data], { type: 'application/json' })), download: fileName() });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('ダウンロードしました');
}
async function openFile() {
  if (window.showOpenFilePicker) {
    try {
      const [h] = await window.showOpenFilePicker({ types: [{ description: 'MyCAD 図面', accept: { 'application/json': ['.json'] } }] });
      const f = await h.getFile();
      if (loadText(await f.text())) fileHandle = h;
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  $('#fileInput').click();
}
$('#fileInput').addEventListener('change', async ev => {
  const f = ev.target.files[0];
  if (f) { loadText(await f.text()); fileHandle = null; }
  ev.target.value = '';
});
function loadText(t) {
  try {
    const d = JSON.parse(t);
    if (!d || d.app !== 'MyCAD') throw new Error('MyCAD の図面ファイルではありません');
    pushUndo();
    doc = normalize(d);
    st.sel = null;
    afterDocLoad(true);
    toast('読み込みました');
    return true;
  } catch (e) {
    alert('読み込めませんでした: ' + e.message);
    return false;
  }
}
function newDrawing() {
  if (doc.entities.length && !confirm('今の図面を閉じて新しい図面を作りますか？\n（保存していない変更は「元に戻す」で戻せます）')) return;
  pushUndo();
  doc = newDoc(); fileHandle = null; st.sel = null;
  afterDocLoad(true);
}
function renderPaper(dpi) {
  const [pw, ph] = paperSize(), S = doc.scale;
  const W = Math.round(pw / 25.4 * dpi), H = Math.round(ph / 25.4 * dpi);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  const f = dpi / 25.4 / S;
  x.setTransform(f, 0, 0, f, -doc.paper.x * f, -doc.paper.y * f);
  x.save();
  x.beginPath(); x.rect(doc.paper.x, doc.paper.y, pw * S, ph * S); x.clip();
  drawDoc(x, makeEnv(f, false));
  x.restore();
  return c;
}
function printDoc() {
  const [pw, ph] = paperSize();
  const url = renderPaper(200).toDataURL('image/png');
  const ifr = el('iframe', { style: 'position:fixed;right:0;bottom:0;width:0;height:0;border:0' });
  document.body.append(ifr);
  const d = ifr.contentDocument;
  d.open();
  d.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.meta.title || '図面')}</title>
<style>@page{size:${doc.paper.size} ${doc.paper.landscape ? 'landscape' : 'portrait'};margin:0}
html,body{margin:0;padding:0}img{display:block;width:${pw}mm;height:${ph - 0.5}mm}</style></head>
<body><img src="${url}"></body></html>`);
  d.close();
  const img = d.querySelector('img');
  const go = () => { ifr.contentWindow.focus(); ifr.contentWindow.print(); setTimeout(() => ifr.remove(), 3000); };
  if (img.complete) go(); else img.onload = go;
}

/* ---------- 起動 ---------- */
function init() {
  $('#lineStyle').append(...Object.entries(LINE_STYLES).map(([v, t]) => el('option', { value: v }, t)));
  $('#wireType').append(...Object.entries(WIRE_TYPES).map(([v, t]) => el('option', { value: v }, t)));
  $('#lineStyle').addEventListener('change', ev => { st.lineStyle = ev.target.value; setTool('line'); });
  $('#wireType').addEventListener('change', ev => { st.wireType = ev.target.value; setTool('wire'); });
  document.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
  const acts = { new: newDrawing, open: openFile, save: () => save(false), saveas: () => save(true),
    print: printDoc, undo, redo, fit };
  document.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => acts[b.dataset.act]()));
  $('#osnapBtn').addEventListener('click', () => toggle('osnap'));
  $('#gsnapBtn').addEventListener('click', () => toggle('gsnap'));
  $('#orthoBtn').addEventListener('click', () => toggle('ortho'));
  buildPalette();
  bindSettings();
  try {
    const saved = localStorage.getItem('mycad.autosave');
    if (saved) { const d = JSON.parse(saved); if (d && d.app === 'MyCAD') doc = normalize(d); }
  } catch (e) { /* 復元できなければ新規 */ }
  new ResizeObserver(resize).observe(wrap);
  resize();
  afterDocLoad(true);
  updateToolUI(); updateStatus();
}

// 動作確認・拡張用
window.MyCAD = {
  get doc() { return doc; }, set doc(d) { doc = normalize(d); afterDocLoad(true); },
  view, st, render: renderNow, renderPaper, fit, setTool,
};
init();
})();
