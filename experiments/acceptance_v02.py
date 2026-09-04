#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v0.2 验收脚本:沿地图对角线自动创建 5 个金币,并回读自检。
用法:python acceptance_v02.py
前置:cocos-agent-kit 扩展已加载,7420 端口可用,场景已打开。
"""
import json
import urllib.request

MCP = 'http://127.0.0.1:7420/mcp'


def call(tool, args):
    payload = json.dumps({
        'jsonrpc': '2.0', 'id': 1,
        'method': 'tools/call',
        'params': {'name': tool, 'arguments': args},
    }).encode('utf-8')
    req = urllib.request.Request(MCP, data=payload,
                                 headers={'Content-Type': 'application/json'})
    d = json.load(urllib.request.urlopen(req, timeout=15))
    return json.loads(d['result']['content'][0]['text'])


def main():
    # 1. 定位 Canvas
    tree = call('scene_tree', {'maxDepth': 2})
    canvas = next((c for c in tree.get('children', []) if c['name'] == 'Canvas'), None)
    if not canvas:
        print('FAIL: 未找到 Canvas 节点')
        return
    print('Canvas:', canvas['uuid'], ' contentSize:', canvas.get('contentSize'))

    # 2. 沿对角线创建 5 个金币(世界坐标等距)
    pts = [(100, 80), (290, 200), (480, 320), (670, 440), (860, 560)]
    expected = []
    for i, (x, y) in enumerate(pts):
        name = 'Coin_' + str(i + 1)
        r = call('act_create_node', {
            'name': name,
            'parent': canvas['uuid'],
            'position': {'x': x, 'y': y, 'z': 0},
            'color': [255, 200, 0],
            'components': [{'type': 'cc.Label',
                            'props': {'string': '¥', 'fontSize': 30}}],
        })
        if 'error' in r:
            print('FAIL create', name, '->', r['error'])
            return
        created = r.get('created', {})
        pos = created.get('worldPosition', {})
        print('created ' + name + ' uuid=' + str(created.get('uuid'))[:8]
              + ' pos=(' + str(pos.get('x')) + ',' + str(pos.get('y'))
              + ') comps=' + str(created.get('components')))
        expected.append((name, x, y))

    # 3. 回读自检:重读场景树,核对数量与坐标
    tree2 = call('scene_tree', {'maxDepth': 3})
    coins = []

    def walk(n):
        if n['name'].startswith('Coin_'):
            wp = n.get('worldPosition') or {}
            coins.append((n['name'], wp.get('x'), wp.get('y')))
        for c in n.get('children', []) or []:
            walk(c)

    walk(tree2)
    print()
    print('== 回读自检 ==')
    print('场景中 Coin_ 节点:', len(coins), '个(期望 5)')
    all_pass = len(coins) == 5
    for name, ex, ey in expected:
        hit = next(((n, x, y) for n, x, y in coins if n == name), None)
        if hit is None:
            print('  FAIL', name, '不存在')
            all_pass = False
            continue
        _, x, y = hit
        ok = abs(x - ex) < 0.01 and abs(y - ey) < 0.01
        print('  ' + ('PASS' if ok else 'FAIL') + ' ' + name
              + ' @ (' + str(x) + ',' + str(y) + ') 期望 (' + str(ex) + ',' + str(ey) + ')')
        if not ok:
            all_pass = False
    print()
    print('===> 验收结果:', 'PASS' if all_pass else 'FAIL')


if __name__ == '__main__':
    main()
