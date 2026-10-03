/* ============================================================
   R37 复现 + 回归套件：三条线上反馈
     ① 新用户设了初始本金，无法用于买入建仓
     ② 操作流水的「全部清空」按钮无效（撤销按钮正常）
     ③ 买入后点「初始化重置」，持仓手数与资金都还在（重置又失效了）
   设计原则：**先用断言复现问题，再修到全绿**（不是修完补测试）。
   关键：全部走【云端分支】（注入假 SDK），因为这三条都涉及云端读写。
   运行：
     export NODE_PATH="C:/Users/qq444/node_modules"
     node tests/r37.js
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

/* ---- 假「服务端」：可被写入修改，并模拟平台 onUpdated 回声 ---- */
const VAL_ROWS = [
  { record_id:'v_cp', 标的名称:'长江电力', 代码:'600900.SH', 组合层级:'核心层', 目标仓位:40, 当前价格:28.36, 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:26, 正常定投上限:30, 减仓起始价:45 },
  { record_id:'v_gd', 标的名称:'国电电力', 代码:'600795.SH', 组合层级:'核心层', 目标仓位:40, 当前价格:5.24,  一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:4.5, 正常定投上限:5.5, 减仓起始价:5.8 },
  { record_id:'v_gs', 标的名称:'工商银行', 代码:'601398.SH', 组合层级:'核心层', 目标仓位:20, 当前价格:8.13,  一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:7, 正常定投上限:8.5, 减仓起始价:9.5 },
  { record_id:'v_sh', 标的名称:'中国神华', 代码:'601088.SH', 组合层级:'卫星层', 目标仓位:20, 当前价格:48.03, 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:35, 正常定投上限:42, 减仓起始价:60 },
];
/* ★ 必须用【真实 record_id】，否则 mock 的「服务端」匹配不到页面的写入，
   回声就会一直读到初始值 —— 那是测试桩失真，测不出真问题。 */
const R_POOLS = 'mC4rTAw4nEVRvqcrpFnf4K';
const R_PV2   = 'xHo47TEYkdMoLZhuqDRYsj';
const R_HOLD  = 'uxwbZTqSxwzwY2Ju7rk3w3';
const R_PROF  = 'DdLu2A8Zsa09jZL4awFNKP';
const STATE_ROWS = [
  { record_id: R_POOLS, 键:'POOLS',    更新时间:'2026-09-26T12:00:00Z', 数据: JSON.stringify({ blink:{} }) },
  { record_id: R_PV2,   键:'PV2',      更新时间:'2026-09-26T12:00:00Z', 数据: JSON.stringify({ blink:{ capital:null, monthly:null, divPool:0, divSince:null, divMode:'single', pendingPool:0, capitalLeft:0, startISO:null, logs:[], phaseLock:null, __ts:'2026-09-26T12:00:00.000Z' } }) },
  { record_id: R_HOLD,  键:'HOLDINGS', 更新时间:'2026-09-26T12:00:00Z', 数据: JSON.stringify({ blink:{} }) },
  { record_id: R_PROF,  键:'PROFILE',  更新时间:'2026-09-26T12:00:00Z', 数据: JSON.stringify({ current:'blink', list:['blink'] }) },
];

const QUERY_LOG = [];
const UPDATE_LOG = [];
let onUpdatedCb = null;
/* ★ 模拟真实竞态：估值表写入【立刻】生效（于是立刻触发 onUpdated 回声），
   状态表写入【延迟 40ms】生效 —— 回声就会读到还没更新的旧状态。 */
const STATE_WRITE_DELAY = 40;

function makeDb(){
  return {
    getSchema: function(){ return Promise.resolve({ properties: [
      { name:'组合层级', type:'select', config:{ options:[{text:'核心层'},{text:'卫星层'},{text:'卫星层备选'},{text:'排除'}] } },
      { name:'跟踪状态', type:'select', config:{ options:[{text:'持有'},{text:'等待'}] } }
    ] }); },
    query: function(opts){
      var id = opts && opts.databaseId;
      QUERY_LOG.push(id);
      if (id === VAL_DB)  return Promise.resolve({ results: VAL_ROWS.map(function(r){ return Object.assign({}, r); }), hasMore: false });
      if (id === STATE_DB) return Promise.resolve({ results: STATE_ROWS.map(function(r){ return Object.assign({}, r); }), hasMore: false });
      return Promise.resolve({ results: [], hasMore: false });
    },
    updateRecord: function(opts){
      UPDATE_LOG.push(opts);
      var valWrite = (opts.databaseId === VAL_DB);
      var apply = function(){
        var props = opts.properties || {};
        if (valWrite){
          for (var i = 0; i < VAL_ROWS.length; i++){
            if (VAL_ROWS[i].record_id === opts.recordId){
              if (props['持仓数量']) VAL_ROWS[i]['持仓数量'] = props['持仓数量'].number;
              if (props['持仓成本']) VAL_ROWS[i]['持仓成本'] = props['持仓成本'].number;
            }
          }
        } else {
          for (var j = 0; j < STATE_ROWS.length; j++){
            if (STATE_ROWS[j].record_id === opts.recordId && props['数据']){
              STATE_ROWS[j]['数据'] = props['数据'].text;
              STATE_ROWS[j]['更新时间'] = new Date().toISOString();
            }
          }
        }
      };
      if (valWrite) apply();                                   /* 立刻生效 → 立刻回声 */
      else setTimeout(apply, STATE_WRITE_DELAY);                /* 慢一拍 */
      /* ★ 平台行为：估值表变化 → 推送 onUpdated（不看是谁写的） */
      if (valWrite && onUpdatedCb) setTimeout(function(){ onUpdatedCb({ databaseIds: [VAL_DB] }); }, 1);
      return Promise.resolve({ ok: 1 });
    },
    addRecord: function(opts){ UPDATE_LOG.push(opts); return Promise.resolve({ ok: 1 }); },
    onUpdated: function(cb){ onUpdatedCb = cb; }
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

const flush = function(ms){ return new Promise(function(r){ setTimeout(r, ms || 80); }); };
function D(id){ return w.document.getElementById(id); }
function G(name){ return w.findByName(name); }
/* ★ R39：确认框已从 window.confirm 改为页面内弹层 —— 测试改为点真实弹层按钮 */
function cfOk(){ var b = w.document.getElementById('cfOk'); if (b) b.dispatchEvent(new w.Event('click',{bubbles:true,cancelable:true})); return !!b; }
function cfOpen(){ var h = w.document.getElementById('confirmSheet'); return !!(h && h.style.display === 'block'); }

(async function main(){

  /* ═══════════════ 启动（云端模式） ═══════════════ */
  try { w.bindGlobalDelegates(); } catch(e){ bootErr.push('delegates: ' + e.message); }
  try { w.bootstrap(); } catch(e){ bootErr.push('bootstrap: ' + e.message); }
  await flush(140);
  eq('启动：估值表载入 4 条', w.RECORDS.length, 4);
  eq('启动：当前档案 blink', w.PROFILE.current, 'blink');

  /* ════════════════════════════════════════════════════════════
     ② 操作流水「全部清空」按钮
     ════════════════════════════════════════════════════════════ */
  console.log('\n【②】操作流水「全部清空」按钮');
  w.PV2.capital = 50000; w.PV2.monthly = 3000; w.PV2.capitalLeft = 20000;
  w.POOLS['v_cp'] = { amount: 8000, note:'', since:'2026-09-26' };
  w.PV2.logs = [
    { seq:1, ts:'2026-09-26T01:00:00.000Z', type:'capital', label:'设定初始本金', amount:50000, detail:'' },
    { seq:2, ts:'2026-09-26T02:00:00.000Z', type:'monthly', label:'设定每月增量', amount:3000, detail:'' }
  ];
  var renderErr = null;
  try { w.renderPool(); } catch(e){ renderErr = e.message; }
  ok('② renderPool 无异常', renderErr === null, renderErr);

  var rst = D('pv2Reset');
  ok('② 「全部清空」按钮存在于 DOM', !!rst);
  ok('② 按钮可见（有非空 offsetParent 或文本）', !!(rst && rst.textContent.indexOf('全部清空') >= 0));

  var clickErr = null;
  if (rst){ try { rst.dispatchEvent(new w.Event('click', { bubbles:true, cancelable:true })); } catch(e){ clickErr = e.message; } }
  ok('② 点击无异常', clickErr === null, clickErr);
  /* ★ R39：确认框改页面内弹层 —— 点两次「确定」（严格两步） */
  ok('② ★ 第一次弹层打开', cfOpen());
  cfOk();
  ok('② ★ 第二次弹层打开（双确认）', cfOpen());
  cfOk();
  eq('② ★ 本金被清空', w.PV2.capital, null);
  eq('② ★ 月度被清空', w.PV2.monthly, null);
  eq('② ★ 流水被清空', w.PV2.logs.length, 0);
  eq('② ★ 标的池被清空', Object.keys(w.POOLS).length, 0);
  ok('② ★ 清空后界面已重渲染（未抛异常）', (function(){
    try { w.renderPool(); return true; } catch(e){ return false; }
  })());
  /* ★ 重建容器后仍可点（事件委托）—— 线上反馈它「点不动」，这里锁死 */
  w.renderPool();
  var rst2 = D('pv2Reset');
  ok('② 重建后按钮仍存在（带 data-act）', !!rst2 && rst2.getAttribute('data-act') === 'pv2-reset');
  w.PV2.capital = 12345; w.PV2.logs = [{ seq:1, ts:'2026-09-26T03:00:00.000Z', type:'capital', label:'x', amount:1, detail:'' }];
  w.renderPool();
  var rst3 = D('pv2Reset');
  if (rst3) rst3.dispatchEvent(new w.Event('click', { bubbles:true, cancelable:true }));
  ok('② ★ 重建后点击仍弹出弹层（委托）', cfOpen());
  cfOk(); cfOk();
  eq('② ★ 重建后清空生效', w.PV2.capital, null);

  /* ════════════════════════════════════════════════════════════
     ① 新档案：设本金 → 分配 → 买入
     ════════════════════════════════════════════════════════════ */
  console.log('\n【①】新档案：本金能否用于买入建仓');
  w.createProfile('测试B');
  await flush(120);
  eq('① 已切到新档案', w.PROFILE.current, '测试B');

  /* 设初始本金 */
  w.openFundSheet('money');
  await flush(30);
  var capIn = D('capIn'), capSet = D('capSet');
  ok('① 本金输入框存在', !!capIn && !!capSet);
  if (capIn){ capIn.value = '100000'; }
  if (capSet){ capSet.dispatchEvent(new w.Event('click', { bubbles:true, cancelable:true })); }
  await flush(60);
  eq('① 本金已记入', w.PV2.capital, 100000);
  eq('① 全部进「未分配本金」', w.PV2.capitalLeft, 100000);

  /* 分配资金到各池 */
  w.openFundSheet('split');
  await flush(30);
  var splitAmt = D('splitAmt'), splitGo = D('splitGo');
  ok('① 分配台输入框存在', !!splitAmt && !!splitGo);
  if (splitAmt){ splitAmt.value = '30000'; }
  var splitIsMonthly = D('splitIsMonthly');
  if (splitIsMonthly){ splitIsMonthly.checked = false; }   /* 意外资金口径（本金分配） */
  var splitPrevErr = null;
  if (splitGo){ try { splitGo.dispatchEvent(new w.Event('click', { bubbles:true, cancelable:true })); } catch(e){ splitPrevErr = e.message; } }
  ok('① 分配预览无异常', splitPrevErr === null, splitPrevErr);
  await flush(40);

  var planApply = D('planApply');
  ok('① 预览生成了「确认落地」按钮', !!planApply);
  var applyErr = null;
  if (planApply){ try { planApply.dispatchEvent(new w.Event('click', { bubbles:true, cancelable:true })); } catch(e){ applyErr = e.message; } }
  await flush(80);
  ok('① 落地无异常', applyErr === null, applyErr);

  var poolSum = 0;
  for (var pk in w.POOLS){ if (Object.prototype.hasOwnProperty.call(w.POOLS, pk)) poolSum += (w.num(w.POOLS[pk].amount) || 0); }
  ok('① ★ 分配的 3 万【全额落地】到池（合计 ' + poolSum + ' 元，旧行为只有 4400）', poolSum >= 29000, 'poolSum=' + poolSum);
  eq('① ★ 未分配本金相应减少', w.PV2.capitalLeft, 100000 - 30000);

  /* 买入 */
  var cpRec = G('长江电力');
  var cpId = cpRec ? cpRec._id : null;
  var poolBefore = cpId ? (w.num((w.POOLS[cpId] || {}).amount) || 0) : 0;
  ok('① 长电池里已有钱（' + poolBefore + ' 元）', poolBefore > 0, 'poolBefore=' + poolBefore);
  var buyErr = null;
  try { w.openBuySheet(cpId); } catch(e){ buyErr = e.message; }
  ok('① 买入弹层能打开', buyErr === null, buyErr);
  await flush(40);
  var buyGo = D('bsOk');
  ok('① 买入弹层有确认按钮', !!buyGo, 'button ids=' + Array.prototype.map.call(w.document.querySelectorAll('#buySheet button'), function(b){ return b.id; }).join(','));
  var qtyBefore = cpRec ? (w.num(cpRec[w.F.qty]) || 0) : 0;
  if (buyGo){ try { buyGo.dispatchEvent(new w.Event('click', { bubbles:true, cancelable:true })); } catch(e){} }
  await flush(100);
  var qtyAfter = G('长江电力') ? (w.num(G('长江电力')[w.F.qty]) || 0) : 0;
  ok('① ★ 买入成功：持仓从 ' + qtyBefore + ' → ' + qtyAfter, qtyAfter > qtyBefore, 'qtyAfter=' + qtyAfter);

  /* ════════════════════════════════════════════════════════════
     ③ 买入后「初始化重置」——重点：写入回声不得把数据带回来
     ════════════════════════════════════════════════════════════ */
  console.log('\n【③】买入后初始化重置（含平台 onUpdated 回声）');
  /* ★ 关键前置：等买入的持仓同步到云端（写入有 900ms 防抖）。
     不等就会出现「假通过」——云端 HOLDINGS 还是空对象，等价于已经清零，
     回声把空对象套回来当然也是 0。真实场景里用户买入后云端【已有持仓】，才会出事。 */
  await flush(1300);
  /* ★ R43：存储改为「每档案独立记录」（键 HOLDINGS::档案名）。
     这里改为断言「确实为当前档案写出过 HOLDINGS 记录」—— 等价地验证了时序前提。 */
  var holdWrites = UPDATE_LOG.filter(function(o){
    var pr = o.properties || {};
    return pr['键'] && String(pr['键'].text).indexOf('HOLDINGS::') === 0;
  });
  ok('③ 前置：已把持仓写入档案独立记录（' + holdWrites.length + ' 次）—— 复现真实时序', holdWrites.length > 0,
     'writes=' + holdWrites.length);

  var heldBefore = G('长江电力') ? (w.num(G('长江电力')[w.F.qty]) || 0) : 0;
  var poolSumBefore = 0;
  for (var pk2 in w.POOLS){ if (Object.prototype.hasOwnProperty.call(w.POOLS, pk2)) poolSumBefore += (w.num(w.POOLS[pk2].amount) || 0); }
  ok('③ 前置：确实有持仓（' + heldBefore + ' 股）+ 资金（' + poolSumBefore + ' 元）', heldBefore > 0 && poolSumBefore > 0,
     'held=' + heldBefore + ' pool=' + poolSumBefore);

  UPDATE_LOG.length = 0;
  var resetBtn = D('fullResetBtn');
  ok('③ 重置按钮存在', !!resetBtn);
  if (resetBtn){ resetBtn.dispatchEvent(new w.Event('click', { bubbles:true, cancelable:true })); }
  cfOk(); cfOk();                      /* ★ R39：点弹层两次「确定」 */
  await flush(60);      /* 让写入 + 回声都跑起来 */

  /* 立刻检查（此时回声可能正在把旧数据套回来） */
  var heldRightAfter = G('长江电力') ? (w.num(G('长江电力')[w.F.qty]) || 0) : 0;
  eq('③ 重置后立即：持仓归零', heldRightAfter, 0);
  eq('③ 重置后立即：本金归零', w.PV2.capital, null);
  eq('③ 重置后立即：标的池清空', Object.keys(w.POOLS).length, 0);

  /* ★ 关键：等回声跑完（估值表写入 → onUpdated → loadAll → afterLoad → cloudLoadState） */
  await flush(400);
  var heldAfterEcho = G('长江电力') ? (w.num(G('长江电力')[w.F.qty]) || 0) : 0;
  var poolSumAfter = 0;
  for (var pk3 in w.POOLS){ if (Object.prototype.hasOwnProperty.call(w.POOLS, pk3)) poolSumAfter += (w.num(w.POOLS[pk3].amount) || 0); }
  eq('③ ★ 回声跑完后：持仓仍为 0（不被云端旧值带回）', heldAfterEcho, 0);
  eq('③ ★ 回声跑完后：标的池仍为空', Object.keys(w.POOLS).length, 0);
  eq('③ ★ 回声跑完后：本金仍为 null', w.PV2.capital, null);

  /* 服务端（假云端）也应该是干净的 */
  var srvHold = null;
  try { srvHold = JSON.parse(STATE_ROWS.filter(function(r){ return r.record_id === R_HOLD; })[0]['数据'])['测试B']; } catch(e){}
  var srvHoldSum = 0;
  if (srvHold){ for (var hk in srvHold){ if (Object.prototype.hasOwnProperty.call(srvHold, hk)) srvHoldSum += (w.num((srvHold[hk] || {}).qty) || 0); } }
  eq('③ ★ 云端 HOLDINGS 也是空的', srvHoldSum, 0);

  /* 刷新页面（模拟用户重新打开）→ 依然干净 */
  var dom2 = new JSDOM(HTML, { runScripts:'outside-only', pretendToBeVisual:true, url:'https://local.test/' });
  var w2 = dom2.window;
  w2.__SMART_PAGE__ = { database: makeDb() };
  w2.confirm = function(){ return true; };
  try { w2.eval(script); } catch(e){}
  try { w2.bindGlobalDelegates(); } catch(e){}
  try { w2.bootstrap(); } catch(e){}
  await flush(200);
  var cp2 = w2.findByName('长江电力');
  eq('③ ★ 重新打开页面：持仓仍为 0（不再「仓位还在」）', cp2 ? (w2.num(cp2[w2.F.qty]) || 0) : -1, 0);

  console.log('\n【运行时】');
  ok('★ 全程无运行时错误', bootErr.length === 0, bootErr.join(' | '));

  console.log('\n========================================');
  console.log('PASS: %d   FAIL: %d', PASS, FAIL);
  if (fails.length){ console.log('\n失败项：'); fails.forEach(function(f){ console.log('  ✗ ' + f); }); }
  else console.log('全部通过 ✓');
  process.exit(FAIL ? 1 : 0);
})();
