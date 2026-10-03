/* ============================================================
   R41 档案隔离专项（P0）：跨档案数据污染
   ─────────────────────────────────────────────────────────────
   线上现象（用户报告）：
     ① 在测试档案「1」里设资金池 + 买入，切到 blink 后数据【一模一样】
     ② 在档案「1」里点初始化重置，【其他档案也被清空】
   两个 bug 的根因：
     A. cloudLoadState 的「认领」分支：目标档案在 HOLDINGS 里没有条目时，
        把全局共享的 RECORDS 当前值认领给该档案 —— 而 RECORDS 此刻装的是
        【另一个档案】的持仓（估值表是共用表，RECORDS 是它的内存镜像）
     B. doFullReset 会写【全档案共用】的估值表持仓列 → 其他档案的兜底源被清零，
        再叠加 A 的认领行为 → 其他档案的数据被清空
   覆盖：
     I1 多档案持仓隔离：切换后各自显示自己的持仓
     I2 ★ 目标档案在 HOLDINGS 无条目时，必须得【空持仓】，绝不能认领别人的 RECORDS
     I3 ★ 重置只影响当前档案：其他档案的云端分组必须原样不动
     I4 ★ 重置不再写共用的估值表
     I5 本地缓存带档案归属：属于别的档案的缓存不得被采用
   运行：
     export NODE_PATH="C:/Users/qq444/node_modules"
     node tests/r41.js
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
const R_POOLS = 'mC4rTAw4nEVRvqcrpFnf4K';
const R_PV2   = 'xHo47TEYkdMoLZhuqDRYsj';
const R_HOLD  = 'uxwbZTqSxwzwY2Ju7rk3w3';
const R_PROF  = 'DdLu2A8Zsa09jZL4awFNKP';
const TODAY = new Date().toISOString().slice(0, 10);

const VAL_ROWS = [
  { record_id:'v_cp', 标的名称:'长江电力', 代码:'600900.SH', 组合层级:'核心层', 目标仓位:50, 当前价格:28.36, 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:26, 正常定投上限:30, 减仓起始价:45 },
  { record_id:'v_gd', 标的名称:'国电电力', 代码:'600795.SH', 组合层级:'核心层', 目标仓位:50, 当前价格:5.24,  一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:4.5, 正常定投上限:5.5, 减仓起始价:5.8 },
];

/* 服务端数据（可被写入修改）—— 两个档案的数据【明显不同】，便于识别串档 */
function freshState(){
  return {
    POOLS: { blink: { v_cp: { amount: 50000, note:'', since:'2026-09-01' } },
             '1':   { v_gd: { amount: 7000,  note:'', since:'2026-09-20' } } },
    PV2: { blink: { capital: 300000, monthly:null, divPool:0, divSince:null, divMode:'single',
                    pendingPool:0, capitalLeft:250000, startISO:null, logs:[], phaseLock:null, __ts:'2026-09-26T14:00:00.000Z' },
           '1':   { capital: 20000, monthly:null, divPool:0, divSince:null, divMode:'single',
                    pendingPool:0, capitalLeft:13000, startISO:null, logs:[], phaseLock:null, __ts:'2026-09-26T14:00:00.000Z' } },
    HOLDINGS: { blink: { v_cp: { qty: 3000, cost: 28.36 } },     /* 长江电力 3000 股 */
                '1':   { v_gd: { qty: 100,  cost: 5.24 } } },    /* 国电电力 100 股 */
    PROFILE: { current:'blink', list:['blink','1'], meta: { blink:{admin:true,pass:''}, '1':{admin:false,pass:''} } }
  };
}
let SRV = freshState();

const UPDATE_LOG = [];
function makeDb(){
  return {
    getSchema: function(){ return Promise.resolve({ properties: [
      { name:'组合层级', type:'select', config:{ options:[{text:'核心层'},{text:'卫星层'},{text:'卫星层备选'},{text:'排除'}] } },
      { name:'跟踪状态', type:'select', config:{ options:[{text:'持有'},{text:'等待'}] } } ] }); },
    query: function(o){
      var id = o && o.databaseId;
      if (id === VAL_DB)  return Promise.resolve({ results: VAL_ROWS.map(function(r){ return Object.assign({}, r); }), hasMore: false });
      if (id === STATE_DB) return Promise.resolve({ results: [
        { record_id: R_POOLS, 键:'POOLS',    更新时间:'2026-09-26T14:00:00Z', 数据: JSON.stringify(SRV.POOLS) },
        { record_id: R_PV2,   键:'PV2',      更新时间:'2026-09-26T14:00:00Z', 数据: JSON.stringify(SRV.PV2) },
        { record_id: R_HOLD,  键:'HOLDINGS', 更新时间:'2026-09-26T14:00:00Z', 数据: JSON.stringify(SRV.HOLDINGS) },
        { record_id: R_PROF,  键:'PROFILE',  更新时间:'2026-09-26T14:00:00Z', 数据: JSON.stringify(SRV.PROFILE) }
      ], hasMore: false });
      return Promise.resolve({ results: [], hasMore: false });
    },
    updateRecord: function(o){
      UPDATE_LOG.push(o);
      var props = o.properties || {};
      if (o.databaseId === STATE_DB && props['数据']){
        var txt = props['数据'].text;
        if (o.recordId === R_POOLS) SRV.POOLS = JSON.parse(txt);
        else if (o.recordId === R_PV2) SRV.PV2 = JSON.parse(txt);
        else if (o.recordId === R_HOLD) SRV.HOLDINGS = JSON.parse(txt);
        else if (o.recordId === R_PROF) SRV.PROFILE = JSON.parse(txt);
      }
      return Promise.resolve({ ok: 1 });
    },
    addRecord: function(o){ UPDATE_LOG.push(o); return Promise.resolve({ ok: 1 }); },
    onUpdated: function(){}
  };
}

const dom = new JSDOM(HTML, { runScripts:'outside-only', pretendToBeVisual:true, url:'https://local.test/' });
const w = dom.window;
w.__SMART_PAGE__ = { database: makeDb() };
w.localStorage.clear();
const script = (function(h){var tags=[],re=/<script[^>]*>([\s\S]*?)<\/script>/g,m;while((m=re.exec(h))!==null)tags.push(m[1]);return tags.sort(function(a,b){return b.length-a.length;})[0];})(HTML);
const bootErr = [];
w.addEventListener('error', function(e){ bootErr.push(String(e.message || e)); });
try { w.eval(script); } catch(e){ bootErr.push('eval: ' + e.message); }

const flush = function(ms){ return new Promise(function(r){ setTimeout(r, ms || 80); }); };
function D(id){ return w.document.getElementById(id); }
function click(el){ if (el) el.dispatchEvent(new w.Event('click', { bubbles:true, cancelable:true })); }
function cfOk(){ click(D('cfOk')); }
function cfCancel(){ click(D('cfCancel')); }
function ciType(v){ var i = D('ciVal'); if (i) i.value = v; }
function ciOk(){ click(D('ciOk')); }
function heldQty(name){ var r = w.findByName(name); return r ? (w.num(r[w.F.qty]) || 0) : -1; }
function poolAmtOf(rid, who){
  var bags = (who === w.PROFILE.current) ? w.POOLS : ((w.STATE_CACHE.pools || {})[who] || {});
  return w.num((bags[rid] || {}).amount) || 0;
}

(async function main(){

  try { w.bindGlobalDelegates(); } catch(e){ bootErr.push('delegates: ' + e.message); }
  try { w.poolLoad(); w.pv2Load(); w.pv2Migrate(); } catch(e){ bootErr.push('boot: ' + e.message); }
  try { w.bootstrap(); } catch(e){ bootErr.push('bootstrap: ' + e.message); }
  await flush(200);

  /* ════════════════════════════════════════════════════════════
     I1 多档案持仓隔离
     ════════════════════════════════════════════════════════════ */
  console.log('\n【I1】切换档案后，各自显示自己的持仓');
  eq('I1 启动后当前档案 = blink', w.PROFILE.current, 'blink');
  eq('I1 ★ blink 持仓 = 自己的 3000 股（长电）', heldQty('长江电力'), 3000);
  eq('I1 ★ blink 国电持仓 = 0（不是「1」的 100 股）', heldQty('国电电力'), 0);

  w.openFundSheet('profile');
  await flush(40);
  var sel = D('profSel'); if (sel) sel.value = '1';
  click(D('profSwitch'));
  await flush(120);
  eq('I1 已切到档案「1」', w.PROFILE.current, '1');
  eq('I1 ★ 档案「1」持仓 = 自己的 100 股（国电）', heldQty('国电电力'), 100);
  eq('I1 ★ 档案「1」长电持仓 = 0（不是 blink 的 3000 股）', heldQty('长江电力'), 0);

  /* 切回 blink 复核 */
  w.openFundSheet('profile'); await flush(30);
  var sel2 = D('profSel'); if (sel2) sel2.value = 'blink';
  click(D('profSwitch'));
  await flush(120);
  eq('I1 ★ 切回 blink 后仍是自己的 3000 股', heldQty('长江电力'), 3000);
  eq('I1 ★ 切回 blink 后国电仍为 0', heldQty('国电电力'), 0);

  /* ════════════════════════════════════════════════════════════
     I2 ★ 目标档案在 HOLDINGS 无条目 → 必须得空持仓，绝不认领
     ════════════════════════════════════════════════════════════ */
  console.log('\n【I2】目标档案在 HOLDINGS 里无条目时，必须是空持仓（不得认领别人的）');
  /* 造一个第三档案「新用户」，它在 HOLDINGS 里【完全没有条目】 */
  w.PROFILE.list.push('新用户');
  w.profMeta('新用户').pass = '';
  SRV.PROFILE.list = w.PROFILE.list.slice();
  await flush(40);
  /* 此刻 RECORDS 里装着 blink 的持仓（长电 3000）——"认领"会把 3000 写给新用户 */
  w.openFundSheet('profile'); await flush(30);
  var sel3 = D('profSel'); if (sel3) sel3.value = '新用户';
  click(D('profSwitch'));
  await flush(150);
  eq('I2 已切到「新用户」', w.PROFILE.current, '新用户');
  eq('I2 ★ 新用户持仓 = 0（没有被认领 blink 的 3000 股）', heldQty('长江电力'), 0);
  var newHold = (SRV.HOLDINGS['新用户'] || {});
  var newSum = 0;
  for (var k in newHold) if (Object.prototype.hasOwnProperty.call(newHold, k)) newSum += (w.num(newHold[k].qty) || 0);
  eq('I2 ★ 云端也没有给新用户写入别人的持仓', newSum, 0);

  /* ════════════════════════════════════════════════════════════
     I3 ★ 重置只影响当前档案
     ════════════════════════════════════════════════════════════ */
  console.log('\n【I3】初始化重置只清当前档案，其他档案不受影响');
  /* 切回「1」并在里面放点东西 */
  w.openFundSheet('profile'); await flush(30);
  var sel4 = D('profSel'); if (sel4) sel4.value = '1';
  click(D('profSwitch'));
  await flush(120);
  eq('I3 当前档案 = 「1」', w.PROFILE.current, '1');

  var blinkPoolsBefore = JSON.stringify(SRV.POOLS['blink']);
  var blinkPv2Before   = JSON.stringify(SRV.PV2['blink']);
  var blinkHoldBefore  = JSON.stringify(SRV.HOLDINGS['blink']);
  ok('I3 前置：blink 有池数据', SRV.POOLS['blink'] && Object.keys(SRV.POOLS['blink']).length > 0);
  ok('I3 前置：blink 有持仓数据', blinkHoldBefore.indexOf('3000') >= 0, blinkHoldBefore);

  UPDATE_LOG.length = 0;
  click(D('fullResetBtn'));
  cfOk(); cfOk();
  await flush(150);

  eq('I3 ★ 当前档案「1」的持仓已清零', heldQty('国电电力'), 0);
  eq('I3 ★ 当前档案「1」的池已清空', Object.keys(w.POOLS).length, 0);
  /* 云端其他档案必须原样不动 */
  eq('I3 ★★ 云端 blink 的池【未被改动】', JSON.stringify(SRV.POOLS['blink']), blinkPoolsBefore);
  eq('I3 ★★ 云端 blink 的流水/本金【未被改动】', JSON.stringify(SRV.PV2['blink']), blinkPv2Before);
  /* 持仓：允许多一次写入，但内容必须仍是 3000 股 */
  var blinkHoldAfter = JSON.stringify(SRV.HOLDINGS['blink']);
  ok('I3 ★★ 云端 blink 的持仓仍是 3000 股（未被清）',
     blinkHoldAfter.indexOf('3000') >= 0, 'before=' + blinkHoldBefore + ' after=' + blinkHoldAfter);
  /* 状态下发只应写 4 条状态表记录 */
  var stateWrites = UPDATE_LOG.filter(function(o){ return o.databaseId === STATE_DB; });
  ok('I3 重置写入了状态表（' + stateWrites.length + ' 条）', stateWrites.length >= 1);

  /* ════════════════════════════════════════════════════════════
     I4 ★ 重置不得再写【共用的】估值表
     ════════════════════════════════════════════════════════════ */
  console.log('\n【I4】重置不再写全档案共用的估值表');
  var valWrites = UPDATE_LOG.filter(function(o){ return o.databaseId === VAL_DB; });
  eq('I4 ★★ 重置期间对估值表的写入次数 = 0（估值表全档案共用，写它会波及别人）', valWrites.length, 0);

  /* ════════════════════════════════════════════════════════════
     I5 本地缓存带档案归属
     ════════════════════════════════════════════════════════════ */
  console.log('\n【I5】本地缓存必须带档案归属（防「重新加载后显示上一个档案的数据」）');
  ok('I5 ★ 缓存里记录了所属档案', w.localStorage.getItem('wb_portfolio_pool_v2__prof') !== null,
     'got=' + w.localStorage.getItem('wb_portfolio_pool_v2__prof'));

  console.log('\n【运行时】');
  ok('★ 全程无运行时错误', bootErr.length === 0, bootErr.join(' | '));

  console.log('\n========================================');
  console.log('PASS: %d   FAIL: %d', PASS, FAIL);
  if (fails.length){ console.log('\n失败项：'); fails.forEach(function(f){ console.log('  ✗ ' + f); }); }
  else console.log('全部通过 ✓');
  process.exit(FAIL ? 1 : 0);
})();
