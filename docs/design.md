# cocos-agent-kit 设计文档

## 决策记录(ADR)

### ADR-1:只读,不做任何写操作

**决定**:感知接口全部只读;创建/修改/删除一律不提供。

**理由**:
- 差异化定位:操作已被操作型 MCP(Game Agent、daxianlee 系列)充分覆盖且同质化严重,感知侧连付费方案都只有雏形。
- 教学叙事:对照实验里"GUI 操作 + 感知验证"的变量隔离最干净——所有动作都来自 Agent 的鼠标键盘,成功率差异只能归因于感知。
- 安全:只读扩展在任何项目里启用都无副作用。

### ADR-2:MCP server 内嵌扩展,零 npm 依赖,Streamable HTTP

**决定**:在扩展主进程内用 Node 原生 `http` 模块实现 MCP Streamable HTTP 的最小子集,监听 `127.0.0.1:7420`。

**理由**:
- Cocos 扩展跑在编辑器内置 Node 环境,零依赖 = 拷贝即用,无构建步骤,适合教学分发。
- Streamable HTTP 规范允许服务器以 `application/json` 直接响应单条 JSON-RPC(不必开 SSE 流),单机单客户端场景免去会话管理。
- Claude Code / Cursor / ZCode 均支持 http transport,`claude mcp add --transport http` 一行接入。

**实现范围**:`initialize`、`tools/list`、`tools/call`、`ping`、notification(202 无响应体)。不支持:resources、prompts、SSE。

### ADR-3:场景数据从场景进程取,不依赖编辑器消息的私有返回结构

**决定**:场景树/节点详情通过 `execute-scene-script` 在场景进程内遍历 `cc.director.getScene()` 自行构造,输出字段完全由 `scene.js` 定义。

**理由**:编辑器消息(如 `query-node-tree`)的返回结构属于内部实现,版本间可能变化;自己构造的 schema 稳定、可控、面向 token 预算。

### ADR-4:输出面向 token 预算

- 树深度默认 6 层,超过截断为 `childCount`;
- 组件只输出构造函数类名,不输出属性值;
- 坐标四舍五入到 3 位小数;
- 资产索引只出 `name/type/url`,按类型过滤。

## 感知接口 schema

### `scene_tree` → 意图级场景树

```jsonc
// 入参
{ "maxDepth": 6 }
// 出参(每个节点)
{
  "name": "Player",
  "uuid": "f7Q8k3...",
  "active": true,
  "activeInHierarchy": true,
  "worldPosition": { "x": 240.0, "y": 160.0, "z": 0.0 },
  "components": ["cc.UITransform", "cc.Sprite", "PlayerController"],
  "children": [ /* 递归;超深则 "childCount": 3 */ ]
}
```

### `node_detail` → 单节点详情

```jsonc
{ "uuid": "f7Q8k3..." }
// 出参
{
  "name": "Player", "uuid": "...",
  "parent": { "name": "Canvas", "uuid": "..." },
  "worldPosition": { "x": 240, "y": 160, "z": 0 },
  "angle": 0, "scale": { "x": 1, "y": 1 },
  "active": true,
  "components": ["cc.UITransform", "cc.Sprite"],
  "children": [ { "name": "HealthBar", "uuid": "..." } ]
}
```

### `selected_nodes` → 选中回读(GUI 操作后的验证锚点)

```jsonc
{ }  // 出参
{ "context": "scene", "uuids": ["f7Q8k3..."] }
```

用法约定:Agent 在层级面板点击 / 场景视图点选后,立即调用本工具,把返回的 UUID 与任务目标比对——这是整条"操作→回读→纠偏"闭环的核心接口。

### `asset_index` → 资产索引

```jsonc
{ "type": "cc.ImageAsset" }   // type 可选
// 出参
{ "count": 12, "assets": [ { "name": "hero_idle", "type": "cc.ImageAsset", "url": "db://assets/roles/hero_idle.png" } ] }
```

## 真机校准清单 —— ✅ 3.8.8 实测全绿(2026-09-04)

> 实测环境:Cocos Creator 3.8.8 / Windows / senseTest 项目。校准过程中踩到的两个坑已写进代码注释。

- [x] 扩展 manifest 被识别:`package_version: 2` + `contributions.scene.script` 正常进入场景进程(实测可用)
- [x] **`execute-scene-script` 参数格式(踩坑一+二)**:必须传**单个对象** `{name, method, args}`,且 **`args` 必须是数组**(内部 `method(...args)` 展开,传对象报 "Spread syntax requires ...iterable")。实锤方式:asar 内置 lightmap 扩展的官方调用范例。业务参数打包为单元素数组 `[argsObj]`,场景进程方法签名统一 `method(argsObj)`
- [x] 场景进程内全局 `cc` 可用:`node.worldPosition / active / activeInHierarchy / components`(构造函数类名)全部可用;且能读到**编辑器内部节点**(Editor Camera、gizmo 树、网格、Reference-Image-Canvas)——视觉不可见的结构现在全是真值
- [x] **选中回读(踩坑三)**:`Editor.Selection.getCurrentSelection` 不存在;实测生效的是 **`Editor.Selection.getSelected('scene')`**(候选链第一个命中,返回 uuid 数组)
- [x] `asset-db` `query-assets` 返回字段:`name / type / url` 直接可用(实测 501 项,含 internal 内置资产)
- [x] MCP JSON 直响应模式兼容:JSON-RPC over HTTP + application/json 直响应工作正常(tools/list、tools/call 全程 curl 验证)

校准方法(全部通过):

```bash
# 1. 存活
curl http://127.0.0.1:7420/health
# 2. 工具列表
curl -s -X POST http://127.0.0.1:7420/mcp -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
# 3. 场景树(核心链路:主进程→场景进程)
curl -s -X POST http://127.0.0.1:7420/mcp -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"scene_tree","arguments":{"maxDepth":3}}}'
# 4. 选中回读(先在编辑器里点一个节点再执行)
curl -s -X POST http://127.0.0.1:7420/mcp -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"selected_nodes","arguments":{}}}'
# 5. 资产索引
curl -s -X POST http://127.0.0.1:7420/mcp -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"asset_index","arguments":{}}}'
# 6. 节点详情
curl -s -X POST http://127.0.0.1:7420/mcp -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"node_detail","arguments":{"uuid":"<从scene_tree获取>"}}}'
```

## 排障记录(校准过程)

- `Spread syntax requires ...iterable` → `execute-scene-script` 的 args 传了对象,改为数组;
- `Scenario scripts do not exist: undefined` → 参数用了位置形式,内部按对象解构得 undefined,改回单对象格式;
- 排障方法论:编辑器日志 `temp/logs/project.log` 会打出场景进程异常与调用栈;内置扩展源码可用 `grep -abo '关键字' app.asar` 定位偏移后按 asar 头解析提取(`.ccc` 编译产物不可读,但调用范例/文档字符串可读)。

## 后续版本的设计草图

- **0.2 操作模块 cocos-act(下一个交付物)**:意图级工具 ≤15 个——创建/删除节点、挂/移除组件、设属性、移动节点、保存 prefab、刷新 asset-db、执行菜单命令等。**核心设计原则:每个操作工具的返回值 = 操作后的状态回读**(create_node 返回新节点 uuid + 局部场景树;attach_component 返回组件列表 diff)。act-then-verify 内建于工具本身,不依赖 Agent 自觉——这是对"盲操作"这个操作型 MCP 头号顽疾的正解,也是感知模块与操作模块的真正结合点。
- **0.3 Agent 配置层**:领域知识配置(Cocos 坐标系统、.scene 序列化格式要点、组件体系、常见坑)+ 工作流技能(make_character / make_level)。专用 Agent = ZCode/Claude Code(大脑 runtime)+ 本扩展(器官)+ 这层配置(知识),不自己写 agent loop。
- **0.4 控制台错误流**:轮询/订阅编辑器 console 模块,聚合成 `recent_errors`;编译错误与运行时异常是 GUI Agent 最难从屏幕上感知的状态。
- **0.4 屏幕坐标投影**:节点世界坐标 → 场景视图屏幕像素,需要拿到场景视图相机的投影矩阵,使"结构化坐标"能直接转成鼠标点击坐标。这是打通"GUI 兜底操作 + 真值锚定"的最后一公里。
- **0.4+ Set-of-Mark**:把可见节点编号后与截图合成,Agent 看图选编号,坐标由真值表给出——视觉定位误差归零。
