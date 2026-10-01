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
- 离线合并：结伴出行各自离线排景点，按作者与修改时间三方合并；冲突两版保留待确认。
- 分享预览：生成可复制的行程文本（仅包含已确认内容）。

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

## 离线协作合并

`/sync`（离线合并）页面支持多人各自离线编辑后互相合并：

- 每处改动都带 `updated_by`（作者）与 `updated_at`（修改时间），元数据随 Trip / DayPlan / DayPlanItem 保存。
- 三方合并引擎在 `utils/mergeEngine.ts`（纯函数）：Trip 按 `id`、每日行程按 `(trip_id, day_index)`、同一天内景点按 `spot_id` 逐项对齐。
- **移除与移动分开处理**：删除用墓碑（tombstone）表示；纯移动不会被当作内容编辑，删除遇到移动/编辑意图时保留两版，只有对方完全未动时删除才直接生效。
- 顺序合并：各方相对基线的位置变化按锚点融合，双方移动不同景点互不覆盖；同一景点两侧都移动时按更晚的修改时间裁决。
- 非冲突改动直接生效（数组字段如同行人取并集）；字段冲突或"删除 vs 保留"冲突保留本机/同伴两版，在冲突面板逐条确认。
- **确认前隔离**：未决的旅行/整日/景点不会进入预算统计与分享预览（见 `syncStore.confirmedTrips / confirmedDayPlans`）。
- 合并先在副本上计算，失败自动重试一次；仍失败则回滚到上一份可读结果（`syncLastResult`），不会留下损坏数据。
- 快照为 JSON 文本，可复制/存文件后在同伴设备导入；也可用"模拟同伴离线改动"一键体验完整流程。

合并逻辑的离线测试：`npm test`（`scripts/mergeEngine.test.mjs`、`scripts/syncStore.test.mjs`，共 24 个用例）。

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

