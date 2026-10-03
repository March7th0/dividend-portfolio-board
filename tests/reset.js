/* ============================================================
   初始化重置 / 全部清空 专项验证套件（离线模式）
   ─────────────────────────────────────────────────────────────
   ★ R39 重大变更：确认框从 window.confirm 改为【页面内弹层】。
     原因（线上真根因）：真实环境里 window.confirm 会被静默阻止
     （平台 iframe / 浏览器「阻止此页面创建更多对话框」），
     被阻止时 confirm 立即返回 false → 调用方第一行就 return
     → 用户看到「点了按钮毫无反应」。
     症状完全吻合：带 confirm 的「初始化重置 / 全部清空」无效，
     而没有 confirm 的「撤销」一直正常。
   本套件因此不再 mock confirm，而是**点击真实弹层按钮**。
   覆盖：
     R1 按钮存在；点击弹出确认弹层
     R2 第一次点「取消」→ 什么都不清
     R3 第二次点「取消」→ 什么都不清
     R4 两次「确定」→ 全字段归零（内存 + localStorage）
     R5 重建容器后仍可点（事件委托）
     R6 ★ window.confirm 被阻止时，重置依然生效（本轮核心回归）
     R7 「全部清空」同样走弹层且生效
   运行：
     export NODE_PATH="C:/Users/qq444/node_modules"
     node tests/reset.js
   ============================================================ */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.resolve(__dirname, '..', 'portfolio-workbench.html'), 'utf8');

let PASS = 0, FAIL = 0;
const fails = [];
function ok(name, cond, extra){ if (cond){ PASS++; } else { FAIL++; fails.push(name + (extra ? ' → ' + extra : '')); } }
function eq(name, got, want){ ok(name, got === want, 'got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }

const TODAY = new Date().toISOString().slice(0, 10);
const RECS = [
  { record_id:'u_cp', 标的名称:'长江电力', 代码:'600900.SH', 组合层级:'核心层', 目标仓位:25, 当前价格:28.36, 一手股数:100, 持仓数量:2000, 持仓成本:26.5, 最近更新:TODAY,
    加倍买入价:26, 正常定投上限:30, 减仓起始价:45 },
  { record_id:'u_gd', 标的名称:'国电电力', 代码:'600795.SH', 组合层级:'核心层', 目标仓位:20, 当前价格:5.24,  一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY,
    加倍买入价:4.5, 正常定投上限:5.5, 减仓起始价:5.8 },
];

const dom = new JSDOM(HTML, { runScripts:'outside-only', pretendToBeVisual:true, url:'https://local.test/' });
const w = dom.window;
w.localStorage.setItem('wb_portfolio_val_v1', JSON.stringify(RECS));
w.localStorage.setItem('wb_portfolio_pools_v1', JSON.stringify({ u_cp: { amount: 5000, note:'' } }));
w.localStorage.setItem('wb_portfolio_pool_v2', JSON.stringify({
  capital: 50000, monthly: 3800, divPool: 200, pendingPool: 100, capitalLeft: 12345,
  startISO: '2026-08-01',
  logs: [ {type:'capital', label:'设定初始本金', amount:50000, ts:'2026-08-01T00:00:00.000Z'},
          {type:'inject',  label:'注入测试',     amount:1000,  ts:'2026-08-02T00:00:00.000Z'} ],
  phaseLock: null }));
const script = (function(h){var tags=[],re=/<script[^>]*>([\s\S]*?)<\/script>/g,m;while((m=re.exec(h))!==null)tags.push(m[1]);return tags.sort(function(a,b){return b.length-a.length;})[0];})(HTML);
const bootErr = [];
w.addEventListener('error', e => bootErr.push(String(e.message || e)));
try { w.eval(script); } catch(e){ /* DOMContentLoaded 时序容错 */ }
w.goOffline && w.goOffline();
/* ★ jsdom 构造时 DOMContentLoaded 已经错过，启动链不会自动跑 —— 必须手动补跑 */
try { w.poolLoad(); w.pv2Load(); w.pv2Migrate(); } catch(e){ bootErr.push('manual boot: ' + e.message); }
/* ★ 控件走全局事件委托，DOMContentLoaded 不触发时必须手动挂 */
try { w.bindGlobalDelegates(); } catch(e){ bootErr.push('delegates: ' + e.message); }

function D(id){ return w.document.getElementById(id); }
function click(el){ if (el) el.dispatchEvent(new w.Event('click', { bubbles:true, cancelable:true })); }
function btn(){ return D('fullResetBtn'); }
function cfOk(){ var b = D('cfOk'); click(b); return !!b; }          /* 点确认弹层的「确定」 */
function cfCancel(){ var b = D('cfCancel'); click(b); return !!b; }  /* 点确认弹层的「取消」 */
function sheetOpen(){ var h = D('confirmSheet'); return !!(h && h.style.display === 'block'); }

let renderErr = null;
try { w.renderPool(); } catch(e){ renderErr = e.message; }
ok('★ renderPool 无异常', !renderErr, renderErr);

/* ════════════════════════════════════════════════════════════
   R1 按钮存在 + 点击弹出确认弹层
   ════════════════════════════════════════════════════════════ */
console.log('\n【R1】点击「初始化重置」弹出页面内确认弹层');
ok('R1 按钮在 DOM 中', !!btn());
ok('R1 按钮带 data-act（走全局委托）', !!btn() && btn().getAttribute('data-act') === 'full-reset');

var err1 = null;
try { click(btn()); } catch(e){ err1 = e; }
ok('R1 点击无异常', !err1, err1 && err1.message);
ok('R1 ★ 弹层已打开', sheetOpen());
ok('R1 ★ 弹层里有「确定」按钮', !!D('cfOk'));
ok('R1 弹层里有「取消」按钮', !!D('cfCancel'));
ok('R1 弹层文字说明了后果', (D('confirmSheet').textContent || '').indexOf('持仓归零') >= 0);

/* ════════════════════════════════════════════════════════════
   R2 第一次点「取消」→ 什么都不清
   ════════════════════════════════════════════════════════════ */
console.log('\n【R2】第一次确认点「取消」→ 不清任何数据');
cfCancel();
ok('R2 弹层已关闭', !sheetOpen());
eq('R2 本金未动', w.PV2.capital, 50000);
eq('R2 月度未动', w.PV2.monthly, 3800);
eq('R2 流水未动', w.PV2.logs.length, 2);
eq('R2 持仓未动', w.RECORDS[0]['持仓数量'], 2000);

/* ════════════════════════════════════════════════════════════
   R3 第二次点「取消」→ 仍不清
   ════════════════════════════════════════════════════════════ */
console.log('\n【R3】第二次确认点「取消」→ 仍不清任何数据');
click(btn());
ok('R3 第一次弹层打开', sheetOpen());
cfOk();                                  /* 第一次确定 → 应弹出第二次 */
ok('R3 第二次弹层打开', sheetOpen());
ok('R3 第二次弹层文案不同（再确认一次）', (D('confirmSheet').textContent || '').indexOf('再确认一次') >= 0);
cfCancel();
eq('R3 ★ 二次取消后本金仍为 50000', w.PV2.capital, 50000);
eq('R3 股息池未动', w.PV2.divPool, 200);
eq('R3 持仓未动', w.RECORDS[0]['持仓数量'], 2000);

/* ════════════════════════════════════════════════════════════
   R4 两次「确定」→ 全部归零
   ════════════════════════════════════════════════════════════ */
console.log('\n【R4】两次都确认 → 全部归零');
click(btn());
cfOk(); cfOk();
ok('R4 弹层已关闭', !sheetOpen());
eq('R4 本金清空', w.PV2.capital, null);
eq('R4 月度清空', w.PV2.monthly, null);
eq('R4 股息池清零', w.PV2.divPool, 0);
eq('R4 卖出回流清零', w.PV2.pendingPool, 0);
eq('R4 未分配清零', w.PV2.capitalLeft, 0);
eq('R4 起投日清空', w.PV2.startISO, null);
eq('R4 流水清空', w.PV2.logs.length, 0);
eq('R4 阶段锁清空', w.PV2.phaseLock, null);
eq('R4 标的池清空', Object.keys(w.POOLS).length, 0);
eq('R4 持仓数量归零', w.RECORDS[0]['持仓数量'], 0);
ok('R4 持仓成本清空', w.RECORDS[0]['持仓成本'] === null);
try {
  const pv2After = JSON.parse(w.localStorage.getItem('wb_portfolio_pool_v2') || '{}');
  eq('R4 localStorage 本金归零', pv2After.capital, null);
  eq('R4 localStorage 流水归零', (pv2After.logs || []).length, 0);
} catch(e){ ok('R4 localStorage 校验无异常', false, e.message); }

/* ════════════════════════════════════════════════════════════
   R5 重建容器后仍可点（事件委托）
   ════════════════════════════════════════════════════════════ */
console.log('\n【R5】重建后按钮依然可用（事件委托）');
w.PV2.capital = 12345;
w.renderPool();
ok('R5 重建后按钮仍存在', !!btn());
click(btn());
ok('R5 ★ 重建后点击仍弹出弹层', sheetOpen());
cfCancel();

/* ════════════════════════════════════════════════════════════
   R6 ★ window.confirm 被阻止时，重置仍必须生效（本轮核心回归）
   ════════════════════════════════════════════════════════════ */
console.log('\n【R6】window.confirm 被静默阻止时，重置依然生效');
w.PV2.capital = 77777; w.PV2.monthly = 6666; w.PV2.capitalLeft = 555;
w.POOLS['u_cp'] = { amount: 8888, note:'' };
w.renderPool();
/* 模拟真实环境：confirm 被阻止 → 抛错 / 或静默返回 false，两种都测 */
w.confirm = function(){ throw new Error('blocked by browser (iframe sandbox)'); };
var blockedErr = null;
try { click(btn()); cfOk(); cfOk(); } catch(e){ blockedErr = e; }
ok('R6 全程无异常（没有依赖 confirm）', !blockedErr, blockedErr && blockedErr.message);
eq('R6 ★ confirm 被阻止时：本金仍被清空', w.PV2.capital, null);
eq('R6 ★ confirm 被阻止时：月度仍被清空', w.PV2.monthly, null);
eq('R6 ★ confirm 被阻止时：标的池仍被清空', Object.keys(w.POOLS).length, 0);

/* 另一种阻止形式：静默返回 false */
w.PV2.capital = 8888;
w.renderPool();
w.confirm = function(){ return false; };
click(btn()); cfOk(); cfOk();
eq('R6 ★ confirm 返回 false 时：本金仍被清空', w.PV2.capital, null);

/* ════════════════════════════════════════════════════════════
   R7 「全部清空」同样走弹层且生效
   ════════════════════════════════════════════════════════════ */
console.log('\n【R7】操作流水「全部清空」');
w.PV2.capital = 4321; w.PV2.monthly = 321;
w.PV2.logs = [{ seq:1, ts:'2026-09-26T03:00:00.000Z', type:'capital', label:'x', amount:1, detail:'' }];
w.POOLS['u_cp'] = { amount: 1000, note:'' };
w.renderPool();
var rst = D('pv2Reset');
ok('R7 「全部清空」按钮存在且带 data-act', !!rst && rst.getAttribute('data-act') === 'pv2-reset');
click(rst);
ok('R7 ★ 点击弹出确认弹层', sheetOpen());
cfOk(); cfOk();
eq('R7 ★ 本金被清空', w.PV2.capital, null);
eq('R7 ★ 月度被清空', w.PV2.monthly, null);
eq('R7 ★ 流水被清空', w.PV2.logs.length, 0);
eq('R7 ★ 标的池被清空', Object.keys(w.POOLS).length, 0);
/* 双确认必须是严格两步：只点第一次确定后，应停在第二次弹层 */
w.PV2.capital = 999;
w.renderPool();
click(D('pv2Reset'));
cfOk();
ok('R7 ★ 双确认是严格两步（不是并发弹出多层）', sheetOpen());
cfCancel();

console.log('\n【运行时】');
ok('★ 页面初始化全程无运行时错误', bootErr.length === 0, bootErr.join(' | '));

console.log('\n========================================');
console.log('PASS: %d   FAIL: %d', PASS, FAIL);
if (fails.length){ console.log('\n失败项：'); fails.forEach(f => console.log('  ✗ ' + f)); }
else console.log('全部通过 ✓');
process.exit(FAIL ? 1 : 0);
