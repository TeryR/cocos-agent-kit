# AGENTS.md — 你(AI Agent)拿到了这个仓库,从这里开始

cocos-agent-kit 是给 Agent 用的 Cocos Creator 感知×操作层(MCP)。你的用户把仓库给了你,接下来的正确动作按顺序:

## 0. 铁律,现在就读(违反=事故)

**编辑器进程归用户管:永不启动、永不关闭、永不重启 Cocos Creator**——包括 MCP 端口 7420 连不上、编辑器卡死或崩溃的场景(报告用户并等待处置)。只允许终止你自己启动的进程,且凭启动时记录的 PID。

## 1. 安装(如果还没装)

1. 把本仓库 `extension/` 的内容拷到目标 Cocos 项目:`<project>/extensions/cocos-agent-kit/`
2. 用户在编辑器里打开项目,Extension Manager 启用 cocos-agent-kit
3. 给你的客户端配 MCP(Streamable HTTP):`http://127.0.0.1:7420/mcp`
4. 验活:`curl -s http://127.0.0.1:7420/health` → `{"ok":true,...}`

## 2. 操作手册(干活前必读)

**`skills/cocos-agent-kit/SKILL.md`** —— 铁律、空间坐标、工具速查、配方、血泪坑位。两种用法:
- 直接读进上下文;或
- 拷到你的 skills 目录(如 `~/.agents/skills/cocos-agent-kit/`)成为可调技能

就算不读它,MCP initialize 握手会给你服务级纪律,`scene_summary` 每次返回环境事实(conventions:坐标系/尺寸真值等)。

## 3. 验收纪律(简版)

- 改完必须 `save_scene`;文件级改动必须 `refresh_assets`
- 验收阶梯:结构检查 ≠ 能玩;判定类功能必须走真实管线测(API 直改结果不算)
- 项目本身的质量门:`python experiments/doc_contract_test.py --require-editor`(编辑器在线时全绿才算健康)

## 4. 改知识/规则(贡献者)

单一源是 `knowledge/knowledge.json`;改完跑 `node tools/build-knowledge.js` 同步所有载体(SKILL.md 段落 / conventions / MCP instructions),`--check` 验证零漂移。
