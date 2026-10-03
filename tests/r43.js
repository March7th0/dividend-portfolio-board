/* ============================================================
   R43 档案数据物理隔离专项（每档案独立记录）
   ─────────────────────────────────────────────────────────────
   改造目标：从「4 条记录 + 记录内按档案名分组」改为
            「每个档案 3 条独立记录（键 `POOLS::档案名` 等）」。
   为什么：旧结构下任何一次保存都是【整包重写】——
           「写 A 的时候把 B 的数据一起重写」在物理上就可能，R41 因此暴露了 6 个串档缺陷。
   本套件验证：
     D1 ★★ 物理隔离：写当前档案时，绝不触碰其他档案的记录
     D2 新档案用 addRecord 自动建记录（无需人工建表）
     D3 旧格式（分组记录）自动展开 + 一次性迁移成独立记录
     D4 改名：记录「键」跟着改（记录 id 不变）
     D5 删除：记录改写为 TRASH:: 并清空（平台无删除记录 API）
     D6 只有旧格式时也能正确读取（兼容）
   运行：
     export NODE_PATH="C:/Users/qq444/node_modules"
     node tests/r43.js
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
  { record_id:'v_gd', 标的名称:'国电电力', 代码:'600795.SH', 组合层级:'核心层', 目标仓位:50, 当前价格:5.24,  一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:4.5, 正常定投上限:5.5, 减仓起始价:5.8 },
];

/* ---- 假「服务端」：以【记录】为单位，键是复合键（新格式）或固定键（旧格式） ---- */
let SRV = {};            /* 键 → 数据对象 */
let IDS = {};            /* 键 → record_id */
let NEXT = 1;
const UPDATE_LOG = [];
const ADD_LOG = [];

function seedLegacy(){
  /* 旧格式：4 条分组记录（含两个档案） */
  SRV = {
    'POOLS':    { blink: { v_cp: { amount: 50000 } }, '1': { v_gd: { amount: 7000 } } },
    'PV2':      { blink: { capital: 300000, capitalLeft: 250000, pendingPool:0, divPool:0, logs:[], __ts:'2026-09-26T14:00:00.000Z' },
                  '1':    { capital: 20000,  capitalLeft: 13000,  pendingPool:0, divPool:0, logs:[], __ts:'2026-09-26T14:00:00.000Z' } },
    'HOLDINGS': { blink: { v_cp: { qty: 3000, cost: 28.36 } }, '1': { v_gd: { qty: 100, cost: 5.24 } } },
    'PROFILE':  { current:'blink', list:['blink','1'], meta:{ blink:{admin:true,pass:''}, '1':{admin:false,pass:''} } }
  };
  IDS = {}; Object.keys(SRV).forEach(function(k){ IDS[k] = 'legacy_' + k; });
  NEXT = 100;
}
seedLegacy();
function keyById(rid){
  for (var k in IDS) if (Object.prototype.hasOwnProperty.call(IDS, k) && IDS[k] === rid) return k;
  return null;
}

function makeDb(){
  return {
    getSchema: function(){ return Promise.resolve({ properties: [
      { name:'组合层级', type:'select', config:{ options:[{text:'核心层'},{text:'卫星层'},{text:'卫星层备选'},{text:'排除'}] } },
      { name:'跟踪状态', type:'select', config:{ options:[{text:'持有'},{text:'等待'}] } } ] }); },
    query: function(o){
      var id = o && o.databaseId;
      if (id === VAL_DB)  return Promise.resolve({ results: VAL_ROWS.map(function(r){ return Object.assign({}, r); }), hasMore: false });
      if (id === STATE_DB) return Promise.resolve({ results: Object.keys(SRV).map(function(k){
        return { record_id: IDS[k], 键: k, 数据: JSON.stringify(SRV[k]), 更新时间: '2026-09-26T14:00:00Z' };
      }), hasMore: false });
      return Promise.resolve({ results: [], hasMore: false });
    },
    updateRecord: function(o){
      UPDATE_LOG.push(o);
      var k = keyById(o.recordId);
      if (!k) return Promise.resolve({ ok: 1 });
      var pr = o.properties || {};
      if (pr['键']) { var nk = pr['键'].text; if (nk !== k){ delete SRV[k]; delete IDS[k]; SRV[nk] = SRV[k] || {}; IDS[nk] = o.recordId; k = nk; } }
      if (pr['数据']) SRV[k] = JSON.parse(pr['数据'].text);
      return Promise.resolve({ ok: 1 });
    },
    addRecord: function(o){
      UPDATE_LOG.push(o); ADD_LOG.push(o);
      var pr = o.properties || {};
      var nk = (pr['键'] && pr['键'].text) || ('anon_' + NEXT);
      var rid = 'new_' + (NEXT++);
      IDS[nk] = rid;
      SRV[nk] = pr['数据'] ? JSON.parse(pr['数据'].text) : {};
      return Promise.resolve({ record_id: rid });
    },
    onUpdated: function(){}
  };
}

function boot(){
  const dom = new JSDOM(HTML, { runScripts:'outside-only', pretendToBeVisual:true, url:'https://local.test/' });
  const w = dom.window;
  w.__SMART_PAGE__ = { database: makeDb() };
  w.localStorage.clear();
  const script = (function(h){var tags=[],re=/<script[^>]*>([\s\S]*?)<\/script>/g,m;while((m=re.exec(h))!==null)tags.push(m[1]);return tags.sort(function(a,b){return b.length-a.length;})[0];})(HTML);
  const errs = [];
  w.addEventListener('error', function(e){ errs.push(String(e.message || e)); });
  try { w.eval(script); } catch(e){ errs.push('eval: ' + e.message); }
  try { w.bindGlobalDelegates(); } catch(e){}
  try { w.poolLoad(); w.pv2Load(); w.pv2Migrate(); } catch(e){}
  try { w.bootstrap(); } catch(e){ errs.push('bs: ' + e.message); }
  return { w: w, errs: errs };
}
const flush = function(ms){ return new Promise(function(r){ setTimeout(r, ms || 120); }); };

(async function main(){
  let ctx = boot();
  let w = ctx.w;
  /* ★ 迁移是异步发起的（为每个档案建独立记录），必须等它全部完成 ——
     否则迁移写入会混进后面「物理隔离」的断言里，把预期行为误判成串档。 */
  await flush(600);

  /* ════════════════════════════════════════════════════════════
     D6 兼容读取：只有旧格式时也要能正确显示
     ════════════════════════════════════════════════════════════ */
  console.log('\n【D6】旧格式（分组记录）兼容读取');
  eq('D6 当前档案 = blink', w.PROFILE.current, 'blink');
  var cp = w.findByName('长江电力');
  eq('D6 ★ 长电持仓 = 3000（来自旧分组记录）', cp ? (w.num(cp[w.F.qty]) || 0) : -1, 3000);
  eq('D6 ★ 池内金额已装载', w.num((w.POOLS['v_cp'] || {}).amount) || 0, 50000);

  /* ════════════════════════════════════════════════════════════
     D3 一次性迁移：旧分组 → 每档案独立记录
     ════════════════════════════════════════════════════════════ */
  console.log('\n【D3】旧格式自动迁移成独立记录');
  ok('D3 ★ 已为 blink 建出 POOLS::blink 记录', !!IDS['POOLS::blink'], Object.keys(IDS).join(','));
  ok('D3 ★ 已为 blink 建出 PV2::blink 记录', !!IDS['PV2::blink']);
  ok('D3 ★ 已为 blink 建出 HOLDINGS::blink 记录', !!IDS['HOLDINGS::blink']);
  ok('D3 ★ 已为档案「1」建出 POOLS::1 记录', !!IDS['POOLS::1']);
  ok('D3 ★ 已为档案「1」建出 HOLDINGS::1 记录', !!IDS['HOLDINGS::1']);
  eq('D3 迁移过来的池数据正确', (SRV['POOLS::1'] || {}).v_gd ? ((SRV['POOLS::1'].v_gd || {}).amount) : -1, 7000);
  ok('D3 旧分组记录保留未删（可回滚）', !!SRV['POOLS'] && !!SRV['PROFILE']);

  /* ════════════════════════════════════════════════════════════
     D1 ★★ 物理隔离：写当前档案不碰其他档案的记录
     ════════════════════════════════════════════════════════════ */
  console.log('\n【D1】物理隔离：写当前档案只碰自己的记录');
  UPDATE_LOG.length = 0; ADD_LOG.length = 0;   /* ★ 也要清空 addRecord 日志（否则混入启动迁移的建记录） */
  w.PV2.capitalLeft = 12345;
  w.POOLS['v_cp'] = { amount: 11111 };
  w.cloudSaveState({ immediate: true });
  await flush(150);

  var touchedKeys = UPDATE_LOG.map(function(o){ return keyById(o.recordId); }).filter(function(x){ return !!x; });
  var addedKeys = ADD_LOG.map(function(o){ return (o.properties['键'] || {}).text; });
  var allKeys = touchedKeys.concat(addedKeys);
  ok('D1 ★★ 写入只涉及当前档案（blink）的记录',
     allKeys.length > 0 && allKeys.every(function(k){ return k === 'PROFILE' || k.indexOf('::blink') > 0; }),
     'keys=' + JSON.stringify(allKeys));
  ok('D1 ★★ 未触碰档案「1」的任何记录',
     allKeys.every(function(k){ return k.indexOf('::1') < 0; }), JSON.stringify(allKeys));
  eq('D1 服务端 blink 池已更新', (SRV['POOLS::blink'] || {}).v_cp ? SRV['POOLS::blink'].v_cp.amount : -1, 11111);
  eq('D1 ★ 服务端档案「1」的池【原封不动】', (SRV['POOLS::1'] || {}).v_gd ? SRV['POOLS::1'].v_gd.amount : -1, 7000);

  /* 切换档案：应只写「1」的记录 */
  UPDATE_LOG.length = 0; ADD_LOG.length = 0;
  w.openFundSheet('profile'); await flush(40);
  var sel = w.document.getElementById('profSel'); if (sel) sel.value = '1';
  var sw = w.document.getElementById('profSwitch');
  if (sw) sw.dispatchEvent(new w.Event('click', { bubbles:true, cancelable:true }));
  await flush(150);
  eq('D1 已切到档案「1」', w.PROFILE.current, '1');
  var keys2 = UPDATE_LOG.map(function(o){ return keyById(o.recordId); }).filter(function(x){ return !!x; })
              .concat(ADD_LOG.map(function(o){ return (o.properties['键'] || {}).text; }));
  ok('D1 ★★ 切换后写入只涉及「1」的记录',
     keys2.every(function(k){ return k === 'PROFILE' || k.indexOf('::1') > 0; }), JSON.stringify(keys2));
  eq('D1 ★ 档案「1」的持仓正确装载', (function(){ var r = w.findByName('国电电力'); return r ? (w.num(r[w.F.qty]) || 0) : -1; })(), 100);

  /* ════════════════════════════════════════════════════════════
     D2 新档案用 addRecord 自动建记录
     ════════════════════════════════════════════════════════════ */
  console.log('\n【D2】新建档案自动创建独立记录');
  UPDATE_LOG.length = 0; ADD_LOG.length = 0;
  w.createProfile('新朋友A');
  await flush(180);
  ok('D2 ★ 为该档案建出 POOLS::新朋友A',
     !!IDS['POOLS::新朋友A'] || ADD_LOG.some(function(o){ return ((o.properties['键']||{}).text||'') === 'POOLS::新朋友A'; }),
     'adds=' + JSON.stringify(ADD_LOG.map(function(o){ return (o.properties['键']||{}).text; })));
  ok('D2 建出 HOLDINGS::新朋友A', !!IDS['HOLDINGS::新朋友A']);
  eq('D2 新档案是空账', Object.keys(w.POOLS).length, 0);

  /* ════════════════════════════════════════════════════════════
     D4 改名：记录的「键」跟着改
     ════════════════════════════════════════════════════════════ */
  console.log('\n【D4】改名时记录键同步变更');
  UPDATE_LOG.length = 0;
  var ridBefore = IDS['POOLS::新朋友A'];
  w.renameProfile('新朋友A', '朋友B');
  await flush(150);
  ok('D4 ★ 新键记录出现', !!IDS['POOLS::朋友B'], Object.keys(IDS).filter(function(k){ return k.indexOf('朋友') >= 0; }).join(','));
  eq('D4 ★ 记录 id 未变（原地改名）', IDS['POOLS::朋友B'], ridBefore);
  ok('D4 旧键已消失', !IDS['POOLS::新朋友A']);

  /* ════════════════════════════════════════════════════════════
     D5 删除：记录改 TRASH + 清空
     ════════════════════════════════════════════════════════════ */
  console.log('\n【D5】删除档案时清空其记录');
  UPDATE_LOG.length = 0;
  w.PROFILE.list.push('待删除');
  w.askDeleteProfile('待删除');
  /* 走二次确认（该档案无密码，当前档案有管理员身份但无密码 → 直接二次确认） */
  await flush(60);
  var cf = w.document.getElementById('cfOk');
  if (cf) { cf.dispatchEvent(new w.Event('click', { bubbles:true, cancelable:true })); }
  var cf2 = w.document.getElementById('cfOk');
  if (cf2) { cf2.dispatchEvent(new w.Event('click', { bubbles:true, cancelable:true })); }
  await flush(150);
  ok('D5 ★ 档案已从列表移除', w.PROFILE.list.indexOf('待删除') < 0, JSON.stringify(w.PROFILE.list));

  /* 有数据的档案：删掉「朋友B」并检查记录被 TRASH 化 */
  UPDATE_LOG.length = 0;
  var target = '朋友B';
  w.askDeleteProfile(target);
  await flush(60);
  var cfa = w.document.getElementById('cfOk');
  if (cfa) cfa.dispatchEvent(new w.Event('click', { bubbles:true, cancelable:true }));
  var cfb = w.document.getElementById('cfOk');
  if (cfb) cfb.dispatchEvent(new w.Event('click', { bubbles:true, cancelable:true }));
  await flush(200);
  var trashKeys = Object.keys(IDS).filter(function(k){ return k.indexOf('TRASH::') === 0; });
  ok('D5 ★★ 该档案的记录被改写成 TRASH::（数据已清空）', trashKeys.length >= 1, JSON.stringify(Object.keys(IDS)));
  ok('D5 ★ 原键不再存在', !IDS['POOLS::朋友B'], JSON.stringify(Object.keys(IDS)));
  ok('D5 TRASH 记录的键包含原档案名（便于追溯）',
     trashKeys.some(function(k){ return k.indexOf('朋友B') >= 0; }), JSON.stringify(trashKeys));

  /* ════════════════════════════════════════════════════════════
     重开页面：数据仍然正确（新格式读取）
     ════════════════════════════════════════════════════════════ */
  console.log('\n【D7】以新格式重开页面，数据仍在');
  ctx = boot();
  w = ctx.w;
  await flush(600);
  /* D5 删掉的是「当时的当前档案」→ doDeleteProfile 会回退到列表第一个（blink），
     所以这里断言 blink 的数据完好，而不是「1」。 */
  eq('D7 ★ 原当前档案被删后回退到列表首个（blink）', w.PROFILE.current, 'blink');
  eq('D7 ★ blink 的长电持仓仍是 3000 股（新格式读取正确）',
     (function(){ var r = w.findByName('长江电力'); return r ? (w.num(r[w.F.qty]) || 0) : -1; })(), 3000);
  eq('D7 ★ blink 池内金额仍是 11111（D1 写入的值）',
     w.num((w.POOLS['v_cp'] || {}).amount) || 0, 11111);
  ok('D7 全程无运行时错误', ctx.errs.length === 0, ctx.errs.join(' | '));

  console.log('\n========================================');
  console.log('PASS: %d   FAIL: %d', PASS, FAIL);
  if (fails.length){ console.log('\n失败项：'); fails.forEach(function(f){ console.log('  ✗ ' + f); }); }
  else console.log('全部通过 ✓');
  process.exit(FAIL ? 1 : 0);
})();
