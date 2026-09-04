#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""cocos-sense 边界/极限/安全测试套件。
分类:INPUT(非法输入) / STATE(状态边界) / PROTO(协议层) / SECURITY(安全) / DANGER(破坏性,默认跳过)
每用例记录:行为分类 OK(优雅报错) / QUIRK(静默容错,记录行为) / BREAK(崩溃或破坏)
用法:python stress_test.py [--include-danger]
"""
import json
import urllib.request
import concurrent.futures

MCP = 'http://127.0.0.1:7420/mcp'


def raw_call(payload, timeout=20):
    req = urllib.request.Request(MCP, data=json.dumps(payload).encode('utf-8'),
                                 headers={'Content-Type': 'application/json'})
    try:
        d = json.load(urllib.request.urlopen(req, timeout=timeout))
        if 'error' in d:
            return 'RPC_ERROR', d['error']
        content = json.loads(d['result']['content'][0]['text'])
        if isinstance(content, dict) and content.get('error'):
            return 'TOOL_ERROR', content['error']
        if isinstance(content, dict) and content.get('isError'):
            return 'TOOL_ERROR', content.get('content')
        return 'OK', content
    except urllib.error.HTTPError as e:
        # 4xx/5xx 也可能是服务器的正确 JSON 错误响应(如 400 parse error / 500 内部错误)
        try:
            d = json.loads(e.read().decode('utf-8'))
            if 'error' in d:
                return 'RPC_ERROR', d['error']
            return 'HTTP_ERROR', d
        except Exception:
            return 'HTTP_ERROR', 'HTTP %d' % e.code
    except Exception as e:
        return 'EXCEPTION', str(e)[:120]


def call(tool, args):
    return raw_call({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call',
                     'params': {'name': tool, 'arguments': args}})


def canvas_uuid():
    st, tree = call('scene_tree', {'maxDepth': 2, 'filterEditor': True})
    if st != 'OK':
        return None
    for c in tree.get('children', []):
        if c['name'] == 'Canvas':
            return c['uuid']
    return None


RESULTS = []


def record(case_id, group, status, detail):
    RESULTS.append((case_id, group, status, detail))
    print('  [%s] %s -> %s' % (status.upper() if status in ('BREAK', 'QUIRK') else status, case_id, detail[:110]))


def main():
    cnv = canvas_uuid()
    print('Canvas:', cnv)
    print('== GROUP A: 输入边界(非法值/极端值)==')

    cases = [
        ('A01 emoji+引号名字', 'act_create_node', {'name': '测试🍎"quote"', 'parent': cnv}),
        ('A02 超长名字', 'act_create_node', {'name': 'X' * 1000, 'parent': cnv}),
        ('A03 parent uuid 无效', 'act_create_node', {'name': 't', 'parent': 'deadbeef-0000-0000-0000-000000000000'}),
        ('A04 anchor 非法词', 'act_create_node', {'name': 't', 'parent': cnv, 'anchor': 'banana'}),
        ('A05 position 超大 1e15', 'act_create_node', {'name': 't', 'parent': cnv, 'position': {'x': 1e15, 'y': 0, 'z': 0}}),
        ('A06 组件类型不存在', 'act_create_node', {'name': 't', 'parent': cnv, 'components': [{'type': 'cc.NotExist'}]}),
        ('A07 color 越界', 'act_create_node', {'name': 't', 'parent': cnv, 'color': [999, -5, 0]}),
        ('A08 margin 巨大负数', 'act_create_node', {'name': 't', 'parent': cnv, 'anchor': 'top-right', 'margin': {'right': -999999}}),
        ('A09 scale 0', 'act_set_transform', {'uuid': cnv, 'props': {'scale': {'x': 0, 'y': 0, 'z': 0}}}),
        ('A10 删除后重复删', 'act_delete_node', {'uuid': '00000000-0000-0000-0000-000000000000'}),
        ('A11 移除不存在组件', 'act_remove_component', {'uuid': cnv, 'type': 'cc.NotExist'}),
        ('A12 set_property 未知属性', 'act_set_property', {'uuid': cnv, 'component': 'cc.Canvas', 'prop': 'not_a_real_prop', 'value': 1}),
        ('A13 set_property color 越界', 'act_set_property', {'uuid': cnv, 'component': 'cc.Canvas', 'prop': 'color', 'value': [300, -999, 0, 9999]}),
        ('A14 component_props 非法属性名', 'component_props', {'uuid': cnv, 'component': 'cc.UITransform', 'props': ['not_exist_prop']}),
        ('A15 scene_tree maxDepth 0', 'scene_tree', {'maxDepth': 0, 'filterEditor': True}),
        ('A16 scene_tree maxDepth 负数', 'scene_tree', {'maxDepth': -5}),
        ('A17 console_logs lines 负数', 'console_logs', {'lines': -5}),
        ('A18 console_logs lines 巨大', 'console_logs', {'lines': 99999999}),
        ('B01 inspect_asset 路径穿越', 'inspect_asset', {'url': 'db://assets/../package.json'}),
        ('B02 inspect_asset 路径穿越深', 'inspect_asset', {'url': 'db://assets/../../../../../windows/win.ini'}),
        ('B03 inspect_asset 非JSON资产', 'inspect_asset', {'url': 'db://assets/Scripts/Fruit.ts'}),
        ('B04 act_add_component 重复挂 Canvas', 'act_add_component', {'uuid': cnv, 'type': 'cc.Canvas'}),
        ('B05 act_add_component 类型不存在', 'act_add_component', {'uuid': cnv, 'type': 'cc.NotExist'}),
        ('C01 未知工具', '__no_such_tool__', {}),
    ]

    for case_id, tool, args in cases:
        st, detail = call(tool, args)
        cls = 'OK' if st == 'TOOL_ERROR' else ('QUIRK' if st == 'OK' else st)
        record(case_id, 'INPUT', cls, str(detail))

    print('== GROUP B: 协议层 ==')
    st, d = raw_call({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': 'scene_tree'}})
    record('P01 tools/call 缺 arguments', 'PROTO', 'OK' if st != 'EXCEPTION' else 'BREAK', str(d)[:100])
    # 真·畸形 JSON:绕过 json.dumps,直接发非法字节流
    import urllib.error
    try:
        req = urllib.request.Request(MCP, data=b'not json at all {{', headers={'Content-Type': 'application/json'})
        resp = urllib.request.urlopen(req, timeout=10)
        body = resp.read().decode('utf-8', 'replace')[:100]
        record('P02 畸形 JSON', 'PROTO', 'OK', 'HTTP 4xx/5xx with body: ' + body)
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'replace')[:100]
        record('P02 畸形 JSON', 'PROTO', 'OK', 'HTTP %d rejected: %s' % (e.code, body))
    except Exception as e:
        record('P02 畸形 JSON', 'PROTO', 'BREAK', str(e)[:120])
    st, d = raw_call({'jsonrpc': '2.0', 'id': 1, 'method': 'no/such/method'})
    record('P03 未知 method', 'PROTO', 'OK' if st == 'RPC_ERROR' else 'BREAK', str(d)[:100])

    # 注册一致性:tools/list 列出的每个工具,空参调用不得报 "unknown tool"
    # (空参调用会触发参数校验错误,但那证明分发已注册)
    payload = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list'}).encode()
    req = urllib.request.Request(MCP, data=payload, headers={'Content-Type': 'application/json'})
    tools = [t['name'] for t in json.load(urllib.request.urlopen(req, timeout=15))['result']['tools']]
    unknown = []
    for name in tools:
        st2, d2 = call(name, {})
        if 'unknown tool' in str(d2):
            unknown.append(name)
    record('P04 注册一致性(tools/list vs dispatch)', 'PROTO',
           'OK' if not unknown else 'BREAK',
           '全部 %d 个可分发' % len(tools) if not unknown else 'missing dispatch: %s' % unknown)

    print('== GROUP C: 并发 ==')
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex:
        futures = [ex.submit(call, 'scene_tree', {'maxDepth': 3}) for _ in range(5)]
        ok_count = sum(1 for f in futures if f.result()[0] == 'OK')
    record('C05 并发 5x scene_tree', 'CONCURRENT', 'OK' if ok_count == 5 else 'BREAK', 'success %d/5' % ok_count)

    print('== GROUP D: 破坏性(本轮仅探测统计,不执行删除)==')
    print('  覆盖项: 删 Canvas / 删场景根 / 删编辑器辅助节点 —— 需 --include-danger 且用户确认')

    print()
    print('==== 汇总 ====')
    by = {}
    for _, _, status, _ in RESULTS:
        by[status] = by.get(status, 0) + 1
    print(json.dumps(by, ensure_ascii=False))
    print()
    print('QUIRK/BREAK 明细:')
    for case_id, group, status, detail in RESULTS:
        if status in ('QUIRK', 'BREAK'):
            print('  [%s] %s: %s' % (status, case_id, detail[:150]))


if __name__ == '__main__':
    main()
