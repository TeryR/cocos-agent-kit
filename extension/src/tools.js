'use strict';

// 感知工具集:一个工具 = 一个 MCP tool,全部只读(ADR-1)。
// 依赖编辑器 API 的地方做防御性映射;首次真机加载后按 docs/design.md 校准清单逐项核对。

// 调用场景进程脚本(contributions.scene.script),路径:主进程 -> 场景进程。
// 校准记录(实锤自编辑器内置 lightmap 扩展的官方调用):参数必须是单个对象,
// 且 args 字段必须是【数组】——内部 method(...args) 会展开它,传对象会报
// "Spread syntax requires ...iterable"。本扩展约定:业务参数打包成单元素数组,
// scene.js 的每个 method 接收一个 args 对象。
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

const TOOLS = [
  {
    name: 'scene_tree',
    description:
      'Dump the Cocos Creator scene hierarchy: names, uuids, world positions, active states and component class names. Use this as ground truth instead of reading the Scene view visually.',
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
      'Detail of one node by uuid: parent, world position, angle, scale, components and direct children.',
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
      'Read back which nodes are currently selected in the editor. Call this right after a GUI click or drag to verify what the action actually landed on. This is the verify step of the act-then-verify loop.',
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
];

async function dispatch(name, args) {
  switch (name) {
    case 'scene_tree':
      return textResult(await sceneScript('getSceneTree', args));

    case 'node_detail':
      if (!args || !args.uuid) throw new Error('uuid is required');
      return textResult(await sceneScript('getNodeDetail', args));

    case 'selected_nodes': {
      // 校准记录:Editor.Selection.getCurrentSelection 在 3.8.8 不存在(见校准清单)。
      // 按候选链探测,第一个成功的生效,并把实际使用的 API 名返回给调用方。
      const candidates = [
        { api: 'Editor.Selection.curSelection', fn: () => Editor.Selection.curSelection('scene') },
        { api: 'Editor.Selection.getSelected', fn: () => Editor.Selection.getSelected('scene') },
        { api: "Message 'selection'/'query'", fn: () => Editor.Message.request('selection', 'query', 'scene') },
        { api: "Message 'scene'/'query-selection'", fn: () => Editor.Message.request('scene', 'query-selection') },
      ];
      for (const { api, fn } of candidates) {
        try {
          const sel = fn();
          if (sel !== undefined) {
            const uuids = Array.isArray(sel) ? sel : (sel ? [sel] : []);
            return textResult({ context: 'scene', uuids, via: api });
          }
        } catch (err) { /* 试下一个候选 */ }
      }
      return textResult({
        context: 'scene',
        uuids: [],
        warning: 'all selection API candidates failed, see docs/design.md calibration list',
      });
    }

    case 'asset_index': {
      // 待校准:query-assets 返回字段做防御性映射
      const assets = await Editor.Message.request('asset-db', 'query-assets');
      const wanted = args && args.type;
      const rows = (Array.isArray(assets) ? assets : [])
        .map((a) => ({ name: a.name, type: a.type, url: a.url }))
        .filter((r) => r.name && (!wanted || r.type === wanted));
      return textResult({ count: rows.length, assets: rows });
    }

    default:
      throw new Error('unknown tool: ' + name);
  }
}

module.exports = { TOOLS, dispatch };
