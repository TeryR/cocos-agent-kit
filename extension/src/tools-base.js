'use strict';

// 基础工具(v0.1 感知 4 + v0.2 操作 5 + save/refresh)。
// act_add_component 双通道:编辑器 'add-component' 消息(官方路径,支持自定义脚本 uuid)优先,
// 场景进程类名直加兜底(内置组件与已编译脚本)。

const { dbToPath, ccclassOf } = require('./asset-inspect');

function sceneScript(method, args) {
  return Editor.Message.request('scene', 'execute-scene-script', {
    name: 'cocos-sense',
    method,
    args: [args || {}],
  });
}

function textResult(obj) {
  return {
    content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }],
  };
}

async function tryChain(candidates) {
  const attempts = [];
  for (const { label, fn } of candidates) {
    try {
      const result = await fn();
      attempts.push({ via: label, ok: true, result: result === undefined ? null : result });
      return { ok: true, via: label, attempts, result };
    } catch (err) {
      attempts.push({ via: label, ok: false, error: String((err && err.message) || err) });
    }
  }
  return { ok: false, attempts, result: null };
}

const TOOLS_BASE = [
  {
    name: 'scene_tree',
    description:
      'Dump the Cocos scene hierarchy: names, uuids, world positions, active states, component class names, spatial extras (contentSize/anchorPoint, TiledMap grid). Ground truth instead of the Scene view. Pass filterEditor=true to exclude editor helper layers (recommended for business-node statistics).',
    inputSchema: {
      type: 'object',
      properties: {
        maxDepth: { type: 'number', description: 'max tree depth, default 6, hard cap 12' },
        filterEditor: { type: 'boolean', description: 'exclude Editor Scene Foreground/Background helper layers' },
      },
    },
  },
  {
    name: 'node_detail',
    description:
      'Detail of one node by uuid: world position, contentSize, anchorPoint, active states, components, direct children.',
    inputSchema: {
      type: 'object',
      properties: { uuid: { type: 'string' } },
      required: ['uuid'],
    },
  },
  {
    name: 'selected_nodes',
    description:
      'Read back which nodes are currently selected in the editor. Call right after a GUI click/drag to verify what it landed on.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'asset_index',
    description:
      'Index of project assets (name, type, url). Use instead of visually scanning the Assets panel.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'optional type filter, e.g. cc.ImageAsset / cc.Prefab / cc.SceneAsset' },
      },
    },
  },
  {
    name: 'act_create_node',
    description:
      'Create a node under a parent. Returns the created node READBACK (uuid/position/size/components) — verify from it, not from a success word. position is WORLD coordinates. Visible objects need a renderable component (cc.Label works without assets).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        parent: { type: 'string', description: 'parent node uuid, or "scene"' },
        position: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } } },
        anchor: { type: 'string', description: 'semantic placement: "top-left"/"top-center"/.../"center"/"bottom-right" relative to Canvas — no pixel math needed' },
        margin: { type: 'object', description: 'inset from the anchored edges in px: {left,top,right,bottom}' },
        relative: {
          type: 'object',
          description: 'offset from another node as fraction of canvas size: {to: uuid, dxPct: 0.1, dyPct: 0}',
          properties: { to: { type: 'string' }, dxPct: { type: 'number' }, dyPct: { type: 'number' } },
        },
        color: { type: 'array', description: '[r,g,b] or [r,g,b,a]' },
        components: {
          type: 'array',
          items: {
            type: 'object',
            properties: { type: { type: 'string' }, props: { type: 'object' } },
          },
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'act_delete_node',
    description: 'Delete a node by uuid. Returns remaining sibling list.',
    inputSchema: {
      type: 'object',
      properties: { uuid: { type: 'string' } },
      required: ['uuid'],
    },
  },
  {
    name: 'act_set_transform',
    description:
      'Modify node properties: position (world), name, active, angle, scale, size, color. Returns node readback with actual new values.',
    inputSchema: {
      type: 'object',
      properties: {
        uuid: { type: 'string' },
        props: {
          type: 'object',
          properties: {
            position: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } } },
            name: { type: 'string' },
            active: { type: 'boolean' },
            angle: { type: 'number' },
            scale: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } } },
            size: { type: 'object', properties: { w: { type: 'number' }, h: { type: 'number' } } },
            color: { type: 'array' },
          },
        },
      },
      required: ['uuid', 'props'],
    },
  },
  {
    name: 'act_add_component',
    description:
      'Attach a component: built-in by class name (cc.Sprite), custom script by class name (if compiled) or script uuid (recommended for custom scripts). Returns component list readback.',
    inputSchema: {
      type: 'object',
      properties: {
        uuid: { type: 'string', description: 'node uuid' },
        type: { type: 'string', description: 'component class name OR custom script uuid' },
        props: { type: 'object' },
      },
      required: ['uuid', 'type'],
    },
  },
  {
    name: 'act_remove_component',
    description: 'Remove a component from a node. Returns component list readback.',
    inputSchema: {
      type: 'object',
      properties: {
        uuid: { type: 'string' },
        type: { type: 'string' },
      },
      required: ['uuid', 'type'],
    },
  },
  {
    name: 'save_scene',
    description: 'Save the currently open scene.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'refresh_assets',
    description: 'Refresh the asset database. REQUIRED after writing script/asset files directly to disk.',
    inputSchema: { type: 'object', properties: {} },
  },
];

async function dispatchBase(name, args) {
  switch (name) {
    case 'scene_tree':
      return textResult(await sceneScript('getSceneTree', args));

    case 'node_detail':
      if (!args || !args.uuid) throw new Error('uuid is required');
      return textResult(await sceneScript('getNodeDetail', args));

    case 'selected_nodes': {
      const outcome = await tryChain([
        { label: 'Editor.Selection.getSelected', fn: () => Editor.Selection.getSelected('scene') },
        { label: 'Editor.Selection.curSelection', fn: () => Editor.Selection.curSelection('scene') },
        { label: "Message 'selection'/'query'", fn: () => Editor.Message.request('selection', 'query', 'scene') },
      ]);
      const uuids = Array.isArray(outcome.result) ? outcome.result : outcome.result ? [outcome.result] : [];
      return textResult({ context: 'scene', uuids, via: outcome.via });
    }

    case 'asset_index': {
      const assets = await Editor.Message.request('asset-db', 'query-assets');
      const wanted = args && args.type;
      const rows = (Array.isArray(assets) ? assets : [])
        .map((a) => ({ name: a.name, type: a.type, url: a.url }))
        .filter((r) => r.name && (!wanted || r.type === wanted));
      return textResult({ count: rows.length, assets: rows });
    }

    case 'act_create_node':
      if (!args || !args.name) throw new Error('name is required');
      return textResult(await sceneScript('act_create_node', args));

    case 'act_delete_node':
      if (!args || !args.uuid) throw new Error('uuid is required');
      return textResult(await sceneScript('act_delete_node', args));

    case 'act_set_transform':
      if (!args || !args.uuid || !args.props) throw new Error('uuid and props are required');
      return textResult(await sceneScript('act_set_transform', args));

    case 'act_add_component': {
      if (!args || !args.uuid || !args.type) throw new Error('uuid and type are required');
      // 自定义脚本 uuid → @ccclass 类名(场景进程按类名注册组件)
      let typeArg = args.type;
      let ccclass = null;
      if (/^[0-9a-f]{8}-/i.test(args.type)) {
        ccclass = ccclassOf(args.type);
        if (!ccclass) {
          return textResult({
            error: 'script uuid not found in project assets: ' + args.type,
            hint: '确认脚本已存在并 refresh_assets;或直接传 @ccclass 类名',
          });
        }
        typeArg = ccclass;
      }
      const result = await sceneScript('act_add_component', {
        uuid: args.uuid,
        type: typeArg,
        props: args.props,
      });
      // 回读失败不阻塞主结果(挂载结果以 result 为准)
      let readback = null;
      try {
        const rb = await sceneScript('component_props', {
          uuid: args.uuid,
          component: (result && result.attached) || typeArg,
          props: [],
        });
        readback = JSON.parse(rb.content[0].text);
      } catch (e) { /* readback 可选 */ }
      return textResult({ via: 'scene-process', ccclass: ccclass || undefined, result, readback });
    }

    case 'act_remove_component':
      if (!args || !args.uuid || !args.type) throw new Error('uuid and type are required');
      return textResult(await sceneScript('act_remove_component', args));

    case 'save_scene': {
      const outcome = await tryChain([
        { label: "scene/'save-scene'", fn: () => Editor.Message.request('scene', 'save-scene') },
        { label: "scene/'save-current-scene'", fn: () => Editor.Message.request('scene', 'save-current-scene') },
        { label: "scene/'save'", fn: () => Editor.Message.request('scene', 'save') },
      ]);
      return textResult({ saved: outcome.ok, via: outcome.via, attempts: outcome.attempts });
    }

    case 'refresh_assets': {
      const outcome = await tryChain([
        { label: "asset-db/'refresh-asset' db://assets/", fn: () => Editor.Message.request('asset-db', 'refresh-asset', 'db://assets/') },
        { label: "asset-db/'refresh' db://assets/", fn: () => Editor.Message.request('asset-db', 'refresh', 'db://assets/') },
      ]);
      return textResult({ refreshed: outcome.ok, via: outcome.via, attempts: outcome.attempts });
    }

    default:
      throw new Error('unknown tool: ' + name);
  }
}

module.exports = { TOOLS_BASE, dispatchBase };
