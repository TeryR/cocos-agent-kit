'use strict';

// cocos-sense 扩展主进程入口。
// 职责只有两个:启动/停止只读 MCP server;把工具调用转发给场景进程或编辑器模块。
// 不提供任何写操作 —— 见 docs/design.md ADR-1。

const { McpHttpServer } = require('./src/mcp-server');
const { TOOLS, dispatch } = require('./src/tools');

const PORT = 7420;
let server = null;

exports.load = function () {
  server = new McpHttpServer({
    port: PORT,
    serverInfo: { name: 'cocos-sense', version: '0.1.0' },
    listTools: () => TOOLS,
    callTool: dispatch,
  });
  server
    .start()
    .then(() => {
      console.log(`[cocos-sense] perception MCP ready: http://127.0.0.1:${PORT}/mcp`);
    })
    .catch((err) => {
      console.error('[cocos-sense] MCP server failed to start:', err);
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
