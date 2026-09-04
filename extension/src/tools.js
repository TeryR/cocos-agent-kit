'use strict';

// 工具注册:v0.1 感知 4 工具 + v0.2 act 操作工具(save/refresh 走主进程候选链)。
// act 工具全部只操作场景进程内数据,返回值即操作后回读(ADR-5)。

// 调用场景进程脚本:单对象参数,args 必须为【数组】(内部 method(...args) 展开)。
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

const TOOLS = [
  // ============ 感知 ============
  {
    name: 'scene_tree',
    description:
      'Dump the Cocos Creator scene hierarchy: names, uuids, world positions, active states, component class names, plus spatial extras (contentSize/anchorPoint, TiledMap grid info). Ground truth instead of reading the Scene view visually.',
    inputSchema: {
      type: 'object',
      properties: {
        maxDepth: { type: 'number', description: 'max tree depth, default 6, hard cap 12' },
      },
    },
  },
  {
    name: 'node_detail',
    description:
      'Detail of one node by uuid: parent chain via tree, world position, contentSize, anchorPoint, components and direct children.',
    inputSchema: {
      type: 'object',
      properties: {
        uuid: { type: 'string', description: 'node uuid from scene_tree' },
      },
      required: ['uuid'],
    },
  },
  {
    name: 'selected_nodes',
    description:
      'Read back which nodes are currently selected in the editor. Call right after a GUI click/drag to verify what the action actually landed on.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'asset_index',
    description:
      'Index of project assets (name, type, url). Use it instead of visually scanning the Assets panel.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'optional asset type filter, e.g. cc.ImageAsset' },
      },
    },
  },
  // ============ 操作(v0.2)============
  {
    name: 'act_create_node',
    description:
      'Create a node under a parent (uuid or "scene"). Returns the created node readback (uuid/position/size/components) - use it to verify, not the word success. position is WORLD coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        parent: { type: 'string', description: 'parent node uuid, or "scene" for scene root' },
        position: {
          type: 'object',
          properties: {
            x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
          },
        },
        color: { type: 'array', description: 'node tint [r,g,b] or [r,g,b,a]' },
        components: {
          type: 'array',
          description: 'components to attach, e.g. [{"type":"cc.Label","props":{"string":"Coin","fontSize":28}}]',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              props: { type: 'object' },
            },
          },
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'act_delete_node',
    description: 'Delete a node by uuid. Returns remaining sibling list as readback.',
    inputSchema: {
      type: 'object',
      properties: { uuid: { type: 'string' } },
      required: ['uuid'],
    },
  },
  {
    name: 'act_set_transform',
    description:
      'Modify node properties: position (world), name, active, angle, scale, size, color. Returns the node readback with actual new values.',
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
    description: 'Attach a component (e.g. "cc.Sprite") to a node, optionally applying props. Returns the component list readback.',
    inputSchema: {
      type: 'object',
      properties: {
        uuid: { type: 'string' },
        type: { type: 'string', description: 'component class name, e.g. cc.Sprite' },
        props: { type: 'object' },
      },
      required: ['uuid', 'type'],
    },
  },
  {
    name: 'act_remove_component',
    description: 'Remove a component from a node. Returns the component list readback.',
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
    description: 'Save the currently open scene. Tries known scene-save messages and reports which one worked.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'refresh_assets',
    description: 'Refresh the asset database so file-level changes become visible assets.',
    inputSchema: { type: 'object', properties: {} },
  },
];

async function dispatch(name, args) {
  switch (name) {
    // 感知
    case 'scene_tree':
      return textResult(await sceneScript('getSceneTree', args));

    case 'node_detail':
      if (!args || !args.uuid) throw new Error('uuid is required');
      return textResult(await sceneScript('getNodeDetail', args));

    case 'selected_nodes': {
      // 校准记录:3.8.8 实测 Editor.Selection.getSelected('scene') 生效(候选链)
      const candidates = [
        { label: 'Editor.Selection.getSelected', fn: () => Editor.Selection.getSelected('scene') },
        { label: 'Editor.Selection.curSelection', fn: () => Editor.Selection.curSelection('scene') },
        { label: "Message 'selection'/'query'", fn: () => Editor.Message.request('selection', 'query', 'scene') },
        { label: "Message 'scene'/'query-selection'", fn: () => Editor.Message.request('scene', 'query-selection') },
      ];
      const outcome = await tryChain(candidates);
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

    // 操作
    case 'act_create_node':
      if (!args || !args.name) throw new Error('name is required');
      return textResult(await sceneScript('act_create_node', args));

    case 'act_delete_node':
      if (!args || !args.uuid) throw new Error('uuid is required');
      return textResult(await sceneScript('act_delete_node', args));

    case 'act_set_transform':
      if (!args || !args.uuid || !args.props) throw new Error('uuid and props are required');
      return textResult(await sceneScript('act_set_transform', args));

    case 'act_add_component':
      if (!args || !args.uuid || !args.type) throw new Error('uuid and type are required');
      return textResult(await sceneScript('act_add_component', args));

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

module.exports = { TOOLS, dispatch };
