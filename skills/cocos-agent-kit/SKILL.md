---
name: cocos-agent-kit
description: 使用 cocos-agent-kit MCP 工具操作 Cocos Creator 编辑器时使用本技能。涵盖场景感知、节点创建/修改/删除/移动、组件管理(含自定义脚本)、资产引用与引用诊断、场景创建、prefab 实例化、保存与构建。当用户要求在 Cocos 中搭建/修改场景、创建角色或关卡、查询场景结构、修复资源引用时,先读本技能再动手。
---

# cocos-agent-kit:Cocos Creator 编辑器操作指南

通过 cocos-agent-kit MCP 工具(24 个)操作 Cocos Creator 3.8.x 编辑器。核心循环:**感知 → 计划 → act → verify → save**,每一步都基于工具返回的真实状态,禁止凭截图或想象判断编辑器状态。

## 铁律(违反=返工或事故)

1. **创建/修改类操作前,先用信息原语确认现状**:`create_scene` 前查 `scene_list`(目标场景是否已存在);`act_create_node` 前查 `scene_tree`(父节点是否存在、放哪里合适);`act_add_component` 前查组件是否已挂。现状检查是原语调用,判断是你自己的推理;
2. **动手前先感知**:`scene_summary` 十秒读懂场景,`scene_tree` 拿 uuid——所有 act 工具都需要目标 uuid,不许猜;
3. **act 的返回值就是回读**:检查返回的 created/readback/组件列表,确认操作真实生效;
4. **改完必须 `save_scene`**;**文件级改动(脚本/prefab/贴图)必须 `refresh_assets`**;
5. **编辑器里必须已打开目标场景**:用 `scene_info` 对照 `scene_list` 确认,不符就请用户双击目标场景;
6. **涉及删除或批量修改:先让用户 git commit**;
7. **语义推断是你自己的工作**:工具返回九宫格/百分比/尺寸等确定性事实和组件类名,"这是刀还是按钮"由你从证据推断,工具不会也不该给你贴标签。

## 空间与坐标

- 一律使用**世界坐标**(act 的 position/worldPosition 与 scene_tree 返回一致,可直接比对);
- 2D 约定:原点左下,y 向上;z 影响渲染顺序(同层级用 `act_set_sibling_index`);
- **可视范围 = Canvas 的 contentSize**(先读它,常见 960×640 / 1280×720),别把东西摆出画布;
- **语义定位,不要心算像素**:`act_create_node` 支持 `anchor: "top-right", margin: {right: 60, top: 120}`(九宫格+边距)和 `relative: {to: uuid, dxPct, dyPct}`(相对某节点偏移画布百分比);
- `scene_summary` 的每个节点自带 `@zone (pct%,pct%)` 空间事实——放完东西重跑一次,zone/pct 变化即验收;
- TiledMap 节点带 `tiledMap.tileSize/mapSize`,像素坐标 ↔ 格子坐标用它换算。

## 工具速查(按意图)

| 意图 | 工具 |
|---|---|
| 快速读懂场景(一表) | `scene_summary`(先跑这个) |
| 完整树/拿 uuid/精确坐标 | `scene_tree` → `node_detail` |
| 读组件属性值(Sprite 显示哪张图/Label 文本/物理参数) | `component_props` |
| 确认用户点了什么 | `selected_nodes` |
| 项目资产清单 / 场景清单 / 当前场景 | `asset_index` / `scene_list` / `scene_info` |
| 图片像素尺寸 | `image_meta` |
| 解剖 prefab/scene 文件(内部树+引用+断链检测) | `inspect_asset` |
| 谁引用了这个资产(删除/替换前的影响分析) | `asset_refs` |
| 编辑器日志(编译错误/运行时异常) | `console_logs` |
| 创建节点(语义定位) | `act_create_node` |
| 移动层级 / 调渲染顺序 | `act_reparent` / `act_set_sibling_index` |
| 删除节点 | `act_delete_node` |
| 改属性/变换(语义定位) | `act_set_transform` |
| 挂/摘组件(内置类名或自定义脚本 uuid→自动映射) | `act_add_component` / `act_remove_component` |
| 写单个属性值 | `act_set_property` |
| 保存场景 / 刷新资产 | `save_scene` / `refresh_assets` |
| 新建场景(复制模板) / 预览地址 | `create_scene` / `preview_info` |

## 常用配方

**创建可见对象**(空节点没有渲染,肉眼验收需要可渲染组件):
```json
{"name": "Coin_1", "parent": "<Canvas uuid>", "anchor": "top-right",
 "margin": {"right": 60, "top": 120}, "color": [255, 200, 0],
 "components": [{"type": "cc.Label", "props": {"string": "¥", "fontSize": 30}}]}
```
无资产依赖的可见物用 `cc.Label`;Sprite 的 spriteFrame 资产引用设置暂不支持,引导用户手动设置。

**批量摆放**:scene_summary 读画布尺寸 → 算等距坐标或用 anchor/relative → 循环 act_create_node → scene_summary 重跑,验证 zone/pct 与预期一致。

**修改已有节点**:scene_summary/scene_tree 拿 uuid → act_set_transform → 检查回读。

**资源显示异常(色块/白块/贴图丢失)**:典型根因是 spriteFrame 引用断裂。工作流:
1. `inspect_asset {url, resolve: true}` 读该实体的 prefab——`brokenCount > 0` 即实锤,断链 uuid 与归属路径直接列出;
2. 修复 = 把断裂 uuid 替换为目标贴图的 spriteFrame 子资产 uuid(方法见 cocos-agent-kit 仓库 `docs/knowledge-cocos-format.md`,含脚本范本 fix_fruit_refs.py);
3. `refresh_assets` → 用户肉眼验收。
完整格式知识(prefab JSON 结构、meta subMetas/f9941 规则、uuid 比对方法)同样在该文档。

**创建新场景**:先 `scene_list` 确认不存在 → `create_scene {name}`(复制现有场景为模板,格式安全)→ 提示用户双击打开新场景 → 用 act 工具清理模板残留节点 → save_scene。

## 已知边界与坑

- 场景视图对场景进程直改**即时可见**,层级面板可能滞后(数据以工具回读为准);
- 端口 7420 单实例:用户开了多个编辑器项目会抢端口,提示先关旧的;
- `save_scene` 保存的是**当前打开的场景**——动手前确认用户打开的是目标场景;
- Sprite 的 spriteFrame 资产引用暂无法通过 act 设置——需要显示具体图片时,引导用户手动设置或等版本更新;
- 自定义脚本挂载依赖脚本已编译:`refresh_assets` 后再挂;挂载用脚本 uuid(工具自动映射 @ccclass 类名);
- 编辑器辅助层(Editor Scene Foreground/Background)是编辑器自带节点——统计业务组件时过滤它们(`scene_summary` 已自动过滤;`scene_tree` 传 `filterEditor: true`)。
