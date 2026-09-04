---
name: cocos-sense
description: 使用 cocos-sense MCP 工具操作 Cocos Creator 编辑器时使用本技能。涵盖场景感知、节点创建/修改/删除、组件管理、场景保存、资产刷新,以及资源显示异常(色块/贴图丢失)的诊断。当用户要求在 Cocos 中搭建/修改场景、创建角色或关卡、查询场景结构、修复资源引用时,先读本技能再动手。
---

# cocos-sense:Cocos Creator 编辑器操作指南

通过 cocos-sense MCP 工具(11 个)操作 Cocos Creator 3.8.x 编辑器。核心循环:**感知 → 计划 → act → verify → save**,每一步都基于工具返回的真实状态,禁止凭截图或想象判断编辑器状态。

## 铁律(违反=返工)

1. **动手前先感知**:`scene_tree` 拿结构和 uuid——所有 act 工具都需要目标 uuid,不许猜;
2. **act 的返回值就是回读**:检查返回的 created/readback/组件列表,确认操作真实生效,而不是当它成功;
3. **改完必须 `save_scene`**:场景改动在内存里,不保存 = 用户重开就丢;
4. **文件级改动(改 prefab/贴图/脚本)必须 `refresh_assets`**,否则编辑器不感知;
5. **编辑器里必须已打开场景**:空场景状态下 scene_tree 只返回空壳;提示用户双击目标 .scene;
6. **涉及删除或批量修改:先让用户 git commit**(act 直接改场景,可回滚才有底气)。

## 空间与坐标(2D 项目)

- 一律使用**世界坐标**(act 工具的 position 是 worldPosition,与 scene_tree 返回一致,可直接比对);
- 2D 约定:原点在左下,y 向上;z 影响渲染层级;
- **设计分辨率决定可视范围**:先从 Canvas 的 `contentSize` 读出实际大小(如 960×640 或 1280×720),可视区域 = (0,0) 到 (w,h),别把东西放到画布外;
- 摆放/间距计算用 contentSize(节点是"有面积的区域",不是点);TiledMap 节点带 `tiledMap.tileSize/mapSize`,像素坐标 ↔ 格子坐标用它换算。

## 工具速查

| 意图 | 工具 |
|---|---|
| 看场景结构/找节点/拿坐标 | `scene_tree`(maxDepth 按需;先粗后细) |
| 查单节点详情 | `node_detail`(uuid 从 scene_tree 拿) |
| 确认用户在编辑器里点了什么 | `selected_nodes`(GUI 操作后回读验证) |
| 查项目资源(贴图/脚本/prefab 清单) | `asset_index`(按 type 过滤) |
| 创建节点(可带组件+属性) | `act_create_node` |
| 删除节点 | `act_delete_node` |
| 改位置/名字/激活态/尺寸/颜色 | `act_set_transform` |
| 挂/摘组件 | `act_add_component` / `act_remove_component` |
| 保存场景 / 刷新资产 | `save_scene` / `refresh_assets` |

## 常用配方

**创建可见对象**(空节点没有渲染,肉眼验收需要可渲染组件):
```json
{"name": "Coin_1", "parent": "<Canvas uuid>", "position": {"x": 100, "y": 80, "z": 0},
 "color": [255, 200, 0],
 "components": [{"type": "cc.Label", "props": {"string": "¥", "fontSize": 30}}]}
```
无资产依赖的可见物用 `cc.Label`;有资产引用(Sprite 的 spriteFrame)暂不支持,用 Label 替代。

**批量摆放**(如"沿对角线放 5 个"):先读 Canvas contentSize 算等距坐标,循环调 act_create_node,每次检查回读坐标;最后 scene_tree 自检数量与坐标,误差应为 0。

**修改已有节点**:scene_tree/node_detail 拿 uuid → act_set_transform → 检查回读值。

**资源显示异常(色块/白块/贴图丢失)**:典型根因是 spriteFrame 引用断裂(uuid 对不上资产)。诊断工作流与 Cocos 资产序列化格式知识,见 cocos-sense 仓库 `docs/knowledge-cocos-format.md`(含 prefab JSON 结构、meta subMetas/f9941 规则、uuid 比对方法、修复脚本范本 fix_fruit_refs.py)。

## 已知边界与坑

- 场景视图对场景进程直改**即时可见**,但层级面板可能滞后(不影响数据正确性,以工具回读为准);
- 端口 7420 单实例:用户开了多个编辑器项目会抢端口,提示先关旧的;
- `save_scene` 保存的是**当前打开的场景**——动手前确认用户打开的是目标场景;
- Sprite 的 spriteFrame(资产引用)当前无法通过 act 设置——需要显示具体图片时,引导用户手动设置或等版本更新。
