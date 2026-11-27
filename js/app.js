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
// 'wall' は v0.1 の「壁（太線）」との互換のため、太線として残す
const LINE_STYLES = { thin: '細線', wall: '太線', dash: '破線', chain: '一点鎖線' };
const LINE_W = { thin: 0.18, wall: 0.5, dash: 0.18, chain: 0.18 };
const LINE_DASH = { thin: [], wall: [], dash: [2, 1], chain: [4, 1, 0.5, 1] };
const CENTER_DASH = [5, 1, 0.6, 1];
const COLORS = {
  '': 'レイヤー色', '#000000': '黒', '#d32f2f': '赤', '#0b57d0': '青', '#1b7f3a': '緑',
  '#e8710a': '橙', '#8e24aa': '紫', '#795548': '茶', '#00838f': '青緑', '#757575': '灰',
};
const DEFAULT_LAYERS = [
  { id: 'under', name: '下絵', visible: true, locked: true, color: '#8a8a8a' },
  { id: 'arch', name: '建物', visible: true, locked: false, color: '#1a1a1a' },
  { id: 'elec', name: '電気', visible: true, locked: false, color: '#0b57d0' },
  { id: 'dim', name: '寸法', visible: true, locked: false, color: '#1b7f3a' },
  { id: 'note', name: '文字', visible: true, locked: false, color: '#1a1a1a' },
];
const HILITE = '#ff6d00';
const SNAP_NAMES = { end: '端点', center: '中心', int: '交点', mid: '中点', near: '線上', grid: 'グリッド', ortho: '直交' };
const HINTS = {
  select: 'クリックで選択／ドラッグで移動／何もない所をドラッグで画面移動／端点ドラッグで変形／Delete:削除 R:回転 F:反転',
  wall: 'クリックで連続壁／数値+Enterで長さ指定／右クリック・Escで終了／厚さは描く方向に向かって左・右',
  line: 'クリックで連続線／数値+Enterで長さ指定／右クリック・Escで終了／Shift:水平垂直',
  wire: 'クリックで経由点／ダブルクリック・Enter・右クリックで確定／記号の中心に吸着',
  dim: '1点目 → 2点目 → 寸法線の位置をクリック',
  text: 'クリックした位置に文字を配置',
  symPick: '取り付ける壁をクリック（壁以外の場所をクリックするとその場に配置）／R:回転 F:反転',
  symLocked: '壁に沿って配置：クリックで配置／カーソルのある側が部屋側／右クリック・Escで壁を選び直す',
  symFree: 'クリックで配置／壁に近づけると吸着（カーソル側が部屋側）／R:回転 F:反転',
  paper: 'ドラッグで用紙枠（印刷範囲）を移動',
  erase: '消したい図形をクリック → 確認して削除（ロックしたレイヤーは対象外）',
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
function lineInter(p, d, q, e) {   // 無限直線どうしの交点
  const den = d.x * e.y - d.y * e.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((q.x - p.x) * e.y - (q.y - p.y) * e.x) / den;
  return { x: p.x + d.x * t, y: p.y + d.y * t };
}

/* ---------- 図面データ ---------- */
function newDoc() {
  return {
    app: 'MyCAD', version: 2,
    meta: { title: '', author: '', date: today() },
    scale: 50, grid: 910, snapDiv: 2, showCenter: true, printColor: true,
    paper: { size: 'A3', landscape: true, x: 0, y: 0 },
    layers: clone(DEFAULT_LAYERS),
    entities: [], nextId: 1,
  };
}
function normalize(d) {
  const out = Object.assign(newDoc(), d);
  out.meta = Object.assign(newDoc().meta, d.meta || {});
  out.paper = Object.assign(newDoc().paper, d.paper || {});
  const layers = Array.isArray(d.layers) ? d.layers : [];
  // 保存されたレイヤーの順番（重なり順）を保ち、足りないレイヤーを補う
  out.layers = layers.filter(x => DEFAULT_LAYERS.some(L => L.id === x.id))
    .map(x => Object.assign({}, DEFAULT_LAYERS.find(L => L.id === x.id), x));
  for (const L of DEFAULT_LAYERS) if (!out.layers.some(x => x.id === L.id)) out.layers.push(Object.assign({}, L));
  out.entities = Array.isArray(d.entities) ? d.entities : [];
  out.nextId = Math.max(out.nextId || 1, ...out.entities.map(e => (e.id || 0) + 1), 1);
  for (const e of out.entities) if (e.id == null) e.id = out.nextId++;   // 番号のない図形に番号を振る
  out.version = 2;
  return out;
}

let doc = newDoc();
const view = { ox: 0, oy: 0, z: 0.05 };
let dpr = window.devicePixelRatio || 1;
const st = {
  tool: 'select', pts: [], raw: { x: 0, y: 0 }, cur: { x: 0, y: 0 }, snap: null,
  mouse: null, mouseIn: false,
  ortho: false, osnap: true, gsnap: true, shift: false, ctrl: false, space: false,
  input: '', sel: null, drag: null, pan: null, rdown: null,
  place: { kind: null, rot: 0, rotUser: 0, flip: false, label: '', w: 0,
    lockId: null, hover: null, attached: false, d1: undefined, d2: undefined },
  placePick: true, colFit: true, colSize: 120,
  lineStyle: 'thin', wireType: 'ceiling', wallL: 60, wallR: 60, color: '', drawLayer: '', wireR: 4,
  wallMark: false,
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
const snapStep = () => doc.grid / (doc.snapDiv || 2);
const gridRound = p => { const g = snapStep(); return { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g }; };

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
function addEntity(e) {
  e.id = doc.nextId++;
  if (st.drawLayer && doc.layers.some(L => L.id === st.drawLayer)) e.layer = st.drawLayer;
  if (st.color && !e.color) e.color = st.color;
  doc.entities.push(e);
  return e;
}

/* ---------- 形状の補助 ---------- */
function segsOf(e) {
  if (e.type === 'line' || e.type === 'wall') return [[{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }]];
  if (e.type === 'wire') {
    const r = [];
    for (let i = 0; i < e.pts.length - 1; i++) r.push([e.pts[i], e.pts[i + 1]]);
    return r;
  }
  return [];
}
function keyPts(e) {
  switch (e.type) {
    case 'line': case 'wall': case 'dim': return [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }];
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
    case 'line': case 'wall': case 'dim':
      e.x1 = o.x1 + dx; e.y1 = o.y1 + dy; e.x2 = o.x2 + dx; e.y2 = o.y2 + dy; break;
    case 'wire': e.pts = o.pts.map(p => ({ x: p.x + dx, y: p.y + dy })); break;
    default: e.x = o.x + dx; e.y = o.y + dy;
  }
}
function toLocal(e, p) {
  const r = rad(e.rot || 0), c = Math.cos(r), s = Math.sin(r);
  const dx = p.x - e.x, dy = p.y - e.y;
  const l = { x: c * dx + s * dy, y: -s * dx + c * dy };
  if (e.flip) l.x = -l.x;
  return l;
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

/* ---------- 壁 ---------- */
// 壁の「右」は描く方向に対して右（y 下向きの座標で n = (-u.y, u.x) の側）
function wallSeg(e) {
  const a = { x: e.x1, y: e.y1 }, b = { x: e.x2, y: e.y2 }, len = dist(a, b);
  if (len < 1e-6) return null;
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const isWall = e.type === 'wall';
  return { id: e.id, e, a, b, len, u, tl: isWall ? (e.tl || 0) : 0, tr: isWall ? (e.tr || 0) : 0 };
}
// 壁を優先し、近くに壁がなければ線（旧形式の壁や細線）に取り付ける
function nearestWall(p, px) {
  return nearestWallOf(p, px, 'wall') || nearestWallOf(p, px, 'line');
}
function nearestWallOf(p, px, type) {
  let best = null, bd = Infinity;
  for (const e of doc.entities) {
    if (e.type !== type || !isVisible(e)) continue;
    if (type === 'line' && e.layer !== 'arch') continue;   // 文字レイヤーの引出線などには付けない
    const w = wallSeg(e);
    if (!w) continue;
    const d = distToSeg(p, w.a, w.b).d - Math.max(w.tl, w.tr);
    if (d <= px / view.z && d < bd) { bd = d; best = w; }
  }
  return best;
}
// 壁上の位置を決める：端点・中点・他の壁との交点 → グリッド → カーソルの投影
function attachTo(w, raw) {
  const { a, u, len } = w;
  const tol = 12 / view.z;
  let t = (raw.x - a.x) * u.x + (raw.y - a.y) * u.y;
  let type = 'near';
  const cands = [[0, 'end'], [len, 'end'], [len / 2, 'mid']];
  for (const e of doc.entities) {
    if (e.id === w.id || (e.type !== 'wall' && e.type !== 'line') || !isVisible(e)) continue;
    const q = segInter(w.a, w.b, { x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 });
    if (q) cands.push([(q.x - a.x) * u.x + (q.y - a.y) * u.y, 'int']);
  }
  let hit = null;
  if (st.osnap && !st.ctrl) for (const [ct, ty] of cands) if (Math.abs(ct - t) < tol && (!hit || PRI[ty] < PRI[hit[1]] || Math.abs(ct - t) < Math.abs(hit[0] - t))) hit = [ct, ty];
  if (hit) { t = hit[0]; type = hit[1]; }
  else if (st.gsnap && !st.ctrl) {
    const g = gridRound(raw);
    t = (g.x - a.x) * u.x + (g.y - a.y) * u.y; type = 'grid';
  }
  t = Math.max(0, Math.min(len, t));
  const q = { x: a.x + u.x * t, y: a.y + u.y * t };
  const nR = { x: -u.y, y: u.x };
  const side = (raw.x - q.x) * nR.x + (raw.y - q.y) * nR.y >= 0 ? 1 : -1;
  const n = { x: nR.x * side, y: nR.y * side };
  return { q, n, type, rot: Math.atan2(-n.x, n.y),
    d2: side > 0 ? w.tr : w.tl, d1: side > 0 ? w.tl : w.tr };
}
// 壁の輪郭（4点）。端がほかの壁 1 本とつながっていれば留め（マイター）で角を作る
function wallPoly(e, walls) {
  const w = wallSeg(e);
  if (!w) return null;
  const { a, b, u, tl, tr } = w;
  const nR = { x: -u.y, y: u.x };
  const off = (p, k) => ({ x: p.x + nR.x * k, y: p.y + nR.y * k });
  let A = a, B = b;
  let aL = off(a, -tl), aR = off(a, tr), bL = off(b, -tl), bR = off(b, tr);
  const same = (p, q) => Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5;
  const fix = (P, atEnd) => {
    const others = walls.filter(o => o !== e && (same({ x: o.x1, y: o.y1 }, P) || same({ x: o.x2, y: o.y2 }, P)));
    if (!others.length) return null;
    if (others.length === 1) {
      const o = wallSeg(others[0]);
      if (!o) return null;
      // e は P に「入ってくる」向き、o は P から「出ていく」向きにそろえる
      const da = atEnd ? u : { x: -u.x, y: -u.y };
      const ra = atEnd ? tr : tl, la = atEnd ? tl : tr;
      const leaves = same(o.a, P);
      const db = leaves ? o.u : { x: -o.u.x, y: -o.u.y };
      const rb = leaves ? o.tr : o.tl, lb = leaves ? o.tl : o.tr;
      const na = { x: -da.y, y: da.x }, nb = { x: -db.y, y: db.x };
      const R = lineInter({ x: P.x + na.x * ra, y: P.y + na.y * ra }, da, { x: P.x + nb.x * rb, y: P.y + nb.y * rb }, db);
      const L = lineInter({ x: P.x - na.x * la, y: P.y - na.y * la }, da, { x: P.x - nb.x * lb, y: P.y - nb.y * lb }, db);
      const lim = 6 * Math.max(ra, la, rb, lb, 1);
      if (!R || !L || dist(R, P) > lim || dist(L, P) > lim) return null;
      return atEnd ? { L, R } : { L: R, R: L };
    }
    const ext = Math.max(...others.map(o => Math.max(o.tl || 0, o.tr || 0)));
    return { ext };
  };
  const fa = fix(a, false), fb = fix(b, true);
  if (fa && fa.ext) { A = { x: a.x - u.x * fa.ext, y: a.y - u.y * fa.ext }; aL = off(A, -tl); aR = off(A, tr); }
  else if (fa) { aL = fa.L; aR = fa.R; }
  if (fb && fb.ext) { B = { x: b.x + u.x * fb.ext, y: b.y + u.y * fb.ext }; bL = off(B, -tl); bR = off(B, tr); }
  else if (fb) { bL = fb.L; bR = fb.R; }
  return [aL, bL, bR, aR];
}
const allWalls = () => doc.entities.filter(e => e.type === 'wall' && isVisible(e));

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
      if (e.type === 'sym') { take({ x: e.x, y: e.y }, 'center'); continue; }
      for (const q of keyPts(e)) take(q, 'end');
      for (const [a, b] of segsOf(e)) {
        take({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, 'mid');
        if (distToSeg(p, a, b).d <= tol) near.push([a, b]);
      }
    }
    for (let i = 0; i < near.length; i++)
      for (let j = i + 1; j < near.length; j++) {
        const q = segInter(near[i][0], near[i][1], near[j][0], near[j][1]);
        if (q) take(q, 'int');
      }
  }
  if (best) return best;
  if (st.gsnap) return Object.assign(gridRound(p), { type: 'grid' });
  return { x: p.x, y: p.y, type: null };
}
function basePoint() {
  if ((st.tool === 'line' || st.tool === 'wall' || st.tool === 'wire') && st.pts.length) return st.pts[st.pts.length - 1];
  if (st.tool === 'dim' && st.pts.length === 1) return st.pts[0];
  if (st.drag && st.drag.type === 'move') return st.drag.start;
  return null;
}
function updateCursor() {
  if (st.tool === 'sym') { placeCursor(SYM[st.place.kind]); return; }
  let s = st.ctrl ? { x: st.raw.x, y: st.raw.y, type: null } : snapAt(st.raw, { exclude: st.drag && st.drag.id });
  const b = basePoint();
  if ((st.ortho || st.shift) && b) {
    const dx = s.x - b.x, dy = s.y - b.y;
    s = Math.abs(dx) >= Math.abs(dy) ? { x: s.x, y: b.y, type: 'ortho' } : { x: b.x, y: s.y, type: 'ortho' };
  }
  st.snap = s;
  st.cur = { x: s.x, y: s.y };
}
// 記号を置く位置：壁に取り付けるか、自由に置くか
function placeCursor(def) {
  const P = st.place;
  P.hover = null;
  let w = null;
  if (def.wall) {
    if (P.lockId != null) {
      const e = byId(P.lockId);
      w = e && wallSeg(e);
      if (!w) P.lockId = null;
    } else if (st.placePick) P.hover = nearestWall(st.raw, 10);
    else if (!st.ctrl) w = nearestWall(st.raw, 20);
  }
  if (w) {
    const A = attachTo(w, st.raw);
    const off = def.unit === 'paper' ? A.d2 + (def.wallOff || 0) * doc.scale : 0;
    st.cur = { x: A.q.x + A.n.x * off, y: A.q.y + A.n.y * off };
    st.snap = { x: A.q.x, y: A.q.y, type: A.type };
    P.rot = normDeg(deg(A.rot) + P.rotUser);
    P.attached = true; P.d1 = A.d1; P.d2 = A.d2;
  } else {
    const s = st.ctrl ? { x: st.raw.x, y: st.raw.y, type: null } : snapAt(st.raw, {});
    st.snap = s; st.cur = { x: s.x, y: s.y };
    P.rot = normDeg(P.rotUser);
    P.attached = false; P.d1 = P.d2 = undefined;
  }
}
// 配置する記号のデータを組み立てる（プレビューと確定で共用）
function buildSym(p) {
  const P = st.place, d = SYM[P.kind];
  const e = { type: 'sym', layer: d.cat === 'arch' ? 'arch' : 'elec', kind: P.kind, x: p.x, y: p.y,
    rot: P.rot, flip: P.flip, label: P.label };
  if (d.wallMark && st.wallMark) e.wallMark = true;
  if (d.column) {
    if (P.attached && st.colFit && P.d1 + P.d2 > 0) {
      e.fit = true; e.d1 = P.d1; e.d2 = P.d2; e.w = P.d1 + P.d2;
    } else { e.w = st.colSize; e.d1 = e.d2 = st.colSize / 2; }
  } else if (d.w) {
    e.w = P.w || d.w;
    if (P.attached) { e.d1 = P.d1; e.d2 = P.d2; }
  }
  return e;
}

/* ---------- 描画 ---------- */
function makeEnv(px, screen) {
  const S = doc.scale;
  return {
    S, px, screen, bg: '#fff', mono: !screen && !doc.printColor,
    L: w => Math.max(w * S, 1 / px),        // 用紙mm → 実寸座標での線幅
    Lp: w => Math.max(w, 1 / (px * S)),     // 用紙mm座標系での線幅
  };
}
function colorFor(e, g) {
  if (g.mono) return '#000';
  if (e.color) return e.color;
  const L = layerOf(e);
  return (L && L.color) || '#1a1a1a';
}

function drawDoc(c, g) {
  // レイヤー内の重なり順：壁 → 旧形式の太線 → 配線 → 記号（建具の白抜き）→ 線 → 寸法 → 文字
  const rank = e => e.type === 'line' ? (e.style === 'wall' ? 0 : 3)
    : ({ wire: 1, sym: 2, dim: 4, text: 5 }[e.type] ?? 6);
  for (const L of doc.layers) {
    if (!L.visible) continue;
    const ents = doc.entities.filter(e => e.layer === L.id);
    drawWalls(c, ents.filter(e => e.type === 'wall'), g);
    const rest = ents.filter(e => e.type !== 'wall').map((e, i) => [rank(e), i, e]);
    rest.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [, , e] of rest) drawEntity(c, e, g, colorFor(e, g));
  }
  drawFrame(c, g);
}
// 壁はまとめて描く：輪郭を太めに描いてから中を白で塗り、重なった部分の線を消す
function drawWalls(c, walls, g, colorOverride) {
  if (!walls.length) return;
  const polys = walls.map(e => [e, wallPoly(e, allWalls())]).filter(x => x[1]);
  const path = P => { c.beginPath(); c.moveTo(P[0].x, P[0].y); for (let i = 1; i < P.length; i++) c.lineTo(P[i].x, P[i].y); c.closePath(); };
  c.save();
  c.lineJoin = 'round'; c.setLineDash([]);   // 留めの角でとがりが出ないよう丸める
  c.lineWidth = g.L(0.3) * 2;
  for (const [e, P] of polys) { c.strokeStyle = colorOverride || colorFor(e, g); path(P); c.stroke(); }
  c.fillStyle = g.bg;
  for (const [, P] of polys) { path(P); c.fill(); }
  if (doc.showCenter) {
    c.lineWidth = g.L(0.1); c.lineCap = 'butt';
    c.setLineDash(CENTER_DASH.map(v => v * g.S));
    for (const [e] of polys) {
      c.strokeStyle = colorOverride || colorFor(e, g);
      c.beginPath(); c.moveTo(e.x1, e.y1); c.lineTo(e.x2, e.y2); c.stroke();
    }
  }
  c.restore();
}
function drawEntity(c, e, g, col) {
  c.save();
  c.strokeStyle = col; c.fillStyle = col; c.setLineDash([]);
  c.lineCap = 'round'; c.lineJoin = 'round';
  switch (e.type) {
    case 'wall': {   // 選択表示用（通常は drawWalls で描く）
      const P = wallPoly(e, allWalls());
      if (P) {
        c.lineWidth = g.L(0.35); c.lineJoin = 'miter';
        c.beginPath(); c.moveTo(P[0].x, P[0].y); for (let i = 1; i < 4; i++) c.lineTo(P[i].x, P[i].y); c.closePath(); c.stroke();
      }
      break;
    }
    case 'line': {
      const s = e.style || 'thin';
      c.lineWidth = g.L(LINE_W[s] || 0.18);
      c.setLineDash((LINE_DASH[s] || []).map(v => v * g.S));
      if ((LINE_DASH[s] || []).length) c.lineCap = 'butt';
      c.beginPath(); c.moveTo(e.x1, e.y1); c.lineTo(e.x2, e.y2); c.stroke();
      break;
    }
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
// 中継点の角を丸めた経路（r は実寸）。角の両側の線分に収まるよう半径を自動で小さくする
function wirePath(c, pts, r) {
  c.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], n = pts[i + 1];
    const l1 = dist(a, b), l2 = dist(b, n);
    if (r <= 0 || l1 < 1e-6 || l2 < 1e-6) { c.lineTo(b.x, b.y); continue; }
    const u1 = { x: (a.x - b.x) / l1, y: (a.y - b.y) / l1 }, u2 = { x: (n.x - b.x) / l2, y: (n.y - b.y) / l2 };
    const th = Math.acos(Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y)));   // 角の内角
    if (th < 1e-3 || Math.PI - th < 1e-3) { c.lineTo(b.x, b.y); continue; }
    const maxT = Math.min(l1, l2) / 2;
    const rr = Math.min(r, maxT * Math.tan(th / 2));
    c.arcTo(b.x, b.y, n.x, n.y, rr);
  }
  const z = pts[pts.length - 1];
  c.lineTo(z.x, z.y);
}
function drawWire(c, e, g) {
  const S = g.S;
  if (e.pts.length < 2) return;
  c.lineWidth = g.L(0.3);
  c.setLineDash((WIRE_DASH[e.wtype] || []).map(v => v * S));
  c.beginPath();
  wirePath(c, e.pts, (e.r ?? 4) * S);
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
    window.drawSymbolShape(c, e, { fg: col, bg: g.bg, Lw: g.L, P: g.S, pad: g.L(0.3) * 1.6 });
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
    case 'wall':
      if (st.pts.length) {
        const a = st.pts[st.pts.length - 1];
        const tmp = { type: 'wall', x1: a.x, y1: a.y, x2: p.x, y2: p.y, tl: st.wallL, tr: st.wallR };
        const P = wallPoly(tmp, []);
        if (P) {
          c.lineWidth = g.L(0.3);
          c.beginPath(); c.moveTo(P[0].x, P[0].y); for (let i = 1; i < 4; i++) c.lineTo(P[i].x, P[i].y); c.closePath(); c.stroke();
          c.setLineDash(CENTER_DASH.map(v => v * g.S)); c.lineWidth = g.L(0.1);
          c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(p.x, p.y); c.stroke();
        }
      }
      break;
    case 'line':
      if (st.pts.length) {
        const a = st.pts[st.pts.length - 1];
        drawEntity(c, { type: 'line', style: st.lineStyle, x1: a.x, y1: a.y, x2: p.x, y2: p.y }, g, col);
      }
      break;
    case 'wire':
      if (st.pts.length) drawWire(c, { wtype: st.wireType, count: 2, r: st.wireR, pts: [...st.pts, p] }, g);
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
      // 取り付け先の壁を強調
      const lockE = st.place.lockId != null ? byId(st.place.lockId) : null;
      const hl = lockE || (st.place.hover && st.place.hover.e);
      if (hl) {
        c.save();
        c.globalAlpha = lockE ? 0.35 : 0.2; c.strokeStyle = HILITE; c.lineCap = 'butt';
        c.lineWidth = Math.max((hl.tl || 0) + (hl.tr || 0), 0) + 8 / g.px;
        const nR = (() => { const w = wallSeg(hl); return w ? { x: -w.u.y, y: w.u.x } : { x: 0, y: 0 }; })();
        const sh = ((hl.tr || 0) - (hl.tl || 0)) / 2;
        c.beginPath();
        c.moveTo(hl.x1 + nR.x * sh, hl.y1 + nR.y * sh); c.lineTo(hl.x2 + nR.x * sh, hl.y2 + nR.y * sh);
        c.stroke();
        c.restore();
      }
      drawSym(c, buildSym(p), g, col);
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
  keyPts(e).forEach((q, i) => {
    const p = toScreen(q);
    ctx.fillStyle = i === st.vsel ? HILITE : '#fff';
    ctx.beginPath(); ctx.rect(p.x - 4, p.y - 4, 8, 8); ctx.fill(); ctx.stroke();
  });
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
  if (e && isVisible(e)) { ctx.save(); ctx.globalAlpha = 0.9; drawEntity(ctx, e, g, st.tool === 'erase' ? '#d32f2f' : HILITE); ctx.restore(); }
  if (st.tool === 'erase' && !e && st.mouseIn) {
    const h = hitTest(st.raw, 8 / view.z);
    if (h) { ctx.save(); ctx.globalAlpha = 0.6; drawEntity(ctx, h, g, '#d32f2f'); ctx.restore(); }
  }
  drawPreview(ctx, g);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (e && isVisible(e) && st.tool !== 'erase') drawGrips(e);
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
function panBy(dx, dy) {
  view.ox += dx; view.oy += dy;
  if (st.mouse) { st.raw = toWorld(st.mouse.x, st.mouse.y); updateCursor(); }
  render();
}

/* ---------- 当たり判定 ---------- */
function symExtents(e) {   // 実寸記号のローカル範囲
  const d = SYM[e.kind], m = doc.scale;
  const w = e.w || d.w, d1 = e.d1 ?? m, d2 = e.d2 ?? m;
  if (e.kind === 'door') return { x0: -w / 2, x1: w / 2, y0: -d1, y1: d2 + w };
  return { x0: -w / 2, x1: w / 2, y0: -d1, y1: d2 };
}
function entDist(e, p) {
  switch (e.type) {
    case 'line': case 'wire': {
      let m = Infinity;
      for (const [a, b] of segsOf(e)) m = Math.min(m, distToSeg(p, a, b).d);
      return m;
    }
    case 'wall': {
      const w = wallSeg(e);
      return w ? Math.max(0, distToSeg(p, w.a, w.b).d - Math.max(w.tl, w.tr)) : Infinity;
    }
    case 'dim': { const G = dimGeom(e); return G ? distToSeg(p, G.q1, G.q2).d : Infinity; }
    case 'sym': {
      const d = SYM[e.kind]; if (!d) return Infinity;
      const l = toLocal(e, p);
      if (d.unit === 'paper') return Math.max(0, Math.hypot(l.x, l.y) - (d.hit || 2) * doc.scale);
      const b = symExtents(e);
      const dx = Math.max(b.x0 - l.x, 0, l.x - b.x1), dy = Math.max(b.y0 - l.y, 0, l.y - b.y1);
      return Math.hypot(dx, dy);
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
  // 記号や文字を壁より優先して拾う
  const rank = e => (e.type === 'sym' || e.type === 'text' ? 0 : e.type === 'wall' ? 2 : 1);
  let best = null, bk = null;
  for (let i = doc.entities.length - 1; i >= 0; i--) {
    const e = doc.entities[i];
    if (!isEditable(e)) continue;
    const d = entDist(e, p);
    if (d > tol) continue;
    const k = [rank(e), d];
    if (!bk || k[0] < bk[0] || (k[0] === bk[0] && k[1] < bk[1])) { bk = k; best = e; }
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
  const wasSym = st.tool === 'sym';
  st.tool = t; st.pts = []; st.input = '';
  if (t === 'sym') {
    const d = SYM[kind];
    const keepLock = wasSym && d.wall ? st.place.lockId : null;   // 同じ壁に続けて別の記号を付けられる
    Object.assign(st.place, { kind, rotUser: 0, rot: 0, flip: false, label: d.label || '', w: d.w || 0, lockId: keepLock, hover: null });
  } else st.place.lockId = null;
  if (t !== 'select') st.sel = null;
  updateToolUI(); refreshProps(); updateCursor(); updateStatus(); render();
}
function toolClick(p) {
  switch (st.tool) {
    case 'wall': case 'line':
      if (st.pts.length) {
        const a = st.pts[st.pts.length - 1];
        if (dist(a, p) > 1e-6) {
          pushUndo();
          if (st.tool === 'wall') addEntity({ type: 'wall', layer: 'arch', x1: a.x, y1: a.y, x2: p.x, y2: p.y, tl: st.wallL, tr: st.wallR });
          else addEntity({ type: 'line', layer: 'arch', style: st.lineStyle, x1: a.x, y1: a.y, x2: p.x, y2: p.y });
          changed();
        }
      }
      st.pts = [{ x: p.x, y: p.y }];
      break;
    case 'wire': {
      const last = st.pts[st.pts.length - 1];
      if (!last || dist(last, p) > 1e-6) st.pts.push({ x: p.x, y: p.y });
      // 記号の中心で終われば自動で確定（始点以外）
      if (st.pts.length >= 2 && st.snap && st.snap.type === 'center') { finishWire(); return; }
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
      const P = st.place, d = SYM[P.kind];
      if (d.wall && st.placePick && P.lockId == null && P.hover) {   // まず取り付ける壁を選ぶ
        P.lockId = P.hover.id;
        refreshProps();
        break;
      }
      pushUndo();
      addEntity(buildSym(p));
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
    addEntity({ type: 'wire', layer: 'elec', wtype: st.wireType, count: 2, r: st.wireR, pts });
    changed();
  }
  st.pts = [];
  render();
}
function finishOrCancel() {
  if (st.tool === 'wire' && st.pts.length) finishWire();
  else if (st.pts.length) st.pts = [];
  else if (st.tool === 'sym' && st.place.lockId != null) { st.place.lockId = null; refreshProps(); updateCursor(); }
  else if (st.tool !== 'select') { setTool('select'); return; }
  else { st.sel = null; refreshProps(); }
  st.input = '';
  updateStatus(); render();
}
function escape() {
  if (st.input) st.input = '';
  else if (st.pts.length) st.pts = [];
  else if (st.tool === 'sym' && st.place.lockId != null) { st.place.lockId = null; refreshProps(); updateCursor(); }
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
  if (e.type === 'wire' && st.vsel != null && e.pts.length > 2 && st.vsel > 0 && st.vsel < e.pts.length - 1) {
    pushUndo(); e.pts.splice(st.vsel, 1); st.vsel = null; changed(); return;   // 中継点だけ消す
  }
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
function startPan(s) { st.pan = { sx: s.x, sy: s.y, ox: view.ox, oy: view.oy }; cv.classList.add('panning'); }
cv.addEventListener('mousemove', ev => {
  const s = screenPos(ev);
  st.mouse = s; st.mouseIn = true;
  if (st.rdown && !st.pan && Math.hypot(s.x - st.rdown.x, s.y - st.rdown.y) > 4) startPan(st.rdown);
  if (st.pan) {
    view.ox = st.pan.ox + s.x - st.pan.sx; view.oy = st.pan.oy + s.y - st.pan.sy;
    render(); return;
  }
  st.raw = toWorld(s.x, s.y); st.shift = ev.shiftKey; st.ctrl = ev.ctrlKey || ev.metaKey;
  updateCursor();
  if (st.drag) dragMove();
  updateStatus(); render();
});
cv.addEventListener('mouseleave', () => { st.mouseIn = false; render(); });
cv.addEventListener('mousedown', ev => {
  cv.focus();
  const s = screenPos(ev);
  if (ev.button === 1 || (ev.button === 0 && st.space)) { startPan(s); ev.preventDefault(); return; }
  if (ev.button === 2) { st.rdown = s; return; }   // 右ドラッグで画面移動、動かさなければ確定・取消
  if (ev.button !== 0) return;
  st.raw = toWorld(s.x, s.y); st.shift = ev.shiftKey; st.ctrl = ev.ctrlKey || ev.metaKey;
  updateCursor();
  if (st.tool === 'select') selectPress(s);
  else if (st.tool === 'erase') erasePress();
  else if (st.tool === 'paper') {
    st.drag = { type: 'paper', start: { ...st.raw }, orig: { x: doc.paper.x, y: doc.paper.y }, before: JSON.stringify(doc), moved: false };
  } else toolClick(st.cur);
});
window.addEventListener('mouseup', ev => {
  if (ev.button === 2 && st.rdown) {
    const panned = !!st.pan;
    st.rdown = null;
    if (panned) { st.pan = null; cv.classList.remove('panning'); } else finishOrCancel();
    return;
  }
  if (st.pan) { st.pan = null; cv.classList.remove('panning'); return; }
  if (st.drag) { const moved = st.drag.moved; st.drag = null; if (moved) changed(); updateCursor(); render(); }
});
cv.addEventListener('dblclick', () => {
  if (st.tool === 'wire') { finishWire(); return; }
  const e = selEnt();
  if (st.tool === 'select' && e && e.type === 'wire' && isEditable(e)) {   // 中継点を追加
    const tol = 8 / view.z;
    if (vertexHit(e, st.raw, tol) != null) return;
    let bi = -1, bd = Infinity, bq = null;
    for (let i = 0; i < e.pts.length - 1; i++) {
      const r = distToSeg(st.raw, e.pts[i], e.pts[i + 1]);
      if (r.d < bd) { bd = r.d; bi = i; bq = r.q; }
    }
    if (bi >= 0 && bd <= tol) {
      const q = st.snap && st.snap.type ? { x: st.cur.x, y: st.cur.y } : bq;
      pushUndo(); e.pts.splice(bi + 1, 0, { x: q.x, y: q.y }); st.vsel = bi + 1; changed();
    }
    return;
  }
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

function selectPress(screen) {
  const tol = 8 / view.z, cur = selEnt();
  if (cur && isEditable(cur)) {
    const vi = vertexHit(cur, st.raw, tol);
    if (vi != null) { st.vsel = vi; st.drag = { type: 'vertex', id: cur.id, vi, before: JSON.stringify(doc), moved: false }; render(); return; }
  }
  const h = hitTest(st.raw, tol);
  st.sel = h ? h.id : null;
  st.vsel = null;
  if (h) {
    const s = snapAt(st.raw, { exclude: h.id });
    st.drag = { type: 'move', id: h.id, start: { x: s.x, y: s.y }, orig: clone(h), before: JSON.stringify(doc), moved: false };
  } else startPan(screen);   // 何もない所をドラッグ → 画面移動
  refreshProps(); render();
}
function erasePress() {
  const h = hitTest(st.raw, 8 / view.z);
  if (!h) return;
  st.sel = h.id; renderNow();
  setTimeout(() => {   // 赤く表示してから確認する
    if (confirm(`この${entName(h)}を削除しますか？`)) {
      pushUndo(); doc.entities = doc.entities.filter(x => x !== h); changed();
    }
    st.sel = null; render();
  }, 30);
}
function entName(e) {
  if (e.type === 'sym') return (SYM[e.kind] || {}).name || '記号';
  return { wall: '壁', line: '線', wire: '配線', dim: '寸法', text: '文字' }[e.type] || '図形';
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
    const def = e.type === 'sym' && SYM[e.kind];
    if (def && def.wall && !st.ctrl) {   // 壁付きの記号は壁に沿って動かす
      const w = nearestWall(st.raw, 20);
      if (w) {
        const A = attachTo(w, st.raw);
        const off = def.unit === 'paper' ? A.d2 + (def.wallOff || 0) * doc.scale : 0;
        const nx = A.q.x + A.n.x * off, ny = A.q.y + A.n.y * off;
        if (!d.moved && Math.abs(nx - e.x) < 1e-6 && Math.abs(ny - e.y) < 1e-6) return;
        markMoved(d);
        e.x = nx; e.y = ny; e.rot = normDeg(deg(A.rot));
        if (def.unit === 'world' && (!def.column || e.fit)) {
          e.d1 = A.d1; e.d2 = A.d2;
          if (def.column && A.d1 + A.d2 > 0) e.w = A.d1 + A.d2;
        }
        st.snap = { x: A.q.x, y: A.q.y, type: A.type };
        return;
      }
    }
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
  if (k === 'Control' || k === 'Meta') { st.ctrl = true; updateCursor(); render(); return; }
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
  const arrows = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
  if (arrows[k]) { const step = ev.shiftKey ? 300 : 80; panBy(arrows[k][0] * step, arrows[k][1] * step); ev.preventDefault(); return; }
  if (/^[0-9.]$/.test(k) && ['line', 'wall', 'wire', 'dim'].includes(st.tool) && basePoint()) {
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
  const map = { v: 'select', k: 'wall', l: 'line', w: 'wire', d: 'dim', t: 'text', p: 'paper', e: 'erase' };
  if (map[lk]) setTool(map[lk]);
});
window.addEventListener('keyup', ev => {
  if (ev.key === ' ') st.space = false;
  if (ev.key === 'Shift') { st.shift = false; updateCursor(); render(); }
  if (ev.key === 'Control' || ev.key === 'Meta') { st.ctrl = false; updateCursor(); render(); }
});
window.addEventListener('blur', () => { st.ctrl = st.shift = st.space = false; });

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
function hintFor() {
  if (st.tool !== 'sym') return HINTS[st.tool] || '';
  const d = SYM[st.place.kind];
  if (!d.wall) return HINTS.symFree + '／Ctrl押下中はスナップ無効';
  if (st.place.lockId != null) return HINTS.symLocked;
  return st.placePick ? HINTS.symPick : HINTS.symFree;
}
function updateStatus() {
  $('#stCoord').textContent = `X ${Math.round(st.cur.x - doc.paper.x)}  Y ${Math.round(st.cur.y - doc.paper.y)}`;
  $('#stSnap').textContent = st.snap && st.snap.type ? `[${SNAP_NAMES[st.snap.type]}]` : '';
  $('#stInput').textContent = st.input ? `長さ入力: ${st.input}` : '';
  $('#stHint').textContent = hintFor();
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
    else if (k === 'checked') n.checked = !!v;
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
  return el('div', { class: 'inline' }, i, dl);
}
function colorRow(e, set) {
  const L = layerOf(e);
  const pick = el('input', { type: 'color', title: '色を選ぶ' });
  pick.value = e.color || (L && L.color) || '#1a1a1a';
  pick.addEventListener('change', () => set('color', pick.value));
  const reset = el('button', { type: 'button', title: 'レイヤーの色に戻す', onclick: ev => { ev.preventDefault(); set('color', undefined); } }, e.color ? 'レイヤー色に戻す' : '（レイヤー色）');
  return row('色', el('div', { class: 'inline' }, pick, reset));
}

function refreshProps() {
  const box = $('#props'), title = $('#propsTitle');
  box.textContent = '';
  if (st.tool === 'sym') {
    const d = SYM[st.place.kind];
    title.textContent = `配置: ${d.name}`;
    if (d.wall) {
      box.append(row('壁を選択', el('input', { type: 'checkbox', checked: st.placePick,
        onchange: ev => { st.placePick = ev.target.checked; st.place.lockId = null; refreshProps(); updateCursor(); updateStatus(); render(); } })));
      if (st.place.lockId != null) {
        box.append(el('div', { class: 'empty' }, '壁を選択中。右クリック・Escで選び直し'));
      }
    }
    if (d.labelPos) box.append(row('傍記', labelBox(st.place.label, d.labels, v => { st.place.label = v; render(); })));
    if (d.wallMark) box.append(row('壁付き', el('input', { type: 'checkbox', checked: st.wallMark, title: '背面を塗って壁付きを表す', onchange: ev => { st.wallMark = ev.target.checked; render(); } })));
    if (d.column) {
      box.append(row('壁厚に合わせる', el('input', { type: 'checkbox', checked: st.colFit, onchange: ev => { st.colFit = ev.target.checked; render(); } })));
      box.append(row('寸法 mm', numBox(st.colSize, v => { st.colSize = v; render(); }, { step: 5, min: 30 })));
    } else if (d.w) box.append(row('幅 mm', numBox(st.place.w, v => { st.place.w = v; render(); }, { step: 10, min: 100 })));
    box.append(el('div', { class: 'empty' }, 'R:90°回転　F:反転　Ctrl押下中:スナップ無効'));
    return;
  }
  const e = selEnt();
  title.textContent = 'プロパティ';
  if (!e) { box.append(el('div', { class: 'empty' }, '図形を選択すると、ここで編集できます')); return; }
  const set = (key, v) => { pushUndo(); if (v === undefined) delete e[key]; else e[key] = v; changed(); };
  const locked = !isEditable(e);
  switch (e.type) {
    case 'wall': {
      title.textContent = '壁';
      box.append(row('左の厚さ', numBox(e.tl || 0, v => set('tl', Math.max(0, v)), { step: 5, min: 0 })));
      box.append(row('右の厚さ', numBox(e.tr || 0, v => set('tr', Math.max(0, v)), { step: 5, min: 0 })));
      const swap = el('button', { type: 'button', onclick: ev => { ev.preventDefault(); pushUndo(); [e.tl, e.tr] = [e.tr, e.tl]; changed(); } }, '左右を入れ替える');
      box.append(row('', swap));
      box.append(row('長さ', el('span', {}, `${Math.round(dist({ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }))} mm（芯々）`)));
      break;
    }
    case 'line':
      title.textContent = '線';
      box.append(row('線種', selectBox(LINE_STYLES, e.style || 'thin', v => set('style', v))));
      box.append(row('長さ', el('span', {}, `${Math.round(dist({ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }))} mm`)));
      break;
    case 'wire':
      title.textContent = '配線';
      box.append(row('種類', selectBox(WIRE_TYPES, e.wtype, v => set('wtype', v))));
      box.append(row('電線本数', numBox(e.count || 2, v => set('count', Math.max(1, Math.round(v))), { min: 1, max: 9, step: 1 })));
      box.append(row('角の丸み', numBox(e.r ?? 4, v => set('r', Math.max(0, v)), { min: 0, step: 1, title: '用紙上の半径 mm。0で角ばる' })));
      box.append(el('div', { class: 'empty' }, '線の上をダブルクリックで中継点を追加、中継点を選んで Delete で削除'));
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
      if (d.wallMark) box.append(row('壁付き', el('input', { type: 'checkbox', checked: !!e.wallMark, onchange: ev => set('wallMark', ev.target.checked || undefined) })));
      if (d.column) {
        box.append(row('幅 mm', numBox(e.w, v => { pushUndo(); e.w = v; e.fit = false; changed(); }, { step: 5, min: 30 })));
        box.append(row('奥行 mm', numBox((e.d1 || 0) + (e.d2 || 0), v => { pushUndo(); e.d1 = e.d2 = v / 2; e.fit = false; changed(); }, { step: 5, min: 30 })));
      } else if (d.w) box.append(row('幅 mm', numBox(e.w || d.w, v => set('w', v), { step: 10, min: 100 })));
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
  box.append(colorRow(e, set));
  if (locked) box.querySelectorAll('input,select,textarea,button').forEach(n => { n.disabled = true; });
}
function refreshLayers() {
  const box = $('#layers');
  box.textContent = '';
  const n = doc.layers.length;
  [...doc.layers].reverse().forEach(L => {   // 上ほど手前に描かれる
    const i = doc.layers.indexOf(L);
    const move = d => { const j = i + d; if (j < 0 || j >= n) return; pushUndo(); [doc.layers[i], doc.layers[j]] = [doc.layers[j], doc.layers[i]]; refreshLayers(); changed(); };
    const up = el('button', { type: 'button', title: '手前へ', disabled: i === n - 1, onclick: () => move(1) }, '▲');
    const down = el('button', { type: 'button', title: '奥へ', disabled: i === 0, onclick: () => move(-1) }, '▼');
    const vis = el('input', { type: 'checkbox', checked: L.visible, title: '表示', onchange: ev => { L.visible = ev.target.checked; changed(); } });
    const col = el('input', { type: 'color', title: 'レイヤーの色' });
    col.value = L.color || '#1a1a1a';
    col.addEventListener('change', () => { pushUndo(); L.color = col.value; changed(); });
    const lock = el('button', { type: 'button', title: 'ロック（編集禁止）', onclick: () => { L.locked = !L.locked; refreshLayers(); changed(); } }, L.locked ? '🔒' : '🔓');
    box.append(el('div', { class: 'layer' }, vis, col, el('span', { class: 'name' }, L.name), up, down, lock));
  });
  box.append(el('div', { class: 'empty' }, '上にあるレイヤーほど手前に描かれます'));
  const sel = $('#drawLayer');
  if (sel) {
    const v = st.drawLayer;
    sel.textContent = '';
    sel.append(el('option', { value: '' }, '自動'), ...doc.layers.map(L => el('option', { value: L.id }, L.name)));
    sel.value = v;
  }
}
function refreshSettings() {
  $('#setTitle').value = doc.meta.title || '';
  $('#setScale').value = String(doc.scale);
  $('#setPaper').value = doc.paper.size;
  $('#setOrient').value = doc.paper.landscape ? '1' : '0';
  $('#setGrid').value = String(doc.grid);
  $('#setSnapDiv').value = String(doc.snapDiv || 2);
  $('#setCenter').value = doc.showCenter ? '1' : '0';
  $('#setPrintColor').value = doc.printColor ? '1' : '0';
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
  on('#setSnapDiv', v => { doc.snapDiv = +v; });
  on('#setCenter', v => { doc.showCenter = v === '1'; });
  on('#setPrintColor', v => { doc.printColor = v === '1'; });
  on('#setDate', v => { doc.meta.date = v; });
  on('#setAuthor', v => { doc.meta.author = v; });
}
function afterDocLoad(doFit) {
  if (st.sel != null && !selEnt()) st.sel = null;
  if (st.place.lockId != null && !byId(st.place.lockId)) st.place.lockId = null;
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
  } else if (d.column) {
    const k = 0.15;
    x.scale(k, k);
    x.strokeStyle = '#222'; x.lineWidth = 1 / k;
    x.beginPath(); x.moveTo(-120, -45); x.lineTo(120, -45); x.moveTo(-120, 45); x.lineTo(120, 45); x.stroke();
    window.drawSymbolShape(x, { kind, w: 90, d1: 45, d2: 45 }, { fg: '#222', bg: '#fff', Lw: w => Math.max(w * 5, 1 / k), P: 5 });
  } else {
    const k = 30 / d.w, t = 0.1 * d.w;
    if (kind === 'door') x.translate(0, -12);
    x.scale(k, k);
    x.strokeStyle = '#222'; x.lineWidth = 1 / k;
    x.beginPath();
    x.moveTo(-d.w * 0.65, -t); x.lineTo(d.w * 0.65, -t); x.moveTo(-d.w * 0.65, t); x.lineTo(d.w * 0.65, t);
    x.stroke();
    window.drawSymbolShape(x, { kind, w: d.w, d1: t, d2: t }, { fg: '#222', bg: '#fff', Lw: w => Math.max(w * 20, 1 / k), P: 20, pad: 1 / k });
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
  $('#drawColor').append(...Object.entries(COLORS).map(([v, t]) => el('option', { value: v, style: v ? `color:${v}` : '' }, (v ? '■ ' : '') + t)));
  $('#lineStyle').addEventListener('change', ev => { st.lineStyle = ev.target.value; setTool('line'); });
  $('#wireType').addEventListener('change', ev => { st.wireType = ev.target.value; setTool('wire'); });
  $('#drawColor').addEventListener('change', ev => { st.color = ev.target.value; ev.target.style.color = st.color || ''; });
  $('#drawLayer').addEventListener('change', ev => { st.drawLayer = ev.target.value; });
  $('#wallL').value = st.wallL; $('#wallR').value = st.wallR;
  $('#wallL').addEventListener('change', ev => { st.wallL = Math.max(0, +ev.target.value || 0); setTool('wall'); });
  $('#wallR').addEventListener('change', ev => { st.wallR = Math.max(0, +ev.target.value || 0); setTool('wall'); });
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
