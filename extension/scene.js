'use strict';

// 场景进程脚本 v0.2(contributions.scene.script),可直接访问引擎运行时 cc。
// v0.2 新增:空间感知增强(contentSize/anchorPoint/TiledMap 格子信息)+ act 操作工具。
// 原则:
//   1) 输出 schema 由本文件定义,不依赖编辑器消息的私有返回结构;
//   2) act 工具的返回值 = 操作后的真实状态(act-then-verify 内建于工具,ADR-5)。

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

// 空间增强:尺寸、锚点、TiledMap 格子信息
function spatialInfo(node) {
  const info = {};
  try {
    const ut = node.getComponent('cc.UITransform');
    if (ut) {
      info.contentSize = { w: round3(ut.width), h: round3(ut.height) };
      info.anchorPoint = { x: round3(ut.anchorX), y: round3(ut.anchorY) };
    }
    const tm = node.getComponent('cc.TiledMap');
    if (tm && tm.getMapSize && tm.getTileSize) {
      const ms = tm.getMapSize();
      const ts = tm.getTileSize();
      info.tiledMap = {
        mapSize: { cols: ms.width, rows: ms.height },
        tileSize: { w: round3(ts.width), h: round3(ts.height) },
      };
    }
  } catch (e) { /* 单节点组件读取失败不阻塞整棵树 */ }
  return info;
}

function dumpNode(node, depth, maxDepth) {
  const entry = {
    name: node.name || '',
    uuid: node.uuid,
    active: node.active !== false,
    activeInHierarchy: node.activeInHierarchy !== false,
    worldPosition: vecToJson(node.worldPosition),
    components: componentNames(node),
  };
  Object.assign(entry, spatialInfo(node));
  const children = node.children || [];
  if (depth >= maxDepth) {
    entry.childCount = children.length;
  } else {
    entry.children = children.map((c) => dumpNode(c, depth + 1, maxDepth));
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

function findParent(scene, parentRef) {
  if (!parentRef || parentRef === 'scene') return scene;
  return findByUuid(scene, parentRef);
}

function applyProps(target, props) {
  for (const key of Object.keys(props || {})) {
    let v = props[key];
    if (key === 'color' && Array.isArray(v)) {
      v = new cc.Color(v[0], v[1], v[2], v[3] === undefined ? 255 : v[3]);
    }
    target[key] = v;
  }
}

// act 之后的回读:目标节点的最新状态(含空间数据)
function readback(scene, uuid) {
  const node = findByUuid(scene, uuid);
  return node ? dumpNode(node, 0, 1) : { error: 'node vanished after op: ' + uuid };
}

module.exports = {
  load() {},
  unload() {},

  methods: {
    ping() {
      return { pong: true, hasScene: !!cc.director.getScene() };
    },

    // ============ 感知(v0.1)============

    getSceneTree(args) {
      const maxDepth = Math.min(Number(args && args.maxDepth) || 6, 12);
      const scene = cc.director.getScene();
      if (!scene) return { error: 'no active scene' };
      return dumpNode(scene, 0, maxDepth);
    },

    getNodeDetail(args) {
      const scene = cc.director.getScene();
      const uuid = args && args.uuid;
      if (!scene || !uuid) return { error: 'scene or uuid missing' };
      const node = findByUuid(scene, uuid);
      if (!node) return { error: 'node not found: ' + uuid };
      return dumpNode(node, 0, 2);
    },

    // ============ 操作(v0.2,全部返回操作后回读)============

    act_create_node(args) {
      const scene = cc.director.getScene();
      if (!scene) return { error: 'no active scene' };
      const parent = findParent(scene, args.parent);
      if (!parent) return { error: 'parent not found: ' + args.parent };

      const node = new cc.Node();
      node.name = args.name || 'NewNode';
      try { node.addComponent('cc.UITransform'); } catch (e) { /* 非 UI 环境则无 UITransform */ }
      node.setParent(parent);
      if (args.position) {
        node.setWorldPosition(
          Number(args.position.x) || 0,
          Number(args.position.y) || 0,
          Number(args.position.z) || 0
        );
      }
      if (Array.isArray(args.color)) {
        applyProps(node, { color: args.color });
      }
      const compErrors = [];
      for (const comp of args.components || []) {
        try {
          const c = node.addComponent(comp.type);
          if (comp.props) applyProps(c, comp.props);
        } catch (e) {
          compErrors.push(comp.type + ': ' + String((e && e.message) || e));
        }
      }
      const result = {
        created: readback(scene, node.uuid),
        parent: { name: parent.name, uuid: parent.uuid },
        siblings: (parent.children || []).map((c) => c.name),
      };
      if (compErrors.length) result.componentErrors = compErrors;
      return result;
    },

    act_delete_node(args) {
      const scene = cc.director.getScene();
      const node = scene && findByUuid(scene, args && args.uuid);
      if (!node) return { error: 'node not found: ' + (args && args.uuid) };
      const parent = node.parent;
      const name = node.name;
      node.removeFromParent();
      node.destroy();
      return {
        deleted: { name, uuid: args.uuid },
        parentChildren: parent ? (parent.children || []).map((c) => c.name) : [],
      };
    },

    act_set_transform(args) {
      const scene = cc.director.getScene();
      const node = scene && findByUuid(scene, args && args.uuid);
      if (!node) return { error: 'node not found: ' + (args && args.uuid) };
      const p = args.props || {};
      if (p.position) node.setWorldPosition(Number(p.position.x) || 0, Number(p.position.y) || 0, Number(p.position.z) || 0);
      if (typeof p.name === 'string') node.name = p.name;
      if (typeof p.active === 'boolean') node.active = p.active;
      if (typeof p.angle === 'number') node.angle = p.angle;
      if (p.scale && typeof p.scale.x === 'number') node.setScale(p.scale.x, p.scale.y, p.scale.z === undefined ? 1 : p.scale.z);
      if (p.size) {
        const ut = node.getComponent('cc.UITransform');
        if (ut) ut.setContentSize(Number(p.size.w) || 0, Number(p.size.h) || 0);
      }
      if (Array.isArray(p.color)) applyProps(node, { color: p.color });
      return readback(scene, node.uuid);
    },

    act_add_component(args) {
      const scene = cc.director.getScene();
      const node = scene && findByUuid(scene, args && args.uuid);
      if (!node) return { error: 'node not found: ' + (args && args.uuid) };
      try {
        const comp = node.addComponent(args.type);
        if (args.props) applyProps(comp, args.props);
      } catch (e) {
        return { error: 'addComponent failed: ' + String((e && e.message) || e) };
      }
      return { components: componentNames(node), node: readback(scene, node.uuid) };
    },

    act_remove_component(args) {
      const scene = cc.director.getScene();
      const node = scene && findByUuid(scene, args && args.uuid);
      if (!node) return { error: 'node not found: ' + (args && args.uuid) };
      try {
        const comp = node.getComponent(args.type);
        if (comp) node.removeComponent(comp);
      } catch (e) {
        return { error: 'removeComponent failed: ' + String((e && e.message) || e) };
      }
      return { components: componentNames(node) };
    },
  },
};
