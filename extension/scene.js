'use strict';

// 场景进程脚本 v0.3:感知原语(scene_info/component_props)+ 操作原语(act_*,全部返回回读)。
// 定位:提供"事实查询"与"意图执行"两类原语;判断与修复方案归 Agent(它拿原语自行推理)。

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

function dumpNode(node, depth, maxDepth, filterEditorLayers) {
  if (filterEditorLayers && (node.name === 'Editor Scene Foreground' || node.name === 'Editor Scene Background')) {
    return null;
  }
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
    entry.children = children
      .map((c) => dumpNode(c, depth + 1, maxDepth, filterEditorLayers))
      .filter(Boolean);
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

// 按类名或运行时 cid 找组件(自定义脚本类名 = 编译后构造函数名)
function findComponent(node, nameOrCid) {
  try {
    const direct = node.getComponent(nameOrCid);
    if (direct) return direct;
  } catch (e) { /* 名称无效则走遍历 */ }
  for (const comp of node.components || []) {
    const cname = comp.constructor && comp.constructor.name;
    const cid = comp.__cid__ || (comp.constructor && comp.constructor._cid);
    if (cname === nameOrCid || cid === nameOrCid) return comp;
  }
  return null;
}

// 通用属性值序列化(防循环引用,深度受限)——信息原语的底层
function serializeVal(v, depth) {
  if (v === null || v === undefined) return v;
  const t = typeof v;
  if (t === 'number' || t === 'boolean' || t === 'string') return v;
  if (t !== 'object') return String(v);
  if (depth <= 0) return '[max-depth]';
  const cname = v.constructor && v.constructor.name;
  if (cname === 'Color') return [v.r, v.g, v.b, v.a];
  if (cname && cname.indexOf('Vec') === 0) return { x: round3(v.x), y: round3(v.y), z: round3(v.z) };
  if (cname === 'Size') return { w: round3(v.width), h: round3(v.height) };
  if (cname === 'SpriteFrame') return v.name || '[SpriteFrame]';
  if (cname === 'Node') return '[Node:' + (v.name || '?') + ']';
  if (cname === 'Array') return v.slice(0, 20).map((x) => serializeVal(x, depth - 1));
  const out = {};
  for (const k of Object.keys(v)) {
    const val = v[k];
    if (typeof val === 'function') continue;
    out[k] = serializeVal(val, depth - 1);
  }
  return out;
}

// 组件属性白名单(信息原语的常用捷径),未命中则通用枚举 _ 开头字段
const PROP_WHITELIST = {
  'cc.Sprite': ['_spriteFrame', '_color', '_sizeMode', '_type'],
  'cc.Label': ['_string', '_fontSize', '_lineHeight', '_color', '_isBold'],
  'cc.UITransform': ['_contentSize', '_anchorPoint'],
  'cc.Button': ['interactable', '_state'],
  'cc.RigidBody2D': ['gravityScale', 'enabled'],
  'cc.Animation': ['_defaultClip'],
};

// 确定性空间换算:Canvas 世界矩形 + 节点九宫格/百分比事实(纯数学,零语义判断)
function canvasRectOf(scene) {
  function find(n) {
    try { if (n.getComponent('cc.Canvas')) return n; } catch (e) { /* 忽略 */ }
    for (const c of n.children || []) {
      const r = find(c);
      if (r) return r;
    }
    return null;
  }
  const canvas = find(scene);
  if (!canvas) return null;
  const ut = canvas.getComponent('cc.UITransform');
  if (!ut) return null;
  const w = ut.width, h = ut.height;
  const wp = canvas.worldPosition;
  return {
    w, h,
    left: wp.x - w * ut.anchorX,
    bottom: wp.y - h * ut.anchorY,
    right: wp.x + w * (1 - ut.anchorX),
    top: wp.y + h * (1 - ut.anchorY),
  };
}

function layoutFacts(node, rect) {
  if (!rect) return null;
  const wp = node.worldPosition;
  if (!wp || typeof wp.x !== 'number') return null;
  const relX = rect.w ? (wp.x - rect.left) / rect.w : 0;
  const relY = rect.h ? (wp.y - rect.bottom) / rect.h : 0;
  const zoneH = relX < 1 / 3 ? 'left' : relX < 2 / 3 ? 'center' : 'right';
  const zoneV = relY < 1 / 3 ? 'bottom' : relY < 2 / 3 ? 'middle' : 'top';
  const facts = {
    pct: { x: Math.round(relX * 1000) / 1000, y: Math.round(relY * 1000) / 1000 },
    zone: zoneV + '-' + zoneH,
  };
  if (wp.x < rect.left || wp.x > rect.right || wp.y < rect.bottom || wp.y > rect.top) {
    facts.outOfCanvas = true;
  }
  return facts;
}

// 语义定位换算:anchor(+margin)→ 世界坐标;纯数学,语义意图由 Agent 给出
function resolvePlacement(scene, args) {
  if (args.position) {
    return {
      x: Number(args.position.x) || 0,
      y: Number(args.position.y) || 0,
      z: Number(args.position.z) || 0,
    };
  }
  const rect = canvasRectOf(scene);
  if (!rect) return null;
  const m = args.margin || {};
  if (args.anchor) {
    const parts = String(args.anchor).split('-');
    const vx = parts[1] || parts[0];
    const vy = parts[1] ? parts[0] : 'middle';
    const x = vx === 'left' ? rect.left + (Number(m.left) || 0)
      : vx === 'right' ? rect.right - (Number(m.right) || 0)
      : rect.left + rect.w / 2;
    const y = vy === 'bottom' ? rect.bottom + (Number(m.bottom) || 0)
      : vy === 'top' ? rect.top - (Number(m.top) || 0)
      : rect.bottom + rect.h / 2;
    return { x, y, z: 0 };
  }
  if (args.relative) {
    const base = findByUuid(scene, args.relative.to);
    if (base) {
      const b = base.worldPosition;
      return {
        x: b.x + (Number(args.relative.dxPct) || 0) * rect.w,
        y: b.y + (Number(args.relative.dyPct) || 0) * rect.h,
        z: 0,
      };
    }
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

    // ============ 感知原语 ============

    // 确定性事实汇编:每节点一行(九宫格/百分比/尺寸/组件/激活态)+ 空容器/越界统计。
    // 只做数学换算;功能语义由 Agent 从组件与命名自行推断。
    scene_summary(args) {
      const scene = cc.director.getScene();
      if (!scene) return { error: 'no active scene' };
      const rect = canvasRectOf(scene);
      const maxDepth = Math.min(Number(args && args.maxDepth) || 8, 14);
      const stats = { nodes: 0, emptyContainers: 0, outOfCanvas: 0, inactive: 0 };
      const compStats = {};
      const lines = [];

      function walk(n, indent) {
        stats.nodes++;
        const comps = componentNames(n);
        for (const c of comps) compStats[c] = (compStats[c] || 0) + 1;
        const facts = rect ? layoutFacts(n, rect) : null;
        if (facts && facts.outOfCanvas) stats.outOfCanvas++;
        const kids = n.children || [];
        if (kids.length === 0) stats.emptyContainers++;
        let line = '  '.repeat(indent) + '- ' + (n.name || '');
        if (facts) line += ' @' + facts.zone + ' (' + Math.round(facts.pct.x * 100) + '%,' + Math.round(facts.pct.y * 100) + '%)';
        const sz = spatialInfo(n).contentSize;
        if (sz && (sz.w || sz.h)) line += ' ' + sz.w + 'x' + sz.h;
        if (comps.length) line += ' [' + comps.join(',') + ']';
        if (!n.activeInHierarchy) { line += ' (inactive)'; stats.inactive++; }
        if (kids.length === 0) line += ' (empty)';
        lines.push(line);
        for (const k of kids) walk(k, indent + 1);
      }

      for (const top of scene.children || []) {
        if (top.name === 'Editor Scene Foreground' || top.name === 'Editor Scene Background') continue;
        walk(top, 0);
      }

      return {
        scene: { name: scene.name, uuid: scene.uuid },
        canvas: rect ? { width: rect.w, height: rect.h } : null,
        stats,
        componentStats: compStats,
        tree: lines,
        note: 'zone/pct 为相对画布的确定性换算(九宫格+百分比);功能语义不在本接口职责内',
      };
    },

    scene_info() {
      const s = cc.director.getScene();
      if (!s) return { error: 'no active scene' };
      return {
        name: s.name,
        uuid: s.uuid,
        childCount: (s.children || []).length,
        hint: 'name/uuid 应与 asset_index 的场景清单对照;不符说明打开的不是目标场景',
      };
    },

    getSceneTree(args) {
      const maxDepth = Math.min(Number(args && args.maxDepth) || 6, 12);
      const scene = cc.director.getScene();
      if (!scene) return { error: 'no active scene' };
      const tree = dumpNode(scene, 0, maxDepth, !!(args && args.filterEditor));
      return tree || { error: 'no active scene' };
    },

    getNodeDetail(args) {
      const scene = cc.director.getScene();
      const uuid = args && args.uuid;
      if (!scene || !uuid) return { error: 'scene or uuid missing' };
      const node = findByUuid(scene, uuid);
      if (!node) return { error: 'node not found: ' + uuid };
      return dumpNode(node, 0, 2, false);
    },

    // 信息原语:读组件属性值(指定 props 或白名单/通用枚举)
    component_props(args) {
      const scene = cc.director.getScene();
      const node = scene && findByUuid(scene, args && args.uuid);
      if (!node) return { error: 'node not found: ' + (args && args.uuid) };
      const comp = findComponent(node, args.component);
      if (!comp) {
        return { error: 'component not found: ' + args.component, available: componentNames(node) };
      }
      const cname = comp.constructor && comp.constructor.name;
      let keys = args.props;
      if (!Array.isArray(keys) || !keys.length) {
        keys = PROP_WHITELIST[cname] || PROP_WHITELIST['cc.' + cname] || null;
      }
      let out;
      if (keys) {
        out = {};
        for (const k of keys) {
          const raw = k.startsWith('_') ? undefined : comp[k];
          const val = raw !== undefined ? raw : comp[k];
          out[k] = serializeVal(val === undefined ? comp[k] : val, 2);
        }
      } else {
        // 通用枚举:单下划线开头的自有字段
        out = serializeVal(comp, 2);
      }
      return { node: node.name, component: cname, props: out };
    },

    // ============ 操作原语 ============

    act_create_node(args) {
      const scene = cc.director.getScene();
      if (!scene) return { error: 'no active scene' };
      const parent = findParent(scene, args.parent);
      if (!parent) return { error: 'parent not found: ' + args.parent };

      const node = new cc.Node();
      node.name = args.name || 'NewNode';
      try { node.addComponent('cc.UITransform'); } catch (e) { /* 非 UI 环境无 UITransform */ }
      node.setParent(parent);
      const placement = resolvePlacement(scene, args);
      if (placement) {
        node.setWorldPosition(placement.x, placement.y, placement.z || 0);
      } else {
        node.setPosition(0, 0, 0);
      }
      if (Array.isArray(args.color)) applyProps(node, { color: args.color });
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
        created: dumpNode(node, 0, 1, false),
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
      if (p.position) {
        node.setWorldPosition(Number(p.position.x) || 0, Number(p.position.y) || 0, Number(p.position.z) || 0);
      } else if (p.anchor || p.margin || p.relative) {
        const placement = resolvePlacement(scene, { anchor: p.anchor, margin: p.margin, relative: p.relative });
        if (placement) node.setWorldPosition(placement.x, placement.y, placement.z || 0);
      }
      if (typeof p.name === 'string') node.name = p.name;
      if (typeof p.active === 'boolean') node.active = p.active;
      if (typeof p.angle === 'number') node.angle = p.angle;
      if (p.scale && typeof p.scale.x === 'number') node.setScale(p.scale.x, p.scale.y, p.scale.z === undefined ? 1 : p.scale.z);
      if (p.size) {
        const ut = node.getComponent('cc.UITransform');
        if (ut) ut.setContentSize(Number(p.size.w) || 0, Number(p.size.h) || 0);
      }
      if (Array.isArray(p.color)) applyProps(node, { color: p.color });
      return dumpNode(node, 0, 1, false);
    },

    act_add_component(args) {
      const scene = cc.director.getScene();
      const node = scene && findByUuid(scene, args && args.uuid);
      if (!node) return { error: 'node not found: ' + (args && args.uuid) };
      let comp;
      try {
        comp = node.addComponent(args.type);
      } catch (e) {
        // type 可能是自定义脚本 uuid:引擎标准做法是 getClassById 转成类再挂
        if (/^[0-9a-f]{8}-/i.test(args.type) && cc.js && cc.js.getClassById) {
          try {
            const cls = cc.js.getClassById(args.type);
            if (cls) comp = node.addComponent(cls);
          } catch (e2) { /* 落入下方统一报错 */ }
        }
      }
      if (!comp) {
        return { error: 'addComponent failed: ' + args.type + ' (class not registered? 先 refresh_assets 触发编译)' };
      }
      try {
        if (args.props) applyProps(comp, args.props);
      } catch (e) { /* 属性应用失败不回滚挂载 */ }
      return { components: componentNames(node), attached: comp.constructor.name, node: dumpNode(node, 0, 1, false) };
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

    // 操作原语:通用组件属性写入(基本类型/color 数组/字符串;资产引用走主进程 set-property 通道)
    act_set_property(args) {
      const scene = cc.director.getScene();
      const node = scene && findByUuid(scene, args && args.uuid);
      if (!node) return { error: 'node not found: ' + (args && args.uuid) };
      const comp = findComponent(node, args.component);
      if (!comp) return { error: 'component not found: ' + args.component, available: componentNames(node) };
      try {
        applyProps(comp, { [args.prop]: args.value });
      } catch (e) {
        return { error: 'set failed: ' + String((e && e.message) || e) };
      }
      return { prop: args.prop, newValue: serializeVal(comp[args.prop], 2) };
    },
  },
};
