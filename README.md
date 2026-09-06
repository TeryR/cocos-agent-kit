[English](README.md) | [简体中文](README.zh-CN.md)

# cocos-agent-kit — Perception & Action Layer for AI Agents on Cocos Creator

> Let your AI Agent (Claude Code / Cursor / Cline / ZCode…) **see and operate** the Cocos Creator editor:
> read scene hierarchy, node positions, component properties and asset references; create nodes, attach
> components, modify properties, save scenes, refresh assets — all over standard MCP, 5-minute setup,
> no need to read the source.

- **Information primitives**: scene digest (nine-grid zones / percentages / sizes / states), scene tree,
  node details, component property **values**, selection, asset index, file-level asset dissection
  (with broken-reference detection), scene list, editor logs, preview URL
- **Action primitives**: create/delete nodes, transform & properties (with **semantic placement**),
  attach/detach components (incl. custom scripts), generic property write, save scene, refresh assets,
  create scene, reparent/sort, prefab instantiate & save-to-disk, web build
- **Design principle**: primitives provide fact queries and intent execution only — diagnosis, judgment
  and repair strategies belong to the Agent, based on the data these primitives return.

## Quick Start (5 minutes)

### Prerequisites

- Cocos Creator **3.8.x** (verified on 3.8.6+; 3.7 untested)
- Any MCP-capable (Streamable HTTP) Agent client
- One of your own Cocos game projects

### Step 1: Install the extension

> **AI Agent reading this?** Start with [`AGENTS.md`](AGENTS.md) at the repo root — install steps, the operating manual (`skills/cocos-agent-kit/SKILL.md`), and iron rules.

Copy the `extension/` folder from this repo into your project as `extensions/cocos-agent-kit/`
(create the `extensions` directory if missing):

```
your-project/
└── extensions/
    └── cocos-agent-kit/    ← contents of extension/
        ├── package.json
        ├── main.js
        └── ...
```

### Step 2: Enable

Open/refresh the project — project-scoped extensions are **enabled automatically**. If not:
Extension Manager → cocos-agent-kit → toggle on.

### Step 3: Verify the service

```bash
curl http://127.0.0.1:7420/health
# {"ok":true,"server":{"name":"cocos-agent-kit","version":"0.4.1"}}
```

### Step 4: Connect your Agent

**Claude Code:**
```bash
claude mcp add --transport http cocos-agent-kit http://127.0.0.1:7420/mcp
```

**Cursor / Cline etc.** (mcp.json):
```json
{
  "mcpServers": {
    "cocos-agent-kit": { "url": "http://127.0.0.1:7420/mcp" }
  }
}
```

### Step 5: Install the Skill (strongly recommended)

Tools are capability; [`skills/cocos-agent-kit/SKILL.md`](skills/cocos-agent-kit/SKILL.md) is the playbook
for using them correctly: the perceive → act → verify → save discipline, coordinate system knowledge,
semantic placement recipes, and resource-anomaly diagnosis workflows.

- **Claude Code**: copy to `~/.claude/skills/cocos-agent-kit/SKILL.md` (global) or
  `.claude/skills/cocos-agent-kit/SKILL.md` (project-level)
- **ZCode / other Agent-Skills-compatible clients**: same, into their skills directory

### Step 6: Smoke test

Tell your Agent: **"List the node tree of the current Cocos scene."** If it calls `scene_tree` and returns
real scene data, the full chain works.

## Tool Reference (v0.4, 28 tools)

### Information primitives

| Tool | Content |
|---|---|
| `scene_summary` | Deterministic one-line-per-node digest: nine-grid zone, canvas %, size, components, active state + stats (empty containers / out-of-canvas / inactive) |
| `scene_tree` | Full hierarchy (uuid / world position / components / size / anchor / TiledMap grid) |
| `scene_info` / `scene_list` | Currently open scene / all scenes in project |
| `node_detail` | Single node details |
| `component_props` | Component property **values** (which image a Sprite shows, Label text, physics params…) |
| `selected_nodes` | Editor selection (readback verification) |
| `asset_index` / `image_meta` | Asset index / image pixel dimensions |
| `inspect_asset` | File-level asset dissection: prefab/scene internal tree + all references + broken-ref detection |
| `asset_refs` | Reverse references: which files use a given asset |
| `console_logs` | Editor log tail (compile errors / runtime exceptions) |
| `preview_info` | Preview service URL |

### Action primitives

| Tool | Content |
|---|---|
| `act_create_node` | Create node with **semantic placement** (`anchor: "top-right"` + margin, or relative %) |
| `act_set_transform` / `act_set_property` | Modify transform/property (latter supports asset references, dual channel) |
| `act_add_component` / `act_remove_component` | Attach/detach components (builtin class name, or custom script uuid → auto @ccclass mapping) |
| `act_reparent` / `act_set_sibling_index` | Move hierarchy / render order |
| `act_delete_node` | Delete node |
| `create_scene` / `instantiate_prefab` / `save_as_prefab` | Scene creation (template copy) / prefab instantiate / save node as prefab |
| `save_scene` / `refresh_assets` / `build_web` | Save / refresh / web build |

## Troubleshooting

| Symptom | Cause & fix |
|---|---|
| `/health` unreachable | Extension not enabled → check Extension Manager; or multiple editor instances fighting over 7420 → **close extra editors** (single port, single instance) |
| Editor console shows `EADDRINUSE` | Same as above |
| scene_tree returns error: no active scene | No scene open in the editor → double-click a .scene |
| Tool errors mention spread / undefined | Outdated extension build → pull latest and reload |
| `component_props` says component not found | Custom script not compiled → `refresh_assets` and retry |

## ⚠️ Safety

- `act_` tools **actually modify your scene**, and `save_scene` persists to disk — make sure your
  project is committed to git before letting an Agent write;
- All perception tools are strictly read-only;
- The server listens on `127.0.0.1` only, never exposed to the network;
- **You own the editor**: open the project editor yourself before asking an Agent to operate —
  it will not (and should not) launch the editor for you.

## Architecture

```
┌──────────────────────────────────────────────┐
│    Your AI Agent (Claude / Cursor / ZCode)   │
│      + cocos-agent-kit skill (playbook)      │
└────────────┬─────────────────────────────────┘
             │ MCP (Streamable HTTP)
             ▼  http://127.0.0.1:7420/mcp
┌──────────────────────────────────────────────┐
│  cocos-agent-kit extension (Creator 3.8.x)   │
│  ├─ info primitives: scene tree/values/      │
│  │  asset dissection/logs/reverse refs       │
│  └─ action primitives: act_* (readback       │
│     built-in) / save / refresh / build       │
└────────────┬─────────────────────────────────┘
             ▼
   Cocos Creator editor (scene process + asset-db)
```

## Documentation

> Documentation is currently written in Chinese.

| Doc | Content |
|---|---|
| [`docs/design.md`](docs/design.md) | Architecture decision records, interface schemas, calibration checklist |
| [`docs/knowledge-cocos-format.md`](docs/knowledge-cocos-format.md) | Cocos asset serialization knowledge (required reading for resource-anomaly diagnosis) |
| [`docs/editor-protocol.md`](docs/editor-protocol.md) | Editor operation protocol (ownership, pre-flight checks, danger boundaries) |
| [`docs/roadmap.md`](docs/roadmap.md) | Positioning, production gates, roadmap, ecosystem comparison |

## License

MIT
