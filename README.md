# Pair-wise GSB · 键盘与辅助技术语义比对工作台

面向前端团队的**本地构建两两比对**工具。导入两个构建（baseline / candidate）在同一键盘操作序列下记录的

- DOM 快照（含 shadow root 拍平后的结构），
- 可访问树（角色 / 可访问名称 / 状态），
- 焦点事件，
- 键盘操作序列，

系统为每一步重建键盘可达节点、暴露给辅助技术的语义、焦点去向与 live region 播报，定位两个构建之间的**最早分歧**，并提供可回放证据、带范围的豁免、研究者冲突保留与自包含导出包。

## 安装与演示

```bash
npm install
npm test -- --run
npm run dev -- --host 127.0.0.1 --port 5220 --strictPort
```

页面固定在 <http://127.0.0.1:5220>。打开后点击「载入内置演示会话」即可看到一次包含全部规则的比对。

- `npm test -- --run`：先执行 `tsc --noEmit` 类型检查，再运行 Vitest（52 个用例）。
- `npm run build`：类型检查 + 生产构建到 `dist/`。

## 目录结构

```
src/core/              纯函数核心（无 DOM、无时钟、无随机数）
  types.ts             全部输入/输出数据类型与 RULE_VERSION
  deterministic.ts     规范化 JSON（键排序）与 cyrb53 哈希
  dom-tree.ts          DOM/shadow 拍平、隐式角色、可访问名称解析
  replay.ts            逐步骤重放：tab 顺序、AT 可达集合、live 区域、焦点、弹层
  matching.ts          稳定证据节点匹配 + 置信度 + 祖先上下文
  findings.ts          焦点陷阱 / 不可达弹层 / live 重复播报
  compare.ts           逐类分歧比对、最早分歧、规则证据对齐
  ledger.ts            追加式决定账本、冲突、豁免绑定与自动失效、撤销
  export-package.ts    自包含导出包与离线重放校验
  sample-data.ts       内置演示会话（测试与网页共用同一份数据）
src/ui/                Vite 原生 TS 网页工作台
test/                  Vitest 自动化用例
```

## 输入格式

比对请求是一个 JSON 对象：

```json
{
  "baseline": { "side": "baseline", "fingerprint": "abc123", "steps": [ ... ] },
  "candidate": { "side": "candidate", "fingerprint": "def456", "steps": [ ... ] }
}
```

每个 `steps[i]`：

```json
{
  "index": 0,
  "action": { "key": "Tab" },
  "dom": { "tag": "body", "children": [ ...DomNodeInput ] },
  "a11y":  [ { "domRef": "confirm-btn", "role": "button", "name": "保存", "states": { "disabled": false } } ],
  "focus": { "fromRef": "name-field", "toRef": "confirm-btn", "reason": "Tab" },
  "announcements": [ { "targetRef": "status-msg", "polite": true, "text": "已保存" } ]
}
```

`DomNodeInput` 关键字段：`stableId` / `testid`（稳定身份）、`id`（DOM id，**单独不作为身份**）、
`role`、`accessibleName`、`labelledby`、`controls`、`tabindex`、`focusable`、`disabled`、
`hidden`、`ariaHidden`、`live`、`text`、`states`、`shadowHost`、`children`。

两个构建的 `steps` 数量必须相同、`index` 从 0 密集、同一步 `action` 必须一致，否则直接报错而不是产生部分结果。

## 节点身份与匹配（不能只看 CSS 路径）

动态更新、元素重挂载和 shadow root 会让 DOM id、层级与 CSS 选择器失效。匹配使用**累积稳定证据**：

| 证据 | 权重 | 说明 |
| --- | --- | --- |
| `stableId` 相同 | 0.45 | 显式稳定标识（test id / 框架 id） |
| `testid` 相同 | 0.30 | 无 stableId 时的稳定标识 |
| DOM `id` 相同 | 0.12 | 弱证据，重挂载时常变 |
| role 相同 | 0.08 | 语义角色 |
| 可访问名称相同 | 0.22 | 名称相同 |
| `controls` 相同 | 0.08 | 受控目标关系 |
| 祖先链逐代相同 | 0.05/代，最多 3 代 | 祖先 `role[name]#stableId` 串 |

- 双方都有 `stableId`（或 `testid`）但**取值不同**时禁止配对（硬冲突）。
- 总分达到 `0.40` 才接受；`≥0.85` 高置信，`≥0.60` 中置信，其余低置信，页面逐对展示命中的证据与置信度。
- 全局一对一贪心分配：分数从高到低、分数相同按 key 全序排序，结果与遍历顺序无关。
- 配不上的节点保留为**新增（added）/消失（removed）**，绝不强行配对。

## 分歧与规则

颜色 / 纯样式变化**不产生结论**。只比较：

- `focus-destination`：同一按键后焦点落到不同节点；
- `reachable-set`：同一节点在键盘 tab 顺序中的进出；
- `semantic-state`：role / 可访问名称 / checked、pressed、expanded、selected、readonly、required、disabled、value、level、current 等状态差异；
- `new-node` / `gone-node`：无稳定证据对应的新增 / 消失语义节点；
- `finding`：下面三类规则只在一侧触发时成为分歧。

三类规则都带**可回放证据**：

- **焦点陷阱 `focus-trap`**：非模态 dialog 打开期间焦点始终留在内部且外部仍存在 tabbable 节点（contained）；或 dialog 内没有任何可聚焦节点（dead）。模态 dialog 合法圈定焦点不算违规。证据包含 dialog、内部/外部 tabbable 列表与每步观察到的焦点。
- **不可达弹层 `unreachable-popup`**：可见的 dialog/menu/listbox/tooltip 等在整个开放期间既不含 tabbable 节点，焦点也从未进入。证据包含开放步骤与当时 tab 顺序。
- **live region 重复播报 `live-repeat`**：同一 live 区域在 3 步滚动窗口内、文本未变化的情况下重复播报相同内容。播报先由相邻快照的 live 文本差异**确定性派生**，再与导入的播报记录去重合并。证据包含区域、polite/assertive、文本与首次出现步骤。

`earliestStep` 给出整个序列中最早出现分歧的步骤。

## 人工决定、冲突与豁免

所有人工操作写入**只追加**的事件账本（`classified` / `exempted` / `undone`）：

- 每条事件记录**理由、操作者、前后账本版本、输入指纹、规则版本**；`clientTime` 只在显式提供时保存，系统永不读取墙上时钟。
- 两个研究者对同一分歧给出不同归类（intentional / regression）时，投影状态为 **`conflict`，保留两条记录，不覆盖**。
- **撤销**只能由原操作者执行，并且写入一条新的 `undone` 事件，历史不删除。
- 「声明有意并生成豁免」会建立分类 + 一条带**闭区间步骤范围**的豁免（默认从该分歧步到序列末尾）。
- 豁免绑定：双侧 role、双侧可访问名称、双侧祖先上下文、双侧构建指纹、规则版本、subjectKey、锚定步骤。
- 之后重新比对时自动复核：节点移动（祖先变化 / subject 变化）、名称变化、role 变化、构建指纹变化、规则版本变化或越界都会把豁免标记为 `invalid` 并给出原因；失效不删除历史。
- 批量操作是**事务**：任一操作校验失败则整批不落账，界面不出现部分结果。

## 导出包与离线重放

导出包（`pairwise-gsb-export`，规范化 JSON）包含：原始请求、逐对匹配映射、两侧 findings、分歧、最早步骤、
**两侧逐步 tab 顺序指纹** `replayOrder`，以及完整决定账本。`verifyOfflineReplay(pkg)` 仅用包内请求重新执行整条流水线，断言：

- baseline 的重放顺序逐项一致；
- candidate 的重放顺序逐项一致；
- 分歧集合规范化后完全一致；
- 输入指纹一致。

网页里的「校验当前离线重放」按钮会现场执行该检查。

## 确定性不变量（本项目必须始终成立）

1. 所有计算结果只能由**保存的输入 + `RULE_VERSION`** 重新得到。
2. 不使用 `Date.now()` / `new Date()` / `Math.random()` / 性能计数器；时间戳仅作为显式输入。
3. 所有排序都有显式比较器；对象在哈希 / 序列化前递归按键名排序（`canonicalJson`）。
4. 同输入多次运行、以及对象键插入顺序变化，输出字节级一致（见 `test/export.test.ts` 的 determinism 用例）。
5. 失败的导入 / 校验 / 批量操作不留下可见部分结果。
6. 人工决定只追加；撤销产生新事件。

## 测试数据的含义

内置会话（`src/core/sample-data.ts`，网页与 `test/` 共用）模拟「打开设置」对话框的 4 步键盘会话（Enter + 3×Tab）：

- **基线**：焦点正确落到对话框标题，随后依次进入名称输入框、保存按钮；存在「恢复默认」按钮；modal 状态合法圈定焦点；live 区域文本从「正在保存」变为「已保存」。
- **候选**（刻意制造回归，覆盖全部分歧类型）：
  - 打开时自动聚焦跳过标题（`focus-destination`，最早分歧在第 0 步）；
  - 打开按钮重挂载（DOM id 变为 `btn-v2-9f3`）、保存按钮被包进新容器（CSS 路径变化）——靠 stableId 仍高置信配对，演示「不只按 CSS 路径认同一节点」；
  - dialog 变为非模态却仍困住焦点（仅候选触发 `focus-trap`）；
  - 保存按钮 `tabindex=-1` 掉出 tab 顺序（`reachable-set`）；
  - 新增键盘不可达的 tooltip（仅候选触发 `unreachable-popup`，保留为规则证据而非强行配对）；
  - live 区域重复播报「正在保存」而内容未变（仅候选触发 `live-repeat`）；
  - 新增基线没有的「查看键盘快捷键」链接（`new-node`），基线的「恢复默认」按钮在候选缺失（`gone-node`）。
- `remountRequest()` 是更小的重挂载配对夹具，专供匹配用例；`test/findings.test.ts` 内另有最小化构造，分别正面/反面验证三类规则。

## 以库方式使用

```ts
import {
  compareBuilds,
  emptyLedger,
  classify,
  projectLedger,
  createExportPackage,
  verifyOfflineReplay,
} from './src/core/index.js';

const result = compareBuilds(request);
let ledger = emptyLedger(result);
ledger = classify(ledger, result, {
  divergenceId: result.divergences[0]!.id,
  kind: 'regression',
  reason: '自动聚焦错位',
  operator: 'alice',
});
const pkg = createExportPackage(request, result, ledger);
console.log(verifyOfflineReplay(pkg).ok); // true
```
