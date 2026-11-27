'use strict';
/*
 * 図記号の定義
 *   unit: 'paper' … 用紙上の寸法(mm)で描く。縮尺に関係なく同じ大きさで印刷される（電気記号）
 *         'world' … 実寸(mm)で描く（建具など。w = 開口幅）
 *   wall: true    … 壁線に近づけると壁の向きに合わせて回転・吸着する
 *   wallOff       … 壁に吸着したとき、壁から部屋側へずらす量（用紙mm）
 *   wallMark      … 「壁付き」の印（背面の塗り）を付けられる記号の半径
 * 記号のローカル座標： -y 側が壁、+y 側が部屋側
 */
window.SYMBOLS = {
  outlet:  { name: 'コンセント', cat: 'elec', unit: 'paper', wall: true, wallOff: 2.1, hit: 2.4, wallMark: 2,
             label: '2', labels: ['', '1', '2', '3', 'E', 'ET', '2E', 'EET', 'WP', '20A', 'EV'],
             labelPos: { x: 0, y: 3.8 }, labelSize: 2 },
  switch:  { name: 'スイッチ', cat: 'elec', unit: 'paper', wall: true, wallOff: 1.2, hit: 1.6,
             label: '', labels: ['', '2', '3', '4', 'H', 'L', 'P', 'D', 'A', 'R'],
             labelPos: { x: 0, y: 2.4 }, labelSize: 2 },
  light:   { name: '照明', cat: 'elec', unit: 'paper', hit: 2.8,
             label: 'CL', labels: ['', 'CL', 'DL', 'CH', 'P', 'R', 'N', 'WP'],
             labelPos: { x: 0, y: 0 }, labelSize: 1.7 },
  bracket: { name: 'ブラケット', cat: 'elec', unit: 'paper', wall: true, wallOff: 2, hit: 2.3,
             label: '', labelPos: { x: 0, y: 3.4 }, labelSize: 2 },
  fan:     { name: '換気扇', cat: 'elec', unit: 'paper', hit: 2.8,
             label: '', labelPos: { x: 0, y: 3.6 }, labelSize: 2 },
  tv:      { name: 'テレビ端子', cat: 'elec', unit: 'paper', wall: true, wallOff: 2.1, hit: 2.4, wallMark: 2,
             label: '', labelPos: { x: 0, y: 3.6 }, labelSize: 2 },
  panel:   { name: '分電盤', cat: 'elec', unit: 'paper', wall: true, wallOff: 1.6, hit: 3.4,
             label: '', labelPos: { x: 0, y: 3.4 }, labelSize: 2 },
  meter:   { name: '電力量計', cat: 'elec', unit: 'paper', wall: true, wallOff: 1.9, hit: 3,
             label: '', labelPos: { x: 0, y: 3.8 }, labelSize: 2 },
  column:  { name: '柱', cat: 'arch', unit: 'world', wall: true, w: 120, column: true },
  door:    { name: '片開き戸', cat: 'arch', unit: 'world', wall: true, w: 780 },
  slide:   { name: '引違い戸', cat: 'arch', unit: 'world', wall: true, w: 1640 },
  window:  { name: '引違い窓', cat: 'arch', unit: 'world', wall: true, w: 1640 },
};

/* 小さい文字でもにじまないよう、100px で描いてから縮小する */
window.fillTextSafe = function (c, text, x, y, size, weight) {
  if (!(size > 0)) return;
  c.save();
  c.translate(x, y);
  const k = size / 100;
  c.scale(k, k);
  c.font = `${weight || ''} 100px "Hiragino Sans","Yu Gothic UI","Meiryo",sans-serif`;
  c.fillText(text, 0, 0);
  c.restore();
};

/*
 * 記号の形を描く。呼び出し側で translate / rotate / (flip) / (paper なら scale) 済み。
 * g = { fg, bg, Lw(用紙mm→線幅), P(用紙1mmあたりのローカル単位), pad(壁線を隠す余白) }
 * 建具・柱の d1 / d2 は壁芯から -y 側 / +y 側（部屋側）の壁厚
 */
window.drawSymbolShape = function (c, e, g) {
  const fg = g.fg, bg = g.bg, Lw = g.Lw, P = g.P;
  const circle = r => { c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); };
  const seg = (x1, y1, x2, y2) => { c.moveTo(x1, y1); c.lineTo(x2, y2); };
  const fillBgStroke = lw => { c.fillStyle = bg; c.fill(); c.lineWidth = Lw(lw); c.stroke(); };
  // 壁側（-y）を、直径の 1/4 の深さまで塗る
  const backFill = r => {
    c.beginPath(); c.arc(0, 0, r, Math.PI * 7 / 6, Math.PI * 11 / 6); c.closePath();
    c.fillStyle = fg; c.fill();
  };
  c.strokeStyle = fg;
  c.setLineDash([]);

  switch (e.kind) {
    case 'outlet':
      circle(2); fillBgStroke(0.25);
      c.beginPath(); seg(-0.7, -1.1, -0.7, 1.1); seg(0.7, -1.1, 0.7, 1.1); c.stroke();
      break;
    case 'switch':
      circle(0.9); c.fillStyle = fg; c.fill();
      break;
    case 'light':
      circle(2.5); fillBgStroke(0.25);
      break;
    case 'bracket':
      circle(2); c.fillStyle = bg; c.fill();
      backFill(2);
      circle(2); c.lineWidth = Lw(0.25); c.stroke();
      break;
    case 'fan':
      circle(2.5); fillBgStroke(0.25);
      c.beginPath();
      c.ellipse(-0.85, 0, 0.85, 0.5, 0, 0, Math.PI * 2);
      c.moveTo(1.7, 0);
      c.ellipse(0.85, 0, 0.85, 0.5, 0, 0, Math.PI * 2);
      c.lineWidth = Lw(0.2); c.stroke();
      break;
    case 'tv':
      circle(2); fillBgStroke(0.25);
      circle(1); c.stroke();
      break;
    case 'panel':
      c.beginPath(); c.rect(-3, -1.5, 6, 3); fillBgStroke(0.3);
      c.beginPath(); c.moveTo(-3, 1.5); c.lineTo(3, -1.5); c.lineTo(3, 1.5); c.closePath();
      c.fillStyle = fg; c.fill();
      break;
    case 'meter':
      c.beginPath(); c.rect(-2.5, -1.75, 5, 3.5); fillBgStroke(0.3);
      // 文字は逆さまにならないようにする（横向きはそのまま）
      c.save();
      if (e.flip) c.scale(-1, 1);
      { const r = (((e.rot || 0) % 360) + 360) % 360; if (r > 90 + 1e-6 && r < 270 - 1e-6) c.rotate(Math.PI); }
      c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle';
      window.fillTextSafe(c, 'Wh', 0, 0.1, 1.7, 'bold');
      c.restore();
      break;

    case 'door': {
      const w = e.w || 780, d1 = e.d1 ?? 0.45 * P, d2 = e.d2 ?? 0.45 * P, pad = g.pad || 0;
      c.fillStyle = bg; c.fillRect(-w / 2, -d1 - pad, w, d1 + d2 + pad * 2);
      c.lineWidth = Lw(0.18); c.beginPath(); seg(-w / 2, -d1, -w / 2, d2); seg(w / 2, -d1, w / 2, d2); c.stroke();
      c.lineWidth = Lw(0.3); c.beginPath(); seg(-w / 2, d2, -w / 2, d2 + w); c.stroke();
      c.lineWidth = Lw(0.13); c.beginPath(); c.arc(-w / 2, d2, w, 0, Math.PI / 2); c.stroke();
      break;
    }
    case 'slide': {
      const w = e.w || 1640, d1 = e.d1 ?? 0.75 * P, d2 = e.d2 ?? 0.75 * P, pad = g.pad || 0;
      const mid = (d2 - d1) / 2, h = Math.max(d1 + d2, 0.6 * P);
      c.fillStyle = bg; c.fillRect(-w / 2, -d1 - pad, w, d1 + d2 + pad * 2);
      c.lineWidth = Lw(0.18); c.beginPath(); seg(-w / 2, -d1, -w / 2, d2); seg(w / 2, -d1, w / 2, d2); c.stroke();
      c.lineWidth = Lw(0.35); c.beginPath();
      seg(-w / 2, mid - h * 0.15, w * 0.04, mid - h * 0.15);
      seg(-w * 0.04, mid + h * 0.15, w / 2, mid + h * 0.15);
      c.stroke();
      break;
    }
    case 'window': {
      const w = e.w || 1640, d1 = e.d1 ?? 0.75 * P, d2 = e.d2 ?? 0.75 * P, pad = g.pad || 0;
      const mid = (d2 - d1) / 2, h = Math.max(d1 + d2, 0.6 * P);
      c.fillStyle = bg; c.fillRect(-w / 2, -d1 - pad, w, d1 + d2 + pad * 2);
      c.lineWidth = Lw(0.13); c.beginPath();
      seg(-w / 2, -d1, w / 2, -d1); seg(-w / 2, d2, w / 2, d2);
      seg(-w / 2, -d1, -w / 2, d2); seg(w / 2, -d1, w / 2, d2);
      c.stroke();
      c.lineWidth = Lw(0.25); c.beginPath();
      seg(-w / 2, mid - h * 0.12, w * 0.04, mid - h * 0.12);
      seg(-w * 0.04, mid + h * 0.12, w / 2, mid + h * 0.12);
      c.stroke();
      break;
    }
    case 'column': {
      const w = e.w || 120, d1 = e.d1 ?? w / 2, d2 = e.d2 ?? w / 2;
      c.fillStyle = bg; c.fillRect(-w / 2, -d1, w, d1 + d2);
      c.lineWidth = Lw(0.3); c.beginPath(); c.rect(-w / 2, -d1, w, d1 + d2); c.stroke();
      c.lineWidth = Lw(0.13); c.beginPath(); seg(-w / 2, -d1, w / 2, d2); seg(w / 2, -d1, -w / 2, d2); c.stroke();
      break;
    }
  }
  // 壁付きの印
  const def = window.SYMBOLS[e.kind];
  if (def && def.wallMark && e.wallMark) {
    backFill(def.wallMark);
    circle(def.wallMark); c.lineWidth = Lw(0.25); c.stroke();
  }
};
