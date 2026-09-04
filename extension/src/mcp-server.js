'use strict';

// 零依赖 MCP Streamable HTTP server(只实现本扩展需要的最小子集,ADR-2):
//   POST /mcp  -> JSON-RPC(initialize / notifications / tools/list / tools/call / ping)
//   GET /health -> 存活探针
// 不做 SSE 长连接:Streamable HTTP 规范允许服务器以 application/json 直接响应,
// 单机单客户端的教学场景无需会话管理。

const http = require('http');

class McpHttpServer {
  constructor({ port, serverInfo, listTools, callTool }) {
    this.port = port;
    this.serverInfo = serverInfo;
    this.listTools = listTools;
    this.callTool = callTool;
    this._http = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      this._http = http.createServer((req, res) => {
        this._route(req, res).catch((err) => {
          this._json(res, 500, {
            jsonrpc: '2.0',
            id: null,
            error: { code: -32603, message: String((err && err.message) || err) },
          });
        });
      });
      this._http.once('error', reject);
      this._http.listen(this.port, '127.0.0.1', () => resolve());
    });
  }

  stop() {
    if (this._http) {
      this._http.close();
      this._http = null;
    }
  }

  isRunning() {
    return !!this._http;
  }

  async _route(req, res) {
    const url = req.url.split('?')[0];

    if (req.method === 'GET' && url === '/health') {
      return this._json(res, 200, { ok: true, server: this.serverInfo });
    }

    if (req.method === 'POST' && url === '/mcp') {
      const body = await this._readBody(req);
      let msg;
      try {
        msg = JSON.parse(body);
      } catch (e) {
        return this._json(res, 400, {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'parse error' },
        });
      }

      if (Array.isArray(msg)) {
        const replies = (await Promise.all(msg.map((m) => this._handle(m)))).filter(
          (r) => r !== undefined
        );
        return this._json(res, 200, replies);
      }

      const out = await this._handle(msg);
      // notification 按规范返回 202 无响应体
      return out === undefined
        ? this._empty(res, 202)
        : this._json(res, 200, out);
    }

    this._json(res, 404, { error: 'not found' });
  }

  async _handle(msg) {
    const { id, method, params } = msg || {};
    const isNotification = id === undefined || id === null;

    switch (method) {
      case 'initialize':
        if (isNotification) return undefined;
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: (params && params.protocolVersion) || '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: this.serverInfo,
          },
        };

      case 'notifications/initialized':
      case 'notifications/cancelled':
        return undefined;

      case 'ping':
        if (isNotification) return undefined;
        return { jsonrpc: '2.0', id, result: {} };

      case 'tools/list':
        if (isNotification) return undefined;
        return { jsonrpc: '2.0', id, result: { tools: this.listTools() } };

      case 'tools/call': {
        const name = params && params.name;
        const args = (params && params.arguments) || {};
        try {
          const result = await this.callTool(name, args);
          if (isNotification) return undefined;
          return { jsonrpc: '2.0', id, result };
        } catch (err) {
          if (isNotification) return undefined;
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                { type: 'text', text: 'tool error: ' + String((err && err.message) || err) },
              ],
              isError: true,
            },
          };
        }
      }

      default:
        if (isNotification) return undefined;
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: 'method not found: ' + method },
        };
    }
  }

  _readBody(req) {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (c) => {
        data += c;
      });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });
  }

  _json(res, code, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(code, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }

  _empty(res, code) {
    res.writeHead(code);
    res.end();
  }
}

module.exports = { McpHttpServer };
