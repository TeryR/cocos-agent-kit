'use strict';

// 感知工具集:一个工具 = 一个 MCP tool,全部只读(ADR-1)。
// 依赖编辑器 API 的地方做防御性映射;首次真机加载后按 docs/design.md 校准清单逐项核对。

// 调用场景进程脚本(contributions.scene.script),路径:主进程 -> 场景进程
function sceneScript(method, args) {
  return Editor.Message.request('scene', 'execute-scene-script', {
    name: 'cocos-sense',
    method,
    args: args || {},
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
      // 待校准:Editor.Selection API 的准确签名见 docs/design.md 校准清单
      let uuids = [];
      try {
        const sel = Editor.Selection.getCurrentSelection('scene');
        if (Array.isArray(sel)) uuids = sel;
      } catch (err) {
        return textResult({
          context: 'scene',
          uuids: [],
          warning:
            'selection API needs calibration (see docs/design.md): ' +
            String((err && err.message) || err),
        });
      }
      return textResult({ context: 'scene', uuids });
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
