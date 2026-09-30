// Pixel-art tavern background: a 320x180 scene drawn once into an albedo buffer,
// then re-lit every frame by a flickering hearth and candles with ordered dithering.
(() => {
  const W = 320, H = 180, FPS = 12;
  const canvas = document.createElement('canvas');
  canvas.id = 'tavern-bg'; canvas.width = W; canvas.height = H;
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const out = img.data;

  // ---------------------------------------------------------------- helpers
  const hash = (a, b) => {
    let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const hex = s => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
  const R = new Uint8ClampedArray(W * H), G = new Uint8ClampedArray(W * H), B = new Uint8ClampedArray(W * H);
  const EM = new Uint8Array(W * H); // 0 lit, 1 emissive (unlit), 2 hearth opening (fire shows here)

  function px(x, y, c, f = 1, em = 0) {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = y * W + x;
    R[i] = c[0] * f; G[i] = c[1] * f; B[i] = c[2] * f; EM[i] = em;
  }
  function rect(x, y, w, h, c, f = 1) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) px(i, j, c, f); }
  // Planks/beams with grain running along `dir` ('h' or 'v'), lit top/left edge, shadowed bottom/right.
  function wood(x, y, w, h, base, dir = 'h') {
    const c = hex(base);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const along = dir === 'h' ? i : j, across = dir === 'h' ? j + y : i + x;
      let f = .82 + hash(across, ((along + across * 7) / 6) | 0) * .24 + (hash(x + i, y + j) - .5) * .08;
      if (dir === 'h') { if (j === 0) f *= 1.2; if (j === h - 1) f *= .65; }
      else { if (i === 0) f *= 1.2; if (i === w - 1) f *= .65; }
      px(x + i, y + j, c, f);
    }
  }
  function stoneWall(x0, y0, x1, y1, bw, bh, palette, mortarHex, salt) {
    const cols = palette.map(hex), mortar = hex(mortarHex);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const yy = y - y0, row = (yy / bh) | 0, off = row % 2 ? bw >> 1 : 0;
      const xx = x - x0 + off, bx = (xx / bw) | 0, my = yy % bh, mx = xx % bw;
      if (my === 0 || mx === 0) { px(x, y, mortar, .8 + hash(x, y) * .4); continue; }
      const c = cols[(hash(bx + salt, row + 50) * cols.length) | 0];
      let f = .88 + hash(x, y) * .2;
      if (my === 1 || mx === 1) f *= 1.15;
      if (my === bh - 1 || mx === bw - 1) f *= .82;
      px(x, y, c, f);
    }
  }
  const ellipseIn = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

  // ---------------------------------------------------------------- back wall, beams, floor
  stoneWall(0, 10, W, 120, 16, 9, ['#3b332c', '#453b32', '#4f443a', '#383029', '#554a3f'], '#1c1714', 0);
  wood(0, 0, W, 10, '#4a2f1a');
  for (const x of [0, 96, 216, 312]) wood(x, 10, 8, 110, '#43291a', 'v');
  // dried herbs hanging from the beam
  for (let k = 0; k < 7; k++) {
    const hx = 232 + k * 11, len = 3 + ((hash(k, 3) * 4) | 0);
    for (let j = 10; j < 10 + len; j++) px(hx, j, hex('#8a7a5a'));
    const herb = hex(k % 3 ? '#4f6a2e' : '#6b5a2a');
    for (let j = 0; j < 7; j++) for (let i = -2; i <= 2; i++)
      if (Math.abs(i) <= 1 + (j > 2) - (j > 5) && hash(hx + i, j) > .2) px(hx + i, 10 + len + j, herb, .75 + hash(i, j + k) * .5);
  }
  // floor planks: rows grow taller toward the viewer for a hint of depth
  const floorCols = ['#3e281a', '#46301f', '#362316'].map(hex), seamC = hex('#1a100a');
  for (let y = 120, hgt = 5, row = 0; y < H; y += hgt, hgt++, row++) {
    const span = 110 + row * 30, off = (hash(row, 7) * span) | 0;
    for (let j = 0; j < hgt && y + j < H; j++) for (let x = 0; x < W; x++) {
      const bx = ((x + off) / span) | 0;
      if (j === 0 || (x + off) % span === 0) { px(x, y + j, seamC); continue; }
      const c = floorCols[(hash(bx, row) * 3) | 0];
      px(x, y + j, c, .85 + hash(y + j, ((x + bx * 5) / 5) | 0) * .2 + (hash(x, y + j) - .5) * .06);
    }
  }
  for (let x = 0; x < W; x++) px(x, 120, hex('#120b07')); // baseboard shadow

  // rug in front of the hearth
  for (let y = 124; y < 146; y++) for (let x = 110; x < 210; x++) {
    const dx = (x - 160) / 46, dy = (y - 134) / 9.5, d = dx * dx + dy * dy;
    if (d >= 1) continue;
    if (d > .72) px(x, y, hex((x + y) % 4 < 2 ? '#a8842e' : '#6e4f1a'));
    else if (d > .62) px(x, y, hex('#3a0e0c'));
    else px(x, y, hex((Math.abs(x - 160) + Math.abs(y - 134) * 3) % 10 < 2 ? '#8e3a22' : '#6b1e1a'), .9 + hash(x, y) * .15);
  }

  // ---------------------------------------------------------------- window with moonlit sky
  const winIn = (x, y) => x >= 30 && x <= 61 && y >= 28 && y <= 75 && (y >= 44 || ellipseIn(x, y, 45.5, 44, 16, 16));
  for (let y = 24; y < 80; y++) for (let x = 26; x < 66; x++) {
    if (winIn(x, y)) {
      const t = (y - 28) / 48;
      let c = [10 + t * 22, 15 + t * 28, 42 + t * 44];
      if (hash(x, y + 91) < .025) c = hex('#c8d0ff');
      if (ellipseIn(x, y, 53, 39, 5, 5)) c = hex(hash(x, y) < .2 ? '#c9c4a6' : '#e8e4c8');
      if (y > 66 - 3 * Math.sin(x * .35) - 2 * Math.sin(x * .9)) { px(x, y, hex('#0a0c16')); continue; }
      px(x, y, c, 1, 1);
    } else if (winIn(x, y + 2) || winIn(x - 2, y) || winIn(x + 2, y)) px(x, y, hex('#3a2414'), .9 + hash(x, y) * .2);
  }
  rect(45, 28, 2, 48, hex('#3a2414')); rect(30, 55, 32, 2, hex('#3a2414'));
  wood(24, 76, 44, 4, '#5a3a20');

  // heraldic shield on the wall
  for (let y = 38; y < 66; y++) for (let x = 68; x < 92; x++) {
    const u = (x - 79.5) / 12, v = (y - 38) / 28;
    const halfW = v < .5 ? 1 : Math.sqrt(Math.max(0, 1 - ((v - .5) / .5) ** 2));
    if (Math.abs(u) > halfW) continue;
    const edge = Math.abs(u) > halfW - .16 || y < 40;
    const cross = Math.abs(x - 79.5) < 2 || (y >= 47 && y <= 50);
    px(x, y, hex(edge ? '#b8923a' : cross ? '#d8c9a0' : '#4a1a5a'), .88 + hash(x, y) * .18);
  }

  // ---------------------------------------------------------------- fireplace
  stoneWall(128, 10, 192, 66, 8, 6, ['#5b534b', '#645b52', '#6e645a', '#554d45'], '#2a2420', 11);
  stoneWall(122, 72, 198, 118, 8, 6, ['#5b534b', '#645b52', '#6e645a', '#554d45'], '#2a2420', 23);
  const openIn = (x, y) => x >= 136 && x <= 183 && y >= 80 && y <= 117 && (y >= 92 || ellipseIn(x, y, 159.5, 92, 24, 12));
  for (let y = 74; y < 118; y++) for (let x = 130; x < 190; x++) {
    if (openIn(x, y)) px(x, y, hex('#140d0a'), .7 + ((y - 80) / 37) * .5 + hash(x, y) * .15, 2);
    else if (openIn(x, y + 4) || openIn(x - 3, y) || openIn(x + 3, y)) {
      // voussoir ring around the arch
      const a = Math.atan2(y - 100, x - 159.5), seam = ((a * 12) % 1 + 1) % 1 < .12;
      px(x, y, hex(seam ? '#3a322c' : '#7a6e62'), .9 + hash(x, y) * .2);
    }
  }
  wood(116, 64, 88, 8, '#5a3a20');
  // mantel clutter: jug, tankards, a skull
  for (let y = 55; y < 64; y++) for (let x = 128; x < 137; x++) if (ellipseIn(x, y, 132, 60, 4, 4) || (x >= 131 && x <= 133 && y < 58)) px(x, y, hex('#8a5a3a'), x < 131 ? 1.2 : .9);
  for (const tx of [178, 185]) { rect(tx, 57, 5, 7, hex('#7a7a80'), .9); rect(tx, 57, 1, 7, hex('#a8a8b0')); rect(tx + 5, 59, 1, 3, hex('#5a5a60')); }
  for (let y = 55; y < 64; y++) for (let x = 150; x < 160; x++) {
    if (!ellipseIn(x, y, 154.5, 59, 4.5, 4.5) && !(y > 61 && x > 151 && x < 158)) continue;
    const eye = y === 59 && (x === 152 || x === 157);
    px(x, y, hex(eye ? '#1a1410' : '#d8d0b8'), x < 153 ? 1.1 : .9);
  }
  // logs and embers
  for (let y = 108; y < 117; y++) for (let x = 142; x < 178; x++) {
    const low = y >= 112 && y <= 116, high = y >= 108 && y <= 111 && x >= 147 && x <= 172;
    if (!low && !high) continue;
    const endcap = (low && (x < 144 || x > 175)) || (high && (x < 149 || x > 170));
    px(x, y, hex(endcap ? '#a0764a' : '#3d2615'), .85 + hash(x, y >> 1) * .3);
  }
  for (let x = 138; x < 182; x++) if (hash(x, 5) < .6) px(x, 117, hex(hash(x, 6) < .5 ? '#ff7a1a' : '#b3300e'), 1, 1);
  wood(116, 118, 88, 5, '#6a6058');

  // wall sconces
  for (const sx of [112, 208]) { rect(sx - 2, 60, 5, 2, hex('#2a2a2e')); rect(sx, 62, 1, 3, hex('#2a2a2e')); rect(sx - 1, 55, 3, 5, hex('#e6dcc0')); }

  // ---------------------------------------------------------------- shelves, bottles, barrels
  function bottle(x, base, h, col, round) {
    const c = hex(col);
    for (let y = base - h; y <= base; y++) for (let i = 0; i < 5; i++) {
      const body = y > base - h + 3;
      if (!body && (i === 0 || i === 4)) continue;
      if (round && body && !ellipseIn(x + i, y, x + 2, base - (h - 3) / 2, 3, (h - 3) / 2 + .5)) continue;
      px(x + i, y, !body && y === base - h ? hex('#8a6a40') : c, i === 1 ? 1.5 : i === 4 ? .7 : 1);
    }
  }
  for (const sy of [52, 80]) {
    wood(226, sy, 84, 4, '#5a3a20');
    for (const bx of [232, 300]) for (let j = 0; j < 5; j++) rect(bx, sy + 4 + j, 5 - j, 1, hex('#3d2615'));
  }
  bottle(232, 51, 10, '#2e6a3a'); bottle(239, 51, 12, '#6a3a1a'); bottle(246, 51, 8, '#2a3e7a');
  rect(254, 45, 8, 7, hex('#c8b890')); rect(254, 44, 8, 1, hex('#6a4a2a')); rect(255, 45, 1, 7, hex('#e8dcb8'));
  for (const mx of [266, 274]) { rect(mx, 46, 5, 6, hex('#6e4724')); rect(mx + 5, 47, 1, 3, hex('#54351c')); rect(mx, 47, 5, 1, hex('#3a3a40')); }
  bottle(284, 51, 9, '#8a1a2a', true);
  const books = ['#6b1e1a', '#2a4a2a', '#2a2e5a', '#6a5a2a'];
  books.forEach((b, k) => rect(293 + k * 3, 42 + (k % 2), 3, 10 - (k % 2), hex(b), .9 + (k % 2) * .15));
  for (let y = 73; y < 80; y++) for (let x = 230; x < 246; x++) if (ellipseIn(x, y, 237.5, 77, 7.5, 3.5) || (y >= 76 && y < 80)) px(x, y, hex(y < 76 ? '#e8c860' : '#c8a040'), .9 + hash(x, y) * .2);
  for (const pxx of [258, 270]) for (let y = 68; y < 80; y++) for (let x = pxx; x < pxx + 11; x++) if (ellipseIn(x, y, pxx + 5, 74, 5.5, 5.5)) px(x, y, hex(ellipseIn(x, y, pxx + 5, 74, 3, 3) ? '#8a8a90' : '#a8a8b0'));
  bottle(286, 79, 11, '#5a4a1a'); bottle(294, 79, 8, '#2e6a3a', true);

  function barrel(x0, y0, w, h) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      const u = ((x - x0) / (w - 1)) * 2 - 1, v = (y - y0) / (h - 1);
      const inset = Math.abs(v - .5) > .42 ? 1 : 0;
      if (x < x0 + inset || x > x0 + w - 1 - inset) continue;
      const shade = 1.1 - u * u * .6;
      const hoop = [2, 3, (h / 2) | 0, h - 4, h - 3].includes(y - y0);
      const stave = (x - x0) % 4 === 0;
      px(x, y, hex(hoop ? '#4a4a50' : stave ? '#2e1c10' : '#6a4424'), shade * (.9 + hash(x, y) * .15));
    }
    for (let x = x0 + 1; x < x0 + w - 1; x++) px(x, y0, hex('#2a1a0e'));
  }
  barrel(254, 96, 26, 30); barrel(283, 96, 26, 30);

  // ---------------------------------------------------------------- foreground tables
  wood(8, 139, 116, 7, '#8a5c2e'); wood(8, 146, 116, 4, '#4a2e18');
  wood(18, 150, 7, 30, '#54351c', 'v'); wood(107, 150, 7, 30, '#54351c', 'v');
  // tankard with foam
  rect(34, 131, 8, 9, hex('#6e4724')); rect(34, 131, 2, 9, hex('#8a5c2e'));
  rect(34, 133, 8, 1, hex('#5a5a60')); rect(34, 137, 8, 1, hex('#5a5a60'));
  rect(42, 133, 2, 1, hex('#54351c')); rect(43, 133, 1, 5, hex('#54351c')); rect(42, 137, 2, 1, hex('#54351c'));
  rect(33, 129, 10, 2, hex('#e8e0c8')); px(35, 128, hex('#e8e0c8'));
  // bread and plate
  for (let y = 134; y < 141; y++) for (let x = 54; x < 76; x++) {
    if (ellipseIn(x, y, 64.5, 138.5, 10.5, 2.5)) px(x, y, hex('#9a9aa0'), .9 + (y < 138) * .15);
    if (ellipseIn(x, y, 63, 135.5, 6, 3) && y < 138) px(x, y, hex('#b0783a'), y < 135 ? 1.2 : .95);
  }
  // candle holder
  rect(87, 138, 9, 2, hex('#5a5a60')); rect(90, 129, 3, 9, hex('#e6dcc0')); rect(90, 129, 1, 9, hex('#fff4dc'));

  wood(200, 145, 120, 7, '#8a5c2e'); wood(200, 152, 120, 4, '#4a2e18');
  wood(210, 156, 7, 24, '#54351c', 'v'); wood(302, 156, 7, 24, '#54351c', 'v');
  // unrolled map with a route marked in red
  for (let y = 142; y < 147; y++) for (let x = 214; x < 258; x++) {
    const left = 214 + (146 - y);
    if (x < left || x > left + 38) continue;
    let c = hex('#d8c49a');
    if ((x * 3 + y * 7) % 23 === 0 || (y === 144 && x > left + 8 && x < left + 26 && x % 3)) c = hex('#8a1f1a');
    px(x, y, c, .9 + hash(x, y) * .15);
  }
  rect(214, 146, 3, 1, hex('#b8a47a')); rect(250, 142, 3, 1, hex('#b8a47a'));
  // d20 in the site's accent color, and a d6
  const d20 = ['..###..', '.#####.', '##$$$##', '#$$$$$#', '##$$$##', '.#####.', '..###..'];
  d20.forEach((row, j) => [...row].forEach((ch, i) => { if (ch !== '.') px(268 + i, 138 + j, hex(ch === '$' ? '#f0c060' : '#b07a24')); }));
  rect(281, 140, 6, 6, hex('#e8e0c8')); rect(281, 145, 6, 1, hex('#a8a090')); rect(286, 140, 1, 6, hex('#a8a090'));
  for (const [dx, dy] of [[1, 1], [3, 3], [1, 3], [3, 1]]) px(281 + dx, 140 + dy, hex('#2a1a0e'));
  rect(296, 144, 7, 2, hex('#5a5a60')); rect(298, 135, 3, 9, hex('#e6dcc0')); rect(298, 135, 1, 9, hex('#fff4dc'));

  // ---------------------------------------------------------------- lighting
  const lights = [
    { x: 160, y: 100, r: 200, s: 1.15, c: [1, .62, .32], pow: 1.5 },
    { x: 112, y: 52, r: 60, s: .5, c: [1, .75, .45], pow: 2 },
    { x: 208, y: 52, r: 60, s: .5, c: [1, .75, .45], pow: 2 },
    { x: 91, y: 125, r: 55, s: .6, c: [1, .72, .42], pow: 2 },
    { x: 299, y: 131, r: 55, s: .6, c: [1, .72, .42], pow: 2 },
    { x: 46, y: 54, r: 48, s: .28, c: [.45, .55, .95], pow: 2 },
  ];
  for (const L of lights) {
    L.map = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - L.x, (y - L.y) * 1.15);
      L.map[y * W + x] = Math.max(0, 1 - d / L.r) ** L.pow * L.s;
    }
    L.flick = 1;
  }
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + .5) / 16);
  const LEVELS = 7, AMB = [.1, .09, .12];

  // ---------------------------------------------------------------- fire (doom-style)
  const FX = 138, FY = 80, FW = 44, FH = 38, FMAX = 36;
  const fire = new Uint8Array(FW * FH);
  const fireKeys = [[0, [7, 7, 7]], [6, [80, 16, 8]], [12, [170, 40, 10]], [20, [230, 100, 20]], [28, [250, 170, 50]], [33, [255, 230, 130]], [36, [255, 255, 220]]];
  const firePal = [];
  for (let v = 0; v <= FMAX; v++) {
    let k = 0; while (fireKeys[k + 1][0] < v) k++;
    const [v0, c0] = fireKeys[k], [v1, c1] = fireKeys[Math.min(k + 1, fireKeys.length - 1)];
    const t = v1 === v0 ? 0 : (v - v0) / (v1 - v0);
    firePal.push(c0.map((c, i) => c + (c1[i] - c) * t));
  }
  function stepFire() {
    for (let x = 0; x < FW; x++) {
      const u = (x - (FW - 1) / 2) / (FW / 2), bell = Math.max(0, 1 - u * u * 1.25);
      fire[(FH - 1) * FW + x] = Math.min(FMAX, FMAX * bell * (.75 + Math.random() * .35)) | 0;
    }
    for (let y = 1; y < FH; y++) for (let x = 0; x < FW; x++) {
      const v = fire[y * FW + x], r = (Math.random() * 3) | 0;
      const decay = Math.random() < .3 ? 2 : Math.random() < .5 ? 1 : 0;
      fire[(y - 1) * FW + Math.min(FW - 1, Math.max(0, x - r + 1))] = Math.max(0, v - decay);
    }
  }

  const smallFlame = [[0, 0, '#ff9a2a'], [0, 1, '#ffd060'], [-1, 2, '#ff9a2a'], [0, 2, '#fff4c0'], [1, 2, '#ff9a2a'], [0, 3, '#ffd060']].map(([dx, dy, c]) => [dx, dy, hex(c)]);
  const candleFlames = [[112, 51], [208, 51], [91, 125], [299, 131]];

  // ---------------------------------------------------------------- frame
  function frame() {
    stepFire();
    let heat = 0;
    for (let i = FW * 20; i < FW * 32; i++) heat += fire[i];
    lights[0].flick = .75 + (heat / (FW * 12 * FMAX)) * .9;
    for (let k = 1; k < lights.length - 1; k++) lights[k].flick = lights[k].flick * .6 + (.85 + Math.random() * .25) * .4;

    for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) {
      const o = i * 4;
      if (EM[i] === 1) { out[o] = R[i]; out[o + 1] = G[i]; out[o + 2] = B[i]; out[o + 3] = 255; continue; }
      if (EM[i] === 2) {
        const fx = x - FX, fy = y - FY;
        const v = fx >= 0 && fx < FW && fy >= 0 && fy < FH ? fire[fy * FW + fx] : 0;
        if (v > 3) { const c = firePal[v]; out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255; continue; }
      }
      let lr = AMB[0], lg = AMB[1], lb = AMB[2];
      for (const L of lights) { const m = L.map[i] * L.flick; lr += m * L.c[0]; lg += m * L.c[1]; lb += m * L.c[2]; }
      const t = bayer[((y & 3) << 2) | (x & 3)];
      out[o] = R[i] * (Math.floor(Math.min(lr, 1.6) * LEVELS + t) / LEVELS) * 1.3;
      out[o + 1] = G[i] * (Math.floor(Math.min(lg, 1.6) * LEVELS + t) / LEVELS) * 1.3;
      out[o + 2] = B[i] * (Math.floor(Math.min(lb, 1.6) * LEVELS + t) / LEVELS) * 1.3;
      out[o + 3] = 255;
    }
    for (const [cx, cy] of candleFlames) {
      const sway = Math.random() < .25 ? (Math.random() < .5 ? -1 : 1) : 0;
      for (const [dx, dy, col] of smallFlame) {
        const c = col, o = ((cy + dy) * W + cx + dx + (dy < 2 ? sway : 0)) * 4;
        out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2];
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  for (let k = 0; k < 40; k++) stepFire(); // let the fire catch before the first paint
  frame();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let last = 0;
  (function loop(now) {
    requestAnimationFrame(loop);
    if (now - last < 1000 / FPS) return;
    last = now; frame();
  })(0);
})();
