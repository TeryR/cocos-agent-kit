#!/usr/bin/env node
'use strict';

// 知识编译器(零依赖):knowledge/knowledge.json 是唯一真值,派生三个载体:
//   SKILL.md 铁律/坑位段、scene.js conventions 块、MCP initialize instructions。
// 用法:node tools/build-knowledge.js [--check]

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'knowledge', 'knowledge.json');
const SKILL = path.join(ROOT, 'skills', 'cocos-agent-kit', 'SKILL.md');
const SCENE = path.join(ROOT, 'extension', 'scene.js');
const INSTR = path.join(ROOT, 'extension', 'src', 'server-instructions.js');

const LAYERS = ['skill-iron', 'skill-pitfall', 'convention', 'instructions'];
const IRON_B = '<!-- GEN:iron:BEGIN -->', IRON_E = '<!-- GEN:iron:END -->';
const PIT_B = '<!-- GEN:pitfalls:BEGIN -->', PIT_E = '<!-- GEN:pitfalls:END -->';
const CONV_B = '      // GEN:conventions:BEGIN', CONV_E = '      // GEN:conventions:END';

function die(msg) { console.error('[build-knowledge] ' + msg); process.exit(1); }

const kb = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const entries = kb.entries || [];
if (!entries.length) die('knowledge.json 没有条目');
const seen = new Set();
for (const e of entries) {
  if (!e.id) die('条目缺 id');
  if (seen.has(e.id)) die('重复 id: ' + e.id);
  seen.add(e.id);
  if (!Array.isArray(e.layers) || !e.layers.length) die('条目缺 layers: ' + e.id);
  for (const l of e.layers) if (!LAYERS.includes(l)) die('未知 layer "' + l + '": ' + e.id);
  if (e.text === undefined && e.code === undefined) die('条目既无 text 也无 code: ' + e.id);
  if (e.layers.includes('convention') && !e.key) die('convention 条目缺 key: ' + e.id);
}
const byLayer = (l) => entries.filter((e) => e.layers.includes(l));

const iron = IRON_B + '\n'
  + byLayer('skill-iron').map((e, i) => (i + 1) + '. ' + e.text).join('\n')
  + '\n' + IRON_E;
const pitfalls = PIT_B + '\n'
  + byLayer('skill-pitfall').map((e) => '- ' + e.text).join('\n')
  + '\n' + PIT_E;
const convLines = byLayer('convention').map((e) => {
  const val = e.code !== undefined ? e.code : JSON.stringify(e.text);
  return '        ' + e.key + ': ' + val + ',';
});
const conventions = CONV_B + ' — 由 tools/build-knowledge.js 生成,勿手改;源: knowledge/knowledge.json\n'
  + '      const conventions = {\n' + convLines.join('\n') + '\n      };\n' + CONV_E;
const instructions = 'cocos-agent-kit | Cocos Creator 编辑器操作 MCP。服务级纪律:\n- '
  + byLayer('instructions').map((e) => e.text.replace(/\*\*/g, '').replace(/`/g, '')).join('\n- ');

function replaceBetween(content, begin, end, replacement) {
  const i = content.indexOf(begin);
  const j = content.indexOf(end);
  if (i < 0 || j < 0 || j < i) die('找不到标记(先恢复标记或检查生成器): ' + begin);
  if (!replacement.includes(begin) || !replacement.includes(end)) die('内部错误:生成体未含标记 ' + begin);
  return content.slice(0, i) + replacement + content.slice(j + end.length);
}

const checkOnly = process.argv.includes('--check');
let skill = fs.readFileSync(SKILL, 'utf8');
skill = replaceBetween(skill, IRON_B, IRON_E, iron);
skill = replaceBetween(skill, PIT_B, PIT_E, pitfalls);
let scene = fs.readFileSync(SCENE, 'utf8');
scene = replaceBetween(scene, CONV_B, CONV_E, conventions);
const instrFile = '// GEN-FILE: 由 tools/build-knowledge.js 生成,勿手改;源: knowledge/knowledge.json\n'
  + "'use strict';\nmodule.exports.instructions = " + JSON.stringify(instructions) + ';\n';

const outputs = [[SKILL, skill], [SCENE, scene], [INSTR, instrFile]];
let stale = 0;
for (const [p, content] of outputs) {
  const cur = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  if (cur === content) { console.log('  一致  ' + path.relative(ROOT, p)); continue; }
  if (checkOnly) { console.log('  过期  ' + path.relative(ROOT, p)); stale++; }
  else { fs.writeFileSync(p, content); console.log('  写入  ' + path.relative(ROOT, p)); }
}
if (checkOnly) {
  if (stale) die(stale + ' 个载体与 knowledge.json 不一致——运行 node tools/build-knowledge.js 后提交');
  console.log('[build-knowledge] --check 通过:所有载体与单一源一致');
} else {
  console.log('[build-knowledge] 完成:iron=' + byLayer('skill-iron').length
    + ' pitfalls=' + byLayer('skill-pitfall').length
    + ' conventions=' + byLayer('convention').length
    + ' instructions=' + byLayer('instructions').length);
}
