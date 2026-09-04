'use strict';

// 文件级信息原语(主进程,Node fs 直读):
//   inspect_asset —— 读 prefab/scene/anim 等 JSON 资产的节点树、组件属性摘录、全部 __uuid__ 引用
//   scene_list    —— 项目场景清单(内部名/uuid/url)
//   console_logs  —— 编辑器日志尾部(错误/警告过滤)
//   preview_info  —— 预览服务地址与触发尝试
// 设计:这些都是"事实查询"原语;诊断推理由 Agent 基于返回数据自行完成。

const fs = require('fs');
const path = require('path');

function projectRoot() {
  // 校准记录:Editor.App.path 是编辑器安装目录,项目目录要用 Editor.Project.path
  if (Editor.Project && Editor.Project.path) return Editor.Project.path;
  return Editor.App.path;
}

function dbToPath(url) {
  if (typeof url !== 'string' || !url.startsWith('db://assets/')) return null;
  const rel = url.slice('db://assets/'.length);
  // 安全:规范化后必须仍位于 assets/ 内,拒绝 ../ 路径穿越
  const assetsRoot = path.normalize(path.join(projectRoot(), 'assets'));
  const full = path.normalize(path.join(assetsRoot, rel));
  if (full !== assetsRoot && !full.startsWith(assetsRoot + path.sep)) return null;
  return full;
}

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function walkFiles(dir, exts, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'temp' || e.name === 'library') continue;
      walkFiles(full, exts, out);
    } else if (exts.some((ext) => e.name.endsWith(ext))) {
      out.push(full);
    }
  }
}

// 深度收集对象图中全部 __uuid__ 引用
function collectRefs(obj, out) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    for (const v of obj) collectRefs(v, out);
    return;
  }
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === 'object') {
      if (typeof v.__uuid__ === 'string') {
        out[v.__uuid__] = (out[v.__uuid__] || 0) + 1;
      } else {
        collectRefs(v, out);
      }
    }
  }
}

// 浅摘录组件的关键属性(基本类型/Color/Vec/uuid,过滤大数组与函数)
function summarizeComponent(item) {
  const brief = { __type__: item.__type__ };
  for (const k of Object.keys(item)) {
    if (k === '__type__' || k === 'node' || k === '_id') continue;
    const v = item[k];
    const t = typeof v;
    if (t === 'number' || t === 'boolean' || t === 'string') {
      brief[k] = t === 'string' && v.length > 80 ? v.slice(0, 80) + '…' : v;
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (typeof v.__uuid__ === 'string') brief[k] = { __uuid__: v.__uuid__ };
      else if (typeof v.x === 'number' || typeof v.width === 'number' || typeof v.r === 'number') {
        brief[k] = JSON.stringify(v).slice(0, 120);
      }
    }
  }
  return brief;
}

function buildMetaIndex() {
  const index = {};
  const metas = [];
  walkFiles(path.join(projectRoot(), 'assets'), ['.meta'], metas);
  for (const p of metas) {
    try {
      const m = readJSON(p);
      if (m.uuid) index[m.uuid] = p.replace(/\\/g, '/').split('/assets/')[1];
    } catch (e) { /* 个别 meta 损坏跳过 */ }
  }
  return index;
}

// 自定义脚本 uuid → @ccclass 类名(场景进程按类名注册/查找组件)
function ccclassOf(scriptUuid) {
  const assets = path.join(projectRoot(), 'assets');
  const metas = [];
  walkFiles(assets, ['.ts.meta'], metas);
  for (const metaPath of metas) {
    try {
      if (readJSON(metaPath).uuid !== scriptUuid) continue;
      const src = fs.readFileSync(metaPath.slice(0, -5), 'utf-8');
      const m = src.match(/@ccclass\(\s*['"]([^'"]+)['"]/);
      return m ? m[1] : null;
    } catch (e) { /* 读不了的跳过 */ }
  }
  return null;
}

module.exports = {
  dbToPath,
  projectRoot,
  ccclassOf,

  // 信息原语:读 JSON 资产(prefab/scene/anim)结构 + 引用清单
  inspectAsset(args) {
    const url = args && args.url;
    if (!url) return { error: 'url is required, e.g. db://assets/Res/Prefabs/apple.prefab' };
    const p = dbToPath(url);
    if (!p || !fs.existsSync(p)) return { error: 'asset file not found: ' + url };

    let json;
    try {
      json = readJSON(p);
    } catch (e) {
      return { error: 'not a JSON-serializable asset: ' + String((e && e.message) || e) };
    }

    const nodes = [];
    const components = [];
    const refs = {};
    for (let i = 0; i < json.length; i++) {
      const item = json[i];
      if (!item || typeof item !== 'object') continue;
      if (item.__type__ === 'cc.Node') {
        nodes.push({
          id: i,
          name: item._name || '',
          components: (item._components || []).map((c) => c.__id__),
          children: (item._children || []).map((c) => c.__id__),
        });
      } else if (item.__type__ && item.__type__.startsWith('cc.')) {
        components.push({ id: i, node: (item.node || {}).__id__, ...summarizeComponent(item) });
      }
      collectRefs(item, refs);
    }

    const result = {
      url,
      nodeCount: nodes.length,
      componentCount: components.length,
      nodes,
      components,
      references: Object.keys(refs).map((u) => ({ uuid: u, times: refs[u] })),
    };

    if (args && args.resolve) {
      const index = buildMetaIndex();
      for (const r of result.references) {
        const main = r.uuid.split('@')[0];
        r.assetPath = index[main] ? 'db://assets/' + index[main] : '(不在项目 assets 中:内置/外部/断裂)';
        r.broken = !index[main];
      }
      result.brokenCount = result.references.filter((r) => r.broken).length;
    }
    return result;
  },

  // 信息原语:场景清单
  sceneList() {
    const dir = path.join(projectRoot(), 'assets');
    const files = [];
    walkFiles(dir, ['.scene'], files);
    const scenes = [];
    for (const f of files) {
      const metaP = f + '.meta';
      let uuid = null;
      let name = null;
      try {
        uuid = readJSON(metaP).uuid;
        const scene = readJSON(f);
        const assetEntry = scene.find((it) => it && it.__type__ === 'cc.SceneAsset');
        name = (assetEntry && assetEntry._name) || path.basename(f, '.scene');
      } catch (e) {
        name = path.basename(f, '.scene');
      }
      scenes.push({ name, uuid, url: 'db://assets/' + f.replace(/\\/g, '/').split('/assets/')[1] });
    }
    return { count: scenes.length, scenes };
  },

  // 信息原语:编辑器日志尾部(含场景进程异常与运行时错误)
  consoleLogs(args) {
    const p = path.join(projectRoot(), 'temp', 'logs', 'project.log');
    if (!fs.existsSync(p)) return { error: 'log file not found: ' + p };
    const limit = Math.min(Number(args && args.lines) || 100, 1000);
    const level = args && args.level;
    const stat = fs.statSync(p);
    const readSize = Math.min(stat.size, 512 * 1024);
    const buf = Buffer.alloc(readSize);
    const fd = fs.openSync(p, 'r');
    fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
    fs.closeSync(fd);
    let lines = buf.toString('utf-8').split('\n');
    if (level === 'error') lines = lines.filter((l) => /error|exception|failed/i.test(l));
    else if (level === 'warn') lines = lines.filter((l) => /warn/i.test(l));
    return {
      file: p,
      returned: lines.filter(Boolean).slice(-limit),
      hint: '编译错误/运行时异常会出现在 [Scene] 条目;改代码后先 refresh_assets 再看新日志',
    };
  },

  // 操作原语:预览服务信息(触发浏览器打开交给用户/Agent 的浏览器通道)
  previewInfo() {
    return {
      url: 'http://localhost:7456',
      note: '预览服务由编辑器托管;编辑器未启动预览时该地址可能未监听。触发预览按钮或首次访问即可启动。',
    };
  },
};
