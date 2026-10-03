/* 资金池 v2 冒烟测试（预置缓存数据，离线模式） */
const path = require('path');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const HTML = path.join(ROOT, 'portfolio-workbench.html');
const src = fs.readFileSync(HTML, 'utf8');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) pass++;
  else { fail++; failures.push(name + (extra ? ' → ' + extra : '')); }
}

/* ---- 构造 7 条组合记录（3 核心 + 4 卫星），字段名与 F 映射一致 ---- */
const RECS = [
  { _id:'r1', '标的名称':'长江电力', '代码':'600900.SH', '组合层级':'核心层', '目标仓位':20, '当前价格':28.36, '一手股数':100, '持仓数量':0, '减仓起始价':35 },
  { _id:'r2', '标的名称':'国电电力', '代码':'600795.SH', '组合层级':'核心层', '目标仓位':20, '当前价格':5.24,  '一手股数':100, '持仓数量':0, '减仓起始价':7 },
  { _id:'r3', '标的名称':'工商银行', '代码':'601398.SH', '组合层级':'核心层', '目标仓位':20, '当前价格':8.13,  '一手股数':100, '持仓数量':0, '减仓起始价':10 },
  { _id:'r4', '标的名称':'中国神华', '代码':'601088.SH', '组合层级':'卫星层', '目标仓位':10, '当前价格':48.03, '一手股数':100, '持仓数量':0, '减仓起始价':48 },
  { _id:'r5', '标的名称':'紫金矿业', '代码':'601899.SH', '组合层级':'卫星层', '目标仓位':10, '当前价格':18.20, '一手股数':100, '持仓数量':0, '减仓起始价':25 },
  { _id:'r6', '标的名称':'兖矿能源', '代码':'600188.SH', '组合层级':'卫星层', '目标仓位':10, '当前价格':19.76, '一手股数':100, '持仓数量':0, '减仓起始价':26 },
  { _id:'r7', '标的名称':'中国联通', '代码':'600050.SH', '组合层级':'卫星层', '目标仓位':10, '当前价格':5.53,  '一手股数':100, '持仓数量':0, '减仓起始价':8 },
  { _id:'r8', '标的名称':'某备选股', '代码':'000001.SZ', '组合层级':'卫星层备选', '目标仓位':5, '当前价格':10, '一手股数':100, '持仓数量':0 }
];

const dom = new JSDOM(src, {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'https://local.test/'
});
const w = dom.window, d = w.document;
w.confirm = () => true;

/* 预置缓存（离线模式的数据源） */
w.localStorage.setItem('wb_portfolio_val_v1', JSON.stringify(RECS));

/* 手动执行页面脚本 */
w.eval(d.querySelector('script').textContent);

/* 手动走离线初始化流程 */
w.RECORDS = RECS.map(w.normalize ? w.normalize : (x => x));
w.poolLoad();
w.pv2Load();
w.pv2Migrate();
w.renderTabs();
w.bindEvents();
/* ★ R39：重置/清空按钮已改为全局事件委托 + 页面内确认弹层，
   离线套件必须手动挂上委托，否则点击无反应。 */
w.bindGlobalDelegates();
w.goOffline('test');

function pv2El(){ return d.querySelector('#poolV2'); }
function step(name, fn){ try { fn(); } catch (e) { fail++; failures.push(name + ' → THROW ' + e.message); } }

// ---------- 1. 基础结构 ----------
ok('组合记录已载入 8 条', w.RECORDS.length === 8, 'n=' + w.RECORDS.length);
ok('#poolV2 存在', !!pv2El());
ok('组合内 7 只（含备选不计入）', w.sortedRecs().filter(r => w.isInPortfolio(r)).length === 7,
   'n=' + w.sortedRecs().filter(r => w.isInPortfolio(r)).length);

d.querySelector('.tab[data-tab="pool"]').click();
ok('#poolV2 已渲染', pv2El() && pv2El().innerHTML.length > 300, 'len=' + (pv2El() ? pv2El().innerHTML.length : -1));

// ---------- 2. 阶段卡 ----------
ok('阶段卡存在', /当前阶段/.test(pv2El().textContent));
ok('三种阶段名齐全', /核心层阶段/.test(pv2El().textContent) && /卫星层阶段/.test(pv2El().textContent) && /完整持仓阶段/.test(pv2El().textContent));
ok('有自动/锁定标记', /按建仓进度自动|手动锁定/.test(pv2El().textContent));
ok('默认自动判定为核心层阶段', w.phaseNow() === 'core', 'got=' + w.phaseNow());

// ---------- 3. 资金来源条 + 三个弹层 ----------
/* ★ R26 起本金/月度/股息/分配台不再平铺在页面上（用户反馈「手机上滑半天」），
   全部收进弹层。所以「入口存在」的断言改为：资金条三按钮 + 逐个打开弹层确认控件在。 */
ok('★ 资金来源条三按钮', !!d.querySelector('[data-fund="money"]') &&
   !!d.querySelector('[data-fund="dividend"]') && !!d.querySelector('[data-fund="split"]'));
ok('★ 资金条显示本金/月度口径', /本金/.test(pv2El().textContent) && /月度/.test(pv2El().textContent));
w.openFundSheet('money');
ok('★ 资金设置弹层：本金/月度入口', !!d.querySelector('#capIn') && !!d.querySelector('#capSet') &&
   !!d.querySelector('#monIn') && !!d.querySelector('#monSet'));
ok('★ 弹层含「初始资金 / 每月增量」', /初始资金/.test(d.body.textContent) && /每月增量/.test(d.body.textContent));

// ---------- 4. 分配台 / 股息 / 流水（各在弹层或独立容器） ----------
w.openFundSheet('split');
ok('★ 分配台弹层：输入与预览', !!d.querySelector('#splitAmt') && !!d.querySelector('#splitGo') &&
   !!d.querySelector('#splitPreview'));
w.openFundSheet('dividend');
ok('★ 股息弹层：登记与再分配入口', !!d.querySelector('#divIn') && !!d.querySelector('#divAdd') &&
   !!d.querySelector('#divSplitAmt') && !!d.querySelector('#divSplitGo'));
ok('★ 操作流水区存在（独立容器 #poolLogs）', /操作流水/.test(d.getElementById('poolLogs').textContent));
ok('全部清空按钮存在', !!d.querySelector('#pv2Reset'));
w.openFundSheet('money');   /* 保持打开，供后面的写操作用 */

// ---------- 5. 可分配标的枚举正确 ----------
step('poolListOf', () => {
  const core = w.poolListOf('core').map(r => r['标的名称']);
  const sat = w.poolListOf('sat').map(r => r['标的名称']);
  ok('核心层 3 只', core.length === 3, JSON.stringify(core));
  ok('卫星层 4 只', sat.length === 4, JSON.stringify(sat));
  ok('备选股未被纳入', !sat.includes('某备选股') && !core.includes('某备选股'));
});

// ---------- 6. 写操作：本金 ----------
d.querySelector('#capIn').value = '530000';
d.querySelector('#capSet').click();
ok('本金写入', w.PV2.capital === 530000, 'got=' + w.PV2.capital);
ok('本金产生流水', w.PV2.logs.length === 1 && w.PV2.logs[0].type === 'capital');

// ---------- 7. 写操作：月度 ----------
d.querySelector('#monIn').value = '10000';
d.querySelector('#monSet').click();
ok('月度写入', w.PV2.monthly === 10000, 'got=' + w.PV2.monthly);

// ---------- 8. 核心层阶段：按真实方案的固定比例分配（92.5 : 7.5） ----------
// 注：本轮把 PHASES 从拍脑袋的 100:0 改成方案原文的固定金额分配
//     第一阶段 核心 3500 / 卫星 300 → 92.5 : 7.5
w.openFundSheet('split');   /* ★ 分配台已收进弹层，先打开才能拿到 #splitAmt */
d.querySelector('#splitAmt').value = '30000';
/* ★ 本节测的是「定投 = 按方案固定金额」口径，必须勾选「记为月度注入」；
   不勾会走缺口加权（落地额受各池缺口上限约束，与输入额不等），
   那样下面基于 fixed 口径的断言就会对不上（这正是新加的「预览 vs 算法」断言抓出来的）。 */
d.querySelector('#splitIsMonthly').checked = true;
d.querySelector('#splitGo').click();
ok('预览已生成', d.querySelector('#splitPreview').innerHTML.length > 100);
ok('确认落地按钮存在', !!d.querySelector('#planApply'));

const coreIds = new Set(w.poolListOf('core').map(r => r._id));
let coreGot = 0, satGot = 0, planSum = 0;
d.querySelectorAll('[data-plan-amt]').forEach(el => {
  const v = parseFloat(el.value) || 0;
  planSum += v;
  if (coreIds.has(el.getAttribute('data-plan-amt'))) coreGot += v; else satGot += v;
});
/* 30000 元按 92.5:7.5 切 → 核心层份额 ≈27700 / 卫星层份额 ≈2300。
   注意：coreAmt/satAmt 是「切层份额」，rows 里的 amt 是「实际落到标的的钱」，
   受各标的缺口上限约束 —— 份额 > 缺口时不会硬塞，只填到够一手为止。
   ★ 所以这里分两层断言：
     ① 切层份额 → 精确断言（防有人误改 PHASES 的 split）
     ② 实际落地额 → 断言「不超份额」+「确实分到了钱」 */
const plan30 = w.allocPlan(30000, 0, true);
/* ① 切层份额：92.5 : 7.5 —— 用比例断言，改比例必报错 */
const shareCore = plan30.coreAmt / (plan30.coreAmt + plan30.satAmt);
ok('★ 切层比例：核心 = 92.5%', Math.abs(shareCore - 0.925) < 0.005, 'got=' + (shareCore * 100).toFixed(2) + '%');
ok('★ 切层比例：卫星 = 7.5%', Math.abs((1 - shareCore) - 0.075) < 0.005, 'got=' + ((1 - shareCore) * 100).toFixed(2) + '%');
ok('切层份额：核心 = 27700', Math.abs(plan30.coreAmt - 27700) <= 100, 'coreAmt=' + plan30.coreAmt);
ok('切层份额：卫星 = 2300', Math.abs(plan30.satAmt - 2300) <= 100, 'satAmt=' + plan30.satAmt);
ok('★ 切层份额合计 = 输入金额', plan30.coreAmt + plan30.satAmt === 30000, plan30.coreAmt + '+' + plan30.satAmt);
/* ② 实际落地额 */
ok('实际落到核心层的钱 > 0', coreGot > 0, 'core=' + coreGot);
ok('实际落到卫星层的钱 > 0（种子）', satGot > 0, 'sat=' + satGot);
ok('实际分配不超过切层份额', coreGot <= plan30.coreAmt + 100 && satGot <= plan30.satAmt + 100,
   'core=' + coreGot + ' sat=' + satGot);
/* ★ 旧写法 planSum ≡ coreGot+satGot 是同一个 forEach 里加出来的，恒真。
   改为把「预览框里的金额」与「算法产出的方案」对比 —— 这能真正发现渲染走样。 */
const planRowsSum  = plan30.rows.reduce((a,b) => a + b.amt, 0);
const planRowsCore = plan30.rows.filter(x => x.tier === 'core').reduce((a,b) => a + b.amt, 0);
ok('★ 预览框金额 = 算法方案合计（预览未走样）', Math.abs(planSum - planRowsSum) < 1,
   'preview=' + planSum + ' plan=' + planRowsSum);
ok('★ 预览框核心层金额 = 方案核心层金额', Math.abs(coreGot - planRowsCore) < 1,
   'preview=' + coreGot + ' plan=' + planRowsCore);

// ---------- 9. 落地 + 撤销 ----------
const logsBefore = w.PV2.logs.length;
d.querySelector('#planApply').click();
ok('落地增加流水', w.PV2.logs.length === logsBefore + 1, 'before=' + logsBefore + ' after=' + w.PV2.logs.length);
const lastLog = w.lastActiveLog();
ok('最后一笔为分配', lastLog && (lastLog.type === 'split' || lastLog.type === 'monthly'), 'type=' + (lastLog && lastLog.type));
ok('落地后池有余额', Object.keys(w.POOLS).length > 0, 'pools=' + Object.keys(w.POOLS).length);

const snapAfter = {};
for (const rid in w.POOLS) snapAfter[rid] = w.POOLS[rid].amount;
const undoSeq = lastLog.seq;
w.undoLog(undoSeq);
const lg = w.PV2.logs.find(x => x.seq === undoSeq);
ok('撤销被标记 undone', lg && lg.undone === true);
let reverted = true;
for (const rid in snapAfter) {
  const now = w.POOLS[rid] ? w.POOLS[rid].amount : 0;
  if (now >= snapAfter[rid]) reverted = false;
}
ok('撤销后余额回落', reverted);

// ---------- 10. 倒序撤销保护 ----------
w.openFundSheet('money');
d.querySelector('#capIn').value = '530000';
d.querySelector('#capSet').click();
const newest = w.lastActiveLog();
const older = w.PV2.logs.filter(x => !x.undone && x.seq !== newest.seq)[0];
if (older) {
  w.undoLog(older.seq);
  ok('非最近一笔撤销被拒绝', older.undone === false, 'older.undone=' + older.undone);
} else { ok('非最近一笔撤销被拒绝（无更早流水，跳过）', true); }

// ---------- 11. 股息池 ----------
w.openFundSheet('dividend');
const divBefore = w.divTotal();
d.querySelector('#divIn').value = '5000';
d.querySelector('#divAdd').click();
ok('股息池 +5000', w.divTotal() === divBefore + 5000, 'got=' + w.divTotal());
ok('股息产生流水', w.PV2.logs.some(x => x.type === 'dividend' && !x.undone));

// ---------- 11a. 股息模式：默认整笔单投 ----------
ok('默认模式为整笔单投', (w.PV2.divMode || 'single') === 'single', 'mode=' + w.PV2.divMode);
ok('存在模式切换按钮', d.querySelectorAll('[data-divmode]').length === 2,
   'n=' + d.querySelectorAll('[data-divmode]').length);
const dsa = d.querySelector('#divSplitAmt');
dsa.value = '5000';
d.querySelector('#divSplitGo').click();
ok('单投方案已生成', d.querySelector('#divPreview').innerHTML.length > 50);
ok('单投模式下有标的下拉', !!d.querySelector('#divTarget'));
ok('单投只涉及一只标的', /整笔投给/.test(d.querySelector('#divPreview').textContent));
// 下拉候选按折价降序
const opts = d.querySelectorAll('#divTarget option');
ok('单投候选=组合内 7 只', opts.length === 7, 'n=' + opts.length);
const dab = d.querySelector('#divApply');
ok('股息确认按钮存在', !!dab);
if (dab) {
  const poolsBefore = JSON.stringify(w.POOLS);
  const divPre = w.divTotal();
  dab.click();
  ok('单投使池变化', JSON.stringify(w.POOLS) !== poolsBefore);
  ok('单投后差价扣减', w.divTotal() === divPre - 5000, 'before=' + divPre + ' after=' + w.divTotal());
}

// ---------- 11b. 切换到按比例分摊 ----------
let splitBtn = null;
d.querySelectorAll('[data-divmode]').forEach(b => { if (b.getAttribute('data-divmode') === 'split') splitBtn = b; });
splitBtn.click();
ok('可切到分摊模式', w.PV2.divMode === 'split', 'mode=' + w.PV2.divMode);
ok('★ 分摊模式下不再有机动池输入', !d.querySelector('#divFlex'));
// 再登记一笔股息后分摊
d.querySelector('#divIn').value = '6000';
d.querySelector('#divAdd').click();
d.querySelector('#divSplitAmt').value = '6000';
d.querySelector('#divSplitGo').click();
ok('分摊方案已生成', d.querySelector('#divPreview').innerHTML.length > 50);
ok('分摊方案含层级金额', /核心层/.test(d.querySelector('#divPreview').textContent));
/* ★ 精确断言：股息池扣减额必须恰好等于各行分出去的钱之和
   （旧断言只写 `< divPre2`，多扣少扣任意额度都能过） */
let sumRows = 0;
d.querySelectorAll('#divPreview .fp-div-line').forEach(el => {
  const m = el.textContent.match(/([\d,]+)\s*元/);
  if (m) sumRows += parseFloat(m[1].replace(/,/g, ''));
});
ok('分摊预览有金额行', sumRows > 0, 'sumRows=' + sumRows);
const dab2 = d.querySelector('#divApply');
if (dab2) {
  const divPre2 = w.divTotal();
  dab2.click();
  ok('★ 股息池精确扣减 = 各行合计', divPre2 - w.divTotal() === sumRows,
     'before=' + divPre2 + ' after=' + w.divTotal() + ' sumRows=' + sumRows);
  const lastLog2 = w.PV2.logs.filter(x => !x.undone).slice(-1)[0];
  ok('★ 分摊落款自动打标 srcDiv', w.num(lastLog2.srcDiv) === sumRows, 'srcDiv=' + lastLog2.srcDiv);
  /* ★ 撤销之后钱必须退回股息池（此前 srcDiv 没写，撤销会让钱凭空蒸发） */
  w.undoLog(lastLog2.seq);
  ok('★ 撤销股息分配后股息池全额退回', w.divTotal() === divPre2, 'got=' + w.divTotal() + ' want=' + divPre2);
}
// 切回单投（验证持久化字段）
let singleBtn = null;
d.querySelectorAll('[data-divmode]').forEach(b => { if (b.getAttribute('data-divmode') === 'single') singleBtn = b; });
singleBtn.click();
ok('可切回单投模式', w.PV2.divMode === 'single', 'mode=' + w.PV2.divMode);

// ---------- 12. 手工记一笔 ----------
const setBtns = d.querySelectorAll('[data-pool-set]');
ok('逐池记一笔按钮存在', setBtns.length === 7, 'n=' + setBtns.length);
if (setBtns.length) {
  const btn = setBtns[0];
  const rid = btn.getAttribute('data-pool-set');
  const inp = d.querySelector('[data-pool-in="' + rid + '"]');
  const oldAmt = (w.POOLS[rid] || {}).amount || 0;
  inp.value = '1500';
  const lb = w.PV2.logs.length;
  btn.click();
  ok('记一笔累加生效', ((w.POOLS[rid] || {}).amount || 0) === oldAmt + 1500,
     'old=' + oldAmt + ' new=' + ((w.POOLS[rid] || {}).amount || 0));
  ok('记一笔产生流水', w.PV2.logs.length === lb + 1);
}

// ---------- 13. 阶段切换 ----------
const pbs = pv2El().querySelectorAll('[data-phase-set]');
ok('阶段按钮 4 个（3 阶段 + 跟随数据）', pbs.length === 4, 'n=' + pbs.length);
let satBtn = null;
pbs.forEach(b => { if (b.getAttribute('data-phase-set') === 'sat') satBtn = b; });
if (satBtn) {
  satBtn.click();
  ok('可手动锁定阶段', w.PV2.phaseLock === 'sat' && w.phaseNow() === 'sat', 'lock=' + w.PV2.phaseLock);
  ok('显示手动锁定标记', /手动锁定/.test(pv2El().textContent));
  let autoBtn = null;
  pv2El().querySelectorAll('[data-phase-set]').forEach(b => { if (b.getAttribute('data-phase-set') === 'auto') autoBtn = b; });
  autoBtn.click();
  ok('可恢复自动判定', w.PV2.phaseLock === null);
}

// ---------- 14. 卫星层阶段比例 20 / 80（方案第二阶段：核心800 / 卫星3200） ----------
w.PV2.phaseLock = 'sat';
const pSat = w.allocPlan(10000, 0, true);
const shSat = pSat.coreAmt / (pSat.coreAmt + pSat.satAmt);
ok('★ 卫星层阶段比例：核心 = 20%', Math.abs(shSat - 0.20) < 0.005, 'got=' + (shSat * 100).toFixed(2) + '%');
ok('★ 卫星层阶段比例：卫星 = 80%', Math.abs((1 - shSat) - 0.80) < 0.005, 'got=' + ((1 - shSat) * 100).toFixed(2) + '%');
ok('卫星层阶段 20:80', Math.abs(pSat.coreAmt - 2000) <= 100 && Math.abs(pSat.satAmt - 8000) <= 100,
   'core=' + pSat.coreAmt + ' sat=' + pSat.satAmt);
// ★ 机动池已移除：flexPct 一律被忽略，flexAmt 恒为 0（否则会有钱被扣掉却无处承接）
const pFlex = w.allocPlan(10000, 20, true);
ok('★ 机动池已移除：flexAmt 恒为 0', pFlex.flexAmt === 0, 'flex=' + pFlex.flexAmt);
ok('★ 传 flexPct=20 也不影响切层（核心 2000 / 卫星 8000）',
   pFlex.coreAmt === 2000 && pFlex.satAmt === 8000,
   'core=' + pFlex.coreAmt + ' sat=' + pFlex.satAmt);
w.PV2.phaseLock = null;

// ---------- 14b. 月度定投走固定比例 / 未勾选走缺口加权 ----------
step('定投 vs 意外资金 双口径', () => {
  w.PV2.phaseLock = 'core';
  const fixed = w.allocPlan(10000, 0, true);    /* 定投：固定比例 */
  const gap   = w.allocPlan(10000, 0, false);   /* 意外资金：缺口加权 */
  ok('月度定投 mode=fixed', fixed.mode === 'fixed', 'mode=' + fixed.mode);
  ok('意外资金 mode=gap', gap.mode === 'gap', 'mode=' + gap.mode);
  ok('固定比例：核心层 = 9250 左右', Math.abs(fixed.coreAmt - 9250) <= 200, 'core=' + fixed.coreAmt);
  ok('固定比例：卫星层 = 750 左右', Math.abs(fixed.satAmt - 750) <= 200, 'sat=' + fixed.satAmt);
  w.PV2.phaseLock = null;
});

// ---------- 14c. allocPlan 默认口径 = gap（★ 回归：早期默认 fixed 会让股息静默走错口径） ----------
step('allocPlan 默认口径', () => {
  w.PV2.phaseLock = 'core';
  const dflt = w.allocPlan(10000, 0);          /* 不传第三参 */
  ok('★ 不传第三参 → mode=gap', dflt.mode === 'gap', 'mode=' + dflt.mode);
  const fx = w.allocPlan(10000, 0, true);
  ok('显式 true → mode=fixed', fx.mode === 'fixed', 'mode=' + fx.mode);
  const gp = w.allocPlan(10000, 0, false);
  ok('显式 false → mode=gap', gp.mode === 'gap', 'mode=' + gp.mode);
  w.PV2.phaseLock = null;
});

// ---------- 14d. 定投严格按方案金额（★ 软上限已删除：算法不得自行偏离方案） ----------
step('定投按方案金额', () => {
  w.PV2.phaseLock = 'core';
  w.POOLS = {};
  const r = w.allocPlan(3800, 0, true);
  const amtOf = nm => { const row = r.rows.filter(x => x.r['标的名称'] === nm)[0]; return row ? row.amt : 0; };
  ok('★ 长电 = 1100（方案）', amtOf('长江电力') === 1100, 'got=' + amtOf('长江电力'));
  ok('★ 国电 = 1200（方案）', amtOf('国电电力') === 1200, 'got=' + amtOf('国电电力'));
  ok('★ 工行 = 1200（方案）', amtOf('工商银行') === 1200, 'got=' + amtOf('工商银行'));
  const sumCore = r.rows.filter(x => x.tier === 'core').reduce((a,b) => a + b.amt, 0);
  ok('★ 核心层合计 = 切层份额', sumCore === r.coreAmt, 'sum=' + sumCore + ' coreAmt=' + r.coreAmt);
  ok('核心层三只标记 planned', r.rows.filter(x => x.tier === 'core').every(x => x.planned === true));

  /* 池子塞满也不跳过 —— 这是本轮删掉软上限的核心断言 */
  const cp = w.poolListOf('core').filter(x => x['标的名称'] === '长江电力')[0];
  w.POOLS[cp._id] = { amount: 999999, note:'', since:'2026-09-01' };
  const r2 = w.allocPlan(3800, 0, true);
  const amtOf2 = nm => { const row = r2.rows.filter(x => x.r['标的名称'] === nm)[0]; return row ? row.amt : 0; };
  ok('★ 池子塞满也照方案给 1100（不跳过）', amtOf2('长江电力') === 1100, 'got=' + amtOf2('长江电力'));
  ok('★ 国电仍是 1200', amtOf2('国电电力') === 1200, 'got=' + amtOf2('国电电力'));
  w.POOLS = {};
  w.PV2.phaseLock = null;
});

// ---------- 14e. 输入金额浮动 → 比例等比缩放 ----------
step('定投等比缩放', () => {
  w.PV2.phaseLock = 'core';
  w.POOLS = {};
  const r = w.allocPlan(5000, 0, true);   /* 核心切层 = 4600 */
  const amtOf = nm => { const row = r.rows.filter(x => x.r['标的名称'] === nm)[0]; return row ? row.amt : 0; };
  /* 4600 / 3500 = 1.3143 → 1200→1577, 1100→1446 */
  ok('核心切层 = 4600', r.coreAmt === 4600, 'coreAmt=' + r.coreAmt);
  ok('国电 = 1577（等比放大）', amtOf('国电电力') === 1577, 'got=' + amtOf('国电电力'));
  ok('长电 = 1446（等比放大）', amtOf('长江电力') === 1446, 'got=' + amtOf('长江电力'));
  /* 比例不变：国电/长电 的倍数应相同 */
  const r1 = amtOf('国电电力') / 1200, r2 = amtOf('长江电力') / 1100;
  ok('★ 缩放倍数一致（比例不变）', Math.abs(r1 - r2) < 0.01, 'r1=' + r1.toFixed(4) + ' r2=' + r2.toFixed(4));
  w.POOLS = {};
  w.PV2.phaseLock = null;
});

// ---------- 14f. 阶段由建仓进度判定（不是时间） ----------
/* ★ 阶段改为建仓进度判定（R27 用户反馈：临时增加投资时进度被加速，不应该还按时间走）。
   判定逻辑：核心层还有余量 → core；核心层建完但卫星层还有 → sat；全建完 → full。 */
step('阶段由建仓进度判定（不是时间）', () => {
  /* 前置：清仓 + 设本金 5 万（下方目标手数按此基数硬算）+ 恢复自动判定 */
  for (const r of w.sortedRecs()){ if (w.isInPortfolio(r)) r['持仓数量'] = 0; }
  w.PV2.capital = 50000;
  w.PV2.phaseLock = null;
  /* 核心层全部达标但卫星层没有 → sat */
  for (const r of w.sortedRecs()){
    if (!w.isCore(r)) continue;
    const lc = w.lotCost(r), a = w.allocTier(r);
    const tgt = Math.floor(50000 * a / 100 / lc.lot);
    r['持仓数量'] = tgt * lc.shares;
  }
  ok('★ 核心层达标但卫星层没有 → sat', w.phaseAuto() === 'sat', 'got=' + w.phaseAuto());
  /* 全部达标 → full */
  for (const r of w.sortedRecs()){
    if (!w.isInPortfolio(r)) continue;
    const lc = w.lotCost(r), a = w.allocTier(r);
    const tgt = Math.floor(50000 * a / 100 / lc.lot);
    r['持仓数量'] = tgt * lc.shares;
  }
  ok('★ 全部达标 → full', w.phaseAuto() === 'full', 'got=' + w.phaseAuto());
  /* 反证：把卫星层持仓清零 → 应回到 sat */
  for (const r of w.sortedRecs()){
    if (!w.isSatellite(r)) continue;
    r['持仓数量'] = 0;
  }
  ok('★ 反证：卫星层清零 → 应回到 sat', w.phaseAuto() === 'sat', 'got=' + w.phaseAuto());
  /* 清理 */
  for (const r of w.sortedRecs()){ if (w.isInPortfolio(r)) r['持仓数量'] = 0; }
  w.PV2.capital = null;
});

// ---------- 15. 完整持仓阶段 44 / 56 ----------
w.PV2.phaseLock = 'full';
const pFull = w.allocPlan(10000, 0, true);
const shFull = pFull.coreAmt / (pFull.coreAmt + pFull.satAmt);
ok('★ 完整持仓阶段比例：核心 = 44%', Math.abs(shFull - 0.44) < 0.005, 'got=' + (shFull * 100).toFixed(2) + '%');
ok('★ 完整持仓阶段比例：卫星 = 56%', Math.abs((1 - shFull) - 0.56) < 0.005, 'got=' + ((1 - shFull) * 100).toFixed(2) + '%');
ok('完整持仓阶段 44:56', Math.abs(pFull.coreAmt - 4400) <= 100 && Math.abs(pFull.satAmt - 5600) <= 100,
   'core=' + pFull.coreAmt + ' sat=' + pFull.satAmt);
w.PV2.phaseLock = null;

// ---------- 16. 缺口加权 + 保底（显式走 gap 口径） ----------
step('缺口加权', () => {
  /* 清空池，回到"全部未开始"的干净状态再验证算法（避免前序用例污染缺口） */
  w.POOLS = {};
  w.PV2.logs = [];
  const lotOf = id => w.lotCost(w.findById(id)).lot;

  /* 钱充足（> 全层缺口）：每只都应拿满缺口，小缺口标的不会被饿死 */
  const plan = w.allocPlan(20000, 0, false);
  const byId = {};
  plan.rows.forEach(o => { byId[o.r._id] = o.amt; });
  ok('钱充足时长电拿满缺口（不超上限）', (byId['r1'] || 0) === Math.ceil(lotOf('r1') / 100) * 100,
     'r1=' + byId['r1'] + ' lot=' + lotOf('r1'));
  ok('小缺口标的未被取整归零（国电）', (byId['r2'] || 0) > 0, 'r2=' + byId['r2']);
  ok('小缺口标的未被取整归零（工行）', (byId['r3'] || 0) > 0, 'r3=' + byId['r3']);
  ok('按缺口比例：长电 >= 工行 >= 国电',
     (byId['r1'] || 0) >= (byId['r3'] || 0) && (byId['r3'] || 0) >= (byId['r2'] || 0),
     JSON.stringify([byId['r1'], byId['r3'], byId['r2']]));

  /* 钱不足（比最大缺口还小）：应集中给缺口最小的一只 */
  const small = w.allocPlan(600, 0, false);
  const sb = {};
  small.rows.forEach(o => { sb[o.r._id] = o.amt; });
  ok('钱极少时集中给最小缺口标的', (sb['r2'] || 0) > 0 && (sb['r1'] || 0) === 0,
     'r2=' + sb['r2'] + ' r1=' + sb['r1']);
  ok('钱极少时总额不超过输入', Object.values(sb).reduce((a, b) => a + b, 0) <= 600,
     'sum=' + Object.values(sb).reduce((a, b) => a + b, 0));

  /* 任何情况下单只都不超其缺口 */
  const mid = w.allocPlan(1000, 0, false);
  let over = false;
  mid.rows.forEach(o => { if (o.amt > Math.ceil(lotOf(o.r._id) / 100) * 100) over = true; });
  ok('任意金额下单只不超缺口', !over);
});

// ---------- 17. 持久化 ----------
ok('v2 已落 localStorage', !!w.localStorage.getItem('wb_portfolio_pool_v2'));
ok('v1 池已落 localStorage', !!w.localStorage.getItem('wb_portfolio_pools_v1'));

// ---------- 18. 脏文本（只看可见渲染区，排除 <script> 源码） ----------
const panes = d.querySelectorAll('.pane');
let visTxt = '';
panes.forEach(p => { visTxt += p.textContent + '\n'; });
visTxt += pv2El().textContent;
ok('可见区无 NaN', !/NaN/.test(visTxt), (visTxt.match(/.{0,40}NaN.{0,20}/) || [''])[0]);
ok('可见区无 undefined', !/undefined/.test(visTxt), (visTxt.match(/.{0,40}undefined.{0,20}/) || [''])[0]);
ok('可见区无 Infinity', !/Infinity/.test(visTxt));
ok('v2 区无 markdown 星号', !/\*\*/.test(pv2El().textContent));
ok('v2 区无 null 字面量', !/\bnull\b/.test(pv2El().textContent));
/* ★ 去掉 `|| true`（恒真）与那个先把 '—' 删掉再去找 '—' 的 replace（自相矛盾） */
ok('可见区无「— 元」异常渲染', !/—\s*元/.test(visTxt), 'hit=' + (visTxt.match(/—\s*元/) || [''])[0]);

// ---------- 19. 回归 ----------
const recs = w.sortedRecs();
ok('联通价 < 10（回归）', parseFloat(recs.find(r => /联通/.test(r['标的名称']))['当前价格']) < 10);
ok('兖矿 = 19.76（回归）', parseFloat(recs.find(r => /兖矿/.test(r['标的名称']))['当前价格']) === 19.76);
const ti = w.statTier();
ok('核心 3 / 卫星 4（回归）', ti.core.n === 3 && ti.sat.n === 4, 'core=' + ti.core.n + ' sat=' + ti.sat.n);

// ---------- 20. 全部清空 ----------
/* ★ R39 重写：此前这里直接点 #pv2Reset 就断言「已清空」——
   但那时按钮【没有绑定】（委托未挂）或确认框【未点击】，
   断言其实是在空状态上「碰巧通过」（假绿）。现在先造出非空状态再验。 */
w.PV2.capital = 99999; w.PV2.monthly = 8888; w.PV2.phaseLock = 'core';
w.PV2.logs = [{ seq:1, ts:'2026-09-26T03:00:00.000Z', type:'capital', label:'x', amount:1, detail:'' }];
w.POOLS = { g_cp: { amount: 1234, note:'' } };
w.renderPool();
ok('清空前置：本金非空', w.PV2.capital === 99999);
ok('清空前置：池非空', Object.keys(w.POOLS).length === 1);
ok('清空前置：流水非空', w.PV2.logs.length === 1);
d.querySelector('#pv2Reset').click();
ok('清空：弹出页面内确认弹层',
   (function(){ var h = d.getElementById('confirmSheet'); return !!(h && h.style.display === 'block'); })());
(function(){ var b = d.getElementById('cfOk'); if (b) b.click(); })();   /* 第一次确定 */
(function(){ var b = d.getElementById('cfOk'); if (b) b.click(); })();   /* 第二次确定 */
ok('清空：本金', w.PV2.capital === null);
ok('清空：池', Object.keys(w.POOLS).length === 0);
ok('清空：流水', w.PV2.logs.length === 0);
ok('清空：阶段锁', w.PV2.phaseLock === null);

console.log('\n========== 资金池 v2 冒烟测试 ==========');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
if (fail) {
  console.log('\n--- 失败项 ---');
  failures.forEach(f => console.log('  x ' + f));
  process.exit(1);
} else {
  console.log('全部通过 ✓');
}
process.exit(0);
