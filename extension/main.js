'use strict';

// cocos-agent-kit 扩展主进程入口。
// 职责只有两个:启动/停止只读 MCP server,把工具调用转发给场景进程或编辑器模块。
// 不提供任何写操作 —— 见 docs/design.md ADR-1。

const { McpHttpServer } = require('./src/mcp-server');
const { TOOLS, dispatch } = require('./src/tools');

const PORT = 7420;
let server = null;

// 进程级兜底:未捕获异常只记日志不退出 —— 7420 一旦死掉,Agent 全盲且必须重启编辑器才能恢复
process.on('uncaughtException', (err) => {
  console.error('[cocos-agent-kit] uncaughtException (server kept alive):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[cocos-agent-kit] unhandledRejection (server kept alive):', reason);
});

exports.load = function () {
  const pkg = require('./package.json');
  server = new McpHttpServer({
    port: PORT,
    serverInfo: { name: 'cocos-agent-kit', version: pkg.version },
    listTools: () => TOOLS,
    callTool: dispatch,
  });
  server
    .start()
    .then(() => {
      console.log(`[cocos-agent-kit] perception MCP ready: http://127.0.0.1:${PORT}/mcp (v${pkg.version})`);
    })
    .catch((err) => {
      console.error('[cocos-agent-kit] MCP server failed to start:', err);
    });
};

exports.unload = function () {
  if (server) {
    server.stop();
    server = null;
  }
};

exports.messages = {
  senseStatus() {
    return server && server.isRunning() ? 'running' : 'stopped';
  },
};
