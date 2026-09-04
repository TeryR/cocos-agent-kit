# cocos-agent-kit — AI Agent 的 Cocos Creator 感知与操作层

> 让你的 AI Agent(Claude Code / Cursor / Cline / ZCode…)**看见并操作** Cocos Creator 编辑器:
> 读取场景结构、节点坐标、组件属性、资产引用;创建节点、挂组件、改属性、保存场景、刷新资产——
> 全部通过标准 MCP 协议,5 分钟接入,无需读懂源码。

- **信息原语**:场景树(含九宫格/百分比空间事实)、节点详情、组件属性值、选中状态、资产索引、文件级资产解剖(含断链检测)、场景清单、编辑器日志、预览地址
- **操作原语**:创建/删除节点、改属性/变换(支持语义定位)、挂/摘组件(含自定义脚本)、通用属性写入、保存场景、刷新资产、创建场景、重父级/排序、prefab 实例化与落盘、Web 构建
- **设计原则**:只提供事实查询与意图执行;诊断、判断、修复方案由 Agent 基于返回数据自行完成

## 快速开始(5 分钟)

### 前置条件

- Cocos Creator **3.8.x**(3.8.6+ 实测过,3.7 未验证)
- 任意支持 MCP(Streamable HTTP)的 Agent 客户端
- 一个你自己的 Cocos 游戏项目

### 第 1 步:安装扩展

把本仓库的 `extension/` 文件夹整体拷贝到你项目的 `extensions/cocos-agent-kit/`(没有 `extensions` 目录就新建):

```
你的项目/
└── extensions/
    └── cocos-agent-kit/        ← extension/ 的内容
        ├── package.json
        ├── main.js
        └── ...
```

### 第 2 步:启用

打开/刷新项目——项目内扩展**默认自动启用**。若没启用,扩展管理器 → 扩展 → cocos-agent-kit → 开关打开。

### 第 3 步:验证服务

```bash
curl http://127.0.0.1:7420/health
# {"ok":true,"server":{"name":"cocos-agent-kit","version":"0.4.0"}}
```

### 第 4 步:接入你的 Agent

**Claude Code:**
```bash
claude mcp add --transport http cocos-agent-kit http://127.0.0.1:7420/mcp
```

**Cursor / Cline 等**(mcp.json):
```json
{
  "mcpServers": {
    "cocos-agent-kit": { "url": "http://127.0.0.1:7420/mcp" }
  }
}
```

### 第 5 步:安装 Skill(强烈推荐)

工具是能力,[`skills/cocos-agent-kit/SKILL.md`](skills/cocos-agent-kit/SKILL.md) 是使用这些能力的作业指导书:
感知→操作→验证→保存的工作流纪律、坐标系与设计分辨率知识、语义定位配方、资源异常诊断指引。

- **Claude Code**:拷到 `~/.claude/skills/cocos-agent-kit/SKILL.md`(全局)或项目 `.claude/skills/cocos-agent-kit/SKILL.md`
- **ZCode / 其他支持 Agent Skills 的客户端**:同理放入其 skills 目录

### 第 6 步:冒烟测试

对你的 Agent 说:**"列出当前 Cocos 场景的节点树"**。它调用 `scene_tree` 返回真实场景数据 = 全链路打通。

## 工具清单(v0.4,28 个)

### 感知(信息)

| 工具 | 内容 |
|---|---|
| `scene_summary` | 确定性事实汇编:每节点一行(九宫格/百分比/尺寸/组件/激活态)+ 空容器/越界/未激活统计 |
| `scene_tree` | 完整层级树(uuid/世界坐标/组件/尺寸/锚点/TiledMap 格子) |
| `scene_info` / `scene_list` | 当前打开场景 / 项目全部场景 |
| `node_detail` | 单节点详情 |
| `component_props` | 组件属性**值**(Sprite 显示哪张图、Label 文本、物理参数…) |
| `selected_nodes` | 编辑器当前选中(回读验证) |
| `asset_index` / `image_meta` | 资产索引 / 图片像素尺寸 |
| `inspect_asset` | 文件级资产解剖:prefab/scene 内部树 + 全部引用 + 断链检测 |
| `asset_refs` | 反向引用:谁引用了某个资产 |
| `console_logs` | 编辑器日志尾部(编译错误/运行时异常) |
| `preview_info` | 预览服务地址 |

### 操作(意图执行)

| 工具 | 内容 |
|---|---|
| `act_create_node` | 创建节点,支持语义定位(`anchor: "top-right"` + margin / relative 百分比) |
| `act_set_transform` / `act_set_property` | 改变换/属性(后者支持资产引用,双通道) |
| `act_add_component` / `act_remove_component` | 挂/摘组件(内置类名或自定义脚本 uuid→自动映射 @ccclass) |
| `act_reparent` / `act_set_sibling_index` | 移动层级 / 调整渲染顺序 |
| `act_delete_node` | 删除节点 |
| `create_scene` / `instantiate_prefab` / `save_as_prefab` | 建场景(复制模板)/ 实例化 prefab / 节点落盘为 prefab |
| `save_scene` / `refresh_assets` / `build_web` | 保存 / 刷新 / Web 构建 |

## 排查表

| 症状 | 原因与解法 |
|---|---|
| `/health` 不通 | 扩展未启用 → 扩展管理器检查;或开了多个编辑器实例抢 7420 → **关掉多余的编辑器**(单端口单实例) |
| 编辑器控制台报 `EADDRINUSE` | 同上 |
| 场景树返回 error: no active scene | 编辑器里还没打开任何场景 → 双击一个 .scene |
| 工具报 spread / undefined 错误 | 旧版扩展,拉最新并重新加载 |
| `component_props` 报 component not found | 自定义脚本未编译 → `refresh_assets` 后重试 |

## ⚠️ 安全须知

- `act_` 系列工具会**真实修改你的场景**,`save_scene` 会落盘——操作前确保项目在 git 干净状态;
- 感知工具全部只读;
- 服务只监听 `127.0.0.1`,不对外网暴露;
- 编辑器的启动权归你:让 Agent 操作前,自己打开项目编辑器(Agent 不会也不应替你启动)。

## 文档

| 文档 | 面向 | 内容 |
|---|---|---|
| [`docs/design.md`](docs/design.md) | 维护者/深入 | 架构决策记录、接口 schema、真机校准清单、排障记录 |
| [`docs/knowledge-cocos-format.md`](docs/knowledge-cocos-format.md) | Agent/维护者 | Cocos 资产序列化格式知识(资源显示异常诊断必读) |
| [`docs/editor-protocol.md`](docs/editor-protocol.md) | Agent/维护者 | 编辑器操作规程(启动权/前置检查/危险操作边界) |
| [`docs/roadmap.md`](docs/roadmap.md) | 维护者 | 定位、生产化 gate、路线图、生态对比 |

## 架构

```
┌──────────────────────────────────────────────┐
│      你的 AI Agent(Claude / Cursor / ZCode)   │
│        + cocos-agent-kit skill(作业指导书)          │
└────────────┬─────────────────────────────────┘
             │ MCP(Streamable HTTP)
             ▼  http://127.0.0.1:7420/mcp
┌──────────────────────────────────────────────┐
│  cocos-agent-kit 扩展(Cocos Creator 3.8.x)        │
│  ├─ 信息原语:场景树/属性值/资产解剖/日志/引用    │
│  └─ 操作原语:act_*(回读内建)/保存/刷新/构建     │
└────────────┬─────────────────────────────────┘
             ▼
      Cocos Creator 编辑器(场景进程 + asset-db)
```

## License

MIT
