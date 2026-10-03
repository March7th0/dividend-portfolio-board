/* ============================================================
   R71 GitHub 数据源适配器套件
   ─────────────────────────────────────────────────────────────
   需求:脱离 WorkBuddy 认证,在 GitHub 托管的页面上直接看用真实数据。
   机制:私有数据仓(JSON 文件) + Contents API + 本机 token;
        适配器实现与平台 SDK 完全一致的 db.* 接口。
   覆盖:
     G1 模式接线:有 token → bootstrap 走 GH 数据源(记录/池/关注层全链路)
     G2 无 token → 演示/离线模式不变(向后兼容)
     G3 记录读写往返:addRecord 返回 record_id、updateRecord 合并字段
     G4 冲突合并:409 → 重取远端 → 按「最近更新」逐条裁决
     G5 状态表:cloudSaveState → state/<键>.json 落仓
     G6 轮询:远端变更 → onUpdated 分流(估值表/关注层);自写回声被抑制
     G7 面板:保存并连接 / token 无效提示 / 断开回演示
     G8 备份包含 _id(跨环境桥接前提)
   运行:node tests/ghdata.js(mock fetch,无网络)
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
const TODAY = '2026-10-04';

const SEED_RECORDS = [
  { _id:'v_gs', record_id:'v_gs', 标的名称:'工商银行', 代码:'601398.SH', 组合层级:'核心层', 目标仓位:15, 当前价格:8.13, 一手股数:100, 最近更新:TODAY },
  { _id:'v_gl', record_id:'v_gl', 标的名称:'格力电器', 代码:'000651.SZ', 组合层级:'卫星层', 目标仓位:10, 当前价格:38.36, 一手股数:100, 最近更新:TODAY }
];

/* ---- mock GitHub:内存文件系统 + sha + 一次性 409 冲突模拟 ---- */
function makeGhMock(w, files){
  const shas = {};
  function shaOf(t){ let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0; return 'sha_' + h.toString(16); }
  function refresh(k){ shas[k] = shaOf(files[k]); }
  Object.keys(files).forEach(refresh);
  let conflictOnce = false;
  let remoteNewerRecord = null;
  function b64d(s){ return Buffer.from(String(s), 'base64').toString('utf8'); }
  function b64e(t){ return Buffer.from(t, 'utf8').toString('base64'); }
  function resp(status, obj, text){
    return Promise.resolve({
      ok: status < 300, status: status,
      json: async function(){ return obj; },
      text: async function(){ return (text !== undefined) ? text : JSON.stringify(obj); }
    });
  }
  function listDir(dir){
    const names = Object.keys(files).filter(function(k){ return k.indexOf(dir + '/') === 0; });
    const seen = {}, out = [];
    for (const k of names){
      const rest = k.slice(dir.length + 1), top = rest.split('/')[0];
      const full = dir + '/' + top;
      if (seen[full]) continue; seen[full] = 1;
      const isDir = rest.indexOf('/') >= 0;
      let sha = shas[full];
      if (isDir){
        /* 目录 sha = 子内容指纹(与 GitHub 行为一致:内容变 → 目录条目变) */
        const childShas = Object.keys(files).filter(function(k2){ return k2.indexOf(full + '/') === 0; })
          .map(function(k2){ return shas[k2] || shaOf(files[k2]); }).join(',');
        sha = shaOf(top + '|' + childShas);
      }
      out.push({ name: top, path: full, type: isDir ? 'dir' : 'file', sha: sha });
    }
    return out;
  }
  w.fetch = function(url, opts){
    opts = opts || {};
    const u = String(url).replace('https://api.github.com/', '');
    const mm = u.match(/^repos\/[^/]+\/[^/]+\/contents\/?(.*)$/);
    if (!mm){
      /* 面板的仓库存在性探测:GET /repos/{owner}/{repo}(无 /contents/ 路径) */
      if (/^repos\/[^/]+\/[^/]+$/.test(u)) return resp(200, { name: 'mock-ok' });
      return resp(404, { message: 'mock: unknown url ' + u });
    }
    const p = mm[1].replace(/\?ref=.*$/, '');
    const accept = (opts.headers && opts.headers.Accept) || '';
    const raw = accept.indexOf('raw') >= 0;
    if ((opts.method || 'GET') === 'PUT'){
      const body = JSON.parse(opts.body);
      const cur = shas[p];
      if (cur === undefined) return resp(404, { message: 'parent dir missing (mock)' });
      if (conflictOnce && p === 'data/records.json'){
        conflictOnce = false;
        if (remoteNewerRecord){
          const arr = JSON.parse(files[p] || '[]');
          let hit = false;
          for (let i = 0; i < arr.length; i++) if (arr[i]._id === remoteNewerRecord._id){ arr[i] = remoteNewerRecord; hit = true; }
          if (!hit) arr.push(remoteNewerRecord);
          files[p] = JSON.stringify(arr); refresh(p);
        }
        return resp(409, { message: 'mock conflict' });
      }
      if (cur !== undefined && body.sha && body.sha !== cur) return resp(409, { message: 'mock sha mismatch' });
      files[p] = b64d(body.content); refresh(p);
      return resp(200, { content: { sha: shas[p] } });
    }
    /* GET */
    if (p === '' ) return resp(200, listDir('data'));
    if (files[p] === undefined){
      if (p === 'data') return resp(200, listDir('data'));
      if (p === 'data/state') return resp(200, listDir('data/state'));
      return resp(404, { message: 'mock 404 ' + p });
    }
    if (raw) return resp(200, {}, files[p]);
    return resp(200, { sha: shas[p], content: b64e(files[p]) });
  };
  return {
    files: files,
    addFile: function(k, v){ files[k] = v; refresh(k); },
    delFile: function(k){ delete files[k]; delete shas[k]; },
    armConflict: function(remoteRecord){ conflictOnce = true; remoteNewerRecord = remoteRecord; },
    touch: function(){ Object.keys(files).forEach(refresh); }
  };
}

const dom = new JSDOM(HTML, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://gh.test/' });
const w = dom.window;
const script = (function(h){var tags=[],re=/<script[^>]*>([\s\S]*?)<\/script>/g,m;while((m=re.exec(h))!==null)tags.push(m[1]);return tags.sort(function(a,b){return b.length-a.length;})[0];})(HTML);
const bootErr = [];
w.addEventListener('error', function(e){ bootErr.push(String(e.message || e)); });
try { w.eval(script); } catch(e){ bootErr.push('eval: ' + e.message); }
const flush = function(ms){ return new Promise(function(r){ setTimeout(r, ms || 80); }); };

(async function main(){
  console.log('\n【G0】环境(无 token 启动 → 演示模式)');
  const mock = makeGhMock(w, {
    'data/records.json': JSON.stringify(SEED_RECORDS),
    'data/state/PROFILE.json': JSON.stringify({ '键':'PROFILE', '数据':{ current:'blink', list:['blink'], meta:{} }, '更新时间':'2026-10-01T00:00:00Z' }),
    'data/state/POOLS__blink.json': JSON.stringify({ '键':'POOLS::blink', '数据':{ v_gs:{ amount: 1000 } }, '更新时间':'2026-10-01T00:00:00Z' }),
    'data/state/FOLLOW_shared_v_gs.json': JSON.stringify({ '键':'FOLLOW::shared::v_gs', '数据':{ rid:'v_gs', on:true, by:'blink', ts:'2026-10-01T00:00:00Z' }, '更新时间':'2026-10-01T00:00:00Z' }),
    'data/state/FOLLOW_shared_v_sm.json': JSON.stringify({ '键':'FOLLOW::shared::v_sm', '数据':{ rid:'v_sm', on:true, by:'blink', ts:'2026-10-01T00:00:00Z' }, '更新时间':'2026-10-01T00:00:00Z' })
  });
  try { w.bindGlobalDelegates(); } catch(e){ bootErr.push('delegates: ' + e.message); }
  try { w.bootstrap(); } catch(e){ bootErr.push('bootstrap: ' + e.message); }
  await flush(200);
  eq('G0 启动无异常', bootErr.length, 0);
  eq('G2 ★ 无 token → 演示模式', w.DATA_MODE, 'demo');
  ok('G2 ghBtn 可见(非 SDK 模式)', (w.document.getElementById('ghBtn').className || '').indexOf('show') >= 0);
  ok('G2 演示模式不加载远端记录(RECORDS 空)', w.RECORDS.length === 0, String(w.RECORDS.length));

  console.log('\n【G1】面板保存 → 接入 GitHub 数据源');
  w.ghOpenPanel();
  eq('G1 面板出现', w.document.getElementById('ghSheet').style.display, 'block');
  w.document.getElementById('ghIn_repo').value = 'March7th0/dividend-portfolio-data';
  w.document.getElementById('ghIn_token').value = 'github_pat_TESTTOKEN';
  w.document.getElementById('ghSaveBtn').dispatchEvent(new w.Event('click', { bubbles: true, cancelable: true }));
  await flush(400);
  eq('G1 ★ DATA_MODE=gh', w.DATA_MODE, 'gh');
  eq('G1 ★ 估值表记录 = 2(来自数据仓)', w.RECORDS.length, 2);
  ok('G1 看板含 工商银行', w.document.getElementById('cardList').innerHTML.indexOf('工商银行') >= 0);
  ok('G1 池子已应用(POOLS::blink → v_gs 1000 元)', (w.POOLS['v_gs'] || {}).amount === 1000, JSON.stringify(w.POOLS));
  eq('G1 公共池可见集含 v_gs', w.FOLLOW_SHARED['v_gs'], true);
  eq('G1 ghBtn 绿色(on)', (w.document.getElementById('ghBtn').className || '').indexOf('on') >= 0, true);

  console.log('\n【G3】记录读写往返');
  const addRes = await w.db.addRecord({ databaseId: VAL_DB, properties: {
    '标的名称': { text: '测试股' }, '当前价格': { number: 12.5 }, '最近更新': { date: TODAY } } });
  ok('G3 ★ addRecord 返回 gh 前缀 record_id', /^gh/.test(addRes.record_id || ''), JSON.stringify(addRes));
  await flush(600);                     /* 等写合并队列 flush */
  const arr = JSON.parse(mock.files['data/records.json']);
  ok('G3 新记录已落数据仓', arr.some(function(r){ return r._id === addRes.record_id && r['标的名称'] === '测试股'; }));
  await w.db.updateRecord({ databaseId: VAL_DB, recordId: addRes.record_id, properties: { '当前价格': { number: 13.8 }, '最近更新': { date: TODAY } } });
  await flush(600);
  const arr2 = JSON.parse(mock.files['data/records.json']);
  const upd = arr2.filter(function(r){ return r._id === addRes.record_id; })[0];
  ok('G3 ★ updateRecord 合并字段(13.8)', upd && upd['当前价格'] === 13.8, upd && JSON.stringify(upd));

  console.log('\n【G4】冲突合并(409 → 远端较新者胜)');
  mock.armConflict({
    _id:'v_gs', record_id:'v_gs', 标的名称:'工商银行', 代码:'601398.SH', 组合层级:'核心层',
    目标仓位:15, 当前价格:9.99, 一手股数:100, 最近更新:'2026-10-05'        /* 比操作侧(10-04)新 */
  });
  await w.db.updateRecord({ databaseId: VAL_DB, recordId: 'v_gs', properties: { '当前价格': { number: 8.88 }, '最近更新': { date: TODAY } } });
  await flush(600);
  const arr3 = JSON.parse(mock.files['data/records.json']);
  const gs = arr3.filter(function(r){ return r._id === 'v_gs'; })[0];
  ok('G4 ★ 远端较新者胜(9.99 保留,操作侧 8.88 让位)', gs && gs['当前价格'] === 9.99, gs && JSON.stringify(gs));
  ok('G4 另一条记录(测试股)在合并中未丢', arr3.some(function(r){ return r._id === addRes.record_id; }));

  console.log('\n【G5】状态表落仓');
  w.POOLS['v_gs'] = { amount: 2500 };
  await w.cloudSaveState({ immediate: true });
  await flush(300);
  const poolsFile = JSON.parse(mock.files['data/state/POOLS__blink.json']);
  ok('G5 ★ POOLS::blink 已落数据仓(2500)', poolsFile['数据']['v_gs'].amount === 2500, mock.files['data/state/POOLS__blink.json'].slice(0, 120));
  const profFile = JSON.parse(mock.files['data/state/PROFILE.json']);
  ok('G5 PROFILE 同步落仓', profFile['数据'].current === 'blink');

  console.log('\n【G6】轮询与回声');
  w.ghPollOnce();                        /* 建立基线 sha */
  await flush(60);
  mock.addFile('data/state/FOLLOW_alice_v_gl.json', JSON.stringify({ '键':'FOLLOW::alice::v_gl', '数据':{ rid:'v_gl', on:true, by:'alice', ts:TODAY }, '更新时间':TODAY }));
  w.SELF_WRITE_UNTIL = 0;                /* G5 的 cloudSaveState 已开回声窗,清掉再模拟「对方」的变更 */
  w.ghPollOnce();                        /* 远端变更 → STATE 事件 → 关注层重载 */
  await flush(300);
  ok('G6 ★ 对方关注近实时进入徽标数据', w.followOthersOf('v_gl').indexOf('alice') >= 0, JSON.stringify(w.followOthersOf('v_gl')));
  const keysBefore = Object.keys(w.FOLLOWS_RAW).length;
  w.markSelfWrite(9000);                 /* 自写回声窗 */
  mock.addFile('data/state/FOLLOW_shared_v_zj.json', JSON.stringify({ '键':'FOLLOW::shared::v_zj', '数据':{ rid:'v_zj', on:false, by:'alice', ts:TODAY }, '更新时间':TODAY }));
  w.ghPollOnce();
  await flush(300);
  eq('G6 ★ 回声窗内的通知被忽略', Object.keys(w.FOLLOWS_RAW).length, keysBefore);

  console.log('\n【G8】备份包含 _id');
  const pack = w.buildBackupPack();
  ok('G8 ★ 备份 records 带 _id(桥接前提)', pack.records.length > 0 && !!pack.records[0]._id, pack.records[0] && pack.records[0]._id);

  console.log('\n【G7】断开 → 演示模式');
  w.ghOpenPanel();
  w.document.getElementById('ghDropBtn').dispatchEvent(new w.Event('click', { bubbles: true, cancelable: true }));
  await flush(300);
  eq('G7 ★ 断开后回演示模式', w.DATA_MODE, 'demo');
  eq('G7 token 已清除', w.localStorage.getItem('dpb_gh_token') === null || w.localStorage.getItem('dpb_gh_token') === '', true);
  ok('G7 断开后仍有本地缓存可看( disaster-recovery 语义)', w.RECORDS.length >= 2, String(w.RECORDS.length));

  console.log('\n──── R71 结果 ────');
  console.log('PASS ' + PASS + ' / FAIL ' + FAIL);
  fails.forEach(function(f){ console.log('  ✗ ' + f); });
  if (bootErr.length){ console.log('  boot errors:'); bootErr.forEach(function(e){ console.log('  · ' + e); }); }
  process.exit(FAIL ? 1 : 0);
})();