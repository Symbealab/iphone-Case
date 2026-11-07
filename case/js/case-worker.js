/* case-worker.js — 花の計算・輪郭・manifold の立体を UI と別スレッドで行う（module Worker） */
import Module from "../../vendor/manifold/manifold.js";
import "../../js/pipeline.js";
import "./symbea-core.js";
import "./case-geom.js";

const CG = globalThis.CaseGeom, CP = globalThis.CoasterPipeline;
const wasmReady = Module().then(w => { w.setup(); return w; });
const post = (m, tr) => self.postMessage(m, tr || []);
const status = text => post({ type: "status", text });

// 花の密度場（重い）と輪郭はキャッシュし、関係するパラメータが変わったときだけ作り直す
let srcKey = "", src = null;
const ringCache = new Map();
function flower(F) {
  const k = [F.seed, F.idx, F.vary, F.res, F.points].join();
  if (k !== srcKey) {
    status("花を計算中… 0%");
    src = CG.flowerSource(F, p => status(`花を計算中… ${Math.round(p * 100)}%`));
    srcKey = k; ringCache.clear();
    post({ type: "flower", name: src.name, n: src.n, q: src.params });
  }
  const rk = [F.diameter, F.rotate, F.threshold, F.grow, F.island, F.blur, F.highpass, F.smooth, F.cell].join();
  if (!ringCache.has(rk)) {
    status("刻印の輪郭を作成中…");
    const r = CG.flowerRings(src, F);
    if (ringCache.size > 6) ringCache.clear();
    ringCache.set(rk, r.rings);
  }
  return ringCache.get(rk);
}
function stats(r) {
  const w = CP.checkWatertight(r.indices);
  return { size: r.bbox.size, volume: r.volume, triangles: r.triangles, watertight: w.ok && (!r.status || r.status === "NoError"),
           genus: r.genus, engrave: r.engrave || null, profile: r.profile || null };
}

self.onmessage = async e => {
  const m = e.data;
  try {
    const wasm = await wasmReady;
    const F = { ...CG.FLOWER_DEFAULTS, ...m.F };
    if (m.type === "build") {
      const rings = m.engrave ? flower(F) : null;
      status("立体を作成中…");
      const r = m.kind === "plate" ? CG.buildPlate(wasm, m.plate, rings) : CG.buildCase(wasm, m.P, rings);
      const pos = r.positions;
      post({ type: "result", job: m.job, positions: pos, rings, stats: stats(r) }, [pos.buffer]);
    } else if (m.type === "batch") {
      // 試験片をまとめて作り、1 枚に並べる
      const list = [];
      if (m.kind === "fit") {
        for (const clr of m.clrs) { status(`フィット試験片（隙間 ${clr.toFixed(2)}）を作成中…`); list.push(CG.buildCase(wasm, { ...m.P, clr, engrave: false }, null)); }
      } else {
        let n = 0;
        for (const th of m.thresholds) {
          const rings = flower({ ...F, threshold: th });
          for (const depth of m.depths) { n++; status(`刻印試験片 ${n} / ${m.thresholds.length * m.depths.length} を作成中…`); list.push(CG.buildPlate(wasm, { ...m.plate, depth, mark: n }, rings)); }
        }
      }
      const ok = list.every(r => CP.checkWatertight(r.indices).ok);
      const a = CG.arrange(list, m.kind === "fit" ? 1 : m.depths.length, m.kind === "fit" ? 8 : 6);
      post({ type: "batch", job: m.job, kind: m.kind, positions: a.positions, size: a.bbox.size, volume: a.volume, count: list.length, watertight: ok }, [a.positions.buffer]);
    }
  } catch (err) {
    post({ type: "error", job: m.job, text: err && err.message ? err.message : String(err) });
  }
};
