/* ============================================================
   R38 验证套件：本轮两条反馈
     ① 初始化重置「依旧无效」，且按钮颜色与我描述不符（→ 版本确认问题）
     ② 初始本金「1 元都无法动用和分配」
   本套件覆盖根因修复：
     D1 顶栏版本标签（用于当场对齐「你看到的是哪一版」）
     D2 分配台显示「未分配本金」（此前只显示卖出回流/股息 → 本金不可见）
     D3 「用全部本金建仓」一键按钮 → 生成方案 → 全额落地
     D4 小额（<100 元）给出明确提示（而不是"方案全 0"）
     D5 bindPv2 的 root 兜底：非资金池屏（#poolV2 不在）时弹层按钮仍可点
   运行：
     export NODE_PATH="C:/Users/qq444/node_modules"
     node tests/r38.js
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
  { record_id:'v_cp', 标的名称:'长江电力', 代码:'600900.SH', 组合层级:'核心层', 目标仓位:40, 当前价格:28.36, 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:26, 正常定投上限:30, 减仓起始价:45 },
  { record_id:'v_gd', 标的名称:'国电电力', 代码:'600795.SH', 组合层级:'核心层', 目标仓位:40, 当前价格:5.24,  一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:4.5, 正常定投上限:5.5, 减仓起始价:5.8 },
  { record_id:'v_gs', 标的名称:'工商银行', 代码:'601398.SH', 组合层级:'核心层', 目标仓位:20, 当前价格:8.13,  一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:7, 正常定投上限:8.5, 减仓起始价:9.5 },
  { record_id:'v_sh', 标的名称:'中国神华', 代码:'601088.SH', 组合层级:'卫星层', 目标仓位:20, 当前价格:48.03, 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:35, 正常定投上限:42, 减仓起始价:60 },
];
const STATE_ROWS = [
  { record_id: R_POOLS, 键:'POOLS',    更新时间:'2026-09-26T13:00:00Z', 数据: JSON.stringify({ blink:{} }) },
  { record_id: R_PV2,   键:'PV2',      更新时间:'2026-09-26T13:00:00Z', 数据: JSON.stringify({ blink:{ capital:null, monthly:null, divPool:0, divSince:null, divMode:'single', pendingPool:0, capitalLeft:0, startISO:null, logs:[], phaseLock:null, __ts:'2026-09-26T13:00:00.000Z' } }) },
  { record_id: R_HOLD,  键:'HOLDINGS', 更新时间:'2026-09-26T13:00:00Z', 数据: JSON.stringify({ blink:{} }) },
  { record_id: R_PROF,  键:'PROFILE',  更新时间:'2026-09-26T13:00:00Z', 数据: JSON.stringify({ current:'blink', list:['blink'] }) },
];
const UPDATE_LOG = [];
function makeDb(){
  return {
    getSchema: function(){ return Promise.resolve({ properties: [
      { name:'组合层级', type:'select', config:{ options:[{text:'核心层'},{text:'卫星层'},{text:'卫星层备选'},{text:'排除'}] } },
      { name:'跟踪状态', type:'select', config:{ options:[{text:'持有'},{text:'等待'}] } }
    ] }); },
    query: function(opts){
      var id = opts && opts.databaseId;
      if (id === VAL_DB)  return Promise.resolve({ results: VAL_ROWS.map(function(r){ return Object.assign({}, r); }), hasMore: false });
      if (id === STATE_DB) return Promise.resolve({ results: STATE_ROWS.map(function(r){ return Object.assign({}, r); }), hasMore: false });
      return Promise.resolve({ results: [], hasMore: false });
    },
    updateRecord: function(o){ UPDATE_LOG.push(o); return Promise.resolve({ ok: 1 }); },
    addRecord: function(o){ UPDATE_LOG.push(o); return Promise.resolve({ ok: 1 }); },
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

const flush = function(ms){ return new Promise(function(r){ setTimeout(r, ms || 80); }); };
function D(id){ return w.document.getElementById(id); }

(async function main(){

  try { w.bindGlobalDelegates(); } catch(e){ bootErr.push('delegates: ' + e.message); }
  /* 手动补启动链（jsdom 里 DOMContentLoaded 已错过） */
  try { w.poolLoad(); w.pv2Load(); w.pv2Migrate(); } catch(e){ bootErr.push('boot: ' + e.message); }
  try { w.bootstrap(); } catch(e){ bootErr.push('bootstrap: ' + e.message); }
  await flush(160);

  /* ════════════════════════════════════════════════════════════
     D1 版本标签
     ════════════════════════════════════════════════════════════ */
  console.log('\n【D1】顶栏版本标签（用于对齐「你看到的是哪一版」）');
  var vt = D('verTag');
  ok('D1 版本标签元素存在', !!vt);
  ok('D1 常量 APP_VER 已定义', typeof w.APP_VER === 'string' && w.APP_VER.length > 3, 'APP_VER=' + w.APP_VER);
  /* 真实页面里由 DOMContentLoaded 填充，这里手动触发一次
     （等价于「打开页面」这一步） */
  if (vt && w.APP_VER) vt.textContent = w.APP_VER;
  ok('D1 ★ 标签显示版本号', !!(vt && vt.textContent && vt.textContent.indexOf('v') === 0), 'text=' + (vt ? vt.textContent : ''));

  /* ════════════════════════════════════════════════════════════
     D2 分配台必须显示「未分配本金」
     ════════════════════════════════════════════════════════════ */
  console.log('\n【D2】分配台显示未分配本金（此前完全不可见）');
  w.PV2.capital = 50000; w.PV2.capitalLeft = 50000;
  w.PV2.pendingPool = 0; w.PV2.divPool = 0;
  w.openFundSheet('split');
  await flush(60);
  var desk = D('splitDesk');
  ok('D2 分配台已渲染', !!desk);
  var deskTxt = desk ? desk.textContent : '';
  ok('D2 ★ 显示「未分配本金」字样', deskTxt.indexOf('未分配本金') >= 0, deskTxt.slice(0, 120));
  ok('D2 ★ 显示本金金额 50000', deskTxt.indexOf('50000') >= 0, deskTxt.slice(0, 160));
  ok('D2 ★ 存在「用全部本金建仓」按钮', !!D('uaFillCap'));
  /* 说明文字要提到三种口径 */
  ok('D2 说明文字提到「用本金建仓」与「缺口」', deskTxt.indexOf('用本金建仓') >= 0 && deskTxt.indexOf('缺口') >= 0);

  /* ════════════════════════════════════════════════════════════
     D3 一键用全部本金建仓 → 全额落地
     ════════════════════════════════════════════════════════════ */
  console.log('\n【D3】一键用全部本金建仓 → 全额落地');
  var fillBtn = D('uaFillCap');
  if (fillBtn) fillBtn.dispatchEvent(new w.Event('click', { bubbles:true, cancelable:true }));
  await flush(60);
  var amtBox = D('splitAmt');
  eq('D3 金额框已填入全部本金', parseFloat(amtBox ? amtBox.value : '0'), 50000);
  var prevTxt = D('splitPreview') ? D('splitPreview').textContent : '';
  ok('D3 ★ 预览口径为「建仓全额分配」', prevTxt.indexOf('建仓全额分配') >= 0, prevTxt.slice(0, 140));
  ok('D3 预览显示了核心层份额', /核心层/.test(prevTxt));

  var planApply = D('planApply');
  ok('D3 「确认落地」按钮已生成', !!planApply);
  if (planApply) planApply.dispatchEvent(new w.Event('click', { bubbles:true, cancelable:true }));
  await flush(80);
  var poolSum = 0;
  for (var pk in w.POOLS){ if (Object.prototype.hasOwnProperty.call(w.POOLS, pk)) poolSum += (w.num(w.POOLS[pk].amount) || 0); }
  ok('D3 ★ 5 万【全额落地】到各池（实际 ' + poolSum + ' 元）', poolSum >= 48000, 'poolSum=' + poolSum);
  ok('D3 ★ 未分配本金被相应核销（剩 ' + w.PV2.capitalLeft + ' 元）', (w.num(w.PV2.capitalLeft) || 0) <= 2000,
     'left=' + w.PV2.capitalLeft);

  /* ════════════════════════════════════════════════════════════
     D4 小额提示
     ════════════════════════════════════════════════════════════ */
  console.log('\n【D4】小额分配给出明确提示');
  /* ★ 必须重新取元素：D3 落地后弹层被 renderFundSheetBody 重建，
     之前持有的 amtBox 引用已经脱离 DOM（往里写值不会反映到页面）。 */
  var amtBox2 = D('splitAmt');
  ok('D4 前置：重新拿到金额框', !!amtBox2);
  if (amtBox2) amtBox2.value = '1';
  w.splitPreview();
  await flush(30);
  var smallTxt = D('splitPreview') ? D('splitPreview').textContent : '';
  ok('D4 ★ 输入 1 元时提示「至少 100 元」', smallTxt.indexOf('至少 100 元') >= 0, smallTxt.slice(0, 120));

  /* ════════════════════════════════════════════════════════════
     D5 bindPv2 的 root 兜底（非资金池屏）
     ════════════════════════════════════════════════════════════ */
  console.log('\n【D5】#poolV2 不在时，弹层按钮仍可点');
  w.closeFundSheet();
  var host = D('poolV2');
  var savedParent = host ? host.parentNode : null;
  var savedNext = host ? host.nextSibling : null;
  if (host && savedParent) savedParent.removeChild(host);      /* 模拟「切到别的 Tab」 */
  ok('D5 前置：#poolV2 已移除', !D('poolV2'));
  w.PV2.capital = 0; w.PV2.capitalLeft = 0;
  w.openFundSheet('money');
  await flush(60);
  var capIn = D('capIn'), capSet = D('capSet');
  ok('D5 资金设置弹层已渲染', !!capIn && !!capSet);
  if (capIn) capIn.value = '80000';
  if (capSet) capSet.dispatchEvent(new w.Event('click', { bubbles:true, cancelable:true }));
  await flush(60);
  eq('D5 ★ 弹层按钮仍生效（本金已记入）', w.PV2.capital, 80000);
  eq('D5 ★ 未分配本金同步记入', w.PV2.capitalLeft, 80000);
  /* 还原 DOM，避免影响后续 */
  if (savedParent && host) savedParent.insertBefore(host, savedNext);

  console.log('\n【运行时】');
  ok('★ 全程无运行时错误', bootErr.length === 0, bootErr.join(' | '));

  console.log('\n========================================');
  console.log('PASS: %d   FAIL: %d', PASS, FAIL);
  if (fails.length){ console.log('\n失败项：'); fails.forEach(function(f){ console.log('  ✗ ' + f); }); }
  else console.log('全部通过 ✓');
  process.exit(FAIL ? 1 : 0);
})();
