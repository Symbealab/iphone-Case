/* compare-symbea.js — 移植した symbea-core.js が Symbea Flower のサイトと同じ花を描くかを画像で確かめる
 *
 *   node tools/compare-symbea.js <Symbea-flower の docs/ のパス> <シード> [出力先 out/compare]
 *
 * 1. Symbea-flower の docs/ と、このリポジトリをローカルのサーバーで配信
 * 2. Playwright でサイトを ?seed= で開き、3 × 3 のキャンバスを PNG で保存（site.png）
 * 3. 同じシードを symbea-core.js で計算し、サイトと同じ塗り方（log・ガンマ・露出）で 3 × 3 に描いて保存（port.png）
 * 4. 2 枚を左右に並べた画像（side.png）と、マスごとの相関係数を出す
 * 依存: playwright（クラウド環境には入っている）
 */
"use strict";
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");

const [docs, seedArg, outDir = "out/compare"] = process.argv.slice(2);
if (!docs || !seedArg) { console.error("usage: node tools/compare-symbea.js <Symbea-flower/docs> <seed> [outDir]"); process.exit(1); }
const repo = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".wasm": "application/wasm" };
function serve(rootDir) {
  return new Promise(res => {
    const s = http.createServer((req, rsp) => {
      const p = path.join(rootDir, decodeURIComponent(new URL(req.url, "http://x").pathname));
      if (!p.startsWith(path.resolve(rootDir))) { rsp.writeHead(403); rsp.end(); return; }
      fs.readFile(fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, "index.html") : p, (e, d) => {
        if (e) { rsp.writeHead(404); rsp.end(); return; }
        rsp.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream" }); rsp.end(d);
      });
    }).listen(0, "127.0.0.1", () => res(s));
  });
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const sSite = await serve(path.resolve(docs)), sRepo = await serve(repo);
  const site = `http://127.0.0.1:${sSite.address().port}`, local = `http://127.0.0.1:${sRepo.address().port}`;
  const seed = String(seedArg).padStart(12, "0");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  // 1) サイト：既定の色（同色・水色・白背景）で描かせる。描き終わるまで待つ（点の数が増えなくなるまで）
  await page.goto(`${site}/index.html?seed=${seed}`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${site}/index.html?seed=${seed}`);
  // 探索中の表示（.busy）が消え、画像が 3 秒変わらなくなるまで待つ
  let prev = "", same = 0;
  for (let i = 0; i < 300 && same < 3; i++) {
    await page.waitForTimeout(1000);
    const [len, busy] = await page.evaluate(() => [document.getElementById("cv").toDataURL().length, document.querySelectorAll("#marks .busy:not([hidden])").length]);
    const sig = `${len}`;
    same = busy === 0 && sig === prev ? same + 1 : 0;
    prev = sig;
  }
  const siteData = await page.evaluate(() => document.getElementById("cv").toDataURL("image/png"));
  fs.writeFileSync(path.join(outDir, "site.png"), Buffer.from(siteData.split(",")[1], "base64"));

  // 2) 移植版：サイトと同じ配置・塗り方で描く
  await page.setContent("<canvas id=cv width=1440 height=1440></canvas>");
  await page.addScriptTag({ url: `${local}/case/js/symbea-core.js` });
  const res = await page.evaluate(async seed => {
    const SC = window.SymbeaCore, S = 1440, CELL = S / 3, C = Math.round(CELL * 0.92), info = [];
    const c = document.getElementById("cv"), ctx = c.getContext("2d"), img = ctx.createImageData(S, S);
    // サイトの既定色：水色 #4fb0e3 のランプ（白 → 色 → 深い色）を乗算。比較はトーン（明るさ）で行うので、ここでは灰色で描く
    const F = new Float32Array(S * S).fill(1);
    for (let i = 0; i < 9; i++) {
      const f = SC.flowerParams(seed, i), d = SC.densityField(f.q, f.ci, { C, total: 2.5e6, vary: 1 });
      info.push({ i, name: f.name, q: f.q });
      const lm = Math.log1p(d.max), ox = Math.round((i % 3 + 0.5) * CELL - C / 2), oy = Math.round((Math.floor(i / 3) + 0.5) * CELL - C / 2);
      for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
        const v = d.h[y * C + x]; if (!v) continue;
        const t = Math.min(1, Math.pow(Math.log1p(v) / lm, 1.19) * 1.5);
        F[(oy + y) * S + ox + x] *= 1 - 0.85 * t;
      }
    }
    for (let p = 0; p < S * S; p++) { const g = 255 * F[p]; img.data.set([g, g, g, 255], p * 4); }
    ctx.putImageData(img, 0, 0);
    return { info, png: c.toDataURL("image/png") };
  }, Number(seed));
  fs.writeFileSync(path.join(outDir, "port.png"), Buffer.from(res.png.split(",")[1], "base64"));

  // 3) 並べた画像とマスごとの相関（明るさ。サイトは色付きなので輝度に直して比べる）
  const cmp = await page.evaluate(async ([a, b]) => {
    const load = src => new Promise(r => { const im = new Image(); im.onload = () => r(im); im.src = src; });
    const [A, B] = await Promise.all([load(a), load(b)]), S = 1440, k = 0.5;
    const c = document.createElement("canvas"); c.width = S * k * 2 + 20; c.height = S * k;
    const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(A, 0, 0, S * k, S * k); ctx.drawImage(B, S * k + 20, 0, S * k, S * k);
    const px = im => { const cc = document.createElement("canvas"); cc.width = cc.height = S; const x = cc.getContext("2d"); x.drawImage(im, 0, 0); return x.getImageData(0, 0, S, S).data; };
    const da = px(A), db = px(B), corr = [];
    for (let i = 0; i < 9; i++) {
      const x0 = (i % 3) * S / 3, y0 = Math.floor(i / 3) * S / 3; let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, n = 0;
      for (let y = y0; y < y0 + S / 3; y += 2) for (let x = x0; x < x0 + S / 3; x += 2) {
        const o = (y * S + x) * 4, la = 255 - (da[o] * .299 + da[o + 1] * .587 + da[o + 2] * .114), lb = 255 - db[o];
        sa += la; sb += lb; saa += la * la; sbb += lb * lb; sab += la * lb; n++;
      }
      const cov = sab / n - sa * sb / n / n, va = saa / n - (sa / n) ** 2, vb = sbb / n - (sb / n) ** 2;
      corr.push(cov / Math.sqrt(va * vb));
    }
    return { png: c.toDataURL("image/png"), corr };
  }, [siteData, res.png]);
  fs.writeFileSync(path.join(outDir, "side.png"), Buffer.from(cmp.png.split(",")[1], "base64"));
  for (const f of res.info) console.log(`#${f.i + 1} ${f.name.padEnd(8, "　")} n=${f.q.n} λ=${(+f.q.lam).toFixed(4)}  相関 ${cmp.corr[f.i].toFixed(3)}`);
  await browser.close(); sSite.close(); sRepo.close();
  const bad = cmp.corr.filter(c => !(c > 0.9)).length;
  console.log(bad ? `NG: ${bad} マスの相関が 0.9 未満` : "OK: 9 マスすべて一致（相関 > 0.9）");
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
