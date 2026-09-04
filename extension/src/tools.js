'use strict';

// 工具注册(v0.3):感知原语 6 + 操作原语 8 + 状态工具 2 + 文件级信息原语 4。
// 设计哲学:只提供"事实查询"与"意图执行"原语;诊断与修复方案由 Agent 基于返回数据自行推理。

const { TOOLS_BASE, dispatchBase } = require('./tools-base');
const assetInspect = require('./asset-inspect');

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

const EXTRA_TOOLS = [
  // ============ 感知原语(v0.3)============
  {
    name: 'scene_summary',
    description:
      'One-line-per-node deterministic scene digest: zone (nine-grid), canvas percentage, size, components, active state, plus stats (empty containers / out-of-canvas / inactive). Pure math conversion — NO semantic labels; infer functionality yourself from component and naming evidence.',
    inputSchema: {
      type: 'object',
      properties: {
        maxDepth: { type: 'number' },
      },
    },
  },
  {
    name: 'scene_info',
    description:
      'Name/uuid of the currently open scene. Use it FIRST to confirm the editor has the target scene open (对照 asset_index/scene_list 的清单).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'component_props',
    description:
      'Read property VALUES of one component on a node (e.g. what image a Sprite shows, Label text, physics params). This is the "detail layer" that scene_tree intentionally omits.',
    inputSchema: {
      type: 'object',
      properties: {
        uuid: { type: 'string', description: 'node uuid' },
        component: { type: 'string', description: 'component class name, e.g. cc.Sprite / PlayerController' },
        props: { type: 'array', description: 'optional property name list; omit for sensible defaults' },
      },
      required: ['uuid', 'component'],
    },
  },
  {
    name: 'inspect_asset',
    description:
      'File-level inspection of a JSON asset (prefab/scene/anim): internal node tree, component summaries, ALL __uuid__ references with optional resolution to asset paths and broken-reference detection. Use for runtime-spawned entities (prefabs) and reference-chain diagnosis (color-block bugs).',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'e.g. db://assets/Res/Prefabs/apple.prefab' },
        resolve: { type: 'boolean', description: 'resolve reference uuids to asset paths + flag broken ones (scans project metas)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'scene_list',
    description: 'All scenes in the project (internal name / uuid / url) + 当前打开场景对照用.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'console_logs',
    description:
      'Tail of the editor log (compile errors, runtime exceptions, [Scene] entries). The feedback loop after writing code: refresh_assets, then read this.',
    inputSchema: {
      type: 'object',
      properties: {
        lines: { type: 'number' },
        level: { type: 'string', description: '"error" or "warn" filter' },
      },
    },
  },
  {
    name: 'preview_info',
    description: 'Preview service URL and trigger hints. Run-feedback loop: preview, then console_logs for errors.',
    inputSchema: { type: 'object', properties: {} },
  },
  // ============ 操作原语(v0.3)============
  {
    name: 'act_set_property',
    description:
      'Write ONE property on a component (primitive write). Basic types/colors/strings go through the scene process; asset references (e.g. spriteFrame {__uuid__}) go through editor set-property channel. Returns the actual new value.',
    inputSchema: {
      type: 'object',
      properties: {
        uuid: { type: 'string' },
        component: { type: 'string' },
        prop: { type: 'string', description: 'property name, e.g. string / fontSize / color / _spriteFrame' },
        value: { description: 'new value; color as [r,g,b]; asset ref as {"__uuid__": "..."}' },
      },
      required: ['uuid', 'component', 'prop', 'value'],
    },
  },
];

const DISPATCH_EXTRA = {
  scene_summary: async (args) => textResult(await sceneScript('scene_summary', args || {})),
  scene_info: async () => textResult(await sceneScript('scene_info', {})),
  component_props: async (args) => {
    if (!args || !args.uuid || !args.component) throw new Error('uuid and component are required');
    return textResult(await sceneScript('component_props', args));
  },
  inspect_asset: async (args) => textResult(assetInspect.inspectAsset(args || {})),
  scene_list: async () => textResult(assetInspect.sceneList()),
  console_logs: async (args) => textResult(assetInspect.consoleLogs(args || {})),
  preview_info: async () => textResult(assetInspect.previewInfo()),
  act_set_property: async (args) => {
    if (!args || !args.uuid || !args.component || args.prop === undefined) {
      throw new Error('uuid, component, prop, value are required');
    }
    // 双通道:先编辑器官方 set-property 消息(支持资产引用),失败退场景进程直改(基础类型)
    const outcome = await tryChain([
      {
        label: "scene/'set-property'",
        fn: () => Editor.Message.request('scene', 'set-property', {
          uuid: args.uuid,
          property: args.prop,
          value: args.value,
        }),
      },
      { label: 'scene-process direct', fn: () => sceneScript('act_set_property', args) },
    ]);
    const readback = await sceneScript('component_props', {
      uuid: args.uuid,
      component: args.component,
      props: [args.prop],
    });
    return textResult({ via: outcome.via, readback });
  },
};

const TOOLS = TOOLS_BASE.concat(EXTRA_TOOLS);

async function dispatch(name, args) {
  if (DISPATCH_EXTRA[name]) return DISPATCH_EXTRA[name](args);
  return dispatchBase(name, args);
}

module.exports = { TOOLS, dispatch };
