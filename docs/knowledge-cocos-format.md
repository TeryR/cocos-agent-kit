# Cocos Creator 资产格式知识包(实测沉淀)

> 来源:v0.2 真实项目诊断(色块 bug)过程中的三处返工。本文是 0.3 Agent 配置层的首批素材——
> 目标:同类问题第二次遇到时零返工。适用版本:Creator 3.8.x。

## 1. .prefab / .scene 文件结构

- 本质:**JSON 数组**,数组下标即对象的 `__id__`(不是字段!)。引用某对象 = `{"__id__": 下标}`。
- 常见类型:`cc.Scene`、`cc.Node`、`cc.Sprite`、`cc.Label`、自定义脚本组件(其 `__type__` 是脚本 uuid 的**压缩形式**,grep 类名搜不到——要用运行时感知或按 uuid 反查)。
- 节点名在 `_name` 字段;组件通过 `node: {__id__: 节点下标}` 反向挂在节点上。
- **自定义脚本的 @property 配置存在场景文件的组件条目里**(如 `fruitConfigs`),不在代码里;配置项可能是 `{__id__}` 引用,需要解引用到数组条目。

## 2. .png.meta 与 uuid 引用规则

- meta 顶层 `uuid` = 图片主资产;`subMetas` 里有两个子资产:
  - `6c48a`(importer: texture)→ 引用写作 `<uuid>@6c48a`
  - `f9941`(importer: sprite-frame)→ 引用写作 `<uuid>@f9941` ← **Sprite 的 spriteFrame 用这个**
- 判断"引用断裂"的方法:取引用串 `@` 前的主 uuid,全项目搜 `.png.meta` 顶层 uuid 是否存在;**不能**拿完整引用串去搜。
- 色块(白块被 tint)= spriteFrame 引用断裂的典型症状。

## 3. 诊断工作流(资源显示异常类)

1. 先查图片文件本身:`head -c 4` 应为 `89 50 4E 47`(PNG 魔数);若是 `version https://git-lfs...` 文本 = LFS 没拉;
2. 解析 prefab/scene,列出 Sprite 引用的主 uuid;
3. 建 `.png.meta` 顶层 uuid 索引比对,分出"有效引用 / 断裂引用";
4. 断裂引用按**所在节点名**推断目标贴图(如 `splitLeftFruit` → `<fruit>-1.png`);
5. 修复 = 把断裂 uuid 替换为目标 png 的 `subMetas[importer=sprite-frame].uuid`(带 @sid);改完 `asset-db refresh-asset` 生效;
6. 批量修复前确认 git 干净(可回滚)。

## 4. 编辑器侧速查(3.8.8 实测)

| 需求 | 方法 |
|---|---|
| 看场景进程报错与调用栈 | `项目目录/temp/logs/project.log` |
| 查编辑器内置实现(调用范例) | `grep -abo '关键字' resources/app.asar` 定位偏移 → 按偏移读上下文(`.ccc` 编译产物不可读,但字符串/文档可读) |
| 当前水果/配置表位置 | 自定义组件的编辑器配置在 **.scene 文件**里,不在代码 |
| 执行场景脚本 | `Editor.Message.request('scene', 'execute-scene-script', {name, method, args})`,**args 必须是数组** |
| 查选中节点 | `Editor.Selection.getSelected('scene')` |
| 保存场景 | `Editor.Message.request('scene', 'save-scene')` |
| 刷新资产库 | `Editor.Message.request('asset-db', 'refresh-asset', 'db://assets/')` |

## 5. 已知坑位清单(本项目实测)

- `Editor.Selection.getCurrentSelection` 不存在 → 用 `getSelected`;
- execute-scene-script args 传对象 → "Spread syntax requires ...iterable";传位置参数 → "Scenario scripts do not exist: undefined";
- Cocos Creator(Electron)无障碍树为空 → GUI 操作只能截图+坐标,且要求窗口前台;
- 单端口(7420)单实例:两个编辑器实例同时开会抢端口,先关旧再开新;
- 场景进程内直改节点:场景视图即时可见(渲染循环驱动),层级面板(主进程 UI)可能不自动刷新。
