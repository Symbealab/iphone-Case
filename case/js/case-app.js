/* case-app.js — ケースのページの操作。計算はすべて case-worker.js 側 */
(() => {
"use strict";
const $ = id => document.getElementById(id);
const CG = window.CaseGeom, CP = window.CoasterPipeline, SC = window.SymbeaCore, PH = CG.PHONE;
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ───────── 状態 ─────────
const KEY = "symbea.case.v1";
const saved = store.get(KEY) || {};
const S = {
  preset: "fit", fitClr: 0.20, crop: 42, plateDepth: 0.6, plateTh: 0.06, engrave: true,
  ...saved, P: { ...CG.DEFAULTS, ...(saved.P || {}) }, F: { ...CG.FLOWER_DEFAULTS, ...(saved.F || {}) },
};
const PRESET_HINT = {
  fit: "上端から切り出した試験片。カメラ穴・角・ふち・消音側の開口の始まりを含みます。隙間 0.15 / 0.20 / 0.25 の 3 個を印刷して比べます。",
  plate: "40 mm 角・厚み 2.7 mm の板に、本番と同じ大きさの花の中央 34 mm 角を刻印。深さ 3 段 × しきい値 2 段の 6 枚で、線のつぶれ方を比べます。上面の点の数が番号です。",
  case: "ケース全体。STL は背面が下（ベッド面）の向きで、刻印は背面から見て正しい向きになるよう左右反転して配置しています。",
};
const BATCH_LABEL = { fit: "3 個まとめて保存（隙間 0.15 / 0.20 / 0.25）", plate: "6 枚まとめて保存（深さ 0.4–0.8 × しきい値 0.06・0.09）" };

// ───────── スライダー ─────────
const shows = [];
function slider(parent, obj, k, label, lo, hi, st, dg, help) {
  const lab = document.createElement("label"); lab.className = "sl"; lab.title = help || ""; lab.dataset.key = k;
  lab.innerHTML = `<span>${label}</span>`;
  const inp = Object.assign(document.createElement("input"), { type: "range", min: lo, max: hi, step: st });
  const out = document.createElement("output");
  const show = () => { inp.value = obj()[k]; out.textContent = (+obj()[k]).toFixed(dg); };
  inp.addEventListener("input", () => { obj()[k] = +inp.value; out.textContent = (+inp.value).toFixed(dg); changed(); });
  lab.append(inp, out); parent.append(lab); shows.push(show); show();
  return lab;
}
const P = () => S.P, F = () => S.F;
slider($("flowerSliders"), F, "vary", "変化", 0, 1.5, 0.01, 2, "Symbea Flower の「変化」と同じ（0 で花ごとの既定の姿）");
slider($("engSliders"), F, "diameter", "外径", 30, 60, 0.5, 1, "花の外径 (mm)");
slider($("engSliders"), P, "engY", "位置", 60, 115, 0.5, 1, "花の中心の、上端からの距離 (mm)。幅方向は中央");
slider($("engSliders"), F, "rotate", "回転", 0, 360, 1, 0, "背面から見て反時計回り（度）");
slider($("engSliders"), F, "threshold", "しきい値", 0.02, 0.2, 0.005, 3, "周りより濃い筋がこれ以上なら刻印（下げると線が太く・多く）");
slider($("engSliders"), F, "highpass", "線の抽出", 0.4, 3, 0.05, 2, "周りの平均をとる半径 (mm)。小さいほど細かい筋、大きいほど面に近くなる");
slider($("engSliders"), F, "grow", "線の太さ", 0.3, 0.6, 0.01, 2, "線を太らせる半径 (mm)。溝の最小幅 0.6 mm のため 0.3 以上");
slider($("engSliders"), F, "blur", "ぼかし", 0.1, 0.5, 0.01, 2, "点のばらつきで線が途切れないようにぼかす量 (mm)");
slider($("engSliders"), P, "engDepth", "深さ", 0.3, 1.0, 0.05, 2, "刻印の深さ (mm)。背面板 2.7 なら刻印部でも 2.1 残る");
const clrRow = slider($("caseSliders"), P, "clr", "隙間", 0.1, 0.4, 0.01, 2, "本体との隙間 (mm)。フィット試験で決める");
slider($("caseSliders"), P, "wall", "壁", 1.0, 2.0, 0.05, 2, "側壁の厚み (mm)。薄いほどたわんで着脱しやすい");
slider($("caseSliders"), P, "back", "背面板", 2.0, 3.5, 0.05, 2, "背面板の厚み (mm)。レンズ面（背面から 1.72）より 0.85 以上外側に");
slider($("caseSliders"), P, "lip", "ふち", 0.4, 1.2, 0.05, 2, "前面のふちの巻き込み (mm)。下面は 45° で作る");
$("bottom").value = S.P.bottom; $("leftOpen").checked = S.P.leftOpen; $("rightOpen").checked = S.P.rightOpen; $("engrave").checked = S.engrave;
$("fitClr").value = S.fitClr.toFixed(2); $("plateDepth").value = String(S.plateDepth); $("plateTh").value = S.plateTh.toFixed(2);
$("crop").value = S.crop; $("cropOut").textContent = `${S.crop} mm`;
$("seed").value = SC.pad12(S.F.seed); $("flower").value = String(S.F.idx);

$("bottom").addEventListener("change", () => { S.P.bottom = $("bottom").value; changed(); });
$("leftOpen").addEventListener("change", () => { S.P.leftOpen = $("leftOpen").checked; changed(); });
$("rightOpen").addEventListener("change", () => { S.P.rightOpen = $("rightOpen").checked; changed(); });
$("engrave").addEventListener("change", () => { S.engrave = $("engrave").checked; changed(); });
$("fitClr").addEventListener("change", () => { S.fitClr = +$("fitClr").value; changed(); });
$("plateDepth").addEventListener("change", () => { S.plateDepth = +$("plateDepth").value; changed(); });
$("plateTh").addEventListener("change", () => { S.plateTh = +$("plateTh").value; changed(); });
$("crop").addEventListener("input", () => { S.crop = +$("crop").value; $("cropOut").textContent = `${S.crop} mm`; changed(); });
$("flower").addEventListener("change", () => { S.F.idx = +$("flower").value; changed(); });
function readSeed() {
  try { const s = SC.parseSeed($("seed").value); if (s === null) throw new Error("シードを入力してください"); S.F.seed = s; S.F.idx = +$("flower").value; return true; }
  catch (e) { message(e.message, true); return false; }
}
$("runFlower").addEventListener("click", () => { if (readSeed()) changed(0); });
$("seed").addEventListener("keydown", e => { if (e.key === "Enter" && readSeed()) changed(0); });
$("reset").addEventListener("click", () => {
  const keep = { seed: S.F.seed, idx: S.F.idx };
  S.P = { ...CG.DEFAULTS }; S.F = { ...CG.FLOWER_DEFAULTS, ...keep }; S.engrave = true;
  $("bottom").value = S.P.bottom; $("leftOpen").checked = S.P.leftOpen; $("rightOpen").checked = S.P.rightOpen; $("engrave").checked = true;
  shows.forEach(f => f()); changed();
});
for (const b of $("preset").querySelectorAll("button")) b.addEventListener("click", () => { S.preset = b.dataset.preset; syncPreset(); placed = false; changed(0); });
function syncPreset() {
  for (const b of $("preset").querySelectorAll("button")) b.classList.toggle("on", b.dataset.preset === S.preset);
  $("presetHint").textContent = PRESET_HINT[S.preset];
  $("fitBox").hidden = S.preset !== "fit"; $("plateBox").hidden = S.preset !== "plate";
  clrRow.classList.toggle("off", S.preset === "fit");
  $("saveBatch").hidden = S.preset === "case"; $("saveBatch").textContent = BATCH_LABEL[S.preset] || "";
  // 刻印の位置・深さは試験片では使わない（刻印試験片は深さを上で選ぶ）
  for (const el of $("engSliders").children) if (el.dataset.key === "engY" || el.dataset.key === "engDepth") el.classList.toggle("off", S.preset !== "case");
  for (const el of $("engSliders").children) if (el.dataset.key === "threshold") el.classList.toggle("off", S.preset === "plate");
}
syncPreset();

// ───────── worker ─────────
const worker = new Worker("js/case-worker.js", { type: "module" });
let job = 0, building = false, pending = false, timer = null, positions = null, lastStats = null, lastRings = null;
function changed(delay = 350) {
  store.set(KEY, S);
  clearTimeout(timer); timer = setTimeout(build, delay);
}
function request() {
  const base = { F: { ...S.F }, job: ++job };
  if (S.preset === "fit") return { ...base, type: "build", kind: "case", engrave: false, P: { ...S.P, clr: S.fitClr, crop: S.crop, engrave: false } };
  if (S.preset === "plate") return { ...base, type: "build", kind: "plate", engrave: S.engrave, F: { ...S.F, threshold: S.plateTh }, plate: { depth: S.plateDepth } };
  return { ...base, type: "build", kind: "case", engrave: S.engrave, P: { ...S.P, crop: 0, engrave: S.engrave } };
}
function build() {
  if (building) { pending = true; return; }
  building = true; pending = false; positions = null; $("save").disabled = true;
  worker.postMessage(request());
}
function busy(text) { $("busy").hidden = !text; if (text) $("busyText").textContent = text; }
function message(text, err = false) { $("message").textContent = text || ""; $("message").classList.toggle("error", err); }
worker.onerror = e => { busy(null); building = false; message(`計算用のスレッドを起動できませんでした（${e.message || "module Worker 非対応のブラウザ？"}）`, true); };
worker.onmessage = e => {
  const m = e.data;
  if (m.type === "status") busy(m.text);
  else if (m.type === "flower") $("flowerName").textContent = `— ${m.name}（n=${m.n}）`;
  else if (m.type === "error") { busy(null); building = false; message(m.text, true); if (pending) build(); }
  else if (m.type === "result") {
    building = false;
    if (pending) { build(); return; }
    busy(null);
    positions = m.positions; lastStats = m.stats; lastRings = m.rings;
    const st = m.stats, dd = $("stats").querySelectorAll("dd");
    dd[0].textContent = `${st.size[0].toFixed(1)} × ${st.size[1].toFixed(1)} × ${st.size[2].toFixed(1)} mm`;
    dd[1].textContent = `${(st.volume / 1000 * 1.24).toFixed(1)} g`;
    dd[2].textContent = st.triangles.toLocaleString();
    dd[3].textContent = st.watertight ? "はい" : "いいえ（要確認）";
    $("save").disabled = !st.watertight; $("saveBatch").disabled = false;
    const fits = st.size[0] <= 180 && st.size[1] <= 180;
    if (!fits) message("A1 mini のベッド（180 mm 角）に収まりません", true);
    else if (st.engrave && st.engrave.clippedArea > 0.01)
      message(`刻印がカメラ穴・外周に近すぎるため、${st.engrave.clippedArea.toFixed(1)} mm² を削りました（${S.P.engMargin} mm 以上離す）。位置か外径を調整してください。`, true);
    else message(S.preset === "case" && st.profile
      ? `背面板 ${S.P.back.toFixed(2)} mm（レンズ面より ${(S.P.back - PH.camera.lens).toFixed(2)} mm 外側）、ふちは前面ガラスから ${(st.profile.zTop - st.profile.zf).toFixed(2)} mm 上まで。`
      : "");
    if (!$("view2d").hidden) draw2D(); update3D();
  } else if (m.type === "batch") {
    busy(null); building = false;
    if (!m.watertight) { message("閉じた形状にならない試験片がありました", true); return; }
    download(m.positions, S.preset === "fit" ? `iphone12pro_fit_x3_${S.crop}mm.stl` : `engrave_x6_${SC.pad12(S.F.seed)}_f${S.F.idx + 1}.stl`, "Symbea case test pieces");
    message(`${m.count} 個を並べて保存しました（${m.size[0].toFixed(0)} × ${m.size[1].toFixed(0)} mm、${(m.volume / 1000 * 1.24).toFixed(1)} g）`);
    if (pending) build();
  }
};

// ───────── 2D：背面から見た図 ─────────
function offsetPoly(pts, d) {                    // 凸な多角形を頂点の法線方向にずらす（表示用）
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[(i + n - 1) % n], b = pts[(i + 1) % n], tx = b[0] - a[0], ty = b[1] - a[1], L = Math.hypot(tx, ty) || 1;
    return [p[0] + ty / L * d, p[1] - tx / L * d];
  });
}
function draw2D() {
  const c = $("view2d"), ctx = c.getContext("2d"), S2 = c.width;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = "#0b0b10"; ctx.fillRect(0, 0, S2, S2);
  const css = getComputedStyle(document.documentElement), accent = "#f07aa8";
  const fillRings = (rings, tx, ty) => {
    ctx.beginPath();
    for (const r of rings) { r.forEach(([x, y], i) => i ? ctx.lineTo(tx + x, ty + y) : ctx.moveTo(tx + x, ty + y)); ctx.closePath(); }
    ctx.fillStyle = "#8ecaff"; ctx.fill("nonzero");
  };
  if (S.preset === "plate") {
    const k = S2 * 0.86 / 40;
    ctx.setTransform(k, 0, 0, -k, S2 / 2, S2 / 2);              // mm、y 上向き、背面から見た向き
    ctx.fillStyle = "#2a2834"; ctx.fillRect(-20, -20, 40, 40);
    ctx.save(); ctx.beginPath(); ctx.rect(-17, -17, 34, 34); ctx.clip();
    if (lastRings && S.engrave) fillRings(lastRings, 0, 0);
    ctx.restore();
    ctx.strokeStyle = accent; ctx.lineWidth = 1.5 / k; ctx.setLineDash([4 / k, 3 / k]); ctx.strokeRect(-17, -17, 34, 34); ctx.setLineDash([]);
    label(ctx, k, "背面（ベッド面）から見た向き。点線の中を刻印", S2);
    $("legend").hidden = false;
    return;
  }
  const pr = CG.profiles({ ...S.P, clr: S.preset === "fit" ? S.fitClr : S.P.clr }), outer = pr.outer;
  const k = S2 * 0.92 / (PH.H + 2 * outer);
  ctx.setTransform(-k, 0, 0, -k, S2 / 2, S2 / 2);                // 背面から見る：STL の x を反転
  const ph = CG.phoneOutline(), path = pts => { ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); };
  path(offsetPoly(ph, outer)); ctx.fillStyle = "#2a2834"; ctx.fill();
  path(ph); ctx.strokeStyle = "rgba(255,255,255,.15)"; ctx.lineWidth = 1 / k; ctx.stroke();
  // カメラ穴（面取りの外形と、穴）
  const cr = CG.cameraRect(S.P), rr = (r, d) => { const x0 = r.x0 - d, y0 = r.y0 - d, w = r.x1 - r.x0 + 2 * d, h = r.y1 - r.y0 + 2 * d, R = r.r + d;
    ctx.beginPath(); ctx.roundRect(x0, y0, w, h, R); };
  rr(cr, S.P.camChamfer); ctx.fillStyle = "#15141c"; ctx.fill();
  rr(cr, 0); ctx.fillStyle = "#0b0b10"; ctx.fill();
  if (S.preset === "case" && S.engrave) {
    // 離す範囲（カメラ穴・外周から engMargin）
    ctx.strokeStyle = accent; ctx.lineWidth = 1.2 / k; ctx.setLineDash([4 / k, 3 / k]);
    rr(cr, S.P.camChamfer + S.P.engMargin); ctx.stroke();
    path(offsetPoly(ph, outer - S.P.bedChamfer - S.P.engMargin)); ctx.stroke(); ctx.setLineDash([]);
    // 刻印：背面から見た花はそのまま。STL では x を反転して置くので、この図（x 反転表示）では −x に描く
    const [ex, ey] = CG.toXY(PH.W / 2, S.P.engY);
    if (lastRings) { ctx.save(); ctx.scale(-1, 1); fillRings(lastRings, -ex, ey); ctx.restore(); }
  }
  if (S.preset === "fit") {                                        // 切り出す範囲より下を暗く
    const yc = PH.H / 2 - S.crop;
    ctx.fillStyle = "rgba(11,11,16,.72)"; ctx.fillRect(-60, -100, 120, yc + 100);
    ctx.strokeStyle = accent; ctx.lineWidth = 1.5 / k; ctx.beginPath(); ctx.moveTo(-45, yc); ctx.lineTo(45, yc); ctx.stroke();
  }
  label(ctx, k, S.preset === "fit" ? `背面から見た向き。上端 ${S.crop} mm を切り出す` : "背面から見た向き（カメラは左上）。STL では刻印を左右反転して配置", S2);
  $("legend").hidden = !(S.preset === "case" && S.engrave);
}
function label(ctx, k, text, S2) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = "#b5b2c2"; ctx.font = "22px system-ui, sans-serif"; ctx.fillText(text, 18, 34);
}

// ───────── 3D ─────────
let three = null, placed = false;
function initThree() {
  if (three || !window.THREE) return three;
  const el = $("view3d"), renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio)); el.append(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0b0b10);
  const camera = new THREE.PerspectiveCamera(35, 1, 1, 4000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x222233, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 0.9); key.position.set(-1, 0.6, 1); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffd6e6, 0.35); rim.position.set(1, -0.6, -1); scene.add(rim);
  const controls = new THREE.OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
  const material = new THREE.MeshStandardMaterial({ color: 0xa3a3aa, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  three = { renderer, scene, camera, controls, material, mesh: null, el };
  const resize = () => { const w = el.clientWidth, h = el.clientHeight; if (!w) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  new ResizeObserver(resize).observe(el); resize();
  (function loop() { requestAnimationFrame(loop); if (!el.hidden) { controls.update(); renderer.render(scene, camera); } })();
  return three;
}
function update3D() {
  if (!positions || $("view3d").hidden) return;
  const t = initThree();
  if (!t) { message("3D 表示用のライブラリを読み込めませんでした。STL の保存はできます。", true); return; }
  if (t.mesh) { t.scene.remove(t.mesh); t.mesh.geometry.dispose(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.computeVertexNormals();
  g.computeBoundingBox();
  const c = new THREE.Vector3(); g.boundingBox.getCenter(c);
  t.mesh = new THREE.Mesh(g, t.material); t.mesh.rotation.x = -Math.PI / 2;     // STL は z 上 → three は y 上
  t.mesh.position.set(-c.x, 0, c.y);
  t.scene.add(t.mesh);
  if (!placed) {
    // 全体が入る距離（外接球）。試験片は手前上から、刻印試験片・本番は下（ベッド面）から
    const [sx, sy, sz] = lastStats.size, r = Math.hypot(sx, sy, sz) / 2, dist = r / Math.sin(t.camera.fov * Math.PI / 360) * 1.05;
    const dir = S.preset === "plate" ? [0.3, -1.3, 0.8] : S.preset === "fit" ? [0.5, 1.1, 1] : [0.6, -0.9, 1.1], L = Math.hypot(...dir);
    t.camera.position.set(dir[0] / L * dist, dir[1] / L * dist, dir[2] / L * dist);
    t.controls.target.set(0, lastStats.size[2] / 2, 0); placed = true;
  }
}
for (const b of document.querySelectorAll(".tab")) b.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach(x => x.classList.toggle("on", x === b));
  const is3d = b.dataset.view === "3d";
  $("view3d").hidden = !is3d; $("view2d").hidden = is3d;
  if (is3d) { $("legend").hidden = true; update3D(); } else draw2D();
});

// ───────── 保存 ─────────
const touch = matchMedia("(pointer: coarse)").matches;
async function download(pos, name, title) {
  const data = CP.toSTL(pos, title);
  if (touch && navigator.canShare) {
    const file = new File([data], name, { type: "application/octet-stream" });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; }
      catch (e) { if (e.name === "AbortError") return; }
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type: "application/octet-stream" })); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
function fileName() {
  const fl = `${SC.pad12(S.F.seed)}_f${S.F.idx + 1}`;
  if (S.preset === "fit") return `iphone12pro_fit_clr${S.fitClr.toFixed(2)}_${S.crop}mm.stl`;
  if (S.preset === "plate") return `engrave_d${S.plateDepth.toFixed(1)}_t${S.plateTh.toFixed(2)}_${fl}.stl`;
  return `iphone12pro_case_${S.engrave ? fl : "plain"}_clr${S.P.clr.toFixed(2)}.stl`;
}
$("save").addEventListener("click", () => { if (positions) download(positions, fileName(), "Symbea iPhone 12 Pro case"); });
$("saveBatch").addEventListener("click", () => {
  if (building) return;
  building = true; $("saveBatch").disabled = true;
  if (S.preset === "fit") worker.postMessage({ type: "batch", kind: "fit", job: ++job, clrs: [0.15, 0.20, 0.25], P: { ...S.P, crop: S.crop }, F: { ...S.F } });
  else worker.postMessage({ type: "batch", kind: "plate", job: ++job, thresholds: [0.06, 0.09], depths: [0.4, 0.6, 0.8], plate: {}, F: { ...S.F } });
});
if (touch) $("save").textContent = "STL を保存・共有";

// ───────── URL ?seed=…&flower=…&preset=… ─────────
const q = new URLSearchParams(location.search);
try {
  if (q.get("seed")) { S.F.seed = SC.parseSeed(q.get("seed")); $("seed").value = SC.pad12(S.F.seed); }
  if (q.get("flower")) { S.F.idx = Math.min(9, Math.max(1, +q.get("flower"))) - 1; $("flower").value = String(S.F.idx); }
  if (["fit", "plate", "case"].includes(q.get("preset"))) { S.preset = q.get("preset"); syncPreset(); }
} catch (e) { message(e.message, true); }
changed(0);
})();
