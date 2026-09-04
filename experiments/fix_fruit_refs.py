#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""修复 cutfruit 水果 prefab 的断裂贴图引用(上游项目自带 bug)。
策略:对每个 prefab,按断裂 Sprite 所在节点名推断目标贴图:
  fruit -> <fruit>.png;splitLeftFruit -> <fruit>-1.png;splitRightFruit -> <fruit>-2.png
  watermelon 特例:贴图名是 sandia*;bomb -> boom.png
uuid 换算:png.meta 的 subMetas 里 importer=sprite-frame 的子资产 uuid(带 @sid)。
"""
import json
import os

ROOT = r'T:/cocoscreator/Projects/cutfruit/assets/Res'
PREFABS = ['apple', 'banana', 'peach', 'strawberry', 'watermelon', 'bomb']
# prefab 名 -> 贴图关键词(前缀);strawberry 的贴图在上游被命名为 basaha*
TEX_OF = {
    'apple': 'apple', 'banana': 'banana', 'peach': 'peach',
    'strawberry': 'basaha', 'watermelon': 'sandia', 'bomb': 'boom',
}


def sprite_frame_uuid(png_path):
    """取 png 的 spriteFrame 子资产 uuid(含 @sid)"""
    m = json.load(open(png_path + '.meta', encoding='utf-8'))
    for sid, sub in (m.get('subMetas') or {}).items():
        if sub.get('importer') == 'sprite-frame':
            return sub.get('uuid')
    # 兜底:返回任意子资产
    for sid, sub in (m.get('subMetas') or {}).items():
        return sub.get('uuid')
    return None


def build_uuid_index():
    """全项目 png 主 uuid -> 文件路径(判断引用是否断裂)"""
    idx = {}
    for root, dirs, files in os.walk(r'T:/cocoscreator/Projects/cutfruit/assets'):
        for f in files:
            if f.endswith('.png.meta'):
                p = os.path.join(root, f)
                try:
                    idx[json.load(open(p, encoding='utf-8')).get('uuid')] = p[:-5]
                except Exception:
                    pass
    return idx


def node_names(prefab):
    names = {}
    for i, item in enumerate(prefab):
        if isinstance(item, dict) and item.get('__type__') == 'cc.Node':
            names[i] = item.get('_name', '')
    return names


def fix_prefab(fruit):
    path = os.path.join(ROOT, 'Prefabs', fruit + '.prefab')
    prefab = json.load(open(path, encoding='utf-8'))
    names = node_names(prefab)
    tex = TEX_OF[fruit]
    fixes = []
    for i, item in enumerate(prefab):
        if not (isinstance(item, dict) and item.get('__type__') == 'cc.Sprite'):
            continue
        sf = item.get('_spriteFrame') or {}
        ref = sf.get('__uuid__') or ''
        main_uuid = ref.split('@')[0]
        if main_uuid and main_uuid in UUID_INDEX:
            continue  # 引用有效
        node_name = names.get((item.get('node') or {}).get('__id__'), '').lower()
        # 节点名 -> 目标贴图
        if node_name.startswith('splitleft'):
            target = tex + '-1.png'
        elif node_name.startswith('splitright'):
            target = tex + '-2.png'
        elif 'shadow' in node_name:
            target = 'shadow.png'
        else:
            target = tex + '.png'
        png = os.path.join(ROOT, 'picture', 'fruit', target)
        if not os.path.exists(png):
            png = os.path.join(ROOT, 'picture', target)
        if not os.path.exists(png):
            fixes.append({'node': node_name, 'error': 'target png missing: ' + target})
            continue
        new_uuid = sprite_frame_uuid(png)
        if not new_uuid:
            fixes.append({'node': node_name, 'error': 'no spriteFrame subAsset in ' + target})
            continue
        old = ref
        item['_spriteFrame']['__uuid__'] = new_uuid
        fixes.append({'node': node_name, 'old': old[:13] + '...', 'new': new_uuid[:13] + '... -> ' + target})
    json.dump(prefab, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    return fixes


UUID_INDEX = build_uuid_index()
print('资产索引:', len(UUID_INDEX), '张 png')
print()
total = 0
for fruit in PREFABS:
    fixes = fix_prefab(fruit)
    broken = sum(1 for f in fixes if 'error' in f)
    ok = sum(1 for f in fixes if 'error' not in f and f.get('old'))
    print('== ' + fruit + '.prefab ==')
    for f in fixes:
        total += 1
        if 'error' in f:
            print('   ERROR', f['node'], '->', f['error'])
        elif f.get('old'):
            print('   FIXED', f['node'], ':', f['old'], '=>', f['new'])
        else:
            print('   OK   ', f['node'], '(引用本就有效)')
    print()
print('共处理引用:', total, '(FIXED 即断裂已修复)')
