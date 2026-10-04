/* ============================================================
   R72 行情快照套件(GitHub 数据仓 market/ + 一键应用)
   ─────────────────────────────────────────────────────────────
   覆盖:
     M1 无 token → 演示模式,行情条隐藏(向后兼容)
     M2 有 token + 数据仓有快照 → 提示条出现(只数/日期/变化数)
     M3 一键应用 → 记录价格/MA/RSI 更新 + applied 标记 + 提示条隐藏
     M4 已应用 → 再检查不重复提示
     M5 轮询感知行情目录变化 → 提示条重现(新快照)
     M6 快照里无匹配标的 → 不误提示
   运行:node tests/market.js(mock fetch,无网络)
   ============================================================ */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.resolve(__dirname, '..', 'portfolio-workbench.html'), 'utf8');

let PASS = 0, FAIL = 0;
const fails = [];
function ok(name, cond, extra){ if (cond){ PASS++; } else { FAIL++; fails.push(name + (extra ? ' → ' + extra : '')); } }
function eq(name, got, want){ ok(name, got === want, 'got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }

const VAL_DB = 'RZJijiIkrKlwRQExwHjH0y';
const TODAY = '2026-10-04';

const SEED_RECORDS = [
  { _id:'v_cp', record_id:'v_cp', 标的名称:'长江电力', 代码:'600900.SH', 组合层级:'核心层', 当前价格:28.10, 一手股数:100, 最近更新:'2026-10-01' },
  { _id:'v_gl', record_id:'v_gl', 标的名称:'格力电器', 代码:'000651.SZ', 组合层级:'卫星层', 当前价格:38.10, 一手股数:100, 最近更新:'2026-10-01' },
  { _id:'v_x',  record_id:'v_x',  标的名称:'无码标的',  组合层级:'卫星层', 当前价格:1.00,  一手股数:100, 最近更新:'2026-10-01' }
];
const MARKET = {
  updated: '2026-09-30',
  generatedAt: '2026-10-02T08:00:00Z',
  items: {
    '600900.SH': { name:'长江电力', price:28.54, prevClose:28.38, ma20:28.31, ma60:28.25, rsi14:55.85, date:'2026-09-30' },
    '000651.SZ': { name:'格力电器', price:38.28, prevClose:38.10, ma20:38.47, ma60:38.48, rsi14:47.32, date:'2026-09-30' },
    '999999.XX': { name:'不在估值表里', price:1.23, date:'2026-09-30' }
  }
};

function makeGhMock(w, files){
  const shas = {};
  function shaOf(t){ let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0; return 'sha_' + h.toString(16); }
  function refresh(k){ shas[k] = shaOf(files[k]); }
  Object.keys(files).forEach(refresh);
  function b64d(s){ return Buffer.from(String(s), 'base64').toString('utf8'); }
  function b64e(t){ return Buffer.from(t, 'utf8').toString('base64'); }
  function listDir(dir){
    const names = Object.keys(files).filter(function(k){ return k.indexOf(dir + '/') === 0; });
    const seen = {}, out = [];
    for (const k of names){
      const rest = k.slice(dir.length + 1), top = rest.split('/')[0];
      const full = dir + '/' + top;
      if (seen[full]) continue; seen[full] = 1;
      const isDir = rest.indexOf('/') >= 0;
      let sha = shas[full];
      if (isDir){
        const childShas = Object.keys(files).filter(function(k2){ return k2.indexOf(full + '/') === 0; })
          .map(function(k2){ return shas[k2] || shaOf(files[k2]); }).join(',');
        sha = shaOf(top + '|' + childShas);
      }
      out.push({ name: top, path: full, type: isDir ? 'dir' : 'file', sha: sha });
    }
    return out;
  }
  w.fetch = function(url, opts){
    opts = opts || {};
    const u = String(url).replace('https://api.github.com/', '');
    const mm = u.match(/^repos\/[^/]+\/[^/]+\/contents\/?(.*)$/);
    if (!mm){ if (/^repos\/[^/]+\/[^/]+$/.test(u)) return resp(200, { name: 'mock-ok' }); return resp(404, {}); }
    const p = mm[1].replace(/\?ref=.*$/, '');
    const accept = (opts.headers && opts.headers.Accept) || '';
    const raw = accept.indexOf('raw') >= 0;
    if ((opts.method || 'GET') === 'PUT'){
      const body = JSON.parse(opts.body);
      files[p] = b64d(body.content); refresh(p);
      return resp(200, { content: { sha: shas[p] } });
    }
    if (files[p] !== undefined){
      if (raw) return resp(200, {}, files[p]);
      return resp(200, { sha: shas[p], content: b64e(files[p]) });
    }
    if (p === '' || p === 'data') return resp(200, listDir('data'));
    if (p === 'data/market') return resp(200, listDir('data/market'));
    if (p === 'data/state') return resp(200, listDir('data/state'));
    return resp(404, {});
  };
  function resp(status, obj, text){
    return Promise.resolve({ ok: status < 300, status: status,
      json: async function(){ return obj; }, text: async function(){ return (text !== undefined) ? text : JSON.stringify(obj); } });
  }
  return {
    files: files,
    addFile: function(k, v){ files[k] = v; refresh(k); },
    read: function(k){ return files[k] ? JSON.parse(files[k]) : null; }
  };
}
function makeDom(files, token){
  const dom = new JSDOM(HTML, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://gh.test/' });
  const w = dom.window;
  makeGhMock(w, files);
  const script = (function(h){var tags=[],re=/<script[^>]*>([\s\S]*?)<\/script>/g,m;while((m=re.exec(h))!==null)tags.push(m[1]);return tags.sort(function(a,b){return b.length-a.length;})[0];})(HTML);
  try { w.eval(script); } catch(e){}
  if (token) w.localStorage.setItem('dpb_gh_token', token);
  return w;
}
const flush = function(ms){ return new Promise(function(r){ setTimeout(r, ms || 80); }); };
function barText(w){ const b = w.document.getElementById('marketBar'); return b ? b.textContent : ''; }
function barVisible(w){ const b = w.document.getElementById('marketBar'); return !!(b && b.style.display === 'block'); }

(async function main(){
  const base = {
    'data/records.json': JSON.stringify(SEED_RECORDS),
    'data/state/PROFILE.json': JSON.stringify({ '键':'PROFILE', '数据':{ current:'blink', list:['blink'], meta:{} }, '更新时间':'2026-10-01T00:00:00Z' }),
    'data/state/POOLS__blink.json': JSON.stringify({ '键':'POOLS::blink', '数据':{}, '更新时间':'2026-10-01T00:00:00Z' }),
    'data/market/latest.json': JSON.stringify(MARKET),
    'data/market/history/sh600900.json': JSON.stringify([{ date:'2026-09-30', close:28.54 }])
  };

  console.log('\n【M1】无 token → 演示模式,行情条隐藏');
  const w1 = makeDom(Object.assign({}, base), '');
  w1.bindGlobalDelegates(); w1.bootstrap();
  await flush(250);
  eq('M1 DATA_MODE=demo', w1.DATA_MODE, 'demo');
  ok('M1 ★ 行情条不出现', !barVisible(w1), barText(w1));

  console.log('\n【M2】有 token → 快照提示条出现');
  const w2 = makeDom(Object.assign({}, base), 'github_pat_T');
  w2.bindGlobalDelegates(); w2.bootstrap();
  await flush(400);
  eq('M2 DATA_MODE=gh', w2.DATA_MODE, 'gh');
  eq('M2 记录 3 条', w2.RECORDS.length, 3);
  ok('M2 ★ 行情条出现', barVisible(w2), barText(w2));
  ok('M2 文案含日期与只数', barText(w2).indexOf('2026-09-30') >= 0 && barText(w2).indexOf('2 只价格有变化') >= 0, barText(w2));

  console.log('\n【M3】一键应用');
  w2.document.getElementById('mktApply').dispatchEvent(new w2.Event('click', { bubbles: true, cancelable: true }));
  await flush(700);
  const cp = w2.findByName('长江电力');
  ok('M3 ★ 长电价格更新为 28.54', cp && cp['当前价格'] === 28.54, cp && cp['当前价格']);
  ok('M3 ★ MA20/MA60/RSI14 已写入', cp['MA20'] === 28.31 && cp['MA60'] === 28.25 && cp['RSI14'] === 55.85, JSON.stringify([cp['MA20'], cp['MA60'], cp['RSI14']]));
  const gl = w2.findByName('格力电器');
  ok('M3 格力价格更新为 38.28', gl && gl['当前价格'] === 38.28, gl && gl['当前价格']);
  eq('M3 applied 标记已存', w2.ghMarketAppliedGet(), MARKET.updated);
  ok('M3 ★ 提示条隐藏', !barVisible(w2), barText(w2));

  console.log('\n【M4】已应用 → 再检查不重复提示');
  w2.ghMarketCheck();
  await flush(200);
  ok('M4 ★ 不重复出现', !barVisible(w2), barText(w2));

  console.log('\n【M5】轮询感知新快照 → 提示条重现');
  const newMarket = JSON.parse(JSON.stringify(MARKET));
  newMarket.updated = '2026-10-05';
  newMarket.items['600900.SH'].price = 29.10;
  const w2mock_files = null;      /* mock 直接持有 files:通过 fetch 侧写 */
  /* 模拟 Action 写入新快照:换新文件系统(与真实 Action 提交等价) */
  const files2 = Object.assign({}, base);
  files2['data/market/latest.json'] = JSON.stringify(newMarket);
  w2.ghPollOnce();                             /* 先建基线 sha(首轮只建基线不触发) */
  await flush(150);
  const mock2 = makeGhMock(w2, files2);        /* 换新文件系统 = 模拟 Action 提交后的远端 */
  w2.SELF_WRITE_UNTIL = 0;
  w2.ghPollOnce();                             /* 轮询感知 market 目录 sha 变化 → ghMarketCheck */
  await flush(400);
  ok('M5 ★ 新快照提示条重现', barVisible(w2) && barText(w2).indexOf('2026-10-05') >= 0, barText(w2));
  w2.document.getElementById('mktApply').dispatchEvent(new w2.Event('click', { bubbles: true, cancelable: true }));
  await flush(700);
  const cp2 = w2.findByName('长江电力');
  ok('M5 ★ 应用新价格 29.10', cp2 && cp2['当前价格'] === 29.10, cp2 && cp2['当前价格']);

  console.log('\n【M6】快照无匹配标的 → 不误提示');
  const w3 = makeDom({
    'data/records.json': JSON.stringify([{ _id:'v_x', record_id:'v_x', 标的名称:'无码标的', 代码:'', 当前价格:1 }]),
    'data/state/PROFILE.json': JSON.stringify({ '键':'PROFILE', '数据':{ current:'blink', list:['blink'], meta:{} }, '更新时间':'2026-10-01T00:00:00Z' }),
    'data/market/latest.json': JSON.stringify(MARKET)
  }, 'github_pat_T');
  w3.bindGlobalDelegates(); w3.bootstrap();
  await flush(400);
  ok('M6 ★ 无匹配标的不出现提示条', !barVisible(w3), barText(w3));

  console.log('\n──── R72 结果 ────');
  console.log('PASS ' + PASS + ' / FAIL ' + FAIL);
  fails.forEach(function(f){ console.log('  ✗ ' + f); });
  process.exit(FAIL ? 1 : 0);
})();