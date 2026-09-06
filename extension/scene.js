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

// 顶层异常包裹:单方法异常只影响该次调用,绝不炸场景进程(防御性)
function safeWrap(methods) {
  const wrapped = {};
  for (const name of Object.keys(methods)) {
    const fn = methods[name];
    wrapped[name] = function (...callArgs) {
      try {
        return fn.apply(this, callArgs);
      } catch (e) {
        return { error: name + ' failed: ' + String((e && e.message) || e) };
      }
    };
  }
  return wrapped;
}

module.exports = {
  load() {},
  unload() {},

  methods: safeWrap({
    ping() {
      return { pong: true, hasScene: !!cc.director.getScene() };
    },

    // ============ 感知原语 ============

    // 确定性事实汇编:每节点一行。空间表达按维度分流——
    //   UI 节点(有 UITransform):画布九宫格+百分比(2D 语言)
    //   3D 世界节点(无 UITransform):世界坐标(3D 语言)
    // 全部为确定性换算;功能语义由 Agent 从组件与命名自行推断。
    scene_summary(args) {
      const scene = cc.director.getScene();
      if (!scene) return { error: 'no active scene' };
      const rect = canvasRectOf(scene);
      const maxDepth = Math.min(Number(args && args.maxDepth) || 8, 14);
      const stats = { nodes: 0, emptyContainers: 0, outOfCanvas: 0, inactive: 0, uiNodes: 0, world3dNodes: 0 };
      const compStats = {};
      const lines = [];

      function walk(n, indent) {
        stats.nodes++;
        const comps = componentNames(n);
        for (const c of comps) compStats[c] = (compStats[c] || 0) + 1;
        const isUI = !!spatialInfo(n).contentSize;
        if (isUI) stats.uiNodes++; else stats.world3dNodes++;
        const kids = n.children || [];
        if (kids.length === 0) stats.emptyContainers++;

        let line = '  '.repeat(indent) + '- ' + (n.name || '');
        if (isUI && rect) {
          const facts = layoutFacts(n, rect);
          if (facts) {
            if (facts.outOfCanvas) stats.outOfCanvas++;
            line += ' @' + facts.zone + ' (' + Math.round(facts.pct.x * 100) + '%,' + Math.round(facts.pct.y * 100) + '%)';
          }
        } else {
          const wp = vecToJson(n.worldPosition);
          if (wp) line += ' @world(' + wp.x + ',' + wp.y + ',' + wp.z + ')';
        }
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

      // 环境自描述:坐标系与关键约定随数据返回,Agent 零文档成本获得正确心智模型
      const conventions = {
        worldOrigin: '左下角(scene_tree 的 worldPosition)',
        childPositionOrigin: rect
          ? '画布中心(Canvas 锚点 0.5,子节点 position x∈[' + (-rect.w / 2) + ',' + (rect.w / 2) + '] y∈[' + (-rect.h / 2) + ',' + (rect.h / 2) + '])'
          : null,
        screenEventOrigin: '左下角(触摸/鼠标 getUILocation,与子节点 position 差半宽半高)',
        beforePreview: 'save_scene(预览读磁盘)后手动刷新预览页',
        visibleSprite: '需要 spriteFrame;内置单色图 uuid 7d8f9b89-4fd1-4c9f-a3ab-38ec7cded7ca@f9941 + color 染色',
        logicNode: '纯逻辑容器不要挂 Sprite(不可见即正确)',
        sizeGroundTruth: '物理/碰撞/布局判定必须用 node_detail 的 contentSize 实测值;脚本内硬编码尺寸是未验证声明,可能与实体漂移(实测案例:碰撞盒写 70×10 真身 140×20,可见顶面 33% 死区)',
      };
      return {
        scene: { name: scene.name, uuid: scene.uuid },
        uiCanvas: rect ? { width: rect.w, height: rect.h } : null,
        conventions,
        stats,
        componentStats: compStats,
        tree: lines,
        note: 'UI 节点用画布九宫格/百分比;3D 世界节点用世界坐标。全部为确定性换算;功能语义由你推断',
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
      // 先查重:unique 组件(如 Canvas)重复挂载时报错更明确
      const existing = node.getComponent(args.type);
      if (existing) {
        return { error: 'component already exists on node: ' + args.type };
      }
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
        return { error: 'addComponent failed: ' + args.type + ' (class not found / not compiled? 先 refresh_assets 触发编译)' };
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
      // 前缀 fallback:内置组件注册名带 cc. 前缀('cc.RigidBody2D'),裸名/全名都尝试
      let comp = node.getComponent(args.type) || node.getComponent('cc.' + args.type);
      if (!comp) {
        return { removed: false, note: 'component not found (already removed?): ' + args.type, components: componentNames(node) };
      }
      try {
        node.removeComponent(comp);
      } catch (e) {
        return { error: 'removeComponent failed: ' + String((e && e.message) || e) };
      }
      return { removed: true, removedType: args.type, components: componentNames(node) };
    },

    act_reparent(args) {
      const scene = cc.director.getScene();
      const node = scene && findByUuid(scene, args && args.uuid);
      if (!node) return { error: 'node not found: ' + (args && args.uuid) };
      const newParent = findParent(scene, args.parent);
      if (!newParent) return { error: 'parent not found: ' + args.parent };
      // 防循环:新父级不能是自己或自己的后代
      let p = newParent;
      while (p) {
        if (p === node) return { error: 'cannot reparent a node into its own subtree' };
        p = p.parent;
      }
      const keepWorld = args.keepWorld !== false;
      node.setParent(newParent, keepWorld);
      return {
        moved: node.name,
        newParent: { name: newParent.name, uuid: newParent.uuid },
        worldPosition: vecToJson(node.worldPosition),
        siblings: (newParent.children || []).map((c) => c.name),
      };
    },

    act_set_sibling_index(args) {
      const scene = cc.director.getScene();
      const node = scene && findByUuid(scene, args && args.uuid);
      if (!node) return { error: 'node not found: ' + (args && args.uuid) };
      const idx = Number(args.index) || 0;
      node.setSiblingIndex(idx);
      return {
        node: node.name,
        siblingIndex: node.getSiblingIndex(),
        siblings: node.parent ? node.parent.children.map((c) => c.name) : [],
      };
    },

    // 操作原语:通用组件属性写入。资产引用值({__uuid__})自动解析为场景进程中已加载的资产对象
    act_set_property(args) {
      const scene = cc.director.getScene();
      const node = scene && findByUuid(scene, args && args.uuid);
      if (!node) return { error: 'node not found: ' + (args && args.uuid) };
      const comp = findComponent(node, args.component);
      if (!comp) return { error: 'component not found: ' + args.component, available: componentNames(node) };

      let value = args.value;
      // 资产引用智能解析:{__uuid__} → 场景进程中已加载的资产实例
      if (value && typeof value === 'object' && value.__uuid__) {
        const mainUuid = value.__uuid__.split('@')[0];
        const subId = (value.__uuid__.split('@')[1] || '').trim();
        let asset = null;
        const store = cc.assetManager.assets;
        const entries = [];
        if (typeof store.forEach === 'function') {
          store.forEach((v, k) => entries.push([String(k), v]));
        } else {
          for (const k of Object.keys(store || {})) entries.push([k, store[k]]);
        }
        for (const [k, v] of entries) {
          const ku = k.split('@');
          if (ku[0] === mainUuid && (!subId || ku[1] === subId || !ku[1])) { asset = v; break; }
        }
        if (!asset) {
          return {
            error: 'asset not loaded in scene process: ' + value.__uuid__,
            scanned: entries.length,
            hint: '内置资产通常可用;项目资产需已被场景引用加载',
          };
        }
        value = asset;
      }

      // 校验:属性必须已存在于组件上,拒绝凭空创建字段
      if (comp[args.prop] === undefined && !(args.prop in comp)) {
        return { error: 'property not found on component: ' + args.prop };
      }
      try {
        applyProps(comp, { [args.prop]: value });
      } catch (e) {
        return { error: 'set failed: ' + String((e && e.message) || e) };
      }
      return { prop: args.prop, newValue: serializeVal(comp[args.prop], 2) };
    },

    // 信息原语(调试):列出场景进程中已加载的资产(用于定位内置单色图等)
    debug_assets(args) {
      const out = [];
      const filter = args && args.filter;
      const store = cc.assetManager.assets;
      const entries = [];
      if (typeof store.forEach === 'function') {
        store.forEach((v, k) => entries.push([String(k), v]));
      } else {
        for (const k of Object.keys(store || {})) entries.push([k, store[k]]);
      }
      for (const [uuid, asset] of entries) {
        const cname = asset.constructor && asset.constructor.name;
        if (filter && !uuid.includes(filter) && !String(asset.name || '').includes(filter) && cname !== filter) continue;
        out.push({ uuid, type: cname, name: asset.name || '' });
        if (out.length >= 60) { out.push({ truncated: true }); break; }
      }
      return { count: out.length, assets: out };
    },
  }),
};