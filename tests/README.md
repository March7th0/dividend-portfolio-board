# tests/ —— 自动化测试套件

> 主文件 `portfolio-workbench.html` 的行为守护：21 个 jsdom 套件 / 916 项断言。
> 测试夹具全部为**合成数据**，与作者真实持仓无关。

## 怎么跑

```bash
node tests/run_all.js            # 全部套件,汇总 PASS/FAIL,任一失败退出码 1
node tests/run_all.js poolv2     # 只跑文件名含 poolv2 的套件
node tests/poolv2.js             # 单跑某个套件(各套件可独立运行)
```

依赖:node ≥ 18 + jsdom。runner 自 R63 起为**进程内串行执行**(不 spawn 子进程——
部分安全软件拦截 node 嵌套 spawn 会报 EBUSY)。jsdom 通过 `require` 解析,
请用 `NODE_PATH` 指向装了 jsdom 的目录(如全局 node_modules),或在本目录 `npm i jsdom`。

## 约定

- 每个套件用 `path.resolve(__dirname, '..', 'portfolio-workbench.html')` 自取主文件,
  因此 **tests/ 必须保持在项目根下一层**,目录名改动会全线断掉。
- jsdom 全链路:注入 localStorage 种子 → `w.eval(script)` → 走真实 DOM 事件,不打云端;
  云端路径套件(如 `cloud.js`)注入假 SDK,真实走在线分支。
- 新增套件按【功能域】命名(如 `alloc.js`、`profile.js`),不要按轮次命名
  (`rN.js` 是历史包袱,后续按功能域归并)。每轮新断言优先加进对应功能域套件。
- 全量测试当前基线:**22 套件 / 940 项断言全绿**(v55 · R71 状态)。

## 套件清单

| 套件 | 覆盖域 | 来源 |
|---|---|---|
| `linkage.js` | 估值↔档位↔仓位联动引擎(111 项) | 基础套件 |
| `poolv2.js` | 资金池 V2:分配/买入/撤销/阶段(122 项) | 基础套件 |
| `verify_plan.js` | 定投方案一致性、拆层数学(87 项) | 基础套件 |
| `follows.js` | 关注层:个人关注/公共池/软删/分页/远程同步/分配引擎全量口径(64 项) | R62-R64 |
| `gaps.js` | 审计补盲:边界与遗漏(34 项) | 基础套件 |
| `ui.js` | 交互:弹层/页签/表单(52 项) | 基础套件 |
| `cloud.js` | 云同步:档案隔离/upsert/迁移(35 项) | R43 系 |
| `reconnect.js` | SDK 重连/离线降级(21 项) | 基础套件 |
| `reset.js` | 重置/导入导出(48 项) | R45 系 |
| `regress.js` | 跨轮回归(29 项) | 基础套件 |
| `r37.js` … `r58.js` | 各轮回归(按轮次命名,待按功能域归并) | 历史轮次 |

## 其他

- `schema.json`(仓库根)—— 估值表资料库 schema,页外 lint 工具用。
- 已知环境事实:在本机部分运行时里,node 进程内 spawn 任何子进程会被安全软件
  EBUSY 拦截 —— 因此 runner 必须保持进程内方案,不要改回 spawnSync。