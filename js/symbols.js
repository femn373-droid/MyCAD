'use strict';
/*
 * 図記号の定義
 *   unit: 'paper' … 用紙上の寸法(mm)で描く。縮尺に関係なく同じ大きさで印刷される（電気記号）
 *         'world' … 実寸(mm)で描く（建具など。w = 開口幅）
 *   wall: true    … 壁線に近づけると壁の向きに合わせて回転・吸着する
 *   wallOff       … 壁に吸着したとき、壁から部屋側へずらす量（用紙mm）
 * 記号のローカル座標： -y 側が壁、+y 側が部屋側
 */
window.SYMBOLS = {
  outlet:  { name: 'コンセント', cat: 'elec', unit: 'paper', wall: true, wallOff: 1.6, hit: 2,
             label: '2', labels: ['', '1', '2', '3', 'E', 'ET', '2E', 'EET', 'WP', '20A', 'EV'],
             labelPos: { x: 0, y: 3.2 }, labelSize: 2 },
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
  tv:      { name: 'テレビ端子', cat: 'elec', unit: 'paper', wall: true, wallOff: 2.1, hit: 2.3,
             label: '', labelPos: { x: 0, y: 3.6 }, labelSize: 2 },
  panel:   { name: '分電盤', cat: 'elec', unit: 'paper', wall: true, wallOff: 1.6, hit: 3.4,
             label: '', labelPos: { x: 0, y: 3.4 }, labelSize: 2 },
  meter:   { name: '電力量計', cat: 'elec', unit: 'paper', wall: true, wallOff: 1.9, hit: 3,
             label: '', labelPos: { x: 0, y: 3.8 }, labelSize: 2 },
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
 * g = { fg, bg, Lw(用紙mm→線幅), P(用紙1mmあたりのローカル単位) }
 */
window.drawSymbolShape = function (c, e, g) {
  const fg = g.fg, bg = g.bg, Lw = g.Lw, P = g.P;
  const circle = r => { c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); };
  const seg = (x1, y1, x2, y2) => { c.moveTo(x1, y1); c.lineTo(x2, y2); };
  const fillBgStroke = lw => { c.fillStyle = bg; c.fill(); c.lineWidth = Lw(lw); c.stroke(); };
  c.strokeStyle = fg;
  c.setLineDash([]);

  switch (e.kind) {
    case 'outlet':
      circle(1.5); fillBgStroke(0.25);
      c.beginPath(); seg(-0.55, -0.85, -0.55, 0.85); seg(0.55, -0.85, 0.55, 0.85); c.stroke();
      break;
    case 'switch':
      circle(0.9); c.fillStyle = fg; c.fill();
      break;
    case 'light':
      circle(2.5); fillBgStroke(0.25);
      break;
    case 'bracket':
      circle(2); c.fillStyle = bg; c.fill();
      c.beginPath(); c.arc(0, 0, 2, Math.PI, Math.PI * 2); c.closePath(); c.fillStyle = fg; c.fill();
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
      c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle';
      window.fillTextSafe(c, 'Wh', 0, 0.1, 1.7, 'bold');
      break;

    case 'door': {
      const w = e.w || 780, m = 0.45 * P;
      c.fillStyle = bg; c.fillRect(-w / 2, -m, w, m * 2);
      c.lineWidth = Lw(0.18); c.beginPath(); seg(-w / 2, -m, -w / 2, m); seg(w / 2, -m, w / 2, m); c.stroke();
      c.lineWidth = Lw(0.3); c.beginPath(); seg(-w / 2, 0, -w / 2, w); c.stroke();
      c.lineWidth = Lw(0.13); c.beginPath(); c.arc(-w / 2, 0, w, 0, Math.PI / 2); c.stroke();
      break;
    }
    case 'slide': {
      const w = e.w || 1640, m = 0.75 * P;
      c.fillStyle = bg; c.fillRect(-w / 2, -m, w, m * 2);
      c.lineWidth = Lw(0.18); c.beginPath(); seg(-w / 2, -m, -w / 2, m); seg(w / 2, -m, w / 2, m); c.stroke();
      c.lineWidth = Lw(0.35); c.beginPath();
      seg(-w / 2, -m * 0.35, w * 0.04, -m * 0.35);
      seg(-w * 0.04, m * 0.35, w / 2, m * 0.35);
      c.stroke();
      break;
    }
    case 'window': {
      const w = e.w || 1640, m = 0.75 * P;
      c.fillStyle = bg; c.fillRect(-w / 2, -m, w, m * 2);
      c.lineWidth = Lw(0.13); c.beginPath();
      seg(-w / 2, -m, w / 2, -m); seg(-w / 2, m, w / 2, m);
      seg(-w / 2, -m, -w / 2, m); seg(w / 2, -m, w / 2, m);
      c.stroke();
      c.lineWidth = Lw(0.25); c.beginPath();
      seg(-w / 2, -m * 0.3, w * 0.04, -m * 0.3);
      seg(-w * 0.04, m * 0.3, w / 2, m * 0.3);
      c.stroke();
      break;
    }
  }
};
