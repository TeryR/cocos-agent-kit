#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""文档契约测试:文档/载体声称的东西,必须与现实一致。

四类失效的对应哨兵(见 docs/roadmap.md 知识失效分类学):
  T1 缺位  : 关键纪律必须存在于 skill(编辑器进程铁律——曾因缺位导致另一会话重启编辑器)
  T2 过时  : 编译器 --check(单一源与载体零漂移)
  T3 一致  : skill 提到的工具名 ⊆ 实际 tools/list;conventions 键 ⊇ 单一源声明
  T4 装载  : MCP initialize 必须携带非空 instructions

用法:
  python experiments/doc_contract_test.py                 # 编辑器不在时编辑器相关项 SKIP
  python experiments/doc_contract_test.py --require-editor  # 编辑器必须在线(发布前)
退出码:任一 FAIL(或 --require-editor 下 SKIP)→ 1
"""

import json
import os
import re
import subprocess
import sys
import urllib.request

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))
MCP = 'http://127.0.0.1:7420/mcp'

results = []  # (name, PASS/FAIL/SKIP, detail)


def rec(name, ok, detail=''):
    results.append((name, ok, detail))


def mcp_call(method, params=None, msg_id=1):
    body = {'jsonrpc': '2.0', 'id': msg_id, 'method': method}
    if params is not None:
        body['params'] = params
    req = urllib.request.Request(MCP, data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())


def editor_up():
    try:
        mcp_call('tools/list')
        return True
    except Exception:
        return False


# ---------- T1 缺位哨兵 ----------
def t1_skill_process_rule():
    p = os.path.join(ROOT, 'skills', 'cocos-agent-kit', 'SKILL.md')
    s = open(p, encoding='utf-8').read()
    ok = ('编辑器进程归用户管' in s and '永不启动' in s and '永不重启' in s and 'PID' in s)
    rec('T1 编辑器进程铁律在 skill 且为第一条', ok and s.index('编辑器进程归用户管') < s.index('动手前先感知'),
        '铁律#1 必须是进程规则(2026-09-06 缺位事故的回归测试)')


# ---------- T2 过时哨兵 ----------
def t2_compiler_check():
    r = subprocess.run(['node', os.path.join(ROOT, 'tools', 'build-knowledge.js'), '--check'],
                       capture_output=True, text=True, timeout=60)
    rec('T2 单一源与载体零漂移(node build --check)', r.returncode == 0,
        (r.stdout + r.stderr).strip().splitlines()[-1] if (r.stdout + r.stderr).strip() else '')


# ---------- T3 一致性哨兵 ----------
def t3_tool_names():
    skill = open(os.path.join(ROOT, 'skills', 'cocos-agent-kit', 'SKILL.md'), encoding='utf-8').read()
    # 工具速查表里的 `name` 反引号引用
    mentioned = set(re.findall(r'`([a-z_]{3,30})`', skill)) - {'cc'}
    if not editor_up():
        rec('T3 skill 工具名 ⊆ tools/list', None, '编辑器不在线,SKIP')
        return
    tools = {t['name'] for t in mcp_call('tools/list')['result']['tools']}
    unknown = sorted(m for m in mentioned if m not in tools)
    rec('T3 skill 工具名 ⊆ tools/list', not unknown,
        ('文档提到但不存在的工具: ' + ', '.join(unknown)) if unknown else 'skill 提及 %d 个工具全部真实存在' % len(mentioned))


def t3_conventions_keys():
    kb = json.load(open(os.path.join(ROOT, 'knowledge', 'knowledge.json'), encoding='utf-8'))
    want = {e['key'] for e in kb['entries'] if 'convention' in e.get('layers', [])}
    if not editor_up():
        rec('T3 conventions 键 ⊇ 单一源声明', None, '编辑器不在线,SKIP')
        return
    r = mcp_call('tools/call', {'name': 'scene_summary', 'arguments': {}})
    text = r['result']['content'][0]['text']
    conv = json.loads(text).get('conventions') or {}
    missing = sorted(want - set(conv.keys()))
    rec('T3 conventions 键 ⊇ 单一源声明', not missing,
        ('运行时缺失: ' + ', '.join(missing)) if missing else '运行时返回全部 %d 条约定' % len(want))


# ---------- T4 装载哨兵 ----------
def t4_instructions():
    if not editor_up():
        rec('T4 initialize 携带非空 instructions', None, '编辑器不在线,SKIP')
        return
    r = mcp_call('initialize', {'protocolVersion': '2025-06-18'})
    instr = r.get('result', {}).get('instructions', '')
    rec('T4 initialize 携带非空 instructions', bool(instr),
        ('%d 字符,首行: %s' % (len(instr), instr.splitlines()[0][:60])) if instr else 'instructions 为空')


def main():
    require_editor = '--require-editor' in sys.argv
    t1_skill_process_rule()
    t2_compiler_check()
    t3_tool_names()
    t3_conventions_keys()
    t4_instructions()

    fails = skips = 0
    print('== 文档契约测试 ==')
    for name, ok, detail in results:
        if ok is None:
            skips += 1
            tag = 'SKIP'
        elif ok:
            tag = 'PASS'
        else:
            fails += 1
            tag = 'FAIL'
        print('  [%s] %s%s' % (tag, name, ('  | ' + detail) if detail else ''))
    verdict = 'FAIL' if fails or (require_editor and skips) else 'PASS'
    print('== 结果: %s(fail=%d skip=%d)==' % (verdict, fails, skips))
    sys.exit(0 if verdict == 'PASS' else 1)


if __name__ == '__main__':
    main()
