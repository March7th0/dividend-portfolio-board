/* ============================================================
   UI / 交互改动验证套件（R26「试用反馈」轮）
   对应 6 条反馈：
     #1 初始本金没有去向，买入只能用月度资金
     #2 操作流水缺类型筛选 + 应限高滚动
     #3 资金池屏太长（本金/月度/股息/股息再分配/新增资金分配 平铺）
     #4 不知道每个阶段该买到多少手
     #5 未持仓却提示减仓
     #6 概览/仓位/关注 在所有 Tab 都占顶部空间
   运行：
     export NODE_PATH="C:/Users/qq444/node_modules"
     node tests/ui.js
   ============================================================ */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.resolve(__dirname, '..', 'portfolio-workbench.html'), 'utf8');

let PASS = 0, FAIL = 0;
const fails = [];
function ok(name, cond, extra){ if (cond){ PASS++; } else { FAIL++; fails.push(name + (extra ? ' → ' + extra : '')); } }
function eq(name, got, want){ ok(name, got === want, 'got=' + got + ' want=' + want); }

const TODAY = new Date().toISOString().slice(0, 10);
/* ★ 必须带「最近更新」，否则每条记录都会命中「数据陈旧超 30 天」，
   产生 4 条常驻待办 —— 那样「无待办时提醒条不出现」这条用例永远不可能通过（假失败）。 */
const RECS = [
  { record_id:'u_cp', 标的名称:'长江电力', 代码:'600900.SH', 组合层级:'核心层', 目标仓位:25, 当前价格:28.36, 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY,
    加倍买入价:26, 正常定投上限:30, 减仓起始价:45 },
  { record_id:'u_gd', 标的名称:'国电电力', 代码:'600795.SH', 组合层级:'核心层', 目标仓位:20, 当前价格:5.24,  一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY,
    加倍买入价:4.5, 正常定投上限:5.5, 减仓起始价:5.8 },
  { record_id:'u_gs', 标的名称:'工商银行', 代码:'601398.SH', 组合层级:'核心层', 目标仓位:15, 当前价格:8.13,  一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY,
    加倍买入价:7, 正常定投上限:8.5, 减仓起始价:9.5 },
  /* 中国神华：现价 48.03 ≥ 减仓价 48 → 复现用户遇到的「未持仓却提示减仓」 */
  { record_id:'u_sh', 标的名称:'中国神华', 代码:'601088.SH', 组合层级:'卫星层', 目标仓位:7,  当前价格:48.03, 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY,
    加倍买入价:35, 正常定投上限:42, 减仓起始价:48 },
];

const dom = new JSDOM(HTML, { runScripts:'outside-only', pretendToBeVisual:true, url:'https://local.test/' });
const w = dom.window;
w.localStorage.setItem('wb_portfolio_val_v1', JSON.stringify(RECS));
w.localStorage.setItem('wb_portfolio_pools_v1', JSON.stringify({}));
w.localStorage.setItem('wb_portfolio_pool_v2', JSON.stringify({
  capital: 50000, monthly: 3800, divPool: 0, pendingPool: 0, logs: [], phaseLock: null }));
const script = (function(h){var tags=[],re=/<script[^>]*>([\s\S]*?)<\/script>/g,m;while((m=re.exec(h))!==null)tags.push(m[1]);return tags.sort(function(a,b){return b.length-a.length;})[0];})(HTML);
const bootErr = [];
w.addEventListener('error', e => bootErr.push(String(e.message || e)));
try { w.eval(script); } catch(e){ /* DOMContentLoaded 未触发，容错 */ }
w.goOffline && w.goOffline();

function G(name){ return w.findByName(name); }
function D(){ return w.document; }
function txtOf(sel){ const el = D().querySelector(sel); return el ? el.textContent : ''; }
function htmlOf(sel){ const el = D().querySelector(sel); return el ? el.innerHTML : ''; }

/* ════════════════════════════════════════════════════════════
   #5 未持仓不得提示减仓
   ════════════════════════════════════════════════════════════ */
console.log('\n【#5】未持仓不得提示减仓');

/* 5.1 中国神华：现价 48.03 ≥ 减仓价 48，但持仓 0 → 各处都不得出现减仓提示 */
{
  const sh = G('中国神华');
  w.applyHolding(sh, 0, 0);
  const items = w.focusItems();
  const sellFocus = items.filter(x => /触及减仓档/.test(x.t) && x.r && x.r._id === 'u_sh');
  eq('★ 今日关注：未持仓不给「触及减仓档」', sellFocus.length, 0);

  const sig = w.watchSignal(sh);
  const sellSig = sig.reasons.filter(x => /已达减仓价|距减仓价/.test(x.txt));
  eq('★ 观察清单：未持仓不给减仓信号', sellSig.length, 0);
  ok('★ 观察清单：该标的也不应判为「需处理」', sig.level < 2, 'level=' + sig.level);

  const dec = htmlOf('#decideWrap');
  ok('★ 决策清单：未持仓不显示「暂停 / 减仓」', dec.indexOf('暂停 / 减仓') < 0);
  ok('★ 决策清单：给出「暂停买入」并说明无仓可减',
     dec.indexOf('暂停买入') >= 0 && dec.indexOf('未持仓，无仓可减') >= 0);
}

/* 5.2 反证：给他持仓后，减仓提示必须回来（否则就是把功能关掉了，不是修好） */
{
  const sh = G('中国神华');
  w.applyHolding(sh, 500, 40);          /* 现价 48.03 / 成本 40 → 浮盈 20% */
  const items = w.focusItems();
  const sellFocus = items.filter(x => /触及减仓档/.test(x.t) && x.r && x.r._id === 'u_sh');
  eq('★ 反证：有持仓时「触及减仓档」恢复', sellFocus.length, 1);

  const sig = w.watchSignal(sh);
  ok('★ 反证：有持仓时观察清单给出减仓信号',
     sig.reasons.some(x => /已达减仓价/.test(x.txt)), JSON.stringify(sig.reasons));

  /* ★ 直接改数据后必须 refreshAll()：applyHolding 只写记录不重渲染，
     不刷新的话读到的还是初始化时那一版 DOM（会假失败）。 */
  w.refreshAll();
  const dec2 = htmlOf('#decideWrap');
  ok('★ 反证：有持仓时决策清单显示「暂停 / 减仓」', dec2.indexOf('暂停 / 减仓') >= 0,
     dec2.slice(0, 200));
}

/* 5.3 资金池行：未持仓不显示减仓档 */
{
  w.POOLS = {}; w.PV2.logs = [];
  w.PV2.phaseLock = null; w.PV2.startISO = '2026-09-26';
  w.POOLS.u_sh = { amount: 4803, note:'', since:'2026-09-26' };
  w.applyHolding(G('中国神华'), 0, 0);            /* 清持仓 */
  w.renderPool();
  const wrap = htmlOf('#poolWrap');
  ok('★ 资金池行：未持仓不显示减仓档提示', wrap.indexOf('清仓档') < 0 && wrap.indexOf('减仓档') < 0,
     wrap.match(/减仓档|清仓档/g));

  w.applyHolding(G('中国神华'), 500, 40);         /* 给持仓 */
  w.renderPool();
  ok('★ 反证：有持仓时资金池行显示减仓档', htmlOf('#poolWrap').indexOf('减仓档') >= 0);
}

/* ════════════════════════════════════════════════════════════
   #6 顶部三块只在「估值看板」页显示
   ════════════════════════════════════════════════════════════ */
console.log('\n【#6】顶部空间只在看板页占用');

/* 6.1 看板页：顶部显示、提醒条隐藏 */
{
  w.goto('board');
  eq('★ 看板页：顶部三块可见', D().getElementById('dashTop').style.display, '');
  eq('★ 看板页：提醒条隐藏（顶部已有完整「今日关注」）',
     D().getElementById('alertBar').className, '');
}

/* 6.2 其他页：顶部隐藏、有待办时提醒条出现 */
{
  w.goto('pool');
  eq('★ 资金池页：顶部三块隐藏', D().getElementById('dashTop').style.display, 'none');
  ok('★ 资金池页：有减仓待办时提醒条出现（不丢待办）',
     D().getElementById('alertBar').className === 'on',
     'cls=' + D().getElementById('alertBar').className);
  ok('★ 提醒条文案含「需处理」', /需处理/.test(txtOf('#alertBar')), txtOf('#alertBar'));
  ok('★ 提醒条提供跳转入口', /去处理/.test(txtOf('#alertBar')));

  /* 逐个 Tab 走一遍：都不该显示 dashTop */
  const tabs = ['board','detail','decide','pool','route','watch','input','method'];
  let shown = [];
  for (const t of tabs){
    w.goto(t);
    if (D().getElementById('dashTop').style.display !== 'none') shown.push(t);
  }
  eq('★ 除看板外没有任何页再显示顶部三块', shown.join(','), 'board');
  w.goto('board');
}

/* 6.3 点提醒条 → 跳到看板页，且顶部三块回来 */
{
  w.goto('input');
  const go = D().getElementById('alertGo');
  ok('★ 提醒条可点击', !!go);
  if (go){
    go.click();
    eq('★ 点击后跳到估值看板', w.VIEW.tab, 'board');
    eq('★ 点击后顶部三块恢复显示', D().getElementById('dashTop').style.display, '');
  }
}

/* 6.4 无待办时提醒条不出现（否则就成了新的常驻占位） */
{
  const oldPrice = G('中国神华')['当前价格'];
  /* 45 元：高于正常定投上限 42、低于减仓价 48 → 落在「减半定投」档，
     既不触发减仓、也不触发加倍买入（用 30 会命中「触及加倍买入」，那是另一条合法待办）。 */
  G('中国神华')['当前价格'] = 45;
  /* ★ 还必须清掉全部持仓：否则卫星层市值占比 100% > 40% 上限，
     会命中「卫星层超配」这条合法待办 —— 那不是假失败，是 fixture 自带的待办。 */
  RECS.forEach(r => w.applyHolding(G(r.标的名称), 0, 0));
  w.refreshAll();
  eq('前置：此时确实无待办（卫星层市值归零）', w.alertStats().total, 0);
  w.goto('pool');
  eq('★ 无待办时提醒条不出现', D().getElementById('alertBar').className, '');
  G('中国神华')['当前价格'] = oldPrice;
  w.goto('board');
}

/* 6.5 顶部三块无待办判断时也不该报错（alertStats 是纯计算） */
{
  let e = null;
  try { w.alertStats(); w.renderAlertBar(); w.syncTopVisibility('pool'); } catch(err){ e = err.message; }
  ok('★ 提醒条相关函数不抛异常', e === null, e);
}

/* ════════════════════════════════════════════════════════════
   #1 撤销按钮可点（上一版改容器后漏了绑定，按钮渲染出来却点不动）
   ════════════════════════════════════════════════════════════ */
console.log('\n【#1】撤销按钮可点击');
{
  const cp = G('长江电力');
  w.POOLS = {}; w.PV2.logs = []; w.PV2.pendingPool = 0; w.PV2.divPool = 0;
  /* ★ 未分配本金先给 3000：这样这笔分配才真的从本金核销（三来源全空时
     会按「新增资金」处理，撤销时没有来源可退 —— 那也是对的，只是测的不是撤销） */
  w.PV2.capitalLeft = 3000; w.PV2.capital = 50000; w.PV2.monthly = 3800;
  w.PV2.phaseLock = null; w.PV2.startISO = '2026-09-26';
  w.renderPool();
  /* 走真实弹层 → 分配 3000 到长江电力 */
  w.openFundSheet('split');
  const Da = D();
  Da.getElementById('splitAmt').value = '3000';
  Da.getElementById('splitIsMonthly').checked = false;
  Da.getElementById('splitGo').click();
  Da.getElementById('planApply').click();
  const lg = w.PV2.logs.filter(x => !x.undone).slice(-1)[0];
  ok('前置：产生了一笔分配流水', !!lg && w.num(lg.amount) === 3000, 'amount=' + (lg && lg.amount));
  eq('前置：分配后未分配本金归 0', w.num(w.PV2.capitalLeft), 0);
  eq('前置：流水记了本金来源', w.num(lg.srcCapital), 3000);
  const undoBtn = Da.querySelector('[data-log-undo="' + lg.seq + '"]');
  ok('★ 撤销按钮已渲染', !!undoBtn);
  if (undoBtn){
    const logsBefore = w.PV2.logs.filter(x => !x.undone).length;
    undoBtn.click();                            /* ★ 上一版点了没反应（绑定漏了） */
    ok('★ 点击撤销按钮真的生效（流水被标记撤销）',
       w.PV2.logs.filter(x => !x.undone).length === logsBefore - 1,
       'before=' + logsBefore + ' after=' + w.PV2.logs.filter(x => !x.undone).length);
    eq('★ 撤销后未分配本金退回 3000', w.num(w.PV2.capitalLeft), 3000);
  }
  w.POOLS = {}; w.PV2.logs = [];
}

/* ════════════════════════════════════════════════════════════
   #2 老数据回填：capitalLeft 缺失时按「本金 − 各池余额」回填
   ════════════════════════════════════════════════════════════ */
console.log('\n【#2】本金未分配额回填');
{
  const cp2 = G('长江电力');
  w.POOLS = { u_cp: { amount: 12000, note:'', since:'2026-09-26' } };   /* 已分 12000 到池 */
  w.applyPv2({ capital: 50000, monthly: 3800 });                        /* 不带 capitalLeft（老数据） */
  eq('★ 老数据回填：未分配 = 50000 − 12000 = 38000', w.num(w.PV2.capitalLeft), 38000);
  w.applyPv2({ capital: 50000, capitalLeft: 0, monthly: 3800 });        /* 显式给 0 → 不回填 */
  eq('★ 显式 capitalLeft=0 不回填（尊重现状）', w.num(w.PV2.capitalLeft), 0);
  w.applyPv2({ capital: 50000, capitalLeft: 50000, monthly: 3800 });
}

/* ════════════════════════════════════════════════════════════
   #4 云端状态同步
   ════════════════════════════════════════════════════════════ */
console.log('\n【#4】云端状态同步');
{
  ok('★ 云端状态表常量已配置', typeof w.STATE_DB_ID === 'string' && w.STATE_DB_ID.length > 10,
     'STATE_DB_ID=' + w.STATE_DB_ID);
  ok('★ cloudLoadState / cloudSaveState 存在',
     typeof w.cloudLoadState === 'function' && typeof w.cloudSaveState === 'function');
  ok('★ poolSave / pv2Save 会触发云端保存',
     /cloudSaveState\(\)/.test(String(w.poolSave)) && /cloudSaveState\(\)/.test(String(w.pv2Save)));
  /* ★ applyPv2 是「整快照」语义：云端每次都写全量 PV2，缺省字段按「未设置」处理。
     这与 pv2Load 一致 —— 两条加载路径必须同语义，否则云端覆盖本地时会算错。 */
  w.POOLS = {};                                   /* 清池，回填才会等于本金全额 */
  w.applyPv2({ capital: 60000 });                 /* 只给 capital → 其余字段回到未设置 */
  eq('★ 整快照语义：缺省的 monthly → null', w.PV2.monthly, null);
  eq('★ 整快照语义：缺省的 logs → []', Array.isArray(w.PV2.logs) && w.PV2.logs.length, 0);
  eq('★ 整快照语义：老数据回填仍生效（capital 60000、无池）',
     w.num(w.PV2.capitalLeft), 60000);
  w.applyPv2({ capital: 50000, capitalLeft: 50000, monthly: 3800,
    divPool: 0, pendingPool: 0, startISO: '2026-09-26', logs: [], phaseLock: null });
}

/* ════════════════════════════════════════════════════════════
   档案（多用户隔离）：新建 / 切换 / 数据互不可见
   ════════════════════════════════════════════════════════════ */
console.log('\n【档案】');
{
  /* 前置：给 blink 档案造一份账（本金 5 万、池里有钱、有持仓） */
  w.POOLS = { u_cp: { amount: 1692, note:'', since:'2025-09-26' } };
  w.applyPv2({ capital: 50000, capitalLeft: 14497, monthly: 3800, divPool: 0,
    pendingPool: 0, startISO: '2025-09-26', logs: [], phaseLock: null });
  w.applyHoldings({ u_cp: { qty: 300, cost: 28.36 } });
  const before = {
    pools: JSON.stringify(w.POOLS),
    capital: w.PV2.capital,
    qty: w.num(G('长江电力')['持仓数量'])
  };
  ok('前置：blink 档案有账', JSON.parse(before.pools).u_cp.amount === 1692 && before.capital === 50000);

  /* 新建朋友档案 → 自动切过去，应该是空账 */
  w.createProfile('朋友A');
  eq('★ 新建后自动切换到朋友A', w.PROFILE.current, '朋友A');
  eq('★ 朋友A：资金池为空', Object.keys(w.POOLS).length, 0);
  eq('★ 朋友A：本金为未设置', w.PV2.capital, null);
  eq('★ 朋友A：长江电力持仓归零', w.num(G('长江电力')['持仓数量']), 0);
  ok('★ 朋友A：档案清单包含两份', w.PROFILE.list.join(',').indexOf('blink') >= 0 &&
     w.PROFILE.list.join(',').indexOf('朋友A') >= 0, w.PROFILE.list.join(','));

  /* 切回 blink → 数据原样恢复 */
  w.switchProfile('blink');
  eq('★ 切回 blink', w.PROFILE.current, 'blink');
  eq('★ 切回后资金池恢复', JSON.stringify(w.POOLS), before.pools);
  eq('★ 切回后本金恢复', w.PV2.capital, 50000);
  eq('★ 切回后持仓恢复', w.num(G('长江电力')['持仓数量']), 300);

  /* 再切到朋友A → blink 的数据不会跟着过去 */
  w.switchProfile('朋友A');
  eq('★ 再切到朋友A：资金池仍为空', Object.keys(w.POOLS).length, 0);
  eq('★ 再切到朋友A：持仓仍为 0', w.num(G('长江电力')['持仓数量']), 0);
  w.switchProfile('blink');

  /* 重名 / 空名被拒 */
  const listBefore = w.PROFILE.list.length;
  w.createProfile('blink');
  eq('★ 重名档案被拒', w.PROFILE.list.length, listBefore);
  w.createProfile('  ');
  eq('★ 空名档案被拒', w.PROFILE.list.length, listBefore);

  /* 资金条有档案入口 */
  w.renderPool();
}

/* ════════════════════════════════════════════════════════════
   档案（多用户隔离）
   ════════════════════════════════════════════════════════════ */

console.log('\n【运行时】');
ok('★ 页面初始化全程无运行时错误', bootErr.length === 0, bootErr.join(' | '));

console.log('\n========================================');
console.log('PASS: %d   FAIL: %d', PASS, FAIL);
if (fails.length){ console.log('\n失败项：'); fails.forEach(f => console.log('  ✗ ' + f)); }
else console.log('全部通过 ✓');
process.exit(FAIL ? 1 : 0);
