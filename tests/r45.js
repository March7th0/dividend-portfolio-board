/* ============================================================
   R45 备份完整性专项（消费级可用的底线：数据必须能备份/恢复）
   ─────────────────────────────────────────────────────────────
   线上隐患：exportJson 原来【只导出估值表】（标的清单），
   资金池 / 流水 / 持仓 / 档案这些「账本」数据一条都没备份 ——
   用户以为备份了，其实钱的部分无法恢复。
   覆盖：
     B1 备份包含全部数据（records + profile/pools/pv2/holdings）
     B2 ★★ 往返：备份 → 打乱内存 → 恢复 → 值回到备份时的状态
     B3 恢复会立即落库（账本上云）
     B4 多档案一起恢复
     B5 导入确认已统一到页面内弹层（不再用旧的 confirmBox）
   运行：
     export NODE_PATH="C:/Users/qq444/node_modules"
     node tests/r45.js
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

const VAL_ROWS = [
  { record_id:'v_cp', 标的名称:'长江电力', 代码:'600900.SH', 组合层级:'核心层', 目标仓位:50, 当前价格:28.36, 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:26, 正常定投上限:30, 减仓起始价:45 },
  { record_id:'v_gd', 标的名称:'国电电力', 代码:'600795.SH', 组合层级:'核心层', 目标仓位:50, 当前价格:5.24,  一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:4.5, 正常定投上限:5.0, 减仓起始价:5.8 },
];
let SRV = {
  'POOLS::blink': { v_cp: { amount: 22222 } },
  'PV2::blink':   { capital: 100000, capitalLeft: 77777, pendingPool: 1234, divPool: 0, logs: [], __ts: 't' },
  'HOLDINGS::blink': { v_cp: { qty: 900, cost: 28.36 } },
  'POOLS::friend': { v_gd: { amount: 5000 } },
  'PV2::friend':   { capital: 20000, capitalLeft: 15000, pendingPool: 0, divPool: 0, logs: [], __ts: 't' },
  'HOLDINGS::friend': { v_gd: { qty: 100, cost: 5.24 } },
  'PROFILE': { current:'blink', list:['blink','friend'], meta:{ blink:{admin:true,pass:''}, friend:{admin:false,pass:''} } }
};
let IDS = {}; let NEXT = 1;
Object.keys(SRV).forEach(function(k){ IDS[k] = 'r' + (NEXT++); });
const UPDATE_LOG = [];
function keyById(rid){ for (var k in IDS) if (IDS[k] === rid) return k; return null; }

function makeDb(){
  return {
    getSchema: function(){ return Promise.resolve({ properties: [] }); },
    query: function(o){
      var id = o && o.databaseId;
      if (id === VAL_DB)  return Promise.resolve({ results: VAL_ROWS.map(function(r){ return Object.assign({}, r); }), hasMore: false });
      if (id === STATE_DB) return Promise.resolve({ results: Object.keys(SRV).map(function(k){
        return { record_id: IDS[k], 键: k, 数据: JSON.stringify(SRV[k]), 更新时间: '2026-09-26T16:00:00Z' };
      }), hasMore: false });
      return Promise.resolve({ results: [], hasMore: false });
    },
    updateRecord: function(o){
      UPDATE_LOG.push(o);
      var k = keyById(o.recordId); if (!k) return Promise.resolve({ ok: 1 });
      var pr = o.properties || {};
      if (pr['键'] && pr['键'].text !== k){ var nk = pr['键'].text; var mv = SRV[k]; delete SRV[k]; IDS[nk] = o.recordId; SRV[nk] = mv || {}; k = nk; }
      if (pr['数据']){ try { SRV[k] = JSON.parse(pr['数据'].text); } catch(e){} }
      return Promise.resolve({ ok: 1 });
    },
    addRecord: function(o){
      UPDATE_LOG.push(o);
      var pr = o.properties || {};
      var nk = (pr['键'] && pr['键'].text) || ('anon' + NEXT);
      IDS[nk] = 'r' + (NEXT++); SRV[nk] = pr['数据'] ? JSON.parse(pr['数据'].text) : {};
      return Promise.resolve({ record_id: IDS[nk] });
    },
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
try { w.bindGlobalDelegates(); } catch(e){}
try { w.poolLoad(); w.pv2Load(); w.pv2Migrate(); } catch(e){}
try { w.bootstrap(); } catch(e){ bootErr.push('bs: ' + e.message); }

const flush = function(ms){ return new Promise(function(r){ setTimeout(r, ms || 150); }); };

(async function main(){
  await flush(400);

  /* ════════════════════════════════════════════════════════════
     B1 备份包必须包含全部数据
     ════════════════════════════════════════════════════════════ */
  console.log('\n【B1】备份包覆盖全部用户数据');
  ok('B1 ★ buildBackupPack 已抽出（可测）', typeof w.buildBackupPack === 'function');
  var pack = w.buildBackupPack();
  ok('B1 含标的记录', !!(pack.records && pack.records.length >= 2), 'n=' + (pack.records ? pack.records.length : 0));
  ok('B1 ★ 备份带版本号', !!pack.appVersion, 'v=' + pack.appVersion);
  ok('B1 ★ 含账本区块 state', !!pack.state);
  ok('B1 ★ 含档案列表', !!(pack.state.profile && pack.state.profile.list && pack.state.profile.list.length === 2),
     JSON.stringify(pack.state.profile && pack.state.profile.list));
  ok('B1 ★ 含档案权限元数据（管理员标记）', !!(pack.state.profile.meta && pack.state.profile.meta.blink),
     JSON.stringify(pack.state.profile.meta));
  var cur = w.PROFILE.current;
  ok('B1 ★ 含当前档案的资金池', !!(pack.state.pools && pack.state.pools[cur]), JSON.stringify(Object.keys(pack.state.pools || {})));
  ok('B1 ★ 含当前档案的流水/账目(PV2)', !!(pack.state.pv2 && pack.state.pv2[cur]));
  ok('B1 ★ 含当前档案的持仓', !!(pack.state.holdings && pack.state.holdings[cur]));
  ok('B1 ★ 含其他档案的数据（friend 也在）', !!(pack.state.pools && pack.state.pools.friend),
     JSON.stringify(Object.keys(pack.state.pools || {})));
  eq('B1 备份里的池金额 = 内存实时值', (pack.state.pools[cur].v_cp || {}).amount, 22222);
  eq('B1 备份里的持仓 = 内存实时值', (pack.state.holdings[cur].v_cp || {}).qty, 900);
  eq('B1 备份里的未分配本金 = 内存实时值', pack.state.pv2[cur].capitalLeft, 77777);

  /* ════════════════════════════════════════════════════════════
     B2 ★★ 往返：备份 → 打乱 → 恢复 → 值回来
     ════════════════════════════════════════════════════════════ */
  console.log('\n【B2】往返恢复（备份 → 打乱 → 恢复）');
  /* 打乱内存 */
  w.POOLS = {};
  w.PV2.capitalLeft = 0; w.PV2.pendingPool = 0; w.PV2.logs = [];
  w.applyHoldings({});
  ok('B2 前置：内存已被打乱（池空）', Object.keys(w.POOLS).length === 0);
  eq('B2 前置：未分配已清零', w.num(w.PV2.capitalLeft) || 0, 0);
  eq('B2 前置：持仓已清零', (function(){ var r = w.findByName('长江电力'); return r ? (w.num(r[w.F.qty]) || 0) : -1; })(), 0);

  /* 恢复 */
  var restoreErr = null;
  try { w.applyStateImport(pack.state); } catch(e){ restoreErr = e; }
  ok('B2 恢复无异常', !restoreErr, restoreErr && restoreErr.message);

  var cur2 = w.PROFILE.current;
  eq('B2 ★★ 资金池已恢复', (w.num((w.POOLS.v_cp || {}).amount) || 0), 22222);
  eq('B2 ★★ 未分配本金已恢复', w.num(w.PV2.capitalLeft) || 0, 77777);
  eq('B2 ★★ 卖出回流已恢复', w.num(w.PV2.pendingPool) || 0, 1234);
  eq('B2 ★★ 持仓已恢复', (function(){ var r = w.findByName('长江电力'); return r ? (w.num(r[w.F.qty]) || 0) : -1; })(), 900);
  eq('B2 ★ 档案列表已恢复', w.PROFILE.list.length, 2);
  ok('B2 ★ 管理员标记已恢复', w.isAdminProfile('blink') === true);

  /* ════════════════════════════════════════════════════════════
     B3 恢复会立即落库
     ════════════════════════════════════════════════════════════ */
  console.log('\n【B3】恢复后账本立即上云');
  var writes = UPDATE_LOG.filter(function(o){
    var pr = o.properties || {};
    return pr['键'] && String(pr['键'].text).indexOf('::') > 0;
  });
  ok('B3 ★ 恢复触发了账本记录写入（' + writes.length + ' 条）', writes.length >= 3, 'n=' + writes.length);
  var restoredInSrv = false;
  Object.keys(SRV).forEach(function(k){
    if (k === 'POOLS::' + cur2 && SRV[k] && SRV[k].v_cp && SRV[k].v_cp.amount === 22222) restoredInSrv = true;
  });
  ok('B3 ★ 服务端的资金池已是恢复后的值', restoredInSrv, JSON.stringify(SRV['POOLS::' + cur2]));

  /* ════════════════════════════════════════════════════════════
     B4 切换到另一个档案，数据也是恢复后的
     ════════════════════════════════════════════════════════════ */
  console.log('\n【B4】其他档案的数据也一起恢复了');
  w.openFundSheet('profile'); await flush(50);
  var sel = w.document.getElementById('profSel'); if (sel) sel.value = 'friend';
  var sw = w.document.getElementById('profSwitch');
  if (sw) sw.dispatchEvent(new w.Event('click', { bubbles:true, cancelable:true }));
  await flush(200);
  eq('B4 已切到 friend', w.PROFILE.current, 'friend');
  eq('B4 ★ friend 的池已恢复', (w.num((w.POOLS.v_gd || {}).amount) || 0), 5000);
  eq('B4 ★ friend 的未分配已恢复', w.num(w.PV2.capitalLeft) || 0, 15000);

  /* ════════════════════════════════════════════════════════════
     B5 导入确认已统一（不再用旧的 confirmBox）
     ════════════════════════════════════════════════════════════ */
  console.log('\n【B5】导入确认走统一弹层');
  var callSites = (HTML.match(/confirmBox\(/g) || []).length;
  eq('B5 ★★ 生产代码里已无 confirmBox 调用（只剩函数定义本身）', callSites, 1);
  ok('B5 ★ 导入确认使用 askConfirm（统一弹层）', /askConfirm\(\s*'将导入/.test(HTML) || HTML.indexOf("'将导入 '") >= 0);

  /* ══ B7 R67：内嵌查看器导出兜底（iframe 沙箱静默拦截下载） ══ */
  console.log('\n【B7】内嵌模式备份弹层（showBackupSheet）');
  ok('B7 ★ inEmbeddedViewer 已抽出（可测）', typeof w.inEmbeddedViewer === 'function');
  eq('B7 jsdom 非内嵌 → 走正常下载路径', w.inEmbeddedViewer(), false);
  {
    const pack2 = w.buildBackupPack();
    w.showBackupSheet(pack2, JSON.stringify(pack2, null, 2));
    const ta = w.document.getElementById('bkText');
    ok('B7 ★ 弹层渲染出 textarea', !!ta);
    let parsed = null;
    try { parsed = JSON.parse(ta.value); } catch (e) {}
    ok('B7 ★ textarea 内容是完整可解析的备份包', !!parsed && parsed.state && !!parsed.state.follows,
       parsed ? 'keys=' + Object.keys(parsed).join(',') : 'unparsable');
    ok('B7 ★ 提示里给出浏览器新标签方案', w.document.getElementById('backupSheet').innerHTML.indexOf('新标签') >= 0);
    let threw = null;
    try { w.document.getElementById('bkCopy').click(); } catch (e) { threw = e.message; }
    ok('B7 复制按钮点击不抛异常', threw === null, threw);
  }

  console.log('\n【运行时】');
  ok('★ 全程无运行时错误', bootErr.length === 0, bootErr.join(' | '));

  console.log('\n========================================');
  console.log('PASS: %d   FAIL: %d', PASS, FAIL);
  if (fails.length){ console.log('\n失败项：'); fails.forEach(function(f){ console.log('  ✗ ' + f); }); }
  else console.log('全部通过 ✓');
  process.exit(FAIL ? 1 : 0);
})();
