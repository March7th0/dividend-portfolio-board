/* ============================================================
   云端分支验证套件（R36 · 专治「离线测试全绿、线上依然坏」）
   ─────────────────────────────────────────────────────────────
   为什么要单独一套：
     此前所有套件都在【离线模式】跑（initSdk() 返回 false），
     于是 fullReset / cloudLoadState / 档案落库这些【只在云端路径执行】
     的代码一次都没被覆盖 —— 测试全绿，线上照坏。
     本套件注入 __SMART_PAGE__.database 假实现，让 initSdk() 返回 true，
     真正走在线分支。

   复现的线上数据（实测抓取）：
     · 估值表持仓列残留：长电 300 / 工行 1300 / 国电 2100 / 格力 100 / 紫金 300 / 陕煤 100
     · 状态表 HOLDINGS[blink] 全 0（用户已手动卖出）
     · 状态表 PROFILE = {current:'blink', list:['blink','guest']}
   覆盖：
     C1 启动链确实加载状态表（此前 cloudLoadState 根本没有调用点）
     C2 估值表残留持仓被档案 HOLDINGS 覆盖清零（「重置后仓位还在」的直接根因）
     C3 云端档案列表生效 + 顶栏档案名显示
     C4 新建档案会写入 PROFILE 记录（此前该记录从未被写过 → 刷新即丢）
     C5 fullReset：估值表持仓列清零 + 状态表按档案分组 + 不冲掉其他档案
     C6 事件委托：资金条/弹层重建后，「重置」「切换档案」按钮依然可点
   运行：
     export NODE_PATH="C:/Users/qq444/node_modules"
     node tests/cloud.js
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
const TODAY = new Date().toISOString().slice(0, 10);

/* ---- 估值表：组合内 6 条带「僵尸持仓」（与线上实测一致）---- */
const VAL_ROWS = [
  { record_id:'v_cp', 标的名称:'长江电力', 代码:'600900.SH', 组合层级:'核心层', 目标仓位:20, 当前价格:28.36, 一手股数:100, 持仓数量:300,  持仓成本:28.36, 最近更新:TODAY, 加倍买入价:26, 正常定投上限:30, 减仓起始价:45 },
  { record_id:'v_gd', 标的名称:'国电电力', 代码:'600795.SH', 组合层级:'核心层', 目标仓位:20, 当前价格:5.24,  一手股数:100, 持仓数量:2100, 持仓成本:5.24,  最近更新:TODAY, 加倍买入价:4.5, 正常定投上限:5.5, 减仓起始价:5.8 },
  { record_id:'v_gs', 标的名称:'工商银行', 代码:'601398.SH', 组合层级:'核心层', 目标仓位:20, 当前价格:8.13,  一手股数:100, 持仓数量:1300, 持仓成本:8.13,  最近更新:TODAY, 加倍买入价:7, 正常定投上限:8.5, 减仓起始价:9.5 },
  { record_id:'v_gl', 标的名称:'格力电器', 代码:'000651.SZ', 组合层级:'卫星层', 目标仓位:10, 当前价格:38.36, 一手股数:100, 持仓数量:100,  持仓成本:38.36, 最近更新:TODAY, 加倍买入价:32, 正常定投上限:42, 减仓起始价:50 },
  { record_id:'v_zj', 标的名称:'紫金矿业', 代码:'601899.SH', 组合层级:'卫星层', 目标仓位:10, 当前价格:30.01, 一手股数:100, 持仓数量:300,  持仓成本:30.01, 最近更新:TODAY, 加倍买入价:25, 正常定投上限:33, 减仓起始价:40 },
  { record_id:'v_sx', 标的名称:'陕西煤业', 代码:'601225.SH', 组合层级:'卫星层', 目标仓位:10, 当前价格:25.83, 一手股数:100, 持仓数量:100,  持仓成本:25.83, 最近更新:TODAY, 加倍买入价:21, 正常定投上限:28, 减仓起始价:34 },
  { record_id:'v_out', 标的名称:'中国平安', 代码:'601318.SH', 组合层级:'排除', 目标仓位:0, 当前价格:55.23, 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY },
];
const IN_PORTFOLIO_IDS = ['v_cp','v_gd','v_gs','v_gl','v_zj','v_sx'];

/* ---- 状态表：HOLDINGS[blink] 全 0；PROFILE 含两个档案 ---- */
const ZERO_HOLD = {}; IN_PORTFOLIO_IDS.forEach(id => { ZERO_HOLD[id] = { qty: 0, cost: 0 }; });
const STATE_ROWS = [
  { record_id:'s_pools', 键:'POOLS',    更新时间:'2026-09-26T12:21:58Z', 数据: JSON.stringify({ blink:{}, guest:{} }) },
  { record_id:'s_pv2',   键:'PV2',      更新时间:'2026-09-26T12:21:58Z', 数据: JSON.stringify({
      blink:{ capital:null, monthly:5000, divPool:0, divSince:null, divMode:'single',
              pendingPool:45503, capitalLeft:50000, startISO:'2026-09-26', logs:[], phaseLock:null, __ts:'2026-09-26T12:21:58.000Z' },
      guest:{ capital:null, monthly:null, divPool:0, divSince:null, divMode:'single',
              pendingPool:0, capitalLeft:0, startISO:null, logs:[], phaseLock:null, __ts:'2026-09-26T10:00:00.000Z' } }) },
  { record_id:'s_hold',  键:'HOLDINGS', 更新时间:'2026-09-26T12:21:58Z', 数据: JSON.stringify({ blink: ZERO_HOLD, guest:{} }) },
  { record_id:'s_prof',  键:'PROFILE',  更新时间:'2026-09-26T12:21:58Z', 数据: JSON.stringify({ current:'blink', list:['blink','guest'] }) },
];

/* ---- 假 SDK（关键：让 initSdk() 返回 true → 走云端分支）---- */
const QUERY_LOG = [];
const UPDATE_LOG = [];
function makeDb(){
  return {
    getSchema: function(){ return Promise.resolve({ properties: [
      { name:'组合层级', type:'select', config:{ options:[{text:'核心层'},{text:'卫星层'},{text:'卫星层备选'},{text:'排除'}] } },
      { name:'跟踪状态', type:'select', config:{ options:[{text:'持有'},{text:'等待'}] } }
    ] }); },
    query: function(opts){
      var id = opts && opts.databaseId;
      QUERY_LOG.push(id);
      if (id === VAL_DB) return Promise.resolve({ results: VAL_ROWS, hasMore: false });
      if (id === STATE_DB) return Promise.resolve({ results: STATE_ROWS, hasMore: false });
      return Promise.resolve({ results: [], hasMore: false });
    },
    updateRecord: function(opts){ UPDATE_LOG.push(opts); return Promise.resolve({ ok: 1 }); },
    addRecord: function(opts){ UPDATE_LOG.push(opts); return Promise.resolve({ ok: 1 }); },
    onUpdated: function(){}
  };
}

const dom = new JSDOM(HTML, { runScripts:'outside-only', pretendToBeVisual:true, url:'https://local.test/' });
const w = dom.window;
w.__SMART_PAGE__ = { database: makeDb() };
w.confirm = function(){ return true; };
const script = (function(h){var tags=[],re=/<script[^>]*>([\s\S]*?)<\/script>/g,m;while((m=re.exec(h))!==null)tags.push(m[1]);return tags.sort(function(a,b){return b.length-a.length;})[0];})(HTML);
const bootErr = [];
w.addEventListener('error', function(e){ bootErr.push(String(e.message || e)); });
try { w.eval(script); } catch(e){ bootErr.push('eval: ' + e.message); }

const flush = function(ms){ return new Promise(function(r){ setTimeout(r, ms || 60); }); };
function Q(sel){ return w.document.querySelector(sel); }
/* ★ R39：确认框已从 window.confirm 改为页面内弹层 —— 测试改为点真实弹层按钮 */
function cfOk(){ var b = w.document.getElementById('cfOk'); if (b) b.dispatchEvent(new w.Event('click',{bubbles:true,cancelable:true})); return !!b; }
function cfCancel(){ var b = w.document.getElementById('cfCancel'); if (b) b.dispatchEvent(new w.Event('click',{bubbles:true,cancelable:true})); return !!b; }
function cfOpen(){ var h = w.document.getElementById('confirmSheet'); return !!(h && h.style.display === 'block'); }
function G(name){ return w.findByName(name); }

(async function main(){

  /* ════════════════════════════════════════════════════════════
     C1 启动链：必须加载状态表（此前 cloudLoadState 无任何调用点）
     ════════════════════════════════════════════════════════════ */
  console.log('\n【C1】启动链加载状态表');
  try { w.bindGlobalDelegates(); } catch(e){ bootErr.push('delegates: ' + e.message); }
  try { w.bootstrap(); } catch(e){ bootErr.push('bootstrap: ' + e.message); }
  await flush(120);

  ok('C1 估值表被查询', QUERY_LOG.indexOf(VAL_DB) >= 0, 'QUERY_LOG=' + JSON.stringify(QUERY_LOG));
  ok('C1 ★ 状态表被查询（cloudLoadState 真的被调用）', QUERY_LOG.indexOf(STATE_DB) >= 0,
     'QUERY_LOG=' + JSON.stringify(QUERY_LOG));
  eq('C1 估值表记录已载入 7 条', w.RECORDS.length, 7);

  /* ════════════════════════════════════════════════════════════
     C2 僵尸持仓被档案 HOLDINGS 清零（核心回归）
     ════════════════════════════════════════════════════════════ */
  console.log('\n【C2】估值表残留持仓被档案持仓覆盖（重置后仓位不该还在）');
  eq('C2 ★ 长电持仓清零（估值表残留 300 被 HOLDINGS 覆盖）', G('长江电力')[w.F.qty], 0);
  eq('C2 ★ 工行持仓清零（残留 1300）', G('工商银行')[w.F.qty], 0);
  eq('C2 ★ 国电持仓清零（残留 2100）', G('国电电力')[w.F.qty], 0);
  eq('C2 陕煤持仓清零（残留 100）', G('陕西煤业')[w.F.qty], 0);
  eq('C2 非组合标的保持 0', G('中国平安')[w.F.qty], 0);

  /* ════════════════════════════════════════════════════════════
     C3 云端档案列表 + 顶栏档案名
     ════════════════════════════════════════════════════════════ */
  console.log('\n【C3】档案列表来自云端');
  eq('C3 档案数量 = 2（云端 ['+"'blink','guest'"+']）', w.PROFILE.list.length, 2);
  ok('C3 guest 档案存在', w.PROFILE.list.indexOf('guest') >= 0, JSON.stringify(w.PROFILE.list));
  eq('C3 当前档案 = blink', w.PROFILE.current, 'blink');
  var pn = w.document.getElementById('profName');
  eq('C3 顶栏显示当前档案名', pn ? pn.textContent : '(缺元素)', 'blink');
  ok('C3 PROFILE_LOADED 已置位（允许回写档案列表）', w.PROFILE_LOADED === true);

  /* ════════════════════════════════════════════════════════════
     C4 新建档案必须落库（此前 PROFILE 记录从未被写过）
     ════════════════════════════════════════════════════════════ */
  console.log('\n【C4】新建档案写入 PROFILE 记录');
  UPDATE_LOG.length = 0;
  w.createProfile('测试档案X');
  await flush(80);
  /* ★ R43：档案列表仍写在固定键 PROFILE 的那条记录里（它是全局的） */
  var profWrites = UPDATE_LOG.filter(function(o){
    var pr = o.properties || {};
    return (pr['键'] && pr['键'].text === 'PROFILE') || o.recordId === 'DdLu2A8Zsa09jZL4awFNKP';
  });
  ok('C4 ★ PROFILE 记录被写入（此前 0 次）', profWrites.length >= 1, '写入次数=' + profWrites.length);
  if (profWrites.length){
    var payload = null;
    try { payload = JSON.parse(profWrites[profWrites.length-1].properties['数据'].text); } catch(e){}
    ok('C4 载荷含新档案名', !!(payload && payload.list && payload.list.indexOf('测试档案X') >= 0),
       JSON.stringify(payload));
    eq('C4 当前档案切到新档案', payload && payload.current, '测试档案X');
  }
  eq('C4 内存档案列表 = 3', w.PROFILE.list.length, 3);

  /* ════════════════════════════════════════════════════════════
     C5 fullReset：估值表清零 + 状态表分组 + 不冲掉其他档案
     ════════════════════════════════════════════════════════════ */
  console.log('\n【C5】初始化重置的云端写入');
  /* 回到 blink 档案并造一点仓位/池子出来，验证重置确实清得掉 */
  w.switchProfile('blink');
  await flush(80);
  G('长江电力')[w.F.qty] = 800;
  w.POOLS['v_cp'] = { amount: 12000, note:'' };
  w.PV2.pendingPool = 9999;
  UPDATE_LOG.length = 0;
  var btn = w.document.getElementById('fullResetBtn');
  ok('C5 重置按钮存在', !!btn);
  if (btn) btn.dispatchEvent(new w.Event('click', { bubbles:true, cancelable:true }));
  cfOk(); cfOk();                       /* ★ R39：点弹层两次「确定」（双确认） */
  await flush(120);

  eq('C5 内存：持仓归零', G('长江电力')[w.F.qty], 0);
  eq('C5 内存：本金归零', w.PV2.capital, null);
  eq('C5 内存：待分配池归零', w.PV2.pendingPool, 0);
  eq('C5 内存：标的池清空', Object.keys(w.POOLS).length, 0);

  var valWrites = UPDATE_LOG.filter(function(o){ return o.databaseId === VAL_DB; });
  var stateWrites = UPDATE_LOG.filter(function(o){ return o.databaseId === STATE_DB; });
  /* ★★ R41 行为变更（原断言是「写 6 条且都为 0」，现改为「一条都不写」）：
     估值表是【全档案共用】的一张表，重置写它会直接波及别的档案 ——
     这正是线上「重置一个档案，其他档案也被清空」的根因之一。
     现在重置只清当前档案的状态表分组；估值表的持仓列是历史遗留列，界面不再依赖它。 */
  eq('C5 ★★ 重置【不写】共用的估值表（避免波及别的档案）', valWrites.length, 0);
  ok('C5 ★ 状态表被写入（' + stateWrites.length + ' 条）', stateWrites.length >= 3,
     'stateWrites=' + stateWrites.length);

  /* ★ R43：改为「每档案独立记录」—— 重置时只写当前档案的那 3 条记录。
     核心断言：① 确实写了当前档案的池记录；② 写的是空的；③ 完全不碰其他档案的记录。 */
  function writesByKeyPrefix(pre){
    return UPDATE_LOG.filter(function(o){
      var pr = o.properties || {};
      return pr['键'] && String(pr['键'].text).indexOf(pre) === 0;
    });
  }
  var poolsW = writesByKeyPrefix('POOLS::');
  ok('C5 ★★ 重置写入了当前档案的池记录（' + poolsW.length + ' 条）', poolsW.length >= 1, 'n=' + poolsW.length);
  var poolsEmpty = poolsW.length > 0;
  for (var pi = 0; pi < poolsW.length; pi++){
    try { if (Object.keys(JSON.parse(poolsW[pi].properties['数据'].text)).length !== 0) poolsEmpty = false; } catch(e){ poolsEmpty = false; }
  }
  ok('C5 ★ 当前档案的池记录已清空', poolsEmpty);
  var holdW = writesByKeyPrefix('HOLDINGS::');
  var holdAllZero = holdW.length > 0;
  for (var hi = 0; hi < holdW.length; hi++){
    try {
      var ho2 = JSON.parse(holdW[hi].properties['数据'].text);
      for (var hk in ho2){ if (Object.prototype.hasOwnProperty.call(ho2, hk) && (ho2[hk] || {}).qty) holdAllZero = false; }
    } catch(e){ holdAllZero = false; }
  }
  ok('C5 持仓记录全部归零', holdAllZero);
  /* 未触碰其他档案：本测试里只有一个档案 blink，故断言写入的键都带 ::blink */
  var allKeys = UPDATE_LOG.map(function(o){ var pr=o.properties||{}; return pr['键'] ? pr['键'].text : ''; }).filter(function(x){ return !!x; });
  ok('C5 ★★ 未写入任何其他档案的记录',
     allKeys.every(function(k){ return k === 'PROFILE' || k.indexOf('::blink') > 0; }), JSON.stringify(allKeys));

  /* ════════════════════════════════════════════════════════════
     C6 事件委托：容器重建后按钮依然可点
     ════════════════════════════════════════════════════════════ */
  console.log('\n【C6】重建后按钮依然可点（事件委托）');
  /* 重建资金条（重置按钮所在容器） */
  w.renderPool();
  var btn2 = w.document.getElementById('fullResetBtn');
  ok('C6 重建后按钮仍在（带 data-act）', !!btn2 && btn2.getAttribute('data-act') === 'full-reset');
  if (btn2) btn2.dispatchEvent(new w.Event('click', { bubbles:true, cancelable:true }));
  /* ★ R39：不再依赖 confirm —— 断言「点击后弹出了页面内确认弹层」。
     注意若委托被重复挂载，会一次弹出多层（表现为点一次弹好几个框），
     故这里额外断言「弹层只有一层」（#cfOk 唯一）。 */
  ok('C6 ★ 重建后点击仍弹出确认弹层', cfOpen());
  ok('C6 ★ 弹层只有一层（委托未被重复挂载）',
     w.document.querySelectorAll('#confirmSheet #cfOk').length === 1,
     'cfOk 个数=' + w.document.querySelectorAll('#confirmSheet #cfOk').length);
  cfCancel();

  /* 重建档案弹层（#fundSheet）—— 旧写法在这里丢监听 */
  w.openFundSheet('profile');
  await flush(40);
  var sw = w.document.getElementById('profSwitch');
  ok('C6 档案弹层重建后按钮存在（带 data-act）', !!sw && sw.getAttribute('data-act') === 'prof-switch');
  var sel = w.document.getElementById('profSel');
  if (sel) sel.value = 'guest';
  if (sw) sw.dispatchEvent(new w.Event('click', { bubbles:true, cancelable:true }));
  await flush(80);
  eq('C6 ★ 重建后「切换档案」仍生效', w.PROFILE.current, 'guest');

  /* 再重建一次弹层，确认仍然有效（连续重建不失效） */
  w.openFundSheet('money');
  w.openFundSheet('profile');
  await flush(30);
  var sw2 = w.document.getElementById('profSwitch');
  var sel2 = w.document.getElementById('profSel');
  if (sel2) sel2.value = 'blink';
  if (sw2) sw2.dispatchEvent(new w.Event('click', { bubbles:true, cancelable:true }));
  await flush(80);
  eq('C6 ★ 反复重建后仍生效', w.PROFILE.current, 'blink');

  console.log('\n【运行时】');
  ok('★ 全程无运行时错误', bootErr.length === 0, bootErr.join(' | '));

  console.log('\n========================================');
  console.log('PASS: %d   FAIL: %d', PASS, FAIL);
  if (fails.length){ console.log('\n失败项：'); fails.forEach(function(f){ console.log('  ✗ ' + f); }); }
  else console.log('全部通过 ✓');
  process.exit(FAIL ? 1 : 0);
})();
