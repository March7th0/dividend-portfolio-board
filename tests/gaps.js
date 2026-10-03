/* ============================================================
   补盲区套件 —— 针对子 agent 审计发现的「零覆盖」区块
   覆盖三块此前没有任何断言的资金/纪律逻辑：
     A. askPoolDeduct（录入加仓时从池子扣款）—— 池→持仓的第二入口
     B. 卫星层浮亏 >15% 屏蔽买入提示（用户明确的核心风控纪律）
     C. 资金池三条纪律分支：够一手可买 / 核心层阶段锁卫星层 / 超 6 个月强制买入
   运行：在项目根目录执行
     export NODE_PATH="C:/Users/qq444/node_modules"
     node tests/gaps.js
   ============================================================ */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.resolve(__dirname, '..', 'portfolio-workbench.html'), 'utf8');

let PASS = 0, FAIL = 0;
const fails = [];
function ok(name, cond, extra){ if (cond){ PASS++; } else { FAIL++; fails.push(name + (extra ? ' → ' + extra : '')); } }
function eq(name, got, want){ ok(name, got === want, 'got=' + got + ' want=' + want); }

/* 核心 3 只 + 卫星 4 只，带档位与一手股数，便于测纪律分支 */
const RECS = [
  { record_id:'g_cp', 标的名称:'长江电力', 代码:'600900.SH', 组合层级:'核心层', 目标仓位:25, 当前价格:28.36, 一手股数:100, 持仓数量:0, 持仓成本:0,
    加倍买入价:26, 正常定投上限:30, 减仓起始价:45 },
  { record_id:'g_gd', 标的名称:'国电电力', 代码:'600795.SH', 组合层级:'核心层', 目标仓位:20, 当前价格:5.24,  一手股数:100, 持仓数量:0, 持仓成本:0,
    加倍买入价:4.5, 正常定投上限:5.5, 减仓起始价:5.8 },
  { record_id:'g_gs', 标的名称:'工商银行', 代码:'601398.SH', 组合层级:'核心层', 目标仓位:15, 当前价格:8.13,  一手股数:100, 持仓数量:0, 持仓成本:0,
    加倍买入价:7, 正常定投上限:8.5, 减仓起始价:9.5 },
  { record_id:'g_zj', 标的名称:'紫金矿业', 代码:'601899.SH', 组合层级:'卫星层', 目标仓位:15, 当前价格:30.01, 一手股数:100, 持仓数量:0, 持仓成本:0,
    加倍买入价:26, 正常定投上限:30, 减仓起始价:38 },
  { record_id:'g_gl', 标的名称:'格力电器', 代码:'000651.SZ', 组合层级:'卫星层', 目标仓位:10, 当前价格:38.36, 一手股数:100, 持仓数量:0, 持仓成本:0,
    加倍买入价:34, 正常定投上限:42, 减仓起始价:48 },
  { record_id:'g_sm', 标的名称:'陕西煤业', 代码:'601225.SH', 组合层级:'卫星层', 目标仓位:8,  当前价格:20.00, 一手股数:100, 持仓数量:500, 持仓成本:25,
    加倍买入价:22, 正常定投上限:27, 减仓起始价:34 },
  { record_id:'g_sh', 标的名称:'中国神华', 代码:'601088.SH', 组合层级:'卫星层', 目标仓位:7,  当前价格:48.03, 一手股数:100, 持仓数量:0, 持仓成本:0,
    加倍买入价:35, 正常定投上限:42, 减仓起始价:48 },
];
/* 排除项：用于验证纪律分支不会对组合外标的生效 */
RECS.push({ record_id:'g_ex', 标的名称:'中国石化', 代码:'600028.SH', 组合层级:'排除', 目标仓位:0,
  当前价格:5.32, 一手股数:100, 持仓数量:0, 持仓成本:0 });

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
function totalPools(){
  let t = 0;
  for (const k in w.POOLS) if (Object.prototype.hasOwnProperty.call(w.POOLS, k)) t += (w.num(w.POOLS[k].amount) || 0);
  return t;
}

/* ════════════════════════════════════════════════════════════
   A. askPoolDeduct —— 录入加仓时从池子扣款（池→持仓的第二入口）
   审计发现：整条链路零覆盖，把函数开头直接 return 也测不出来
   ════════════════════════════════════════════════════════════ */
/* ★ R39：确认框已从 window.confirm 改为页面内弹层 —— 测试改为点真实弹层按钮 */
function cfOk(){ var b = w.document.getElementById('cfOk'); if (b) b.dispatchEvent(new w.Event('click',{bubbles:true,cancelable:true})); return !!b; }
function cfCancel(){ var b = w.document.getElementById('cfCancel'); if (b) b.dispatchEvent(new w.Event('click',{bubbles:true,cancelable:true})); return !!b; }

console.log('\n【A】askPoolDeduct（录入扣款）');

/* A1. 确认扣款 → 池子减少 + 流水带 hands（撤销才能回滚持仓）*/
{
  const sm = G('陕西煤业');
  w.POOLS = { g_sm: { amount: 20000, note:'', since:'2026-09-01' } };
  w.PV2.logs = [];
  w.PV2.pendingPool = 0; w.PV2.divPool = 0;
  const poolBefore = 20000;
  w.askPoolDeduct('g_sm', 200, poolBefore);            /* 新增 200 股 @ 成本 25 → 5000 元 */
  cfOk();                                              /* ★ R39：点弹层「确定」才真正扣款 */
  eq('★ 从池子扣掉 5000（200 股 × 成本 25）', w.num(w.POOLS.g_sm.amount), 20000 - 5000);
  const lg = w.PV2.logs.filter(x => !x.undone).slice(-1)[0];
  eq('★ 流水类型 = buy', lg && lg.type, 'buy');
  eq('★ 流水金额 = 5000', w.num(lg.amount), 5000);
  eq('★ ★ 流水带 hands（撤销时才回滚持仓）', w.num(lg.detail[0].hands), 2);
  /* 撤销：钱退回池子 + 持仓按 hands 回滚 */
  const qtyBefore = w.num(G('陕西煤业')['持仓数量']);
  w.undoLog(lg.seq);
  eq('★ 撤销后池子复原 20000', w.num(w.POOLS.g_sm.amount), 20000);
  eq('★ ★ 撤销后持仓回滚 200 股', w.num(G('陕西煤业')['持仓数量']), qtyBefore - 200,
     'before=' + qtyBefore + ' after=' + w.num(G('陕西煤业')['持仓数量']));
}

/* A2. 点「取消」→ 池子完全不动、不记流水 */
{
  const sm2 = G('陕西煤业');
  w.applyHolding(sm2, 500, 25);
  w.POOLS = { g_sm: { amount: 20000, note:'', since:'2026-09-01' } };
  w.PV2.logs = [];
  const logsBefore = w.PV2.logs.length;
  w.askPoolDeduct('g_sm', 200, 20000);
  cfCancel();                                          /* ★ R39：点弹层「取消」→ 池子不动 */
  eq('★ 取消后池子不动', w.num(w.POOLS.g_sm.amount), 20000);
  eq('★ 取消后不记流水', w.PV2.logs.length, logsBefore);
}

/* A3. 扣款上限 = 池内余额（不得扣成负数）*/
{
  w.POOLS = { g_sm: { amount: 3000, note:'', since:'2026-09-01' } };
  w.PV2.logs = [];
  w.askPoolDeduct('g_sm', 200, 3000);                  /* 应扣 5000，但池里只有 3000 */
  cfOk();                                              /* ★ R39 */
  const lg = w.PV2.logs.filter(x => !x.undone).slice(-1)[0];
  eq('★ 扣款以池内余额为上限（3000）', w.num(lg.amount), 3000);
  /* 池子扣空后应被删除，而不是留一个 0 元池 */
  ok('★ 池子扣空后被删除（不留 0 元池）', !w.POOLS.g_sm, 'left=' + JSON.stringify(w.POOLS.g_sm));
  ok('★ 池内余额不为负', totalPools() >= 0);
}

/* ════════════════════════════════════════════════════════════
   B. 卫星层浮亏 >15% 屏蔽买入提示（用户方案里的核心风控纪律）
   审计发现：把阈值从 -15 改成 -50，全部测试仍然通过
   ════════════════════════════════════════════════════════════ */
console.log('\n【B】卫星层浮亏 >15% 屏蔽买入纪律');

function signalText(name){
  const r = G(name);
  const sig = w.watchSignal(r);
  return sig.reasons.map(x => x.txt).join(' ｜ ');
}

/* B1. 陕西煤业：现价 20 ≤ 加倍价 22（本应提示「可加倍定投」），但成本 25 → 浮亏 -20% */
{
  const sm = G('陕西煤业');
  w.applyHolding(sm, 500, 25);
  const txt = signalText('陕西煤业');
  ok('★ 浮亏 -20% 时给出「不加仓」纪律提示', txt.indexOf('不加仓') >= 0, txt);
  ok('★ ★ 浮亏 -20% 时不出现「可加倍定投」', txt.indexOf('可加倍定投') < 0, txt);
  ok('★ 提示里说明受亏损纪律约束', /亏损纪律|基本面信号/.test(txt), txt);
}

/* B2. 反证：把成本调到接近现价（浮亏 -4%）→ 应恢复「可加倍定投」 */
{
  const sm = G('陕西煤业');
  w.applyHolding(sm, 500, 20.8);                      /* 现价 20 / 成本 20.8 → 约 -3.8% */
  const txt = signalText('陕西煤业');
  ok('★ 反证：浮亏小于 15% 时恢复「可加倍定投」提示', txt.indexOf('可加倍定投') >= 0, txt);
  ok('★ 此时不再出现「不加仓」', txt.indexOf('不加仓') < 0, txt);
}

/* B3. 核心层不受该纪律限制（方案：底仓不设止损） */
{
  const gs = G('工商银行');
  w.applyHolding(gs, 100, 12);                        /* 现价 8.13 / 成本 12 → 浮亏约 -32% */
  const txt = signalText('工商银行');
  ok('★ 核心层浮亏 -32% 仍不套用「不加仓」（底仓不设止损）', txt.indexOf('不加仓') < 0, txt);
}

/* ════════════════════════════════════════════════════════════
   C. 资金池三条纪律分支
   审计发现：三个分支对应的唯一断言是「页面里出现过"买入"二字」，几乎恒真
   ════════════════════════════════════════════════════════════ */
console.log('\n【C】资金池纪律分支');

/* ★ 逐池行渲染在 #poolWrap，纪律提示在 #poolRules —— #poolV2 是整屏容器
   （里面是分配台与流水表，不含逐池行）。读错容器会让断言全部空转。 */
function poolHtml(){
  var a = w.document.getElementById('poolWrap');
  var b = w.document.getElementById('poolRules');
  return (a ? a.innerHTML : '') + (b ? b.innerHTML : '');
}
function hasBuyBtn(rid){
  return poolHtml().indexOf('data-pool-buy="' + rid + '"') >= 0;
}
function hasForceBtn(rid){
  return poolHtml().indexOf('data-pool-force="' + rid + '"') >= 0;
}
function hasAllowBtn(rid){
  return poolHtml().indexOf('data-pool-allow="' + rid + '"') >= 0;
}

/* C1. 够一手 → 出现买入按钮；不够一手 → 不出现 */
{
  w.POOLS = {}; w.PV2.logs = [];
  w.PV2.phaseLock = 'core'; w.PV2.startISO = '2026-09-26'; w.PV2.monthly = 3800;
  /* 长江电力 一手 2836 元：给 3000 够买 1 手 */
  w.POOLS.g_cp = { amount: 3000, note:'', since:'2026-09-26' };
  /* 国电电力 一手 524 元：给 500 不够买 1 手 */
  w.POOLS.g_gd = { amount: 500, note:'', since:'2026-09-26' };
  w.renderPool();
  ok('★ 核心层池够一手 → 出现买入按钮', hasBuyBtn('g_cp'));
  ok('★ 核心层池不够一手 → 不出现买入按钮', !hasBuyBtn('g_gd'));
}

/* C2. 核心层阶段 → 卫星层池「只累积不买入」+ 提供「放行买入」入口 */
{
  w.POOLS = {}; w.PV2.logs = [];
  w.PV2.phaseLock = 'core'; w.PV2.startISO = '2026-09-26';
  w.POOLS.g_zj = { amount: 10000, note:'', since:'2026-09-26' };   /* 紫金一手 3001，够买 3 手 */
  w.renderPool();
  ok('★ 核心层阶段：卫星层池不出现买入按钮', !hasBuyBtn('g_zj'));
  ok('★ 核心层阶段：出现「放行买入」入口（方案允许的极端击球区例外）', hasAllowBtn('g_zj'));
  ok('★ 出现阶段锁定说明', /阶段锁定/.test(poolHtml()));

  /* 切到卫星层阶段 → 锁定解除 */
  w.PV2.phaseLock = 'sat';
  w.renderPool();
  ok('★ 卫星层阶段：锁定解除，出现买入按钮', hasBuyBtn('g_zj'));
  ok('★ 卫星层阶段：不再出现「放行买入」', !hasAllowBtn('g_zj'));
  ok('★ 卫星层阶段：不再显示阶段锁定', !/阶段锁定/.test(poolHtml()));
  w.PV2.phaseLock = null;
}

/* C3. 超 6 个月未买入且够一手 → 出现「强制买入」；未逾期则没有 */
{
  w.POOLS = {}; w.PV2.logs = [];
  /* 200 天前入池，够买多手 → 逾期 */
  w.POOLS.g_cp = { amount: 10000, note:'', since:'2026-03-01' };
  /* 同样金额但 10 天前才买入过 → 不该逾期（验证 lastBuy 生效） */
  w.POOLS.g_gs = { amount: 10000, note:'', since:'2026-03-01', lastBuy: '2026-09-16' };
  w.renderPool();
  ok('★ 超 6 个月未买入 → 出现「强制买入」', hasForceBtn('g_cp'));
  ok('★ ★ 近期买入过（lastBuy 新）→ 不出现「强制买入」', !hasForceBtn('g_gs'));
  ok('★ 逾期池有醒目提示', /已超 6 个月未买入/.test(poolHtml()));
}

/* C4. 强制买入的预填手数 = 池内余额 50% 折算（至少 1 手，不超过最大可买）*/
{
  w.POOLS = {}; w.PV2.logs = [];
  w.PV2.phaseLock = null;
  /* 长电现价 28.36、一手 100 股 → 一手 2836 元。池 10000 → 50% = 5000 → 1 手 */
  w.POOLS.g_cp = { amount: 10000, note:'', since:'2026-03-01' };
  w.renderPool();
  const fb = w.document.querySelector('[data-pool-force]');
  ok('★ 强制买入按钮存在', !!fb);
  if (fb){
    fb.click();
    const handsEl = w.document.getElementById('bsHands');
    ok('★ 弹层打开并预填手数', !!handsEl, 'handsEl=' + !!handsEl);
    if (handsEl) eq('★ ★ 预填手数 = floor(池内 50% / 一手金额) = 1', parseInt(handsEl.value, 10), 1);
    /* 关掉弹层，避免影响后续 */
    const cl = w.document.getElementById('bsCancel');
    if (cl) cl.click();
  }
}

/* C5. 组合外标的（排除）不产生任何资金池纪律提示 */
{
  w.POOLS = {}; w.PV2.logs = [];
  w.POOLS.g_ex = { amount: 100000, note:'', since:'2026-01-01' };
  w.renderPool();
  ok('★ 排除项不出现在资金池列表', poolHtml().indexOf('中国石化') < 0);
  ok('★ 排除项不产生买入/强制买入按钮', !hasBuyBtn('g_ex') && !hasForceBtn('g_ex'));
}

/* ── 收尾：页面无运行时错误 ── */
console.log('\n【D】运行时错误检查');
ok('★ 页面初始化全程无运行时错误', bootErr.length === 0, bootErr.join(' | '));

console.log('\n========================================');
console.log('PASS: %d   FAIL: %d', PASS, FAIL);
if (fails.length){ console.log('\n失败项：'); fails.forEach(f => console.log('  ✗ ' + f)); }
else console.log('全部通过 ✓');
process.exit(FAIL ? 1 : 0);
