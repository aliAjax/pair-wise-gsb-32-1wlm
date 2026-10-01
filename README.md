# TripWeaver 旅游行程规划助手

## 快速启动

```bash
pnpm install
pnpm dev
```

访问地址：http://localhost:18417

TripWeaver 是一款纯前端旅行规划应用，支持创建旅行、探索景点、编排每日行程、预算统计和分享预览。

## 主要功能

- 我的旅行：创建、筛选、删除旅行计划。
- 行程详情：查看每日行程、预算图表和共享时间线。
- 景点探索：按 SpotCategory 搜索和筛选，收藏并加入行程。
- 行程编排：SortableJS 拖拽排序，实时影响预算计算。
- 结伴合并：多人离线各自排景点，回来后按作者与修改时间三路合并旅行计划、每日行程、景点。
- 分享预览：生成可复制的行程文本。

## 结伴离线合并（/merge）

几个人结伴改行程、离线各自排景点时，回到「结伴合并中心」按作者和修改时间合并：

- **三层逐项对齐**：旅行计划按字段合并；每日行程按 `(trip_id, day_index)` 对齐；同一天内**按景点（spot_id）逐项对齐**，不再整段覆盖顺序。
- **移动与移除分开处理**：移动冲突（同一景点双方挪到不同位置/不同天）与移除冲突（一方删除、另一方保留并修改）分别记录，互不吞并。
  - 只有一方移动 / 只有一方删除：非冲突，直接生效；
  - 双方都移动到不兼容位置：保留两版顺序等确认；
  - 一方删除、另一方修改：保留「保留 / 删除」两版等确认。
- **字段级三路合并**：同一景点或计划，双方改不同字段则同时生效；改同一字段且值不同才保留两版。
- **确认前隔离**：所有未决冲突的景点条目不进入预算统计（`budgetCalculator` 的待确认感知版本）也不进入分享预览（`/share`）。
- **失败重试 + 可读保底**：合并器异常自动重试 3 次；仍失败则保留上一份可读结果（lastGood），绝不用坏数据覆盖。

合并相关代码分层：

```
src/
├── types/merge.ts              # 快照/冲突/合并结果类型与冲突键
├── utils/merge/
│   ├── engine.ts               # Trip/DayPlan/Spot 三路合并主引擎
│   ├── threeWay.ts             # 字段级三路合并
│   ├── order.ts                # 移动合并（共同祖先 + LCS 骨架）
│   ├── pending.ts              # 待确认索引（预算/分享隔离）
│   ├── equality.ts             # 结构化深比较
│   └── retry.ts                # 失败重试
├── stores/mergeStore.ts        # 执行合并/重试/确认/保底
├── api/mergeApi.ts             # 快照、待确认、上一份可读结果、决议持久化
├── api/demoMergeData.ts        # 同伴离线改动演示数据
├── pages/MergeCenter.vue       # 结伴合并中心页
└── components/common/MergeConflictPanel.vue # 冲突两版确认面板
```

## 技术栈

| 分类 | 技术 |
| --- | --- |
| 前端 | Vue 3 + TypeScript |
| 构建 | Vite |
| UI | Element Plus + ECharts |
| 状态 | Pinia |
| 路由 | Vue Router 4 |
| 持久化 | localStorage + Dexie.js |
| 交互 | sortablejs |

## 目录结构

```
src/
├── api/
├── stores/
├── models/
├── types/
├── components/common/
├── hooks/
├── pages/
├── router/
├── utils/
├── config/
└── constants/
```

## 数据持久化

本地数据通过 `utils/storage.ts` 统一写入 localStorage，并保留 Dexie 数据库对象用于后续 IndexedDB 扩展。版本键来自 `constants/storageVersion.ts`。

## 环境变量

`VITE_AMAP_KEY`：高德地图 key。未配置时使用 demo-key，地图主题配置同时出现在 `config/map.ts`、`SpotCard`、`DayTimeline`、`Planner` 相关逻辑中。

## 枚举出现位置清单

SpotCategory：
- `src/constants/spot.ts`
- `src/models/spot.ts`
- `src/stores/spotStore.ts`
- `src/components/common/CategoryFilter.vue`
- `src/components/common/SpotCard.vue`
- `src/pages/Spots.vue`
- `src/pages/TripDetail.vue`
- `src/utils/formatters.ts`
- `src/router/guards.ts`

TripStatus：
- `src/constants/trip.ts`
- `src/models/trip.ts`
- `src/stores/tripStore.ts`
- `src/components/common/TripCard.vue`
- `src/pages/Trips.vue`
- `src/utils/formatters.ts`
- `src/router/guards.ts`

## License

MIT

