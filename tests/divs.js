/* ============================================================
   R73 股息账本 + 作战简报套件
   ─────────────────────────────────────────────────────────────
   覆盖:
     D1 SDK mock 模式:卡片渲染、记一笔(DIVS + 云端 DIVIDENDS 键落库)、年合计/累计/股息率
     D2 删除一笔
     D3 重新 bootstrap → 股息账本从云端恢复(持久化)
     D4 GH 模式:记一笔 → data/state/DIVIDENDS.json 落仓
     D5 简报:点📋 → 剪贴板内容含 标题/可买/减仓/股息 段落
     D6 演示模式:卡片安全渲染(空账本不崩)
   运行:node tests/divs.js(mock fetch / mock SDK,无网络)
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
const STATE_DB = 'gkfII6uQEsbgZHkbLCmAdl';
const TODAY = '2026-10-04';
const CLIP = [];

function makeSdkMock(w){
  /* 云端状态表:SRV[键] = {record_id, 数据};估值表静态 3 条 */
  const VAL = [
    { record_id:'v_gs', 标的名称:'工商银行', 代码:'601398.SH', 组合层级:'核心层', 目标仓位:15, 当前价格:8.13, 一手股数:100, 持仓数量:500, 持仓成本:8.00, 最近更新:TODAY, 加倍买入价:7, 正常定投上限:8.5, 减仓起始价:9.5 },
    { record_id:'v_cp', 标的名称:'长江电力', 代码:'600900.SH', 组合层级:'核心层', 目标仓位:25, 当前价格:28.36, 一手股数:100, 持仓数量:300, 持仓成本:28.00, 最近更新:TODAY, 加倍买入价:26, 正常定投上限:30, 减仓起始价:45 }
  ];
  const SRV = {
    'POOLS::blink': { rid:'s1', 数据:{ v_gs:{ amount: 8000 } }, ts:'2026-10-01T00:00:00Z' },
    'PV2::blink':   { rid:'s2', 数据:{ capital:50000, capitalLeft:42000, pendingPool:0, divPool:0, logs:[] }, ts:'2026-10-01T00:00:00Z' },
    'HOLDINGS::blink': { rid:'s3', 数据:{ v_gs:{ qty:500, cost:8 } }, ts:'2026-10-01T00:00:00Z' },
    'PROFILE': { rid:'s4', 数据:{ current:'blink', list:['blink'], meta:{} }, ts:'2026-10-01T00:00:00Z' }
  };
  let n = 100;
  w.__SMART_PAGE__ = { database: {
    getSchema: function(){ return Promise.resolve({ properties: [] }); },
    query: function(o){ const id = o && o.databaseId;
      if (id === VAL_DB) return Promise.resolve({ results: VAL, hasMore: false });
      if (id === STATE_DB) return Promise.resolve({ results: Object.keys(SRV).map(function(k){
        return { record_id: SRV[k].rid, '键': k, '数据': JSON.stringify(SRV[k].数据), '更新时间': SRV[k].ts }; }), hasMore: false });
      return Promise.resolve({ results: [], hasMore: false });
    },
    updateRecord: function(o){ const k = Object.keys(SRV).find(function(x){ return SRV[x].rid === o.recordId; });
      if (k){ SRV[k].数据 = JSON.parse(o.properties['数据'].text); SRV[k].ts = o.properties['更新时间'].date; }
      return Promise.resolve({ ok: 1 }); },
    addRecord: function(o){ n++; const rid = 'n' + n; const k = o.properties['键'].text;
      SRV[k] = { rid: rid, 数据: JSON.parse(o.properties['数据'].text), ts: o.properties['更新时间'].date };
      return Promise.resolve({ record_id: rid }); },
    onUpdated: function(){}
  }};
  return { SRV: SRV, VAL: VAL };
}
function makeGhMock(w, files){
  const shas = {};
  function shaOf(t){ let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0; return 's' + h.toString(16); }
  function refresh(k){ shas[k] = shaOf(files[k]); }
  Object.keys(files).forEach(refresh);
  const b64d = s => Buffer.from(String(s), 'base64').toString('utf8');
  const b64e = t => Buffer.from(t, 'utf8').toString('base64');
  function listDir(dir){
    const names = Object.keys(files).filter(k => k.indexOf(dir + '/') === 0);
    const seen = {}, out = [];
    for (const k of names){ const rest = k.slice(dir.length+1), top = rest.split('/')[0], full = dir + '/' + top;
      if (seen[full]) continue; seen[full] = 1;
      out.push({ name: top, path: full, type: rest.indexOf('/') >= 0 ? 'dir' : 'file', sha: shas[full] }); }
    return out;
  }
  w.fetch = function(url, opts){
    opts = opts || {};
    const u = String(url).replace('https://api.github.com/', '');
    const m = u.match(/^repos\/[^/]+\/[^/]+\/contents\/?(.*)$/);
    const p = m ? m[1].replace(/\?ref=.*$/, '') : '';
    const accept = (opts.headers && opts.headers.Accept) || '';
    const raw = accept.indexOf('raw') >= 0;
    if ((opts.method||'GET') === 'PUT'){ const body = JSON.parse(opts.body); files[p] = b64d(body.content); refresh(p);
      return Promise.resolve({ ok:true, status:200, json: async()=>({content:{sha:shas[p]}}), text: async()=>'' }); }
    if (p === '' || p === 'data') return Promise.resolve({ ok:true, status:200, json: async()=>listDir('data'), text: async()=>JSON.stringify(listDir('data')) });
    if (p === 'data/state') return Promise.resolve({ ok:true, status:200, json: async()=>listDir('data/state'), text: async()=>JSON.stringify(listDir('data/state')) });
    if (files[p] === undefined) return Promise.resolve({ ok:false, status:404, json: async()=>({}), text: async()=>'' });
    if (raw) return Promise.resolve({ ok:true, status:200, json: async()=>({}), text: async()=>files[p] });
    return Promise.resolve({ ok:true, status:200, json: async()=>({ sha: shas[p], content: b64e(files[p]) }), text: async()=>'' });
  };
  return { files: files };
}
const script = (function(h){var tags=[],re=/<script[^>]*>([\s\S]*?)<\/script>/g,m;while((m=re.exec(h))!==null)tags.push(m[1]);return tags.sort(function(a,b){return b.length-a.length;})[0];})(HTML);
const flush = function(ms){ return new Promise(function(r){ setTimeout(r, ms || 80); }); };
function setDivInputs(w, vals){
  w.document.getElementById('divDate').value = vals.date || '2026-10-04';
  w.document.getElementById('divName').value = vals.name || '工商银行';
  w.document.getElementById('divAmt').value = String(vals.amount || 123.45);
  w.document.getElementById('divNote').value = vals.note || '2025年度分红';
}
function clickAct(w, act, id){
  const b = w.document.querySelector('[data-act="' + act + '"]' + (id ? '[data-id="' + id + '"]' : ''));
  if (b) b.dispatchEvent(new w.Event('click', { bubbles: true, cancelable: true }));
  return !!b;
}

(async function main(){
  const files = {
    'data/records.json': JSON.stringify([
      { _id:'v_gs', record_id:'v_gs', 标的名称:'工商银行', 代码:'601398.SH', 组合层级:'核心层', 当前价格:8.13, 最近更新:TODAY, 加倍买入价:7, 正常定投上限:8.5, 减仓起始价:9.5 },
      { _id:'v_cp', record_id:'v_cp', 标的名称:'长江电力', 代码:'600900.SH', 组合层级:'核心层', 当前价格:28.36, 最近更新:TODAY, 加倍买入价:26, 正常定投上限:30, 减仓起始价:45 }]),
    'data/state/PROFILE.json': JSON.stringify({ '键':'PROFILE', '数据':{ current:'blink', list:['blink'], meta:{} }, '更新时间':'2026-10-01T00:00:00Z' }),
    'data/state/POOLS__blink.json': JSON.stringify({ '键':'POOLS::blink', '数据':{}, '更新时间':'2026-10-01T00:00:00Z' })
  };

  console.log('\n【D1】SDK 模式:股息账本渲染与记一笔');
  const dom1 = new JSDOM(HTML, { runScripts:'outside-only', pretendToBeVisual:true, url:'https://wb.test/' });
  const w1 = dom1.window;
  const sdk = makeSdkMock(w1);
  w1.__SMART_PAGE__ = { database: w1.__SMART_PAGE__.database };
  w1.eval(script);
  w1.bindGlobalDelegates();
  w1.bootstrap();
  await flush(250);
  eq('D1 DATA_MODE=sdk', w1.DATA_MODE, 'sdk');
  ok('D1 股息卡片已渲染', !!w1.document.getElementById('divsCard').innerHTML);
  ok('D1 卡片含「股息账本」', w1.document.getElementById('divsCard').innerHTML.indexOf('股息账本') >= 0);
  setDivInputs(w1, { name:'工商银行', amount:123.45, note:'2025年度分红', date:'2026-06-15' });
  ok('D1 记一笔按钮存在', clickAct(w1, 'div-add'));
  await flush(300);
  eq('D1 ★ DIVS 内存 1 笔', w1.DIVS.length, 1);
  ok('D1 ★ 云端状态表 DIVIDENDS 键已落库', !!sdk.SRV['DIVIDENDS'], !!sdk.SRV['DIVIDENDS']);
  const saved = sdk.SRV['DIVIDENDS'] ? sdk.SRV['DIVIDENDS'].数据 : [];
  ok('D1 ★ 落库内容正确(工商银行 123.45)', Array.isArray(saved) && saved[0].name === '工商银行' && saved[0].amount === 123.45, JSON.stringify(saved));
  const card = w1.document.getElementById('divsCard').innerHTML;
  ok('D1 年合计/累计可见', card.indexOf('123.45') >= 0 && card.indexOf('累计股息') >= 0);

  console.log('\n【D2】删除一笔');
  const theId = w1.DIVS[0].id;
  ok('D2 删除按钮存在', clickAct(w1, 'div-del', theId));
  await flush(200);
  eq('D2 ★ DIVS 清空', w1.DIVS.length, 0);
  console.log('DBG D2 SRV.DIVIDENDS:', JSON.stringify(sdk.SRV['DIVIDENDS']));
  eq('D2 ★ 云端同步清空', (sdk.SRV['DIVIDENDS'].数据 || []).length, 0);

  console.log('\n【D3】重新 bootstrap → 账本持久化(先记两笔)');
  setDivInputs(w1, { name:'工商银行', amount:100, date:'2026-06-15' });
  clickAct(w1, 'div-add');
  setDivInputs(w1, { name:'长江电力', amount:250, date:'2026-09-15' });
  clickAct(w1, 'div-add');
  await flush(300);
  const dom1b = new JSDOM(HTML, { runScripts:'outside-only', pretendToBeVisual:true, url:'https://wb.test/' });
  const w1b = dom1b.window;
  w1b.__SMART_PAGE__ = { database: w1.__SMART_PAGE__.database };   /* 同一"云端" */
  w1b.eval(script);
  w1b.bindGlobalDelegates();
  w1b.bootstrap();
  await flush(300);
  eq('D3 ★ 重新加载后账本恢复(2 笔)', w1b.DIVS.length, 2);
  ok('D3 卡片累计金额正确(350)', w1b.document.getElementById('divsCard').innerHTML.indexOf('350') >= 0);

  console.log('\n【D4】GH 模式:记一笔 → 数据仓落盘');
  const dom2 = new JSDOM(HTML, { runScripts:'outside-only', pretendToBeVisual:true, url:'https://gh.test/' });
  const w2 = dom2.window;
  const gh = makeGhMock(w2, files);
  w2.eval(script);
  w2.bindGlobalDelegates();
  w2.localStorage.setItem('dpb_gh_token', 'github_pat_T');
  w2.bootstrap();
  await flush(350);
  eq('D4 DATA_MODE=gh', w2.DATA_MODE, 'gh');
  setDivInputs(w2, { name:'工商银行', amount:66.66, date:'2026-08-20' });
  ok('D4 记一笔', clickAct(w2, 'div-add'));
  await flush(300);
  eq('D4 DIVS 1 笔', w2.DIVS.length, 1);
  ok('D4 ★ 数据仓 DIVIDENDS.json 落盘', !!gh.files['data/state/DIVIDENDS.json'], 'missing');
  const ghSaved = JSON.parse(gh.files['data/state/DIVIDENDS.json']);
  ok('D4 ★ 落盘内容正确(66.66)', ghSaved['数据'][0].amount === 66.66, gh.files['data/state/DIVIDENDS.json'].slice(0, 140));

  console.log('\n【D5】作战简报');
  const clipCalls = [];
  Object.defineProperty(w2.navigator, 'clipboard', { value: { writeText: function(t){ CLIP.push(t); return Promise.resolve(); } }, configurable: true });
  w2.document.getElementById('briefBtn').dispatchEvent(new w2.Event('click', { bubbles: true, cancelable: true }));
  await flush(200);
  ok('D5 ★ 剪贴板被写入', CLIP.length === 1, CLIP.length);
  const txt = CLIP[0] || '';
  ok('D5 标题含 作战简报与当日日期(日期无关断言,防日期滚动)', txt.indexOf('作战简报') >= 0 && txt.indexOf(w1.dateStr(w1.todayISO())) >= 0, txt.slice(0, 120));
  ok('D5 含档位分段(今日可买/等回落/减仓档)', txt.indexOf('今日可买') >= 0 && txt.indexOf('等回落') >= 0 && txt.indexOf('减仓档') >= 0);
  ok('D5 含标的行(工商银行 8.13)', txt.indexOf('工商银行 8.13') >= 0, txt.slice(0, 300));
  ok('D5 含资金与股息摘要', txt.indexOf('组合市值') >= 0 && txt.indexOf('本年股息') >= 0);

  console.log('\n【D6】演示模式:卡片安全渲染');
  const dom3 = new JSDOM(HTML, { runScripts:'outside-only', pretendToBeVisual:true, url:'https://demo.test/' });
  const w3 = dom3.window;
  /* 演示模式也要有缓存数据(离线场景:数据源断了但 localStorage 有底) */
  w3.localStorage.setItem('wb_portfolio_val_v1', JSON.stringify([
    { record_id:'v_gs', 标的名称:'工商银行', 代码:'601398.SH', 组合层级:'核心层', 当前价格:8.13, 最近更新:TODAY }]));
  w3.eval(script);
  w3.bindGlobalDelegates();
  w3.bootstrap();
  await flush(200);
  eq('D6 演示模式', w3.DATA_MODE, 'demo');
  ok('D6 卡片安全渲染(空账本)', !!w3.document.getElementById('divsCard').innerHTML);
  setDivInputs(w3, { name:'工商银行', amount:10 });
  console.log('DBG D6 inputs:', w3.document.getElementById('divDate').value, '|',
    w3.document.getElementById('divName').value, '|', w3.document.getElementById('divAmt').value);
  ok('D6 无数据源时记一笔不崩', clickAct(w3, 'div-add'));
  console.log('DBG D6 after click: DIVS=', JSON.stringify(w3.DIVS), ' DATA_MODE=', w3.DATA_MODE);
  await flush(150);
  eq('D6 内存暂存 1 笔(刷新即失提示由 toast 承担)', w3.DIVS.length, 1);

  console.log('\n──── R73 结果 ────');
  console.log('PASS ' + PASS + ' / FAIL ' + FAIL);
  fails.forEach(function(f){ console.log('  ✗ ' + f); });
  process.exit(FAIL ? 1 : 0);
})();