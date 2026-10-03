/* 验证：定投是否严格按方案金额分配 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
/* ★ 用 __dirname 定位，而不是裸相对路径 —— 裸路径依赖 CWD，
   从 .v/ 目录直接运行会 ENOENT。其余 4 个套件都是这么做的。 */
const path = require('path');
const HTML = fs.readFileSync(path.resolve(__dirname, '..', 'portfolio-workbench.html'), 'utf8');

const RECS = [
  { record_id:'r_cp', 标的名称:'长江电力', 代码:'600900.SH', 组合层级:'核心层', 目标仓位:25, 当前价格:28.36, 一手股数:100, 持仓数量:0, 持仓成本:0 },
  { record_id:'r_gd', 标的名称:'国电电力', 代码:'600795.SH', 组合层级:'核心层', 目标仓位:20, 当前价格:5.24,  一手股数:100, 持仓数量:0, 持仓成本:0 },
  { record_id:'r_gs', 标的名称:'工商银行', 代码:'601398.SH', 组合层级:'核心层', 目标仓位:15, 当前价格:8.13,  一手股数:100, 持仓数量:0, 持仓成本:0 },
  { record_id:'r_zj', 标的名称:'紫金矿业', 代码:'601899.SH', 组合层级:'卫星层', 目标仓位:15, 当前价格:30.01, 一手股数:100, 持仓数量:0, 持仓成本:0 },
  { record_id:'r_gl', 标的名称:'格力电器', 代码:'000651.SZ', 组合层级:'卫星层', 目标仓位:10, 当前价格:38.36, 一手股数:100, 持仓数量:0, 持仓成本:0 },
  { record_id:'r_sm', 标的名称:'陕西煤业', 代码:'601225.SH', 组合层级:'卫星层', 目标仓位:8,  当前价格:25.83, 一手股数:100, 持仓数量:0, 持仓成本:0 },
  { record_id:'r_sh', 标的名称:'中国神华', 代码:'601088.SH', 组合层级:'卫星层', 目标仓位:7,  当前价格:48.03, 一手股数:100, 持仓数量:0, 持仓成本:0 },
];

let PASS = 0, FAIL = 0;
const fails = [];
function ok(name, cond, extra){ if (cond){ PASS++; } else { FAIL++; fails.push(name + (extra ? ' → ' + extra : '')); } }
function eq(name, got, want){ ok(name, got === want, 'got=' + got + ' want=' + want); }

const dom = new JSDOM(HTML, { runScripts:'outside-only', pretendToBeVisual:true, url:'https://local.test/' });
const w = dom.window;
w.localStorage.setItem('wb_portfolio_val_v1', JSON.stringify(RECS));
w.localStorage.setItem('wb_portfolio_pools_v1', JSON.stringify({}));
w.localStorage.setItem('wb_portfolio_pool_v2', JSON.stringify({ capital:50000, monthly:3800, divPool:0, pendingPool:0, logs:[], phaseLock:null }));
const script = (function(h){var tags=[],re=/<script[^>]*>([\s\S]*?)<\/script>/g,m;while((m=re.exec(h))!==null)tags.push(m[1]);return tags.sort(function(a,b){return b.length-a.length;})[0];})(HTML);
try { w.eval(script); } catch(e){ /* DOMContentLoaded */ }
w.goOffline && w.goOffline();

function amtOf(plan, name){
  for (const row of plan.rows) if (row.r['标的名称'] === name) return row.amt;
  return 0;
}
function sumTier(plan, tier){
  return plan.rows.filter(x => x.tier === tier).reduce((a,b) => a + b.amt, 0);
}

/* ---------- 1. 核心层阶段：核心层三只必须与方案完全一致 ---------- */
console.log('\n【1】核心层阶段（方案：国电1200 + 工行1200 + 长电1100 + 卫星种子300）');
w.PV2.phaseLock = 'core';
let p = w.allocPlan(3800, 0, true);
eq('切层 核心=3500', p.coreAmt, 3500);
eq('切层 卫星=300', p.satAmt, 300);
eq('长江电力 = 1100', amtOf(p, '长江电力'), 1100);
eq('国电电力 = 1200', amtOf(p, '国电电力'), 1200);
eq('工商银行 = 1200', amtOf(p, '工商银行'), 1200);
eq('核心层三只合计 = 3500', sumTier(p, 'core'), 3500);
eq('卫星层（种子）合计 = 300', sumTier(p, 'sat'), 300);
ok('核心层三只都标记为「按方案」', p.rows.filter(x => x.tier === 'core').every(x => x.planned === true));
ok('卫星层四只按目标仓位权重摊（非方案）', p.rows.filter(x => x.tier === 'sat').every(x => x.planned === false));

/* ---------- 2. 输入金额浮动时等比缩放，比例不变 ---------- */
console.log('\n【2】本月填 5000（方案 3800）→ 比例保持不变');
const p2 = w.allocPlan(5000, 0, true);
eq('核心切层 = 4600', p2.coreAmt, 4600);
eq('卫星切层 = 400', p2.satAmt, 400);
/* 4600 按 国电1200:工行1200:长电1100 等比缩放（4600/3500 = 1.3143）
   → 1577.1 : 1577.1 : 1445.7 → 取整 1577 : 1577 : 1446 */
eq('国电电力 = 1577', amtOf(p2, '国电电力'), 1577);
eq('工商银行 = 1577', amtOf(p2, '工商银行'), 1577);
eq('长江电力 = 1446', amtOf(p2, '长江电力'), 1446);
eq('核心层合计仍 = 4600', sumTier(p2, 'core'), 4600);
const r1 = amtOf(p2, '国电电力') / amtOf(p, '国电电力');
const r2 = amtOf(p2, '长江电力') / amtOf(p, '长江电力');
ok('等比缩放（国电 与 长电 的放大倍数一致）', Math.abs(r1 - r2) < 0.01, 'r1=' + r1.toFixed(4) + ' r2=' + r2.toFixed(4));

/* ---------- 3. 卫星层阶段：卫星层四只按方案等比放大到 3200 ---------- */
console.log('\n【3】卫星层阶段（方案：紫金1100 + 格力800 + 神华600 + 陕煤500）');
w.PV2.phaseLock = 'sat';
const p3 = w.allocPlan(4000, 0, true);
eq('切层 核心=800', p3.coreAmt, 800);
eq('切层 卫星=3200', p3.satAmt, 3200);
eq('卫星层四只合计 = 3200', sumTier(p3, 'sat'), 3200);
/* 3200 / 3000 = 1.0667 → 1173 / 853 / 640 / 533 */
ok('紫金矿业 ≈ 1173', Math.abs(amtOf(p3, '紫金矿业') - 1173) <= 2, 'got=' + amtOf(p3, '紫金矿业'));
ok('格力电器 ≈ 853', Math.abs(amtOf(p3, '格力电器') - 853) <= 2, 'got=' + amtOf(p3, '格力电器'));
ok('中国神华 ≈ 640', Math.abs(amtOf(p3, '中国神华') - 640) <= 2, 'got=' + amtOf(p3, '中国神华'));
ok('陕西煤业 ≈ 533', Math.abs(amtOf(p3, '陕西煤业') - 533) <= 2, 'got=' + amtOf(p3, '陕西煤业'));
const satRows = p3.rows.filter(x => x.tier === 'sat');
ok('卫星层四只标记为「按方案」', satRows.every(x => x.planned === true));
const coreRows = p3.rows.filter(x => x.tier === 'core');
ok('核心层（补仓）按目标仓位权重摊', coreRows.every(x => x.planned === false));
eq('核心层合计 = 800', sumTier(p3, 'core'), 800);

/* ---------- 4. 阶段判定：按方案时间表（1-6月/7-12月/13月起） ---------- */
console.log('\n【4】阶段判定（按时间，不是完成度）');
/* ★ 阶段由建仓进度判定 */
{
  w.PV2.capital = 50000; w.PV2.monthly = 3800;
  w.PV2.startISO = null; w.PV2.capitalLeft = 0;
  for (const r of w.sortedRecs()){ if (w.isInPortfolio(r)) r['持仓数量'] = 0; }
  eq('★ 无持仓 → core', w.phaseAuto(), 'core');
  for (const r of w.sortedRecs()){
    if (!w.isCore(r)) continue;
    const lc = w.lotCost(r), a = w.allocTier(r);
    r['持仓数量'] = Math.floor(50000 * a / 100 / lc.lot) * lc.shares;
  }
  eq('★ 核心层达标但卫星层没有 → sat', w.phaseAuto(), 'sat');
  for (const r of w.sortedRecs()){
    if (!w.isInPortfolio(r)) continue;
    const lc = w.lotCost(r), a = w.allocTier(r);
    r['持仓数量'] = Math.floor(50000 * a / 100 / lc.lot) * lc.shares;
  }
  eq('★ 全部达标 → full', w.phaseAuto(), 'full');
}

/* ---------- 5. 软上限已移除：钱多的池子不再被跳过 ---------- */
console.log('\n【5】软上限已删除 —— 钱堆着的池子仍按方案拿钱');
w.PV2.phaseLock = 'core';
w.POOLS = { r_cp: { amount: 999999, note:'', since:'2026-09-01' } };  /* 长电池子塞满 */
const p5 = w.allocPlan(3800, 0, true);
eq('★ 长电池子塞满，仍分到 1100（不跳过）', amtOf(p5, '长江电力'), 1100);
eq('★ 国电仍分到 1200', amtOf(p5, '国电电力'), 1200);
eq('★ 工行仍分到 1200', amtOf(p5, '工商银行'), 1200);
w.POOLS = {}; w.PV2.phaseLock = null;

/* ---------- 6. 意外资金（不勾月度）仍走缺口加权 ---------- */
console.log('\n【6】意外资金走缺口加权（不受方案金额约束）');
w.PV2.phaseLock = 'core';
const p6 = w.allocPlan(3800, 0, false);
eq('mode = gap', p6.mode, 'gap');
ok('缺口加权未按方案金额', amtOf(p6, '长江电力') !== 1100 || amtOf(p6, '国电电力') !== 1200);
w.PV2.phaseLock = null;

/* ---------- 7. 【已移除 · 假绿】----------
   此处原来在测试里「手动复制」了 applyPlanFromDesk 的核销与打标动作
   （w.PV2.pendingPool = Math.max(0, ... - 2600); lg.srcPending = 2600;），
   然后再断言这两个自己刚算出来的值。
   后果：即使生产代码漏扣待分配池 / 漏打 srcPending，测试依然全绿。
   实测变异（删掉 markSplitSource）在旧写法下 0 失败。
   → 真实链路覆盖见第 9 节 A / B / C / D（真实点击 #splitGo → #planApply）。 */

/* ---------- 7b. 卖出撤销的边界：有后续记录时必须拒绝，且状态不变 ---------- */
console.log('\n【7b】卖出撤销边界（外部审计关心的那条）');
const gd7 = w.findByName('国电电力');
w.POOLS = {}; w.PV2.pendingPool = 0; w.PV2.divPool = 0; w.PV2.logs = [];
w.applyHolding(gd7, 0, 0);
w.applyHolding(gd7, 500, 5.00);
w.sellFromHolding(gd7._id, 5, 5.20);                       // 卖出 → 待分配池 2600
const sellSeq7 = w.PV2.logs.filter(x => x.type === 'sell')[0].seq;
/* 只造一条「后续记录」即可触发拒绝逻辑；不再手抄核销动作
   （本节只验证「非最后一条撤销被拒」，与核销无关） */
w.applyPlan([{ rid: gd7._id, amt: 2600 }], 'split', '分配 2600', 2600);
const pendB = w.num(w.PV2.pendingPool), holdB = w.num(gd7['持仓数量']);
w.undoLog(sellSeq7);                                        // 试图越过分配直接撤卖出
eq('★ 拒绝：待分配池不变', w.num(w.PV2.pendingPool), pendB);
eq('★ 拒绝：持仓不变', w.num(gd7['持仓数量']), holdB);
const sellLog7 = w.PV2.logs.filter(x => x.seq === sellSeq7)[0];
ok('★ 拒绝：卖出流水未被标记撤销', sellLog7.undone === false);
ok('待分配池未变负', w.num(w.PV2.pendingPool) >= 0);
/* 按正确顺序撤销 → 账平 */
w.undoLog(w.PV2.logs[w.PV2.logs.length - 1].seq);
w.undoLog(sellSeq7);
eq('按序撤销后 待分配池 = 0', w.num(w.PV2.pendingPool), 0);
eq('按序撤销后 持仓 = 500', w.num(gd7['持仓数量']), 500);
w.PV2.pendingPool = 0; w.POOLS = {};

/* ---------- 8. 渲染冒烟：阶段卡 / 分配台 都能出来且无 NaN ---------- */
console.log('\n【8】渲染冒烟');
w.PV2.startISO = '2026-09-26';
w.PV2.pendingPool = 1500;
w.PV2.divPool = 500;
let renderErr = null;
try { w.renderPool(); } catch(e){ renderErr = e.message; }
ok('renderPool 无异常', renderErr === null, renderErr);
const poolHtml = w.document.getElementById('poolV2') ? w.document.getElementById('poolV2').innerHTML : '';
ok('阶段卡已渲染', poolHtml.indexOf('当前阶段') >= 0);
/* ★ R26 起分配台收进了弹层（#fundSheet），渲染冒烟要分两处读：
   poolV2 = 阶段卡 + 资金条；fundSheet = 分配台/股息台。 */
w.openFundSheet('split');
const sheetHtml = w.document.getElementById('fundSheet')
  ? w.document.getElementById('fundSheet').innerHTML : '';
const ok3 = ['起投至今','起投日','核心层阶段']
  .filter(k => poolHtml.indexOf(k) >= 0);
/* ★ R38 文案更新：分配台的资金栏抬头由「未分配资金」改为「可分配资金」，
   并把「未分配本金」纳入展示（此前本金在分配台里完全不可见）。
   口径说明也改为三口径并列。断言同步更新，并放宽为「多种可能命中其一」，
   避免以后微调措辞就误报。 */
const ok4 = ['可分配资金','未分配资金','未分配本金','卖出回流','按方案固定金额','缺口','生成方案']
  .filter(k => sheetHtml.indexOf(k) >= 0);
ok('★ 分配台弹层含可分配资金栏（本金/回流/股息）', ok4.indexOf('可分配资金') >= 0 || ok4.indexOf('未分配资金') >= 0);
ok('★ 分配台弹层说明三种口径（本金建仓 / 固定金额 / 缺口）',
   ok4.indexOf('按方案固定金额') >= 0 && sheetHtml.indexOf('用本金建仓') >= 0 && ok4.indexOf('缺口') >= 0);
ok('★ 分配台弹层「生成方案」按钮在', ok4.indexOf('生成方案') >= 0);
w.closeFundSheet();
const visAll = poolHtml + sheetHtml;
ok('可见文本无 NaN', visAll.indexOf('NaN') < 0);
ok('可见文本无 undefined', visAll.indexOf('undefined') < 0);
ok('可见文本无 Infinity', visAll.indexOf('Infinity') < 0);

/* ---------- 9. ★ 端到端落地链路（真实 DOM 点击，不手抄逻辑） ----------
   【为什么必须写这条】此前第 7 / 7b 节是在测试里「手动复制」了
   applyPlanFromDesk 的扣池 + 打标动作（pendingPool -= sum、lg.srcPending = sum）。
   那样即使 applyPlanFromDesk 真的坏了（漏扣 / 漏标），测试照样全绿 —— 这是假绿。
   所以这里走真实路径：renderPool() 建 DOM → 点 #splitGo → 点 #planApply。 */
console.log('\n【9】端到端落地链路（真实点击 #splitGo → #planApply）');

function e2e(amount, monthly, pend, div){
  w.POOLS = {}; w.PV2.logs = [];
  w.PV2.pendingPool = pend; w.PV2.divPool = div;
  w.PV2.monthly = 3800; w.PV2.phaseLock = 'core'; w.PV2.startISO = '2026-09-26';
  w.renderPool();                                     /* 重建 DOM 并绑定事件 */
  w.openFundSheet('split');                           /* ★ 分配台已收进弹层，先打开 */
  const D = w.document;
  const amtEl = D.getElementById('splitAmt');
  const monEl = D.getElementById('splitIsMonthly');
  if (!amtEl || !monEl || !D.getElementById('splitGo')) return { err: '分配台未渲染' };
  amtEl.value = String(amount);
  monEl.checked = !!monthly;
  D.getElementById('splitGo').click();                /* → splitPreview() */
  const go = D.getElementById('planApply');
  if (!go) return { err: '未生成 #planApply（方案行数为 0？）' };
  go.click();                                         /* → applyPlanFromDesk() */
  const act = w.PV2.logs.filter(x => !x.undone);
  const lg = act[act.length - 1] || {};
  return {
    sum: w.num(lg.amount) || 0, type: lg.type,
    srcPending: w.num(lg.srcPending) || 0, srcDiv: w.num(lg.srcDiv) || 0,
    pending: w.num(w.PV2.pendingPool) || 0, div: w.num(w.PV2.divPool) || 0
  };
}

/* A. 待分配池够覆盖 → 只扣待分配池，股息池不动 */
const A = e2e(2600, false, 2600, 800);
if (A.err) ok('端到端 A：分配台可渲染', false, A.err);
else {
  /* ★ 不再用「takeP > 0」（那只是 A.sum>0 的同义反复）。
     池全空 + 缺口总额远大于输入额 → 2600 元应被完整落地，因此核销额就是 2600。 */
  const takeP = Math.min(2600, A.sum), takeD = Math.min(800, A.sum - takeP);
  eq('★ A 落地额 = 输入额 2600（缺口充足，应全额落地）', A.sum, 2600);
  eq('★ A 核销额 = 2600（全部由卖出回流覆盖）', takeP, 2600);
  eq('A 流水类型 = split', A.type, 'split');
  eq('★ A 待分配池余额正确', A.pending, 2600 - takeP);
  eq('★ A 股息池余额正确', A.div, 800 - takeD);
  eq('★ A 自动打标 srcPending', A.srcPending, takeP);
  eq('★ A 自动打标 srcDiv', A.srcDiv, takeD);
  ok('★ A 确认落了钱进池', isFinite(A.sum) && A.sum > 0, 'sum=' + A.sum);
}

/* B. 待分配池不够 → 差额从股息池扣（跨池核销，真实链路） */
const B = e2e(900, false, 400, 800);
if (B.err) ok('端到端 B：分配台可渲染', false, B.err);
else {
  eq('★ B 待分配池清零（400 全用掉）', B.pending, 0);
  eq('★ B 股息池扣掉差额 500', B.div, 300);
  eq('★ B srcPending = 400', B.srcPending, 400);
  eq('★ B srcDiv = 500', B.srcDiv, 500);
}

/* C. 勾「月度注入」→ 是外部新钱，两个池都不该被扣 */
const C = e2e(2600, true, 2600, 800);
if (C.err) ok('端到端 C：分配台可渲染', false, C.err);
else {
  ok('★ C 实际落款 > 0（真走了链路）', C.sum > 0, 'sum=' + C.sum);
  eq('C 流水类型 = monthly', C.type, 'monthly');
  eq('★ C 待分配池不被扣（外部新钱）', C.pending, 2600);
  eq('★ C 股息池不被扣', C.div, 800);
  eq('★ C 不标 srcPending', C.srcPending, 0);
}

/* D. 真实链路的撤销闭环：分配 → 撤销 → 钱回到待分配池 */
{
  const gdX = w.findByName('国电电力');
  w.POOLS = {}; w.PV2.logs = []; w.PV2.pendingPool = 0; w.PV2.divPool = 0;
  w.PV2.phaseLock = 'core'; w.PV2.monthly = 3800; w.PV2.startISO = '2026-09-26';
  w.applyHolding(gdX, 500, 5.00);
  w.sellFromHolding(gdX._id, 5, 5.20);                    /* 待分配池 = 2600 */
  const pendAfterSell = w.num(w.PV2.pendingPool);
  eq('D 卖出后待分配池 = 2600', pendAfterSell, 2600);
  w.renderPool();
  w.openFundSheet('split');                           /* ★ 分配台已收进弹层 */
  const Dd = w.document;
  Dd.getElementById('splitAmt').value = '2600';
  Dd.getElementById('splitIsMonthly').checked = false;
  Dd.getElementById('splitGo').click();
  Dd.getElementById('planApply').click();
  eq('★ D 真实落地后待分配池归 0', w.num(w.PV2.pendingPool), 0);
  /* 撤销这笔分配（它是最后一条）→ 钱应按 srcPending 退回待分配池 */
  const splitSeq = w.PV2.logs.filter(x => !x.undone).slice(-1)[0].seq;
  w.undoLog(splitSeq);
  eq('★ D 撤销分配后待分配池回到 2600', w.num(w.PV2.pendingPool), 2600);
  /* 再撤销卖出 → 待分配池扣回、持仓加回 */
  const sellSeqD = w.PV2.logs.filter(x => x.type === 'sell')[0].seq;
  w.undoLog(sellSeqD);
  eq('★ D 撤销卖出后待分配池归 0', w.num(w.PV2.pendingPool), 0);
  eq('★ D 撤销卖出后持仓回到 500', w.num(gdX['持仓数量']), 500);
  w.POOLS = {}; w.PV2.logs = []; w.PV2.pendingPool = 0; w.PV2.divPool = 0;
}

/* ---------- 10. 未分配资金「一键填入」按钮（真实点击） ---------- */
console.log('\n【10】填入按钮（真实点击）');
{
  w.POOLS = {}; w.PV2.logs = [];
  w.PV2.pendingPool = 1500; w.PV2.divPool = 500;
  w.PV2.monthly = 3800; w.PV2.phaseLock = 'core'; w.PV2.startISO = '2026-09-26';
  w.renderPool();
  w.openFundSheet('split');   /* ★ 填入按钮在分配台弹层里，先打开 */
  const D = w.document;
  const fs_ = D.getElementById('uaFillSell'), fd = D.getElementById('uaFillDiv'), fa = D.getElementById('uaFillAll');
  ok('三个填入按钮都渲染出来', !!fs_ && !!fd && !!fa);
  if (fs_ && fd && fa){
    fs_.click();
    eq('★ 填入卖出 → 1500', D.getElementById('splitAmt').value, '1500');
    eq('★ 填入后自动取消「月度注入」勾选', D.getElementById('splitIsMonthly').checked, false);
    fd.click();
    eq('★ 填入股息 → 500', D.getElementById('splitAmt').value, '500');
    fa.click();
    eq('★ 全部填入 → 2000', D.getElementById('splitAmt').value, '2000');
  }
  /* 只有一个池有余额时，不渲染另一个按钮 */
  w.PV2.pendingPool = 1000; w.PV2.divPool = 0;
  w.renderPool();
  ok('★ 股息池为 0 时不渲染「填入股息」', !w.document.getElementById('uaFillDiv'));
  ok('★ 两池不全为正时不渲染「全部填入」', !w.document.getElementById('uaFillAll'));
  w.PV2.pendingPool = 0; w.PV2.divPool = 0;
}

/* ---------- 11. 老数据兼容（localStorage 缺新字段） ---------- */
console.log('\n【11】老数据兼容');
{
  const KEY = 'wb_portfolio_pool_v2';
  const keep = w.localStorage.getItem(KEY);
  /* 模拟旧版本存的载荷：没有 startISO / pendingPool / divMode */
  w.localStorage.setItem(KEY, JSON.stringify({ capital: 10000, monthly: 3000, divPool: 0, logs: [] }));
  let loadErr = null;
  try { w.pv2Load(); } catch(e){ loadErr = e.message; }
  ok('pv2Load 不抛异常', loadErr === null, loadErr);
  eq('★ 缺 startISO → 兜底 null', w.PV2.startISO, null);
  eq('★ 缺 pendingPool → 兜底 0', w.num(w.PV2.pendingPool), 0);
  eq('★ 缺 divMode → 兜底 single', w.PV2.divMode, 'single');
  /* 进度制不依赖起投日，只要有本金就能判定 */
  ok('★ 无起投日时仍可按进度判定', ['core','sat','full'].indexOf(w.phaseAuto()) >= 0, w.phaseAuto());
  ok('老数据没有流水 → 期初结转不炸', (function(){
    try { w.pv2Migrate(); return true; } catch(e){ return false; }
  })());
  w.localStorage.setItem(KEY, keep);
  w.pv2Load();
}

/* ---------- 12. 取整契约：合计必须精确，单项只允许 ±1 ---------- */
console.log('\n【12】取整契约');
{
  w.POOLS = {}; w.PV2.phaseLock = 'core';
  const p = w.allocPlan(3800, 0, true);
  const coreRows = p.rows.filter(x => x.tier === 'core');
  const coreSum = coreRows.reduce((a,b) => a + b.amt, 0);
  eq('★ 核心层落地合计 = 切层份额 3500（精确）', coreSum, p.coreAmt);
  /* 每项只允许相对「按比例值」偏离 1 元 —— 断言算法契约，不硬编码哪只拿余数
     （余数归属受浮点小数位影响，硬编码会写出脆弱测试） */
  const wsum = 1100 + 1200 + 1200;
  let maxDev = 0;
  coreRows.forEach(row => {
    const nm = row.r['标的名称'];
    const want = ({ '长江电力':1100, '国电电力':1200, '工商银行':1200 })[nm];
    if (want === undefined) return;
    const exact = p.coreAmt * want / wsum;
    maxDev = Math.max(maxDev, Math.abs(row.amt - exact));
  });
  ok('★ 每项偏离按比例值 ≤ 1 元', maxDev <= 1, 'maxDev=' + maxDev.toFixed(3));

  w.PV2.phaseLock = 'sat';
  const p2 = w.allocPlan(4000, 0, true);
  eq('★ 卫星层落地合计 = 切层份额 3200（精确）',
     p2.rows.filter(x => x.tier === 'sat').reduce((a,b) => a + b.amt, 0), p2.satAmt);
  eq('★ 核心补仓合计 = 切层份额 800（精确）',
     p2.rows.filter(x => x.tier === 'core').reduce((a,b) => a + b.amt, 0), p2.coreAmt);
  w.PV2.phaseLock = null;
}

console.log('\n========================================');
console.log('PASS: %d   FAIL: %d', PASS, FAIL);
if (fails.length){ console.log('\n失败项：'); fails.forEach(f => console.log('  ✗ ' + f)); }
else console.log('全部通过 ✓');
process.exit(FAIL ? 1 : 0);
