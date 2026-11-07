/* test-case.mjs — ケースの試験片・本番の STL を out/ に書き出し、形を確かめる
 *
 *   node tools/test-case.mjs [出力先 out] [--quick]
 *
 * 書き出すもの
 *   fit_clr0.15.stl / fit_clr0.20.stl / fit_clr0.25.stl  フィット試験片（上端 42 mm）
 *   fit_all.stl                                          上の 3 個を 1 枚に並べたもの
 *   engrave_<n>_d0.4_t0.06.stl …（6 枚）                刻印試験片（40 mm 角・厚み 2.7、中央 34 mm 角に花）
 *   engrave_all.stl                                      上の 6 枚を 3 × 2 に並べたもの
 *   case_full.stl                                        本番（刻印入り）
 * 確かめること
 *   閉じた形状（全辺が 2 回・逆向き、manifold の状態）、A1 mini の 180 mm 角に収まる、
 *   空洞・壁・背面板・ふち・開口・カメラ穴の寸法、ふちの下面が 45° 以上、刻印がカメラ穴・外周から 4 mm 以上、溝・島の幅
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
require("../js/pipeline.js"); require("../case/js/symbea-core.js"); require("../case/js/case-geom.js");
const { default: Module } = await import("../vendor/manifold/manifold.js");
const CG = globalThis.CaseGeom, CP = globalThis.CoasterPipeline, PH = CG.PHONE;

const args = process.argv.slice(2), quick = args.includes("--quick"), out = args.find(a => !a.startsWith("--")) || "out";
fs.mkdirSync(out, { recursive: true });
const wasm = await Module(); wasm.setup();
const { Manifold, CrossSection, Mesh } = wasm;

let fails = 0;
const check = (ok, label, detail = "") => { console.log(`${ok ? "  ok " : "  NG "} ${label}${detail ? "  " + detail : ""}`); if (!ok) fails++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const f2 = v => (+v).toFixed(2);

const toManifold = r => new Manifold(new Mesh({ numProp: 3, vertProperties: r.verts, triVerts: r.indices }));
// (x, y, z) の点に材料があるか：z の断面と、点のまわりの小さな正方形の重なり
function solidAt(m, x, y, z, e = 0.02) {
  const s = m.slice(z), q = CrossSection.square([2 * e, 2 * e], true).translate([x, y]), i = CrossSection.intersection(s, q);
  const a = i.area(); s.delete(); q.delete(); i.delete();
  return a > (2 * e) ** 2 * 0.5;
}
// 断面で、点から +x（または −x 等）方向に進んで最初に材料の境目に当たる位置
function scan(m, z, x0, y0, dx, dy, max = 50, step = 0.005) {
  const s0 = solidAt(m, x0, y0, z, 0.002);
  for (let d = step; d < max; d += step) if (solidAt(m, x0 + dx * d, y0 + dy * d, z, 0.002) !== s0) return d;
  return null;
}
function common(r, label) {
  const w = CP.checkWatertight(r.indices);
  check(w.ok && r.status === "NoError", `${label}: 閉じた形状`, `${r.triangles.toLocaleString()} 三角形、genus ${r.genus}、${w.reason || "全辺が 2 回・逆向き"}`);
  const sz = r.bbox.size;
  check(sz[0] <= 180 && sz[1] <= 180 && sz[2] <= 180 && r.bbox.min[2] >= -1e-6, `${label}: A1 mini（180 mm 角）に収まる`, `${f2(sz[0])} × ${f2(sz[1])} × ${f2(sz[2])} mm、体積 ${(r.volume / 1000).toFixed(1)} cm³（PLA 約 ${(r.volume / 1000 * 1.24).toFixed(1)} g）`);
}
const save = (r, name, title) => { fs.writeFileSync(path.join(out, name), Buffer.from(CP.toSTL(r.positions, title))); };
const arrange = CG.arrange;

const t0 = Date.now();
const P = CG.DEFAULTS, pr = CG.profiles(P);

// ───────── 1. 断面のプロファイル（ふちの下面・空洞が本体を含む） ─────────
console.log("■ 断面のプロファイル");
{
  let maxSlope = 0, minGap = Infinity;
  for (let z = pr.zf - 1.5; z < pr.zTip - 1e-3; z += 0.01) maxSlope = Math.max(maxSlope, Math.abs(pr.cav(z + 0.01) - pr.cav(z)) / 0.01);
  for (let tt = 0; tt <= PH.T; tt += 0.005) { const z = pr.zf - tt; minGap = Math.min(minGap, pr.cav(z) - (P.clr - CG.edgeInset(Math.min(tt, PH.T - tt)) - 0)); }
  check(maxSlope <= 1.0001, "ふちの下面の傾き ≥ 45°（水平から）", `最も寝ている所で ${f2(Math.atan(1 / Math.max(maxSlope, 1e-9)) * 180 / Math.PI)}°`);
  check(minGap >= -1e-4, "空洞が本体 + 隙間を含む", `最小の余裕 ${minGap.toFixed(3)} mm`);
  check(near(pr.cav(pr.zTip), -P.lip, 1e-6), "ふちの先端が側面から 0.8 mm 内側", `先端は前面ガラスから ${f2(pr.zTip - pr.zf)} mm 上、ふちの上面は ${f2(pr.zTop - pr.zf)} mm 上`);
  check(near(pr.zb, P.back, 1e-9) && P.back - PH.camera.lens >= 0.85, "背面板とレンズ面", `背面板 ${P.back} mm、レンズ面より ${f2(P.back - PH.camera.lens)} mm 外側（ガラス保護の目安 0.85 以上）`);
}

// ───────── 2. 本番（刻印入り） ─────────
console.log("■ 花 → 刻印の輪郭");
const F = { ...CG.FLOWER_DEFAULTS, ...(quick ? { points: 8e6, res: 1000 } : {}) };
let t = Date.now();
const src = CG.flowerSource(F);
console.log(`  シード ${String(F.seed).padStart(12, "0")} 花 ${F.idx + 1}（${src.name}、n=${src.n}）密度場 ${((Date.now() - t) / 1000).toFixed(1)} s`);
const ringsAt = th => { t = Date.now(); const r = CG.flowerRings(src, { ...F, threshold: th }); r.ms = Date.now() - t; return r; };
const main = ringsAt(F.threshold);
{
  const w = CG.widthCheck(main.rings, 0.6, 0.8);
  console.log(`  輪郭 ${main.outers} + 穴 ${main.holes}（${main.ms} ms）、刻印の面積 ${f2(w.grooveArea)} mm²`);
  check(w.grooveThin <= w.grooveArea * 0.002, "溝の幅 ≥ 0.6 mm", `0.6 mm 未満の部分 ${f2(w.grooveThin)} mm²（全体の ${(w.grooveThin / w.grooveArea * 100).toFixed(2)}%）`);
  check(w.islandThin <= w.grooveArea * 0.002, "残る島の幅 ≥ 0.8 mm", `0.8 mm 未満の部分 ${f2(w.islandThin)} mm²（刻印の ${(w.islandThin / w.grooveArea * 100).toFixed(2)}%）`);
}

console.log("■ 本番（case_full.stl）");
t = Date.now();
const full = CG.buildCase(wasm, {}, main.rings);
console.log(`  manifold ${((Date.now() - t) / 1000).toFixed(1)} s`);
common(full, "本番");
save(full, "case_full.stl", "iPhone 12 Pro case (Symbea flower)");
{
  const m = toManifold(full), zMid = pr.zb + PH.T / 2, zB = pr.zb + PH.btnFromFront;   // 厚みの中央（ボタンの高さ）
  // 空洞の内寸：中央の断面で、中心から ±x・±y に進んで壁に当たる距離
  const z = pr.zb + 2.5, yProbe = 0, xIn = scan(m, z, 0, -20, 1, 0) + scan(m, z, 0, -20, -1, 0);
  const yIn = scan(m, z, 0, 0, 0, 1, 80, 0.01) + scan(m, z, 0, 0, 0, -1, 80, 0.01);
  check(near(xIn, PH.W + 2 * P.clr, 0.02), "空洞の幅 = 71.52 + 2 × 隙間", `${f2(xIn)} mm`);
  check(near(yIn, PH.H + 2 * P.clr, 0.03), "空洞の長さ = 146.71 + 2 × 隙間", `${f2(yIn)} mm（下部は壁あり）`);
  const wallR = scan(m, z, PH.W / 2 + P.clr + 0.01, -20, 1, 0);
  check(near(wallR, P.wall - 0.01, 0.02), "側壁の厚み", `${f2(wallR + 0.01)} mm`);
  // 背面板：中心付近（刻印のない所）で z 方向
  const [xb, yb] = CG.toXY(PH.W / 2, 130);
  let zt = 0; while (solidAt(m, xb, yb, zt + 0.005) && zt < 10) zt += 0.01;
  check(near(zt, P.back, 0.02), "背面板の厚み", `${f2(zt)} mm`);
  // ふちの開口：先端の少し上で、内側の幅
  const zl = pr.zTip + 0.2, lipW = scan(m, zl, 0, -20, 1, 0) + scan(m, zl, 0, -20, -1, 0);
  check(near(lipW, PH.W - 2 * P.lip, 0.03), "ふちの開口の幅 = 71.52 − 2 × 0.8", `${f2(lipW)} mm`);
  // 側面の開口：ボタンの高さで、壁の中（側面から 0.7 mm 外）の材料の有無を上端からの距離で調べる
  const sideRange = (X) => {
    const r = []; let prev = null;
    for (let Y = 16; Y < 130; Y += 0.05) {   // 角の曲線（上下 14.64 mm）を避ける
      const [x, y] = CG.toXY(X, Y), s = solidAt(m, x, y, zB, 0.01);
      if (prev !== null && s !== prev) r.push(+Y.toFixed(2));
      prev = s;
    }
    return r;
  };
  const L = sideRange(-P.clr - P.wall / 2), R = sideRange(PH.W + P.clr + P.wall / 2);
  check(L.length === 2 && near(L[0], P.leftFrom, 0.06) && near(L[1], P.leftTo, 0.06), "消音・音量側の開口（ボタンの高さ）", `上端から ${L.join("–")} mm`);
  check(R.length === 2 && near(R[0], P.rightFrom, 0.06) && near(R[1], P.rightTo, 0.06), "電源側の開口（ボタンの高さ）", `上端から ${R.join("–")} mm`);
  // ボタンが開口の中に入っているか（開口の端から 2 mm 以上の余裕）
  const b = PH.buttons;
  const mg = [b.mute[0] - b.mute[1] - P.leftFrom, P.leftTo - (b.volDown[0] + b.volDown[1]), b.side[0] - b.side[1] - P.rightFrom, P.rightTo - (b.side[0] + b.side[1])];
  check(Math.min(...mg) >= 2 - 0.05, "ボタンは開口の端から約 2 mm 内側（開口は 0.1 mm 単位に丸めた値）",
    `消音の上 ${f2(mg[0])}、音量−の下 ${f2(mg[1])}、電源の上 ${f2(mg[2])}、電源の下 ${f2(mg[3])} mm`);
  // カメラ穴：面取りより上の高さで、穴の範囲を 4 方向に調べる（背面図の寸法 + 0.5）
  const cr = CG.cameraRect(P), zc = P.camChamfer + 0.3, cx = (cr.x0 + cr.x1) / 2, cy = (cr.y0 + cr.y1) / 2;
  const hx0 = cx - scan(m, zc, cx, cy, -1, 0), hx1 = cx + scan(m, zc, cx, cy, 1, 0), hy0 = cy - scan(m, zc, cx, cy, 0, -1), hy1 = cy + scan(m, zc, cx, cy, 0, 1);
  const back = x => PH.W / 2 - x;                                  // STL x → 背面図でカメラ側の長辺からの距離
  const top = y => PH.H / 2 - y;
  check(near(hx0, cr.x0, 0.02) && near(hx1, cr.x1, 0.02) && near(hy0, cr.y0, 0.02) && near(hy1, cr.y1, 0.02), "カメラ穴の位置と大きさ",
    `背面図で長辺から ${f2(back(hx1))}–${f2(back(hx0))}、上端から ${f2(top(hy1))}–${f2(top(hy0))} mm（台座 2.12–35.44 × 2.12–37.62 + 0.5）`);
  const hb = cx + scan(m, 0.02, cx, cy, 1, 0);
  check(near(hb - hx1, P.camChamfer, 0.05), "カメラ穴の外側の面取り", `ベッド面で ${f2(hb - hx1)} mm 広い`);
  // 刻印：ベッド面の断面に穴として現れる。輪郭の点から、カメラ穴・外周までの距離
  const [ex, ey] = CG.toXY(PH.W / 2, P.engY), outline = CG.phoneOutline();
  let dCam = Infinity, dEdge = Infinity;
  const segDist = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))); return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy); };
  for (const ring of main.rings) for (let i = 0; i < ring.length; i += 2) {
    const p = [ex - ring[i][0], ey + ring[i][1]];                   // 左右反転して配置
    const qx = Math.max(cr.x0 + cr.r, Math.min(cr.x1 - cr.r, p[0])), qy = Math.max(cr.y0 + cr.r, Math.min(cr.y1 - cr.r, p[1]));
    dCam = Math.min(dCam, Math.hypot(p[0] - qx, p[1] - qy) - cr.r - P.camChamfer);
    for (let k = 0; k < outline.length; k += 1) dEdge = Math.min(dEdge, segDist(p, outline[k], outline[(k + 1) % outline.length]) + pr.outer - P.bedChamfer);
  }
  check(dCam >= P.engMargin && dEdge >= P.engMargin && full.engrave && full.engrave.clippedArea < 1e-6, "刻印はカメラ穴・外周から 4 mm 以上",
    `カメラ穴（面取り込み）から ${f2(dCam)} mm、外周（ベッド面）から ${f2(dEdge)} mm`);
  // 刻印の深さ：刻印の中の点で、ベッド面から材料が始まる高さ
  let probe = null;
  for (const ring of main.rings) { for (const q of ring) { const pp = [ex - q[0] * 0.999, ey + q[1] * 0.999]; if (!solidAt(m, pp[0], pp[1], 0.05, 0.01)) { probe = pp; break; } } if (probe) break; }
  if (probe) { let zz = 0; while (!solidAt(m, probe[0], probe[1], zz + 0.005, 0.01) && zz < 3) zz += 0.01; check(near(zz, P.engDepth, 0.02), "刻印の深さ", `${f2(zz)} mm`); }
  else check(false, "刻印の深さ", "刻印の中の点が見つからない");
  m.delete();
}
for (const bottom of ["corners", "open"]) {
  const r = CG.buildCase(wasm, { bottom, engrave: false });
  common(r, `下部「${bottom === "corners" ? "角だけ残す" : "全開放"}」`);
}

// ───────── 3. フィット試験片 ─────────
console.log("■ フィット試験片（上端 42 mm）");
const fits = [];
for (const clr of [0.15, 0.20, 0.25]) {
  const r = CG.buildCase(wasm, { clr, crop: 42, engrave: false });
  common(r, `隙間 ${clr.toFixed(2)}`);
  const m = toManifold(r), z = P.back + 2.5, yy = PH.H / 2 - 17, w = scan(m, z, 0, yy, 1, 0) + scan(m, z, 0, yy, -1, 0);   // 上端から 17 mm（角と開口を避ける）
  check(near(w, PH.W + 2 * clr, 0.02), `隙間 ${clr.toFixed(2)}: 空洞の幅`, `${f2(w)} mm`);
  m.delete();
  save(r, `fit_clr${clr.toFixed(2)}.stl`, `iPhone 12 Pro fit test clr ${clr}`);
  fits.push(r);
}
{ const a = arrange(fits, 1, 8); fs.writeFileSync(path.join(out, "fit_all.stl"), Buffer.from(CP.toSTL(a.positions, "fit test x3")));
  check(a.bbox.size[0] <= 180 && a.bbox.size[1] <= 180, "fit_all.stl（3 個並べ）が 180 mm 角に収まる", `${f2(a.bbox.size[0])} × ${f2(a.bbox.size[1])} mm（上から 0.15 / 0.20 / 0.25）`); }

// ───────── 4. 刻印試験片 ─────────
console.log("■ 刻印試験片（40 mm 角・厚み 2.7、中央 34 mm 角）");
const plates = [], TH = [0.06, 0.09];
const ringsTh = TH.map(th => th === F.threshold ? main : ringsAt(th));
let n = 0;
for (const th of TH) for (const depth of [0.4, 0.6, 0.8]) {
  n++;
  const rs = ringsTh[TH.indexOf(th)], r = CG.buildPlate(wasm, { depth, mark: n }, rs.rings);
  common(r, `#${n} 深さ ${depth} × しきい値 ${th}`);
  save(r, `engrave_${n}_d${depth.toFixed(1)}_t${th.toFixed(2)}.stl`, `engrave test ${n} depth ${depth} thr ${th}`);
  plates.push(r);
}
for (const [i, th] of TH.entries()) {
  const w = CG.widthCheck(ringsTh[i].rings.map(r => r), 0.6, 0.8);
  check(w.grooveThin <= w.grooveArea * 0.002 && w.islandThin <= w.grooveArea * 0.002, `しきい値 ${th}: 溝 ≥ 0.6・島 ≥ 0.8`,
    `細い溝 ${f2(w.grooveThin)} mm²、細い島 ${f2(w.islandThin)} mm²（刻印 ${f2(w.grooveArea)} mm²）`);
}
{ const a = arrange(plates, 3, 6); fs.writeFileSync(path.join(out, "engrave_all.stl"), Buffer.from(CP.toSTL(a.positions, "engrave test x6")));
  check(a.bbox.size[0] <= 180 && a.bbox.size[1] <= 180, "engrave_all.stl（6 枚並べ）が 180 mm 角に収まる", `${f2(a.bbox.size[0])} × ${f2(a.bbox.size[1])} mm（上段 しきい値 ${TH[0]}、下段 ${TH[1]}、左から深さ 0.4 / 0.6 / 0.8）`); }

console.log(`\n${fails ? `NG ${fails} 件` : "すべて OK"}（${((Date.now() - t0) / 1000).toFixed(0)} s）→ ${path.resolve(out)}`);
process.exit(fails ? 1 : 0);
