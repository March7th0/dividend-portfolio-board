/* 池 → 持仓 联动测试：买入扣池+加持仓、严格整手、加权成本、撤销回滚、建仓路线实时进度 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML = fs.readFileSync(path.resolve(__dirname, '..', 'portfolio-workbench.html'), 'utf8');

let PASS = 0, FAIL = 0;
const fails = [];
function ok(name, cond, extra){
  if (cond){ PASS++; }
  else { FAIL++; fails.push(name + (extra ? '  → ' + extra : '')); }
}
function eq(name, a, b){ ok(name, a === b, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); }

/* 预置数据：核心层 3 只 + 卫星层 1 只（带 record_id，模拟平台真实结构） */
const RECS = [
  { record_id:'r_cp', 标的名称:'长江电力', 代码:'600900.SH', 组合层级:'核心层', 目标仓位:25, 当前价格:28.36, 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:'2026-09-25',
    MA20:28.2655, MA60:28.148, RSI14:57.50, 技术面提醒:'站上MA60；站上MA20；RSI中性' },
  { record_id:'r_gd', 标的名称:'国电电力', 代码:'600795.SH', 组合层级:'核心层', 目标仓位:20, 当前价格:5.24,  一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:'2026-09-25' },
  { record_id:'r_gs', 标的名称:'工商银行', 代码:'601398.SH', 组合层级:'核心层', 目标仓位:15, 当前价格:8.13,  一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:'2026-09-25' },
  { record_id:'r_zj', 标的名称:'紫金矿业', 代码:'601899.SH', 组合层级:'卫星层', 目标仓位:15, 当前价格:30.01, 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:'2026-09-25',
    MA20:32.585, MA60:31.7738, RSI14:21.95, 技术面提醒:'⚠ 跌破MA60（定投节奏需人工复核）；⚠ RSI超卖(<30)' },
];

function boot(){
  const dom = new JSDOM(HTML, { runScripts:'outside-only', pretendToBeVisual:true, url:'https://example.test/' });
  const w = dom.window;
  w.localStorage.setItem('wb_portfolio_val_v1', JSON.stringify(RECS));
  w.localStorage.setItem('wb_portfolio_pools_v1', JSON.stringify({}));
  w.localStorage.setItem('wb_portfolio_pool_v2', JSON.stringify({
    capital: 100000, monthly: 5000, divPool: 0, divSince: null, divMode: 'single', logs: [], phaseLock: null
  }));
  const script = HTML.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)[1];
  try { w.eval(script); } catch(e){ /* DOMContentLoaded 尚未触发，容错 */ }
  w.goOffline && w.goOffline();
  return w;
}

const w = boot();
ok('工作台已加载 RECORDS', w.RECORDS && w.RECORDS.length === 4, 'len=' + (w.RECORDS||[]).length);
ok('POOLS 已初始化', typeof w.POOLS === 'object');
ok('金额格式化可用', typeof w.fmt === 'function');
ok('本地存储键存在', !!w.localStorage.getItem('wb_portfolio_val_v1'));

/* --- 1. 取到标的 ---
   注意：goOffline()/loadAll() 会把 RECORDS 整体替换成新对象数组，
   所以任何时候都必须用 findByName 实时取，不能缓存对象引用。 */
function G(name){ return w.findByName(name); }
const cp = G('长江电力');
ok('findByName 命中长江电力', !!cp);
ok('findByName 命中国电电力', !!G('国电电力'));
ok('findByName 命中紫金矿业', !!G('紫金矿业'));
const cpId = cp._id, gdId = G('国电电力')._id;

/* --- 2. lotShares 兜底 --- */
eq('lotShares 读一手股数', w.lotShares(cp), 100);
/* 缺一手股数时兜底 100 */
const fake = { 当前价格: 10, 一手股数: 0 };
eq('lotShares 缺值兜底 100', w.lotShares(fake), 100);

/* --- 3. 严格整手：余额不足一手 --- */
w.POOLS = {};
ok('余额 0 时不可买', w.maxHands(cp, 28.36, 0) === 0);
/* 长江电力一手 = 2836 元；给 2835 → 0 手（差 1 元也不行） */
eq('余额差 1 元 → 0 手', w.maxHands(cp, 28.36, 2835), 0);
eq('刚好一手 → 1 手', w.maxHands(cp, 28.36, 2836), 1);
eq('2835.x 不足两手', w.maxHands(cp, 28.36, 5671), 1);
eq('够两手 → 2 手', w.maxHands(cp, 28.36, 5672), 2);

/* --- 4. buyFromPool：扣池 + 加持仓 + 成本 --- */
w.POOLS[cpId] = { amount: 6000, note:'', since:'2026-09-01' };
const okBuy = w.buyFromPool(cpId, 2, 28.36);
ok('买入返回成功', okBuy === true);
eq('池子扣减正确（6000 - 2836*2 = 328）', w.POOLS[cpId].amount, 328);
eq('持仓数量 200 股', w.num(G('长江电力')['持仓数量']), 200);
eq('首次建仓成本 = 买入价', Number(w.num(G('长江电力')['持仓成本']).toFixed(3)), 28.36);
ok('买入流水已记', w.PV2.logs.length === 1 && w.PV2.logs[0].type === 'buy');
eq('流水金额 = 花费', w.PV2.logs[0].amount, 5672);
ok('流水 detail 带 hands', w.PV2.logs[0].detail[0].hands === 2);
ok('流水 detail 带 price', w.PV2.logs[0].detail[0].price === 28.36);

/* --- 5. 二次买入：加权平均成本 --- */
w.POOLS[cpId].amount = 3000;
w.buyFromPool(cpId, 1, 30.00);
/* 期望：(200*28.36 + 100*30.00) / 300 = (5672+3000)/300 = 28.9067 */
const expectCost = (200*28.36 + 100*30) / 300;
eq('持仓数量累加到 300', w.num(G('长江电力')['持仓数量']), 300);
eq('加权成本正确', Number(w.num(G('长江电力')['持仓成本']).toFixed(3)), Number(expectCost.toFixed(3)));
/* 3000 元恰好买 1 手 @30 → 余额归零 → 池子被清理 */
ok('余额恰好用尽 → 池子被删除', w.POOLS[cpId] === undefined);

/* --- 6. 超买被拒绝，且状态不变 --- */
/* 池子已清空，先补一笔余额再测超买 */
w.POOLS[cpId] = { amount: 164, note:'', since:'2026-09-01' };
const poolNow = w.POOLS[cpId].amount;
const qtyNow = w.num(G('长江电力')['持仓数量']);
const logsNow = w.PV2.logs.length;
const bad = w.buyFromPool(cpId, 5, 28.36);   /* 5 手需 14180，池内仅 164 */
ok('超买返回 false', bad === false);
eq('超买后池子不变', w.POOLS[cpId].amount, poolNow);
eq('超买后持仓不变', w.num(G('长江电力')['持仓数量']), qtyNow);
eq('超买后无新流水', w.PV2.logs.length, logsNow);

/* --- 7. 非法手数被拒绝 --- */
ok('0 手被拒', w.buyFromPool(cpId, 0, 28.36) === false);
ok('负数手被拒', w.buyFromPool(cpId, -1, 28.36) === false);
ok('非整数手被四舍五入后处理', (function(){
  w.POOLS[gdId] = { amount: 600, note:'', since:'2026-09-01' };
  /* 国电一手 524 元；传 1.6 手 → round → 2 手 → 需 1048 > 600 → 应拒绝 */
  return w.buyFromPool(gdId, 1.6, 5.24) === false;
})());

/* --- 8. 余额恰好用尽 → 池子被清理（避免残留 0 元池） --- */
w.POOLS[gdId] = { amount: 524, note:'', since:'2026-09-01' };
w.buyFromPool(gdId, 1, 5.24);
ok('余额用尽后池子被删除', w.POOLS[gdId] === undefined);
eq('国电持仓 100 股', w.num(G('国电电力')['持仓数量']), 100);

/* --- 9. 撤销买入 → 池子退款 + 持仓回滚 --- */
const buySeq = w.PV2.logs[w.PV2.logs.length - 1].seq;
const qtyBeforeUndo = w.num(G('国电电力')['持仓数量']);
w.undoLog(buySeq);
eq('撤销后国电持仓自 100 归零', w.num(G('国电电力')['持仓数量']), qtyBeforeUndo - 100);
ok('撤销后池子退款 524', w.POOLS[gdId] && w.POOLS[gdId].amount === 524);
ok('流水被标记 undone', w.PV2.logs[w.PV2.logs.length - 1].undone === true);

/* --- 10. 撤销非最后一条被拒绝 --- */
const firstSeq = w.PV2.logs[0].seq;
const beforeReject = w.POOLS[cpId] ? w.POOLS[cpId].amount : null;
w.undoLog(firstSeq);   /* 第一条早已不是最后一条 */
const afterReject = w.POOLS[cpId] ? w.POOLS[cpId].amount : null;
eq('撤销中间流水不生效', afterReject, beforeReject);

/* --- 10b. 注入类流水撤销 → 池子扣回（不是退款） --- */
const gsId = G('工商银行')._id;
w.POOLS[gsId] = { amount: 0, note:'', since:'2026-09-01' };
w.logPush('manual', '手动记一笔 · 工商银行', 1000, [{ rid: gsId, name:'工商银行', amt:1000 }]);
w.POOLS[gsId].amount = 1000;
const injSeq = w.PV2.logs[w.PV2.logs.length - 1].seq;
w.undoLog(injSeq);
/* 注入类撤销应为扣回：1000 - 1000 = 0 → 池子被删除 */
ok('注入类撤销后池子被清（扣回方向正确）', w.POOLS[gsId] === undefined,
   'pool=' + JSON.stringify(w.POOLS[gsId]));

/* --- 10c. 买入流水撤销 → 池子退款 + 持仓回滚（不是扣回） --- */
const zjId = G('紫金矿业')._id;
w.POOLS[zjId] = { amount: 6002, note:'', since:'2026-09-01' };
w.buyFromPool(zjId, 1, 30.01);              /* 花 3001，余 3001 */
eq('紫金买入后池余 3001', w.POOLS[zjId].amount, 3001);
eq('紫金持仓 100', w.num(G('紫金矿业')['持仓数量']), 100);
const zjSeq = w.PV2.logs[w.PV2.logs.length - 1].seq;
w.undoLog(zjSeq);
eq('买入撤销后池子退款回到 6002', w.POOLS[zjId].amount, 6002);
eq('买入撤销后持仓归零', w.num(G('紫金矿业')['持仓数量']), 0);

/* --- 11. 建仓路线实时进度（渲染不炸 + 含关键文案） --- */
let routeErr = null;
try { w.renderRoute(); } catch(e){ routeErr = e.message; }
ok('renderRoute 无异常', routeErr === null, routeErr);
const rw = w.document.getElementById('routeWrap');
ok('routeWrap 已渲染', !!rw && rw.innerHTML.length > 200);
const rhtml = rw ? rw.innerHTML : '';
ok('含「整体建仓进度」', rhtml.indexOf('整体建仓进度') >= 0);
ok('含「已就位」', rhtml.indexOf('已就位') >= 0);
ok('含「已建仓」计数', rhtml.indexOf('已建仓') >= 0);
ok('含实时阶段标签', rhtml.indexOf('进行中') >= 0 || rhtml.indexOf('已完成') >= 0);
ok('不再出现写死的「第 1–6 个月」', rhtml.indexOf('第 1–6 个月') < 0);
ok('不再出现写死的「第 7–12 个月」', rhtml.indexOf('第 7–12 个月') < 0);
ok('含按月度注入推算', rhtml.indexOf('推算') >= 0 || rhtml.indexOf('资金池设定') >= 0);

/* --- 11b. _id 兜底：缺 record_id 时不串池 --- */
const n1 = w.normalize({ 标的名称:'A公司', 代码:'000001.SZ' });
const n2 = w.normalize({ 标的名称:'B公司', 代码:'000002.SZ' });
ok('缺 record_id 时 _id 有值', !!n1._id && n1._id !== 'undefined');
ok('两只不同标的 _id 不同', n1._id !== n2._id, `${n1._id} vs ${n2._id}`);
ok('_id 带 synth 前缀', String(n1._id).indexOf('synth_') === 0);
ok('合成 id 被标记', n1._synthId === true);
/* 同名同码应得到相同 id（稳定可复现） */
const n3 = w.normalize({ 标的名称:'A公司', 代码:'000001.SZ' });
eq('同码同名的合成 id 稳定', n3._id, n1._id);

/* --- 12. 有持仓后进度应大于 0 --- */
ok('进度非零（已有持仓）', /[1-9]\d*\.\d%/.test(rhtml) || /100\.0%/.test(rhtml));

/* --- 13. renderPool 不炸 + 含买入按钮 --- */
let poolErr = null;
try { w.renderPool(); } catch(e){ poolErr = e.message; }
ok('renderPool 无异常', poolErr === null, poolErr);
const pw = w.document.getElementById('poolWrap');
ok('poolWrap 已渲染', !!pw);
const phtml = pw ? pw.innerHTML : '';
ok('含持仓状态行', phtml.indexOf('fp-held') >= 0);
ok('有可用池时出现买入按钮', phtml.indexOf('data-pool-buy') >= 0 || phtml.indexOf('买入') >= 0);

/* ================= 卖出引擎 ================= */

/* --- 14. sellFromHolding 基本路径：减持仓 + 现金进「待分配池」 --- */
const zj2 = G('紫金矿业');
/* 先把持仓清零、池子给足钱，避免前序用例污染 */
w.applyHolding(zj2, 0, 0);
w.POOLS[zj2._id] = { amount: 20000, note:'', since:'2026-09-01' };
w.PV2.pendingPool = 0;
w.buyFromPool(zj2._id, 2, 30.00);            /* 买 2 手 = 200 股，花 6000 */
eq('卖出前持仓 200', w.num(G('紫金矿业')['持仓数量']), 200);
const poolBeforeSell = w.num((w.POOLS[zj2._id] || {}).amount) || 0;
w.POOLS[zj2._id] = { amount: poolBeforeSell, note:'', since:'2026-09-01' };
const okSell = w.sellFromHolding(zj2._id, 1, 33.00);   /* 卖 1 手 @33 */
ok('卖出返回 true', okSell === true);
eq('卖出后持仓 100', w.num(G('紫金矿业')['持仓数量']), 100);
eq('★ 现金进待分配池 3300', w.num(w.PV2.pendingPool), 3300);
eq('★ 标的池余额未被改动', w.num((w.POOLS[zj2._id] || {}).amount), poolBeforeSell);

/* --- 15. 超卖必须被拒绝，且状态完全不变 --- */
const q0 = w.num(G('紫金矿业')['持仓数量']);
const p0 = w.num((w.POOLS[zj2._id] || {}).amount);
const pp0 = w.num(w.PV2.pendingPool);
const badSell = w.sellFromHolding(zj2._id, 99, 33.00);
ok('超卖被拒绝', badSell === false);
eq('超卖后持仓不变', w.num(G('紫金矿业')['持仓数量']), q0);
eq('超卖后池内不变', w.num((w.POOLS[zj2._id] || {}).amount), p0);
eq('超卖后待分配池不变', w.num(w.PV2.pendingPool), pp0);

/* --- 16. 非法入参 --- */
ok('卖出 0 手被拒', w.sellFromHolding(zj2._id, 0, 33.00) === false);
ok('卖出价 0 被拒', w.sellFromHolding(zj2._id, 1, 0) === false);

/* --- 17. 清仓后持仓归零、成本归零 --- */
w.sellFromHolding(zj2._id, 1, 33.00);
eq('清仓后持仓归零', w.num(G('紫金矿业')['持仓数量']), 0);
eq('清仓后成本归零', w.num(G('紫金矿业')['持仓成本']), 0);

/* --- 18. 卖出撤销：现金从待分配池扣回 + 持仓加回 --- */
const gd3 = G('国电电力');
w.POOLS[gd3._id] = { amount: 5000, note:'', since:'2026-09-01' };
w.buyFromPool(gd3._id, 5, 5.00);             /* 买 5 手 = 500 股，花 2500，余 2500 */
eq('国电买入后持仓 500', w.num(G('国电电力')['持仓数量']), 500);
const ppBefore = w.num(w.PV2.pendingPool);
w.sellFromHolding(gd3._id, 2, 6.00);         /* 卖 2 手 = 200 股，回收 1200 */
eq('国电卖出后持仓 300', w.num(G('国电电力')['持仓数量']), 300);
eq('★ 待分配池 +1200', w.num(w.PV2.pendingPool) - ppBefore, 1200);
const sellSeq = w.PV2.logs[w.PV2.logs.length - 1].seq;
w.undoLog(sellSeq);
eq('★ 卖出撤销后待分配池回到卖出前', w.num(w.PV2.pendingPool), ppBefore);
eq('卖出撤销后持仓回到 500', w.num(G('国电电力')['持仓数量']), 500);

/* --- 19. 卖出流水标记为 sell 类型（撤销方向判定依赖它） --- */
const sellLog = w.PV2.logs.find(x => x.seq === sellSeq);
ok('卖出流水 type = sell', sellLog && sellLog.type === 'sell', 'type=' + (sellLog && sellLog.type));
ok('★ 卖出流水不再带 destRid（现金不落标的池）', sellLog && sellLog.detail && sellLog.detail[0].destRid === undefined,
   'destRid=' + (sellLog && sellLog.detail && sellLog.detail[0].destRid));

/* ================= 待分配池 → 分配核销 ================= */

/* --- 19b. 卖出 → 待分配池 → 分配落地时核销（卖出回流优先、股息次之） --- */
{
  const gd4 = G('国电电力');
  w.POOLS = {};
  w.PV2.pendingPool = 0;
  w.PV2.divPool = 0;
  w.PV2.logs = [];
  /* 造一笔卖出：先给池里钱买 2 手，再卖掉 2 手 → 待分配池有钱 */
  w.POOLS[gd4._id] = { amount: 2000, note:'', since:'2026-09-01' };
  w.applyHolding(gd4, 200, 5.00);
  w.sellFromHolding(gd4._id, 2, 6.00);        /* 回收 1200 → 待分配池 */
  eq('待分配池 1200', w.num(w.PV2.pendingPool), 1200);
  /* 再加 300 股息 */
  w.PV2.divPool = 300;
  /* ★ 走真实链路：重建 DOM → 填金额 → 生成方案 → 确认落地（不手抄核销逻辑）
     旧写法在测试里手动复制了 applyPlanFromDesk 的扣池+打标动作，属于假绿。 */
  /* 守恒断言：所有标的池的余额增量之和必须等于本次落地额
     （不断言「哪只拿到钱」—— 缺口加权由缺口大小决定，硬编码会写出脆弱断言） */
  function poolsTotal(){
    var t = 0;
    for (var kk in w.POOLS){ if (Object.prototype.hasOwnProperty.call(w.POOLS, kk)) t += (w.num(w.POOLS[kk].amount) || 0); }
    return t;
  }
  const poolsBefore4 = poolsTotal();
  const pendBefore4 = w.num(w.PV2.pendingPool);
  w.PV2.monthly = 3800; w.PV2.phaseLock = 'core'; w.PV2.startISO = '2026-09-26';
  w.renderPool();
  w.openFundSheet('split');   /* ★ 分配台已收进弹层 */
  const D4 = w.document;
  D4.getElementById('splitAmt').value = '500';
  D4.getElementById('splitIsMonthly').checked = false;
  D4.getElementById('splitGo').click();
  const ap4 = D4.getElementById('planApply');
  ok('★ 真实链路生成了落地按钮', !!ap4);
  if (ap4){
    ap4.click();
    const lg4 = w.PV2.logs.filter(x => !x.undone).slice(-1)[0];
    eq('★ 待分配池按真实逻辑扣减 500', w.num(w.PV2.pendingPool), pendBefore4 - 500);
    eq('★ 股息池确实未被动用（卖出回流足够）', w.num(w.PV2.divPool), 300);
    eq('★ 落款自动打标 srcPending', w.num(lg4.srcPending), 500);
    eq('★ 各池余额增量之和 = 落地额（钱没凭空生/灭）', poolsTotal() - poolsBefore4, w.num(lg4.amount));
  }
  w.PV2.pendingPool = 0; w.PV2.divPool = 0; w.POOLS = {};
}

/* --- 19c. 卖出回流不够时，超出部分从股息池扣（真实链路跨池核销）--- */
{
  const gd5 = G('国电电力');
  w.POOLS = {}; w.PV2.logs = []; w.PV2.pendingPool = 400; w.PV2.divPool = 1000;
  w.PV2.monthly = 3800; w.PV2.phaseLock = 'core'; w.PV2.startISO = '2026-09-26';
  w.renderPool();
  w.openFundSheet('split');   /* ★ 分配台已收进弹层 */
  const D5 = w.document;
  D5.getElementById('splitAmt').value = '900';
  D5.getElementById('splitIsMonthly').checked = false;
  D5.getElementById('splitGo').click();
  const ap5 = D5.getElementById('planApply');
  ok('★ 跨池用例生成了落地按钮', !!ap5);
  if (ap5){
    ap5.click();
    const lg5 = w.PV2.logs.filter(x => !x.undone).slice(-1)[0];
    const sum5 = w.num(lg5.amount) || 0;
    const takeP5 = Math.min(400, sum5);
    const takeD5 = Math.min(1000, sum5 - takeP5);
    ok('★ 落地额 ≥ 400（否则本用例跨池部分为空转）', sum5 >= 400, 'sum=' + sum5);
    eq('★ 待分配池被扣光', w.num(w.PV2.pendingPool), 400 - takeP5);
    eq('★ 股息池只扣差额', w.num(w.PV2.divPool), 1000 - takeD5);
    eq('★ srcPending = 400', w.num(lg5.srcPending), takeP5);
    eq('★ srcDiv = 差额', w.num(lg5.srcDiv), takeD5);
    /* 撤销后两池应各自复原 */
    w.undoLog(lg5.seq);
    eq('★ 撤销后待分配池复原 400', w.num(w.PV2.pendingPool), 400);
    eq('★ 撤销后股息池复原 1000', w.num(w.PV2.divPool), 1000);
  }
  w.PV2.pendingPool = 0; w.PV2.divPool = 0; w.POOLS = {}; w.PV2.logs = [];
}

/* ================= 技术面扫描（只提醒，不改档位） ================= */

/* --- 20. techRow 渲染：跌破MA60 + RSI超卖 → 标红警示 --- */
const zjT = G('紫金矿业');
const trWarn = w.techRow(zjT);
ok('techRow 有内容', trWarn.length > 20, 'len=' + trWarn.length);
ok('techRow 含 MA20 标签与数值', trWarn.indexOf('MA20') >= 0 && /MA20\s*<b[^>]*>32\.5\d/.test(trWarn), trWarn.slice(0, 160));
ok('techRow 含 MA60 标签与数值', trWarn.indexOf('MA60') >= 0 && /MA60\s*<b[^>]*>31\.7\d/.test(trWarn));
ok('techRow 含 RSI 标签与数值', trWarn.indexOf('RSI14') >= 0 && /RSI14\s*<b[^>]*>21\.9\d/.test(trWarn));
ok('跌破MA60 触发 warn 样式', trWarn.indexOf('tech-row warn') >= 0);
ok('提醒文案带警示符', trWarn.indexOf('⚠') >= 0);

/* --- 21. 站上均线 → 不标 warn --- */
const cpT = G('长江电力');
const trOk = w.techRow(cpT);
ok('长江电力 techRow 有内容', trOk.length > 20);
ok('长江电力不触发 warn', trOk.indexOf('tech-row warn') < 0, trOk.slice(0, 60));

/* --- 22. 无技术面数据 → 返回空串（不渲染空卡） --- */
const gsT = G('工商银行');
const trNone = w.techRow(gsT);
ok('无技术面数据时不渲染该行', trNone === '' || trNone.indexOf('tech-row') < 0, 'got=' + trNone.slice(0, 50));

/* --- 23. 技术面不改变档位判定（核心约束：只提醒不自动执行）
   旧写法是「同一函数、同一入参调两次再比较」——恒真断言，改坏 gearOf 也测不出来。
   正确做法：把技术面字段改成极端值，再比较档位是否变化。 --- */
{
  const rec23 = G('紫金矿业');
  /* fixture 里没有档位字段，先补齐，否则 gearOf 直接返回 null（断言变空转） */
  const keepGear = { buy: rec23['加倍买入价'], norm: rec23['正常定投上限'], sell: rec23['减仓起始价'] };
  rec23['加倍买入价'] = 26; rec23['正常定投上限'] = 30; rec23['减仓起始价'] = 38;
  const g0 = w.gearOf(rec23);
  ok('前置：档位可判定（不是 null）', !!g0, 'g0=' + (g0 && g0.k));
  const keep = { ma20: rec23['MA20'], ma60: rec23['MA60'], rsi: rec23['RSI14'] };
  rec23['MA20'] = 1; rec23['MA60'] = 99999; rec23['RSI14'] = 3;   /* 极端技术面 */
  const g1 = w.gearOf(rec23);
  ok('★ 改动技术面字段后档位不变', !!g0 && !!g1 && g0.t === g1.t && g0.k === g1.k,
     (g0 && g0.t) + ' → ' + (g1 && g1.t));
  /* 反证：改动「价格」必须让档位变化，否则说明 gearOf 没在读价格 */
  const keepPrice = rec23['当前价格'];
  rec23['当前价格'] = 1;
  const g2 = w.gearOf(rec23);
  ok('★ 反证：改动价格确实会改变档位（说明断言有效）', !!g2 && g2.k !== g1.k,
     (g1 && g1.k) + ' → ' + (g2 && g2.k));
  rec23['MA20'] = keep.ma20; rec23['MA60'] = keep.ma60; rec23['RSI14'] = keep.rsi;
  rec23['当前价格'] = keepPrice;
  rec23['加倍买入价'] = keepGear.buy; rec23['正常定投上限'] = keepGear.norm; rec23['减仓起始价'] = keepGear.sell;
}

/* --- 24. renderWatch 含技术面行 --- */
let watchErr = null;
try { w.renderWatch(); } catch(e){ watchErr = e.message; }
ok('renderWatch 无异常', watchErr === null, watchErr);
const wwHtml = w.document.getElementById('watchWrap').innerHTML;
ok('观察清单含技术面扫描行', wwHtml.indexOf('tech-row') >= 0);
ok('观察清单含 MA20 标签', wwHtml.indexOf('MA20') >= 0);

console.log('\n========== 池→持仓 联动测试 ==========');
console.log(`PASS: ${PASS}   FAIL: ${FAIL}`);
if (fails.length){ console.log('\n失败项：'); fails.forEach(f => console.log('  ✗ ' + f)); }
else console.log('全部通过 ✓');
process.exit(FAIL ? 1 : 0);
