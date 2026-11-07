/* symbea-core.js — Symbea flower の写像・シード・探索・9 種の花・層の描画（密度場）
 * 出典: github.com/Symbealab/Symbea-flower (docs/js/symbea.js) から DOM を切り離して移植。
 * 乱数の使い方・探索の順番・層の写し方は元と同じなので、同じシードなら同じ花になる。
 * 違いは「キャンバスに色を塗る」代わりに「点の数の密度場（ヒストグラム）」を返すことだけ。
 * ブラウザ（window / Worker）と Node の両方で使える。 */
(function (root) {
"use strict";
const SEED_SPACE = 1e12;
const pad12 = s => String(s).padStart(12, "0");
function splitmix32(a) {
  return () => {
    a = a + 0x9E3779B9 | 0;
    let z = a;
    z = Math.imul(z ^ z >>> 16, 0x85EBCA6B); z = Math.imul(z ^ z >>> 13, 0xC2B2AE35);
    return (z ^ z >>> 16) >>> 0;
  };
}
function subSeed(hi, lo, k) {
  const a = splitmix32(lo), b = splitmix32(Math.imul(hi, 0x9E3779B1) ^ 0x6A09E667),
        c = splitmix32(Math.imul(k + 1, 0x85EBCA77) ^ 0xBB67AE85);
  const a0 = a(), b0 = b(), c0 = c();
  return [a0 ^ c0, b0 ^ a(), c0 ^ b(), a() ^ b() ^ c()].map(x => x >>> 0);
}
function sfc32(a, b, c, d) {
  const next = () => {
    const t = (a + b | 0) + d | 0;
    d = d + 1 | 0; a = b ^ b >>> 9; b = c + (c << 3) | 0; c = (c << 21 | c >>> 11) + t | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  return next;
}
const seedRng = (s, k) => sfc32(...subSeed(Math.floor(s / 4294967296), s % 4294967296, k));
// 1〜12 桁の数字はそのまま、13 桁以上はエラー、それ以外の文字列は 64bit FNV-1a で 10^12 に収める
function parseSeed(str) {
  str = String(str ?? "").trim();
  if (!str) return null;
  if (/^\d+$/.test(str)) {
    if (str.length > 12) throw new RangeError("シードは 12 桁まで（000000000000〜999999999999）です");
    return Number(str);
  }
  let h = 0xCBF29CE484222325n;
  for (const b of new TextEncoder().encode(str)) h = (h ^ BigInt(b)) * 0x100000001B3n & 0xFFFFFFFFFFFFFFFFn;
  return Number(h % 1000000000000n);
}
const rnd = (rng, lo, hi) => lo + rng() * (hi - lo);
const pick = (rng, a) => a[Math.floor(rng() * a.length)];

// ───────── 写像 z ← (λ + α|z|² + β Re(zⁿ) + iω) z + γ z̄ⁿ⁻¹ ─────────
let NX = 0, NY = 0;
function step(q, x, y) {
  const zz = x * x + y * y;
  let zr = x, zi = y;
  for (let i = 1; i < q.n - 1; i++) { const t = zr * x - zi * y; zi = zr * y + zi * x; zr = t; }
  const ren = zr * x - zi * y;
  const p = q.lam + q.alpha * zz + q.beta * ren;
  NX = p * x - q.omega * y + q.gamma * zr;
  NY = p * y + q.omega * x - q.gamma * zi;
}
function probe(q, N = 20000) {
  let x = 0.01, y = 0.003, R = 0;
  for (let i = 0; i < N; i++) {
    step(q, x, y); x = NX; y = NY;
    if (!(Math.abs(x) + Math.abs(y) < 1e4)) return null;
    if (i > 1000) { const r = x * x + y * y; if (r > R) R = r; }
  }
  R = Math.sqrt(R);
  return R > 1e-6 ? { R, x, y } : null;
}
function analyze(q) {
  const pr = probe(q);
  if (!pr) return null;
  const G = 128, h = new Uint8Array(G * G);
  let x = pr.x, y = pr.y;
  for (let i = 0; i < 80000; i++) {
    step(q, x, y); x = NX; y = NY;
    const gx = ((x / pr.R) * 0.5 + 0.5) * (G - 1) | 0, gy = ((y / pr.R) * 0.5 + 0.5) * (G - 1) | 0;
    if (gx >= 0 && gx < G && gy >= 0 && gy < G) h[gy * G + gx] = 1;
  }
  const occ32 = new Uint8Array(32 * 32), c = (G - 1) / 2;
  let c128 = 0, c32 = 0, occDisk = 0, disk = 0;
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const dx = i - c, dy = j - c, inD = dx * dx + dy * dy <= (G / 2) ** 2;
    if (inD) disk++;
    if (!h[j * G + i]) continue;
    c128++; if (inD) occDisk++;
    const o = (j >> 2) * 32 + (i >> 2); if (!occ32[o]) { occ32[o] = 1; c32++; }
  }
  const d0 = 1e-8; let x2 = x + d0, y2 = y, lsum = 0;
  for (let i = 0; i < 3000; i++) {
    step(q, x, y); const ax = NX, ay = NY;
    step(q, x2, y2);
    const dx = NX - ax, dy = NY - ay, dd = Math.hypot(dx, dy) || 1e-300;
    lsum += Math.log(dd / d0);
    x = ax; y = ay; x2 = ax + dx * d0 / dd; y2 = ay + dy * d0 / dd;
  }
  return { D: Math.log2(c128 / Math.max(c32, 1)) / 2, fill: occDisk / disk, lyap: lsum / 3000 };
}
const isGood = a => a && a.D > 1.45 && a.D < 1.9 && a.fill > 0.15 && a.fill < 0.7 && a.lyap > 0.01;

// ───────── 9 種の花（元の CONCEPTS と同じ） ─────────
const TAU = Math.PI * 2;
const BALL = 0.55;
function hashRng(q, salt = 0) {
  let h = 0x811C9DC5 ^ Math.imul(salt, 0x9E3779B9);
  for (const ch of [q.n, q.lam, q.alpha, q.beta, q.gamma, q.omega].map(v => (+v).toFixed(6)).join(","))
    h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  return sfc32(h >>> 0, 0x9E3779B9, 0x243F6A88, 0xB7E15162);
}
function form(q, c, vary) {
  const r = hashRng(q, 1), F = c.form || {}, k = q.n * pick(r, F.m || [1]);
  const size = rnd(r, ...(F.size || [1, 1])), a = rnd(r, ...(F.a || [0, 0])), p = rnd(r, ...(F.p || [1, 1]));
  const phase = r() < 0.5 ? 0 : Math.PI / k, tw = (F.tw || 0) * rnd(r, -1, 1), lr = hashRng(q, 2);
  return {
    k, p, phase, size: 1 - (1 - size) * vary, a: Math.min(0.9, a * vary), tw: tw * vary,
    r: lr,
    v: (def, lo, hi) => def + (rnd(lr, lo, hi) - def) * Math.min(1, vary),
    flag: (def, prob) => { const u = lr(); return vary > 0 ? u < prob : def; },
  };
}
function pistils(q, V) {
  const r = hashRng(q), out = [], L0 = V.v(0.55, 0.42, 0.7), bend = V.v(0, -0.12, 0.12);
  const line = (ang, len, tip) => {
    const D = 14;
    for (let j = 1; j <= D; j++) {
      const t = j / D, d = 0.1 + (len - 0.1) * t, a = ang + bend * t * t;
      out.push({ s: 0.012, rot: r() * TAU, dx: d * Math.cos(a), dy: d * Math.sin(a), dens: 8 });
    }
    const a = ang + bend;
    tip.forEach(([da, s]) => out.push({ s, rot: r() * TAU, dx: len * Math.cos(a + da), dy: len * Math.sin(a + da), dens: 12 }));
  };
  const base = r() * TAU;
  for (let i = 0; i < 6; i++) line(base + i * TAU / 6 + (r() - 0.5) * 0.25, L0 * (0.85 + r() * 0.2), [[0, 0.03 + r() * 0.01]]);
  line(base + TAU / 12, L0 * 1.12, [[-0.06, 0.022], [0, 0.022], [0.06, 0.022]]);
  return out;
}
function stamens(q, V) {
  const r = hashRng(q), K = Math.round(V.v(24, 16, 36)), R0 = V.v(0.34, 0.24, 0.44), sp = V.v(0.08, 0.03, 0.14);
  return Array.from({ length: K }, (_, i) => {
    const a = (i + 0.5 * r()) * TAU / K, d = R0 + (r() * 2 - 1) * sp;
    return { s: 0.032 + r() * 0.016, rot: r() * TAU, dx: d * Math.cos(a), dy: d * Math.sin(a), dens: 6 };
  });
}
const disc = (s, dens = 3) => ({ s, warp: BALL, dens });
const CONCEPTS = [
  { name: "ポインセチア", ns: [5, 6], omega0: true, fill: [0.15, 0.6],
    form: { size: [0.78, 1], m: [1], a: [0.15, 0.55], p: [1.5, 4], tw: 0.12 },
    layers: (q, V) => { const t = Math.round(V.v(2, 2, 3.4)), s2 = V.v(0.6, 0.45, 0.75);
      return [...Array.from({ length: t }, (_, k) => ({ s: s2 ** k, rot: k * Math.PI / q.n, mod: true })), disc(V.v(0.13, 0.08, 0.18), 2.5)]; } },
  { name: "マーガレット", ns: [9, 10, 11, 12], fill: [0.15, 0.5],
    form: { size: [0.78, 1], m: [2], a: [0.05, 0.4], p: [0.8, 2.5], tw: 0.15 },
    layers: (q, V) => [{ s: 1, mod: true }, ...(V.flag(true, 0.65) ? [{ s: V.v(0.96, 0.8, 1), rot: Math.PI / q.n, mod: true }] : []),
                       disc(V.v(0.22, 0.14, 0.32))] },
  { name: "アマリリス", ns: [3], omega0: true, fill: [0.25, 0.65], align: true,
    form: { size: [0.85, 1], m: [1], a: [0.35, 0.65], p: [1.5, 4], tw: 0.08 },
    layers: (q, V) => [{ s: 1, mod: true }, { s: V.v(0.88, 0.75, 0.95), rot: Math.PI / 3, mod: true },
                       disc(V.v(0.2, 0.14, 0.28), 3), ...pistils(q, V)] },
  { name: "アネモネ", ns: [5, 6, 7, 8], fill: [0.35, 0.7],
    form: { size: [0.75, 1], m: [1], a: [0.1, 0.45], p: [0.5, 1.6], tw: 0.25 },
    layers: (q, V) => [{ s: 1, mod: true }, ...(V.flag(false, 0.45) ? [{ s: V.v(0.65, 0.5, 0.78), rot: Math.PI / q.n, mod: true, dens: 0.8 }] : []),
                       disc(V.v(0.28, 0.18, 0.38), 4)] },
  { name: "センニチコウ", ns: [8, 9, 10, 11, 12], fill: [0.3, 0.7],
    form: { size: [0.6, 0.92], m: [2], a: [0.03, 0.2], p: [1, 3], tw: 0.25 },
    layers: (q, V) => { const t = Math.round(V.v(5, 3, 6.4));
      return Array.from({ length: t }, (_, k) => ({ s: 0.84 - k * 0.64 / (t - 1), rot: k * Math.PI / q.n + k * 0.11, warp: BALL, mod: true })); } },
  { name: "ダリア", ns: [8, 9, 10, 11, 12], fill: [0.2, 0.65],
    form: { size: [0.82, 1], m: [1], a: [0.15, 0.5], p: [0.8, 3], tw: 0.5 },
    layers: (q, V) => { const t = Math.round(V.v(6, 4, 8.4)), ratio = V.v(0.8, 0.72, 0.86), jit = V.v(0.06, 0, 0.18);
      return Array.from({ length: t }, (_, k) => ({ s: 0.98 * ratio ** k, rot: (k % 2) * Math.PI / q.n + k * jit, mod: true })); } },
  { name: "ニゲラ", ns: [5], fill: [0.12, 0.42],
    form: { size: [0.78, 1], m: [1, 2], a: [0.1, 0.4], p: [1, 3], tw: 0.2 },
    layers: (q, V) => [{ s: 1, rot: Math.PI / 5, dens: V.v(0.3, 0.12, 0.55) }, { s: V.v(0.7, 0.55, 0.82), mod: true }, disc(V.v(0.17, 0.1, 0.24))] },
  { name: "モモ", ns: [5], omega0: true, fill: [0.3, 0.7],
    form: { size: [0.8, 1], m: [1], a: [0.2, 0.5], p: [0.4, 1.2], tw: 0.05 },
    layers: (q, V) => [{ s: 1, mod: true }, ...(V.flag(false, 0.4) ? [{ s: V.v(0.68, 0.55, 0.8), rot: Math.PI / 5, mod: true }] : []),
                       ...stamens(q, V), disc(V.v(0.1, 0.07, 0.14), 3)] },
  { name: "マリーゴールド", ns: [9, 10, 11, 12], fill: [0.18, 0.5],
    form: { size: [0.72, 1], m: [2], a: [0.05, 0.28], p: [1, 3], tw: 0.5 },
    layers: (q, V) => { const t = Math.round(V.v(6, 4, 7.4)), ratio = V.v(0.8, 0.74, 0.86);
      return Array.from({ length: t }, (_, k) => ({ s: 0.97 * ratio ** k, rot: V.r() * TAU, eq: true, warp: k % 2 ? 0.85 : 1, dens: 1 + k * 0.15, mod: true })); } },
];
const LIB = [
  [[6,-2.68317,3.963443,-0.39696,-1.123296,0], [5,2.733986,-3.146568,-0.478931,-0.789091,0], [6,-1.628503,1.210729,0.812148,-1.167864,0], [6,-2.614832,3.280118,-0.701925,-0.5425,0], [5,-1.939089,2.364574,1.4156,-1.137584,0], [5,-2.324017,2.051365,-1.192669,0.841436,0], [5,2.035876,-2.282334,0.147206,-1.127017,0], [5,-2.219875,1.372859,0.592975,-0.494679,0], [6,2.511806,-3.734029,-0.707922,-1.034008,0], [5,2.709602,-3.778188,1.055306,0.549977,0]],
  [[10,2.303556,-4.41819,-1.245662,-0.779577,0.081783], [11,-2.320488,3.719851,0.890244,0.779235,0.276561], [9,-2.336197,2.501003,0.701183,-0.364954,-0.284364], [11,-2.305849,3.966476,-1.413192,-0.52242,-0.21184], [12,2.128203,-1.666402,0.950158,-0.695159,-0.026722], [10,-1.75757,1.099459,-0.949188,1.05982,0.115602], [12,-2.294955,3.904085,-1.198465,-1.055202,-0.162847], [11,2.208072,-2.877822,0.531518,1.191174,-0.124337], [11,-2.277593,3.720784,-0.92922,-0.333112,0.106754], [10,-2.277683,3.56774,-0.263301,-0.537398,-0.029412]],
  [[3,-1.623767,1.052026,0.616426,1.078095,0], [3,-1.812804,3.75919,0.22944,0.908587,0], [3,-1.842043,0.302364,-0.011551,0.283819,0], [3,-1.21174,-0.913403,-0.767145,-0.887182,0], [3,2.03498,-3.292828,-0.431193,-1.150373,0], [3,-1.709336,2.236277,-1.159831,-0.777255,0], [3,-2.068828,3.268301,-0.201175,0.724811,0], [3,1.669976,-1.014655,0.04364,0.724375,0], [3,2.156419,-3.463988,1.421627,0.938476,0], [3,2.765889,-4.791523,1.424949,0.240651,0]],
  [[5,2.300268,-1.704614,-0.016505,-0.529866,-0.257315], [5,-1.771995,1.467589,-1.451297,-0.086712,0.128172], [5,-2.119187,4.026247,0.653185,0.51342,-0.189487], [5,1.971841,-2.048087,0.322592,-1.106265,0.159305], [8,-2.304503,2.445654,-0.940122,0.443517,-0.272577], [7,2.37368,-2.829701,1.027825,-0.278435,-0.209299], [5,2.296282,-4.815512,-1.354131,-0.11713,0.146251], [7,-2.129014,1.890068,-1.087547,1.075203,0.161711], [8,2.214298,-2.469244,0.931928,-1.02004,0.252475], [5,-2.037134,4.017196,0.565044,1.121558,-0.262693]],
  [[11,1.991412,-1.627151,-0.418944,-0.450025,0.163384], [11,2.345572,-4.171975,0.194156,-0.297579,0.139734], [11,1.762519,-1.286588,-1.005233,-0.796956,0.233561], [9,-2.289758,4.434422,-1.360232,-1.060926,-0.029002], [8,2.256537,-2.308539,-0.954548,0.141516,-0.109819], [12,-2.417305,2.687364,1.170752,-0.13322,0.049582], [12,-1.393404,0.633654,-1.263984,-1.004344,0.21805], [8,-2.191793,1.91003,0.963451,-0.774249,-0.281064], [9,2.369316,-2.291878,0.424746,-0.106001,-0.267656], [9,-1.931221,1.363178,-0.464357,0.82238,-0.118042]],
  [[11,2.152617,-2.215659,-0.061735,-0.630269,0.297511], [8,2.21673,-1.658262,0.158777,-0.229107,0.261461], [11,-1.927987,1.629362,0.444569,-1.013384,-0.166641], [9,1.789718,-1.257541,0.557398,-0.95157,0], [8,2.214586,-1.44322,0.254734,-0.255912,0.166467], [11,-2.33284,3.454416,-0.56556,-0.203098,-0.257373], [11,-1.812837,1.286563,-0.535866,-0.601029,-0.014664], [10,-2.326463,4.547719,1.283469,0.461223,-0.086704], [11,2.314902,-4.854484,-1.24861,-0.502958,-0.052261], [9,1.93534,-1.200619,-0.453294,0.419653,0.258274]],
  [[5,-1.095844,-0.076298,-0.893813,-0.359306,0.105594], [5,-1.868415,0.243712,0.013585,-0.071469,0], [5,2.234204,-4.357495,0.54018,-0.878701,0.190934], [5,2.084878,-2.034307,-0.834134,0.520328,0.284835], [5,-1.413073,0.400002,0.052848,-0.580198,-0.082984], [5,2.161173,-3.691478,-1.461561,-0.695822,0.290738], [5,-1.273345,0.299994,-0.356426,-1.098707,-0.040017], [5,-1.003772,-0.612482,-1.494111,-1.171898,0.04581], [5,-2.0701,2.771876,0.112024,-0.441639,-0.057788], [5,-1.485856,0.875097,0.765451,0.705936,-0.244893]],
  [[5,2.543089,-4.108833,0.794296,0.894528,0], [5,-2.403787,2.967078,-0.7175,0.307318,0], [5,-2.082234,1.527086,-0.492313,0.687856,0], [5,-2.083816,2.343292,-0.866006,0.951509,0], [5,-2.360232,2.753722,0.493863,-0.147718,0], [5,2.733131,-4.482613,-0.957727,-0.936238,0], [5,-2.3585,3.479316,0.964975,-0.361943,0], [5,-2.121543,3.677114,-1.404214,1.139113,0], [5,2.012647,-2.200712,0.020153,-1.045602,0], [5,2.608605,-4.329654,-1.376755,-0.760824,0]],
  [[10,-2.121074,1.687003,0.469714,0.130355,-0.163301], [12,-2.33084,4.264915,0.399065,0.787289,-0.247889], [12,-2.381677,3.966986,-0.133012,0.190769,0.221612], [9,2.344565,-3.800539,-1.447674,0.700296,0.245972], [12,-2.306401,3.305019,-0.267913,-0.081371,0.162175], [9,-2.291144,3.525484,0.74213,0.240269,0.267593], [10,1.967261,-1.729137,-1.267791,1.117766,-0.285467], [11,-1.633868,0.802337,-0.152965,0.437361,0.088313], [11,2.314028,-4.702928,0.842258,0.064956,0.114077], [12,2.263266,-2.132136,-0.159285,-0.108595,-0.026622]],
];
CONCEPTS.forEach((c, i) => { c.lib = LIB[i].map(([n, lam, alpha, beta, gamma, omega]) => ({ n, lam, alpha, beta, gamma, omega })); });

function randomParams(rng, c) {
  const q = { n: pick(rng, c.ns), lam: rnd(rng, -2.8, 2.8), alpha: rnd(rng, -5, 5), beta: rnd(rng, -1.5, 1.5),
              gamma: rnd(rng, -1.2, 1.2), omega: rng() < 0.5 ? 0 : rnd(rng, -0.3, 0.3) };
  if (c.omega0) q.omega = 0;
  return q;
}
function symmetric(q) {
  const pr = probe(q, 3000);
  if (!pr) return false;
  const N = 6000, re = new Float64Array(q.n), im = new Float64Array(q.n);
  let x = pr.x, y = pr.y;
  for (let i = 0; i < N; i++) {
    step(q, x, y); x = NX; y = NY;
    const r = Math.hypot(x, y); if (!r) continue;
    const wr = x / r, wi = y / r;
    let pr_ = 1, pi = 0;
    for (let j = 1; j < q.n; j++) { const t = pr_ * wr - pi * wi; pi = pr_ * wi + pi * wr; pr_ = t; re[j] += pr_; im[j] += pi; }
  }
  for (let j = 1; j < q.n; j++) if (Math.hypot(re[j], im[j]) / N >= 0.1) return false;
  return true;
}
// 元の search と同じ順番で試す（元は 6 回ごとに UI へ譲るだけなので、結果は同じ）
function search(gen, c, maxTries = 4000) {
  let fallback = null, q = null;
  for (let t = 0; t < maxTries; t++) {
    q = gen(); const a = analyze(q);
    if (isGood(a) && symmetric(q)) {
      if (a.fill >= c.fill[0] && a.fill <= c.fill[1]) return q;
      fallback ??= q;
    }
    if (fallback && t >= 600) return fallback;
  }
  return fallback ?? { ...c.lib[Math.floor(hashRng(q)() * c.lib.length)] };
}
// 並び順：系列 10 で 9 種の花をシャッフル
function order(s) {
  const r = seedRng(s, 10), p = [...Array(9).keys()];
  for (let i = 8; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  return p;
}
// シード + マスの番号（0〜8、左上から）→ 花の種類と写像のパラメータ
function flowerParams(seed, idx) {
  const ci = order(seed)[idx], c = CONCEPTS[ci], rng = seedRng(seed, idx);
  const q = search(() => randomParams(rng, c), c);
  return { ci, name: c.name, q };
}

// ───────── 層の描画 → 密度場 ─────────
// 元の render と同じ写し方。C: 密度場の一辺 (px)、total: 点の数、vary: 変化（0〜1.5）。
// 元のマス（一辺 CELL）に対する大きさは C = CELL·size なので、ここでは C の枠いっぱいが花の枠（half = C/2 − C/90）
function densityField(q, ci, opt = {}, onProgress) {
  const c = CONCEPTS[ci], C = opt.C || 1200, total = opt.total || 2.5e6, vary = opt.vary ?? 1;
  const h = new Float32Array(C * C);
  const pr = probe(q);
  if (!pr) throw new Error("この花は軌道が発散するため、形になりません");
  const half = C / 2 - C / 90, inv = 1 / (pr.R * 1.02);
  let x = pr.x, y = pr.y, rmin = Infinity, ex = 0, ey = 0;
  const NB = 512, cdf = new Float32Array(NB + 1);
  for (let i = 0; i < 30000; i++) {
    step(q, x, y); x = NX; y = NY; const r = x * x + y * y; if (r < rmin) rmin = r;
    cdf[Math.min(NB - 1, Math.sqrt(r) * inv * NB | 0) + 1]++;
    if (c.align && r > 0) { const th = Math.atan2(y, x) * q.n; ex += r * Math.cos(th); ey += r * Math.sin(th); }
  }
  for (let i = 1; i <= NB; i++) cdf[i] += cdf[i - 1];
  for (let i = 0; i <= NB; i++) cdf[i] = Math.sqrt(cdf[i] / cdf[NB]);
  const r0 = Math.min(0.9, Math.sqrt(rmin) * inv * 0.94), k0 = 1 / (1 - r0);
  x = pr.x; y = pr.y;
  const V = form(q, c, vary), sz = V.size * half;
  if (c.align) V.phase = Math.atan2(ey, ex) / q.n;
  const L = c.layers(q, V).map(l => {
    l = { s: 1, rot: 0, dx: 0, dy: 0, warp: 1, dens: 1, sy: 1, upper: false, eq: false, mod: false, ...l };
    return { ...l, cs: Math.cos(l.rot) * l.s * sz, sn: Math.sin(l.rot) * l.s * sz, mod: l.mod && (V.a > 0 || V.tw !== 0),
             ox: C / 2 + l.dx * sz, oy: C / 2 - l.dy * sz, w: l.s * l.s * l.dens };
  });
  const NS = 4096, slots = new Uint16Array(NS), wsum = L.reduce((a, l) => a + l.w, 0);
  let acc = 0, k = 0;
  L.forEach((l, j) => { acc += l.w / wsum * NS; while (k < Math.round(acc)) slots[k++] = j; });
  while (k < NS) slots[k++] = L.length - 1;
  let max = 1;
  for (let n = 0; n < total; n++) {
    step(q, x, y); x = NX; y = NY;
    let hs = Math.imul(n ^ n >>> 16, 0x45D9F3B); hs = Math.imul(hs ^ hs >>> 16, 0x45D9F3B);
    const l = L[slots[(hs ^ hs >>> 16) >>> 20]];
    let u = x * inv, v = y * inv;
    const r = Math.hypot(u, v);
    if (r > 0) {
      let rr;
      if (l.eq) { const t = Math.min(NB, r * NB), i0 = Math.min(NB - 1, t | 0); rr = cdf[i0] + (cdf[i0 + 1] - cdf[i0]) * (t - i0); }
      else rr = Math.max(0, (r - r0) * k0);
      if (l.warp !== 1) rr = Math.pow(rr, l.warp);
      if (l.mod) {
        let th = Math.atan2(v, u);
        if (V.a) rr *= 1 - V.a * (1 - Math.pow(Math.abs(Math.cos(V.k * (th - V.phase) / 2)), V.p));
        th += V.tw * rr; u = rr * Math.cos(th); v = rr * Math.sin(th);
      } else { const m = rr / r; u *= m; v *= m; }
    }
    const ry = u * l.sn + v * l.cs;
    if (l.upper && ry < 0) continue;
    const px = (l.ox + u * l.cs - v * l.sn) | 0, py = (l.oy - ry * l.sy) | 0;
    if (px >= 0 && px < C && py >= 0 && py < C) { const cc = ++h[py * C + px]; if (cc > max) max = cc; }
    if (onProgress && (n & 0xFFFFF) === 0xFFFFF) onProgress(n / total);
  }
  // half: 花の枠の半径 (px)。元のマスの外接円にあたる
  return { h, C, max, half, size: V.size, layers: L.length };
}

root.SymbeaCore = { SEED_SPACE, pad12, parseSeed, seedRng, order, flowerParams, densityField, CONCEPTS, analyze, probe,
                    names: CONCEPTS.map(c => c.name) };
})(typeof globalThis !== "undefined" ? globalThis : this);
