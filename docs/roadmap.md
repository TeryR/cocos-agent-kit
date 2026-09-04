# 路线图与项目定位(内部文档)

> 本文档面向维护者。用户与 Agent 需要的内容在 README.md。
> 本文承接:生产定位、能力 gate、路线图、生态对比、事故复盘指引。

## 项目定位(定调记录)

- **最终形态**:Cocos 专用 Agent——tool calling 为主、GUI 兜底、文件直写管批量、感知贯穿全程。
- **cocos-sense 的职责边界**(v0.3 收敏):**信息 × 操作原语**。它回答"现在是什么状态、每样东西在哪、带什么、值多少",并执行"把它变成那样"。它不回答"为什么会坏、该怎么修"、不做语义推断(功能标签/场景解读归 Agent 的推理力)、不替 Agent 判断必要性(判断所需的信息由信息原语提供,纪律条款在 SKILL.md)。
- **信息表达原则**(v0.3.1 确立):优化信息的表达形式(确定性换算:九宫格/百分比/尺寸/状态),不做信息的语义解读。**数学是事实可以做,语义是判断归 Agent。**
- **首要生产场景**:中国小游戏数据驱动品类的关卡产能。

## 生产化四 gate

| Gate | 指标 | 目标 |
|---|---|---|
| 交付 | PRD 级描述 → 可运行游戏成功率 | 常见品类 >80% |
| 自修复 | 编译/运行报错后无人工介入恢复率 | >90%(压在感知层上) |
| 效率 | vs 熟练人工 | 原型 5-10x,批量内容 50x+ |
| 成本 | 单关卡/角色产出成本 | < 人工 1/10 |

## 路线图

### 已完成
- **v0.1.0** 感知层:scene_tree / node_detail / selected_nodes / asset_index(6 项校准全绿)
- **v0.2.0** act 模块:创建/删除/改属性/挂摘组件(返回值自带回读)+ 空间增强(contentSize/锚点/TiledMap)
- **v0.3.0** 信息×操作原语:scene_info / component_props(属性值层)/ scene_list / console_logs(运行反馈)/ inspect_asset(文件级穿透+断链检测)/ preview_info / act_set_property / act_add_component 自定义脚本挂载(uuid→@ccclass)
- **v0.3.1** 确定性空间事实层:scene_summary(九宫格+百分比+空容器/越界/未激活)+ act 语义定位(anchor 九宫格/relative 百分比)
- **v0.3.2** 安全加固 + 边界测试套件(路径穿越/属性污染修复;27 用例)

### v0.4(当前):打穿"从零到有画面的可玩游戏"
- 操作:create_scene(模板复制)/ act_reparent / act_set_sibling_index / instantiate_prefab / save_as_prefab / build_web
- 信息:image_meta(PNG 尺寸)/ asset_refs(反向引用)
- 文档:README 对外化 / SKILL.md 更新(新工具+创建前查现状铁律)

### v0.5+(候选,按真实痛点排序)
- spriteFrame 资产引用设置的真机校准深化
- UI 刷新通知(场景进程直改后通知主进程 UI)
- 批量属性 diff(diff_nodes)
- 3D 适配(eulerAngles / 3D 组件白名单 / 几何体 preset / 相机感知)+ 3D 游戏案例实测
- 视觉层(Set-of-Mark / 贴图多模态)
- 破坏性操作组 D 测试(删 Canvas/场景根,需恢复方案确认)

## 生态对比(为什么是自己做)

| Agent 用旧 MCP 做游戏的痛点 | cocos-sense |
|---|---|
| 盲操作(API 只返回 success) | act 返回操作后真实状态(回读内建) |
| 看不见场景(无感知/静态文档) | 实时场景树+属性值+选中+文件级穿透 |
| 工具爆炸(151 个 API 镜像) | 意图级 19 工具,继续克制 |
| 无保存/刷新 | save_scene / refresh_assets |
| 无诊断依据 | 知识包 + 知识库 + 断链检测 + 日志原语 |
| 无使用指导 | SKILL.md 作业指导书 |

引擎厂商动向佐证方向:Epic 内置 Unreal MCP、Unity AI MCP beta、Cocos 社区 MCP 付费分层(意图级压缩是收费点=市场验证)。

## 事故复盘指引

- 编辑器双实例事故(2026-09-04):规程与教训见 `docs/editor-protocol.md`(R1 启动权归用户 / R2 启动前三查 / R3 冲突信号即停 / R4 清理凭 PID / R5 恢复交还启动权)。
- 通用教训:Agent 默认永不主动启动 GUI 应用;杀进程凭启动时记录的 PID,不猜。
