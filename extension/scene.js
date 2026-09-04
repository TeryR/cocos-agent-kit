'use strict';

// 在场景进程中运行(contributions.scene.script),可直接访问引擎运行时 cc。
// 原则:所有输出字段的 schema 由本文件定义,不依赖编辑器消息的私有返回结构(ADR-3)。
// 通过 execute-scene-script 调用:{ name: 'cocos-sense', method, args }。

function round3(n) {
  return typeof n === 'number' ? Math.round(n * 1000) / 1000 : null;
}

function vecToJson(v) {
  if (!v || typeof v.x !== 'number') return null;
  return { x: round3(v.x), y: round3(v.y), z: round3(v.z) };
}

function componentNames(node) {
  return (node.components || [])
    .map((c) => (c && c.constructor && c.constructor.name) || null)
    .filter(Boolean);
}

function walk(node, depth, maxDepth) {
  const entry = {
    name: node.name || '',
    uuid: node.uuid,
    active: node.active !== false,
    activeInHierarchy: node.activeInHierarchy !== false,
    worldPosition: vecToJson(node.worldPosition),
    components: componentNames(node),
  };
  const children = node.children || [];
  if (depth >= maxDepth) {
    entry.childCount = children.length;
  } else {
    entry.children = children.map((c) => walk(c, depth + 1, maxDepth));
  }
  return entry;
}

function findByUuid(node, uuid) {
  if (node.uuid === uuid) return node;
  const children = node.children || [];
  for (let i = 0; i < children.length; i++) {
    const hit = findByUuid(children[i], uuid);
    if (hit) return hit;
  }
  return null;
}

module.exports = {
  load() {},
  unload() {},

  methods: {
    ping() {
      return { pong: true, hasScene: !!cc.director.getScene() };
    },

    getSceneTree(args) {
      const maxDepth = Math.min(Number(args && args.maxDepth) || 6, 12);
      const scene = cc.director.getScene();
      if (!scene) return { error: 'no active scene' };
      return walk(scene, 0, maxDepth);
    },

    getNodeDetail(args) {
      const scene = cc.director.getScene();
      const uuid = args && args.uuid;
      if (!scene || !uuid) return { error: 'scene or uuid missing' };
      const node = findByUuid(scene, uuid);
      if (!node) return { error: 'node not found: ' + uuid };
      return {
        name: node.name,
        uuid: node.uuid,
        parent: node.parent ? { name: node.parent.name, uuid: node.parent.uuid } : null,
        worldPosition: vecToJson(node.worldPosition),
        angle: round3(node.angle),
        scale:
          node.scale && typeof node.scale.x === 'number'
            ? { x: round3(node.scale.x), y: round3(node.scale.y) }
            : null,
        active: node.active !== false,
        components: componentNames(node),
        children: (node.children || []).map((c) => ({ name: c.name, uuid: c.uuid })),
      };
    },
  },
};
