/* case-geom.js — iPhone 12 Pro ケースの形（manifold-3d）と、Symbea flower の刻印
 *
 *   外殻（断面を重ねて hull）− 空洞（本体 + 隙間、ふちの下面は 45°）− ふちの開口 − 側面・下部の開口 − カメラ穴 − 刻印
 *
 * 座標（STL）：単位 mm、z が上、z = 0 がベッド面（ケースの背面の外側）。
 *   x = X − W/2、y = H/2 − Y（X, Y は「正面から見て、左端・上端からの距離」。Apple の寸法図と同じ）
 *   上（+z）から見ると、正面から見た iPhone と同じ向き。背面（ベッド面）から見ると左右が反転する。
 * ブラウザ（module Worker）と Node の両方で使う。manifold の初期化済みモジュールを引数で受け取る。
 * 依存: CoasterPipeline（js/pipeline.js）、SymbeaCore（case/js/symbea-core.js）
 */
(function (root) {
"use strict";

// ───────── iPhone 12 Pro の寸法（Apple「iPhone 12 Pro Dimensional Drawings」2020-10-16） ─────────
const PHONE = {
  W: 71.52, H: 146.71, T: 7.39,
  // 平面の角（Detail A）：角の外接長方形の頂点から見た点列。(14.64, 0) は上の辺の上、(0, 14.64) は横の辺の上
  corner: [[14.64, 0], [10.59, 0.13], [6.66, 1.07], [3.31, 3.31], [1.07, 6.66], [0.13, 10.59], [0, 14.64]],
  edgeIn: 0.85, edgeH: 1.1,               // 表裏の縁の丸み（Detail B）：側面から 0.85 内側・表面から 1.1 の範囲
  // カメラ台座（背面図で、カメラ側の長辺・上端からの距離）。正面から見ると右上
  camera: { x0: 2.12, x1: 35.44, y0: 2.12, y1: 37.62, r: 7, bump: 0.94, lens: 1.72 },
  buttons: { mute: [25.99, 2.85], volUp: [39.31, 5.65], volDown: [53.31, 5.65], sim: [111.88, 8.02], side: [46.31, 8.90] },
  btnFromFront: 3.69,
};

const DEFAULTS = {
  clr: 0.20,          // 本体との隙間
  wall: 1.4,          // 側壁の厚み
  back: 2.7,          // 背面板の厚み（背面ガラスから外側まで）
  lip: 0.8,           // 前面のふちの巻き込み（側面から内側へ）
  lipTop: 0.8,        // ふちの先端の厚み（45° の下面の先から、ふちの上面まで）
  topRound: 0.8,      // 外周の上の角の丸み
  bedChamfer: 0.5,    // ベッド面の外周の面取り（45°）。エレファントフット対策
  openR: 1.5,         // 開口の角の丸み（R ≥ 1.5）
  leftOpen: true, leftFrom: 21.1, leftTo: 61.0,     // 消音・音量側（正面から左）
  rightOpen: true, rightFrom: 35.4, rightTo: 57.2,  // 電源側（正面から右）
  sideFloor: 1.2,     // 側面の開口の底（背面ガラスの面から）
  bottom: "wall",     // 下部："wall" 壁あり（角も含む）/ "corners" 角だけ残す / "open" 全開放
  bottomFrom: 13.3, bottomTo: 58.3,                 // "corners" のときの開口（正面から見て左端から）
  bottomFloor: 0.3,   // 下部の開口の底（背面ガラスの面から）
  openDepth: 18,      // "open" のとき、下端から何 mm まで壁をなくすか
  camClr: 0.5,        // カメラ穴：台座の外形 + この隙間
  camChamfer: 1.0,    // カメラ穴の外側の縁の面取り（45°）
  crop: 0,            // 0 = 全体。> 0 なら上端からこの長さで切り出す（フィット試験片）
  engrave: true,
  engDepth: 0.6,      // 刻印の深さ
  engY: 88,           // 刻印の中心（上端から）。幅方向は中央
  engMargin: 4,       // カメラ穴・外周から離す距離
  seg: 48,            // 円周の分割数（丸み・オフセット）
};

// 刻印（花 → 輪郭）の既定値
const FLOWER_DEFAULTS = {
  seed: 342717359454, idx: 6, vary: 1,      // 線で描かれた花（モモ）。面を塗る花は細かい点に分かれやすい
  diameter: 48,       // 花の外径
  rotate: 0,          // 回転（度、背面から見て反時計回り）
  threshold: 0.07,    // 周りより濃い筋（ハイパス後のトーン）がこれ以上なら刻印する
  highpass: 1.0,      // 周りの平均をとる半径 (mm)。花の濃い筋（線）だけを取り出す
  grow: 0.32,         // 線を太らせる半径（溝の最小幅 0.6 のため 0.3 + 輪郭の丸めの分）
  island: 0.8,        // 残す島の最小幅（クロージング半径 = island / 2）
  blur: 0.25, smooth: 0.10, cell: 0.05,    // blur: 点のばらつきで線が途切れないようにぼかす
  res: 1400, points: 3e7,
};

// ───────── 平面の輪郭 ─────────
// Detail A の点列を Catmull–Rom（centripetal）でつなぐ。端は直線の辺へ接線連続になるよう、辺の延長上に補助点を置く
function cornerCurve(perSeg = 10) {
  const p = PHONE.corner, ext = [[p[0][0] + 4, 0], ...p, [0, p[p.length - 1][1] + 4]], out = [];
  for (let i = 1; i < ext.length - 2; i++) {
    const [p0, p1, p2, p3] = [ext[i - 1], ext[i], ext[i + 1], ext[i + 2]];
    const d = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5);
    const t1 = d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
    for (let k = 0; k < perSeg; k++) {
      const t = t1 + (t2 - t1) * k / perSeg;
      const L = (a, b, ta, tb) => [(tb - t) / (tb - ta) * a[0] + (t - ta) / (tb - ta) * b[0], (tb - t) / (tb - ta) * a[1] + (t - ta) / (tb - ta) * b[1]];
      const A1 = L(p0, p1, 0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
      const B1 = L(A1, A2, 0, t2), B2 = L(A2, A3, t1, t3);
      out.push(L(B1, B2, t1, t2));
    }
  }
  out.push(p[p.length - 1]);
  return out;                                   // (14.64, 0) → (0, 14.64)
}
// 本体の平面形（STL 座標、反時計回り）
function phoneOutline() {
  const { W, H } = PHONE, c = cornerCurve(), pts = [];
  // 正面座標 (X, Y) の 4 隅。左上の角の曲線を鏡映して使う
  const TL = c.map(([a, b]) => [a, b]);                          // 上の辺 → 左の辺
  const BL = c.map(([a, b]) => [b, H - a]);                      // 左の辺 → 下の辺
  const BR = c.map(([a, b]) => [W - a, H - b]);                  // 下の辺 → 右の辺
  const TR = c.map(([a, b]) => [W - b, a]);                      // 右の辺 → 上の辺
  for (const [X, Y] of [...TL, ...BL, ...BR, ...TR]) pts.push([X - W / 2, H / 2 - Y]);
  // 正面座標の順（上 → 左 → 下 → 右）は y 上向きの STL 座標で反時計回り
  return pts;
}
const toXY = (X, Y) => [X - PHONE.W / 2, PHONE.H / 2 - Y];

// 縁の丸み（楕円の 1/4）：表面から t（0..edgeH）の位置で、側面から内側へ入る量
const edgeInset = t => t >= PHONE.edgeH ? 0 : PHONE.edgeIn * (1 - Math.sqrt(Math.max(0, 1 - ((PHONE.edgeH - t) / PHONE.edgeH) ** 2)));

// ───────── 断面のプロファイル（平面形からの外向きの距離 s を z の関数で） ─────────
function profiles(P) {
  const zb = P.back, zf = P.back + PHONE.T, outer = P.clr + P.wall;
  // ふちの下面：本体の縁（+ 隙間）に接する 45° の線 s = k − (z − zf)。z = zf − t で s = k + t ≥ clr − inset(t)
  let k = -Infinity;
  for (let i = 0; i <= 400; i++) { const t = PHONE.edgeH * i / 400; k = Math.max(k, P.clr - edgeInset(t) - t); }
  // 内側へ lip 入るところがふちの先端。その上 lipTop が上面
  const zTip = zf + k + P.lip, zTop = zTip + P.lipTop;
  const cav = z => {                                // 空洞（z ≤ zTip）
    if (z < zb + PHONE.edgeH) return P.clr - edgeInset(z - zb);
    return Math.min(P.clr, k - (z - zf));
  };
  const out = z => {                                // 外殻
    if (z < P.bedChamfer) return outer - (P.bedChamfer - z);
    const r = Math.min(P.topRound, outer + P.lip - 0.1), z0 = zTop - r;
    if (z > z0) return outer - r + Math.sqrt(Math.max(0, r * r - (z - z0) ** 2));
    return outer;
  };
  return { zb, zf, zTip, zTop, k, cav, out, outer };
}

// ───────── 形を作る ─────────
// wasm: 初期化済みの manifold モジュール。engraveRings: 刻印の輪郭（背面から見た花、mm、中心 0）。null なら刻印なし
function buildCase(wasm, P = {}, engraveRings = null) {
  P = { ...DEFAULTS, ...P };
  const { Manifold, CrossSection } = wasm, T = [], t = o => (T.push(o), o);
  try {
    const pr = profiles(P), seg = P.seg;
    const base = t(new CrossSection([phoneOutline()], "Positive"));
    const offsetPts = d => { const cs = t(base.offset(d, "Round", 2, seg)); return cs.toPolygons()[0]; };
    // 断面を重ねて hull（輪郭は凸、プロファイルは z について凹なので hull で正しい形になる）
    const loft = (f, z0, z1, n) => {
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const z = z0 + (z1 - z0) * (1 - Math.cos(Math.PI * i / n)) / 2;   // 端（丸み）を細かく
        for (const [x, y] of offsetPts(f(z))) pts.push([x, y, z]);
      }
      return t(Manifold.hull(pts));
    };
    const shell = loft(pr.out, 0, pr.zTop, 40);
    const cavity = t(Manifold.union([
      loft(pr.cav, pr.zb, pr.zTip, 40),
      // ふちの開口：先端（zTip）から上は、側面から lip 内側の輪郭でまっすぐ抜く
      t(t(t(base.offset(-P.lip, "Round", 2, seg)).extrude(pr.zTop - pr.zTip + 2)).translate([0, 0, pr.zTip - 0.01])),
    ]));
    const cuts = [cavity];
    // 開口：辺に沿った U 字の切り欠き（底の角 R、上の角も R で外へ逃がす）。
    // (a, b): 辺に沿った範囲（STL 座標の向き）、floor: 底の z。戻り値は (u, z) 平面の断面
    const notch = (a, b, floor) => {
      const R = P.openR, top = pr.zTop + 5;
      const body = t(t(t(CrossSection.square([b - a - 2 * R, top - floor - 2 * R])).translate([a + R, floor + R])).offset(R, "Round", 2, seg));
      const flare = x => t(CrossSection.difference(t(t(CrossSection.square([2 * R, R + 5])).translate([x - R, pr.zTop - R])),
                                                     t(t(CrossSection.circle(R, seg)).translate([x === a ? a - R : b + R, pr.zTop - R]))));
      return t(CrossSection.union([body, flare(a), flare(b)]));
    };
    // 断面 (u, z) を、辺に垂直な向きに押し出す。side: "L" | "R" | "B"
    const place = (cs, side, inward) => {
      const thick = pr.outer + 2, len = thick + inward;
      const m = t(t(cs.extrude(len)).rotate([90, 0, 0]));          // (u, z, e) → (u, −e, z)：y 方向に −len..0
      if (side === "B") return t(m.translate([0, -PHONE.H / 2 + inward, 0]));
      const r = t(m.rotate([0, 0, side === "L" ? -90 : 90]));      // L: (u,−e)→(−e,−u)… 下で位置合わせ
      return side === "L" ? t(r.translate([-PHONE.W / 2 + inward, 0, 0])) : t(r.translate([PHONE.W / 2 - inward, 0, 0]));
    };
    // 側面は y（STL）に沿う。L を z 回りに −90° 回すと u → −y になるので、範囲の符号に注意
    const inward = P.lip + 1.5;
    const zSide = pr.zb + P.sideFloor, zBot = pr.zb + P.bottomFloor;
    const Yr = (Y0, Y1) => [PHONE.H / 2 - Y1, PHONE.H / 2 - Y0];   // 正面座標 Y の範囲 → STL y の範囲（昇順）
    const sideCut = (side, Y0, Y1, floor) => {
      const [y0, y1] = Yr(Y0, Y1);
      // L: −90° 回転で (u, −e) → (−e, −u)。y = −u なので u の範囲は (−y1, −y0)。R: +90° で (e, u) → y = u
      return side === "L" ? place(notch(-y1, -y0, floor), "L", inward) : place(notch(y0, y1, floor), "R", inward);
    };
    if (P.leftOpen) cuts.push(sideCut("L", P.leftFrom, P.leftTo, zSide));
    if (P.rightOpen) cuts.push(sideCut("R", P.rightFrom, P.rightTo, zSide));
    if (P.bottom === "corners") {
      cuts.push(place(notch(P.bottomFrom - PHONE.W / 2, P.bottomTo - PHONE.W / 2, zBot), "B", inward));
    } else if (P.bottom === "open") {
      const Y0 = PHONE.H - P.openDepth;
      cuts.push(sideCut("L", Y0, PHONE.H + 10, zBot), sideCut("R", Y0, PHONE.H + 10, zBot));
      // 角の部分：幅いっぱいを、側面の切り欠きの丸みより下端側で切る
      const d = P.openDepth - P.openR - 0.5, w = PHONE.W + 2 * pr.outer + 4;
      cuts.push(t(t(Manifold.cube([w, d + pr.outer + 2, pr.zTop + 5 - zBot])).translate([-w / 2, -PHONE.H / 2 - pr.outer - 2, zBot])));
    }
    // カメラ穴（台座 + 隙間、角 R、外側の縁を 45° で面取り）
    const cam = cameraRect(P), camCS = rrect(CrossSection, cam, seg, t);
    const camPts = (cs, z) => cs.toPolygons()[0].map(([x, y]) => [x, y, z]);
    const c0 = t(camCS.offset(P.camChamfer + 0.01, "Round", 2, seg));
    cuts.push(t(Manifold.hull([...camPts(c0, -0.01), ...camPts(camCS, P.camChamfer)])));
    cuts.push(t(t(camCS.extrude(pr.zb + 1 - P.camChamfer + 0.01)).translate([0, 0, P.camChamfer - 0.01])));
    // 刻印：背面から見た花を左右反転して、ベッド面から掘る
    let eng = null;
    if (P.engrave && engraveRings && engraveRings.length) {
      const fcs = t(t(t(new CrossSection(engraveRings, "NonZero")).mirror([1, 0])).translate(toXY(PHONE.W / 2, P.engY)));
      // 外周・カメラ穴から engMargin 以上離れた範囲だけ残す（はみ出しは削って警告）
      const allowed = t(CrossSection.difference(t(base.offset(pr.outer - P.bedChamfer - P.engMargin, "Round", 2, seg)),
                                                t(camCS.offset(P.camChamfer + P.engMargin, "Round", 2, seg))));
      const clipped = t(CrossSection.intersection(fcs, allowed));
      eng = { area: fcs.area(), clippedArea: fcs.area() - clipped.area() };
      if (!clipped.isEmpty()) cuts.push(t(t(clipped.extrude(P.engDepth + 0.01)).translate([0, 0, -0.01])));
    }
    let solid = t(Manifold.difference([shell, ...cuts]));
    if (P.crop > 0) {
      const w = PHONE.W + 10, box = t(t(Manifold.cube([w, P.crop + 5, pr.zTop + 10])).translate([-w / 2, PHONE.H / 2 - P.crop, -5]));
      solid = t(Manifold.intersection(solid, box));
    }
    return { ...meshOut(solid), profile: { zb: pr.zb, zf: pr.zf, zTip: pr.zTip, zTop: pr.zTop, k: pr.k, outer: pr.outer }, engrave: eng, P };
  } finally {
    for (const o of T) if (o && o.delete) try { o.delete(); } catch {}
  }
}

// カメラ穴の長方形（STL 座標）：x0..x1, y0..y1, 角 r
function cameraRect(P) {
  const c = PHONE.camera, g = P.camClr;
  const [xa, ya] = toXY(PHONE.W - c.x1 - g, c.y1 + g), [xb, yb] = toXY(PHONE.W - c.x0 + g, c.y0 - g);
  return { x0: xa, x1: xb, y0: ya, y1: yb, r: c.r + g };
}
function rrect(CrossSection, r, seg, t) {
  const sq = t(t(CrossSection.square([r.x1 - r.x0 - 2 * r.r, r.y1 - r.y0 - 2 * r.r])).translate([r.x0 + r.r, r.y0 + r.r]));
  return t(sq.offset(r.r, "Round", 2, seg));
}

// 刻印試験片：size 角・厚み thick の板に、花の中央 window 角を掘る。裏（上面）に識別の点を mark 個
function buildPlate(wasm, opt, engraveRings) {
  const o = { size: 40, thick: 2.7, window: 34, depth: 0.6, mark: 0, bedChamfer: 0.4, ...opt };
  const { Manifold, CrossSection } = wasm, T = [], t = x => (T.push(x), x);
  try {
    const s = o.size / 2, c = o.bedChamfer;
    const sq = (h, z) => [[-h, -h, z], [h, -h, z], [h, h, z], [-h, h, z]];
    let solid = t(Manifold.hull([...sq(s - c, 0), ...sq(s, c), ...sq(s, o.thick)]));
    const cuts = [];
    let eng = null;
    if (engraveRings && engraveRings.length) {
      const fcs = t(t(new CrossSection(engraveRings, "NonZero")).mirror([1, 0]));
      const win = t(CrossSection.square([o.window, o.window], true));
      const clipped = t(CrossSection.intersection(fcs, win));
      eng = { area: clipped.area() };
      if (!clipped.isEmpty()) cuts.push(t(t(clipped.extrude(o.depth + 0.01)).translate([0, 0, -0.01])));
    }
    // 識別の点（上面、φ1.2・深さ 0.4、左上の角から右へ並べる）
    for (let i = 0; i < o.mark; i++)
      cuts.push(t(t(Manifold.cylinder(0.41, 0.6, 0.6, 24)).translate([-s + 2.5 + i * 2.2, s - 2.5, o.thick - 0.4])));
    if (cuts.length) solid = t(Manifold.difference([solid, ...cuts]));
    return { ...meshOut(solid), engrave: eng, P: o };
  } finally {
    for (const x of T) if (x && x.delete) try { x.delete(); } catch {}
  }
}

// manifold → 三角形の座標（STL・three.js 用）と統計
function meshOut(solid) {
  const mesh = solid.getMesh(), np = mesh.numProp, vp = mesh.vertProperties, tv = mesh.triVerts;
  const nT = tv.length / 3, pos = new Float32Array(nT * 9);
  for (let i = 0; i < tv.length; i++) { const v = tv[i]; pos[i * 3] = vp[v * np]; pos[i * 3 + 1] = vp[v * np + 1]; pos[i * 3 + 2] = vp[v * np + 2]; }
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[i + k]); mx[k] = Math.max(mx[k], pos[i + k]); }
  return { positions: pos, indices: Uint32Array.from(tv), verts: Float32Array.from(np === 3 ? vp : vp.filter((_, i) => i % np < 3)), triangles: nT, volume: solid.volume(), genus: solid.genus(),
           status: String(solid.status && solid.status()), bbox: { min: mn, max: mx, size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]] } };
}

// ───────── 花 → 刻印の輪郭 ─────────
// SymbeaCore で密度場を作り、pipeline.js（トーン → しきい値・太らせ → 島の除去 → 輪郭）で mm の閉曲線にする
function flowerSource(F, onProgress) {
  const SC = root.SymbeaCore;
  const f = SC.flowerParams(F.seed, F.idx);
  const d = SC.densityField(f.q, f.ci, { C: F.res, total: F.points, vary: F.vary }, onProgress);
  // サイト（1 マス 442 px・250 万点）の 1 px あたりの点数にそろえる
  const k = (2.5e6 / F.points) * (F.res / 442) ** 2, density = new Float32Array(d.h.length);
  for (let i = 0; i < density.length; i++) density[i] = d.h[i] * k;
  return { kind: "density", density, W: d.C, H: d.C, n: f.q.n, gamma: 1.19, params: f.q, ci: f.ci, name: f.name };
}
function flowerRings(src, F) {
  const CP = root.CoasterPipeline;
  const st = CP.buildStructure(src, {
    diameter: F.diameter, threshold: F.threshold, grow: F.grow, blur: F.blur, smooth: F.smooth, cell: F.cell, highpass: F.highpass,
    close: F.island / 2, minHole: F.island * F.island, bridges: false, keepAll: true, majorFrac: 0.002,
  }, src.n);
  const { outers, holes } = CP.contourRings(st);
  const rot = (F.rotate || 0) * Math.PI / 180, c = Math.cos(rot), s = Math.sin(rot);
  const R = r => r.map(([x, y]) => [c * x - s * y, s * x + c * y]);
  return { rings: [...outers.map(o => R(o.r)), ...holes.map(R)], st, outers: outers.length, holes: holes.length };
}

// 刻印の線幅の確認：輪郭をラスタにして、溝（minGroove 未満）・島（minIsland 未満）の細い部分の面積を測る
function widthCheck(rings, minGroove, minIsland, res = 0.025) {
  const CP = root.CoasterPipeline, { dilate } = CP._internal;
  let R = 0; for (const r of rings) for (const [x, y] of r) R = Math.max(R, Math.abs(x), Math.abs(y));
  R += 2; const N = Math.ceil(2 * R / res), m = new Uint8Array(N * N);
  // 偶奇（NonZero と同じ結果になる：外周と穴が交差しないため）でスキャンライン塗り
  for (let j = 0; j < N; j++) {
    const y = R - (j + 0.5) * res, xs = [];
    for (const r of rings) for (let i = 0, k = r.length - 1; i < r.length; k = i++) {
      const [x1, y1] = r[k], [x2, y2] = r[i];
      if ((y1 > y) !== (y2 > y)) xs.push(x1 + (y - y1) * (x2 - x1) / (y2 - y1));
    }
    xs.sort((a, b) => a - b);
    for (let q = 0; q + 1 < xs.length; q += 2) {
      const a = Math.max(0, Math.ceil((xs[q] + R) / res - 0.5)), b = Math.min(N - 1, Math.floor((xs[q + 1] + R) / res - 0.5));
      for (let i = a; i <= b; i++) m[j * N + i] = 1;
    }
  }
  const inv = a => Uint8Array.from(a, v => 1 - v);
  const open = (a, r) => dilate(inv(dilate(inv(a), N, N, r)), N, N, r);       // オープニング：幅 2r 未満の部分が消える
  const thin = (a, r) => { const o = open(a, r); let n = 0, tot = 0; for (let i = 0; i < a.length; i++) if (a[i]) { tot++; if (!o[i]) n++; } return { thin: n * res * res, total: tot * res * res }; };
  // 島 = 刻印に囲まれた部分と、花の外形の細い入り江（刻印しない側）。外側の背景は太いので数えられない
  const isl = inv(m);
  // 0.9 倍で判定：格子の量子化（±1 px）で正しい幅の線まで細いと数えないように
  const g = thin(m, minGroove / 2 / res * 0.9), s = thin(isl, minIsland / 2 / res * 0.9);
  return { grooveThin: g.thin, grooveArea: g.total, islandThin: s.thin, islandArea: s.total };
}

// 複数の結果を xy に並べて 1 つの三角形列にする（cols 列、隙間 gap mm）。order: 左上から右へ
function arrange(list, cols, gap) {
  const W = Math.max(...list.map(r => r.bbox.size[0])), H = Math.max(...list.map(r => r.bbox.size[1]));
  const rows = Math.ceil(list.length / cols), pos = new Float32Array(list.reduce((a, r) => a + r.positions.length, 0));
  let o = 0, vol = 0, tri = 0;
  list.forEach((r, i) => {
    const cx = (i % cols - (cols - 1) / 2) * (W + gap), cy = ((rows - 1) / 2 - Math.floor(i / cols)) * (H + gap);
    const mx = (r.bbox.min[0] + r.bbox.max[0]) / 2, my = (r.bbox.min[1] + r.bbox.max[1]) / 2;
    for (let k = 0; k < r.positions.length; k += 3) { pos[o + k] = r.positions[k] - mx + cx; pos[o + k + 1] = r.positions[k + 1] - my + cy; pos[o + k + 2] = r.positions[k + 2]; }
    o += r.positions.length; vol += r.volume; tri += r.triangles;
  });
  const zmax = Math.max(...list.map(r => r.bbox.max[2]));
  return { positions: pos, volume: vol, triangles: tri, bbox: { size: [cols * W + (cols - 1) * gap, rows * H + (rows - 1) * gap, zmax] } };
}

root.CaseGeom = { PHONE, DEFAULTS, FLOWER_DEFAULTS, phoneOutline, cornerCurve, profiles, cameraRect, edgeInset, toXY,
                  buildCase, buildPlate, flowerSource, flowerRings, widthCheck, arrange };
})(typeof globalThis !== "undefined" ? globalThis : this);
