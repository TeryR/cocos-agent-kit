'use strict';

// v0.6 keystone:运行时反馈原语(信息)。
// 无头 Chrome 访问预览页,返回:运行时 Console 日志 + 游戏画面截图(base64)。
// 双时间点截图 = 运动判定(t1 与 t2 的画面差异即"动没动")。
// 零依赖:child_process + Chrome 命令行(--headless=new --enable-logging=stderr --screenshot)。

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

function findChrome() {
  for (const p of CHROME_CANDIDATES) {
    try { if (fs.existsSync(p)) return p; } catch (e) { /* 跳过 */ }
  }
  return null;
}

// 单次捕获:跑 budgetMs 虚拟时间,收 console + 一张截图
// 注意:每个 budget 是一次独立 Chrome 生命周期(boot 序列会重复),游戏状态各自从零开始。
function captureOnce(chrome, url, budgetMs, shotPath) {
  return new Promise((resolve) => {
    // user-data-dir 必须是纯 ASCII 路径:含非 ASCII(如中文)时 Chrome 静默拒绝启动(实测)。
    let profileDir = path.join(os.tmpdir(), 'cocos-agent-kit-chrome-' + Date.now());
    if (/[^\x00-\x7F]/.test(profileDir)) profileDir = 'C:\\cak-chrome-profile-' + Date.now();
    const args = [
      // 不用 headless:无头模式无 WebGL,Cocos 引擎到渲染器创建即停,游戏不执行(实测)。
      // 用屏幕外可见窗口:WebGL 正常、游戏真实运行;视觉上接近无感,运行后自动退出。
      '--window-position=-32000,-32000',
      // 屏幕外窗口会被 Chrome 判定为"被遮挡",rAF 节流到 0 → 游戏循环停摆、球冻结(实测:
      // 无这些参数时 tick 心跳仍在但 gameState 恒定不变;加上后 71s 连续运行零冻结)。
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=CalculateNativeWinOcclusion',
      '--no-first-run',
      '--no-default-browser-check',
      '--user-data-dir=' + profileDir,
      '--window-size=1334,750',
      '--timeout=' + budgetMs,
      '--enable-logging=stderr',
      '--screenshot=' + shotPath,
      url,
    ];
    execFile(chrome, args, { timeout: budgetMs + 30000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      const raw = String(stderr || '');
      // Chrome stderr 里 console 行的典型形态:
      //   [INFO:console(23)] message
      //   CONSOLE(n)
      //   Uncaught TypeError: ...
      const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
      const consoleLines = [];
      for (const l of lines) {
        // 实测格式: [pid:pid:0906/001350.251:INFO:CONSOLE:16681] "message", source: url (line)
        const m = l.match(/^\[\d+:\d+:[\d/.]+:(INFO|WARNING|ERROR|SEVERE):CONSOLE:\d+\]\s?"(.*)"(?:, source:\s*(.*))?$/);
        if (m) {
          consoleLines.push((m[1] !== 'INFO' ? '[' + m[1] + '] ' : '') + m[2] + (m[3] ? '  (src: ' + m[3].split('/').pop() + ')' : ''));
          continue;
        }
        const u = l.match(/^(Uncaught\s+\w+.*)$/);
        if (u) consoleLines.push('[UNCAUGHT] ' + u[1]);
      }
      resolve({ consoleLines, rawHead: raw.slice(0, 400), ok: !err || err.code === 0 || fs.existsSync(shotPath) });
    });
  });
}

function shotBase64(shotPath) {
  try {
    const buf = fs.readFileSync(shotPath);
    fs.unlinkSync(shotPath);
    return buf.toString('base64');
  } catch (e) {
    return null;
  }
}

async function runFeedback(args) {
  const url = (args && args.url) || 'http://localhost:7456';
  const budgets = (args && Array.isArray(args.budgetsMs) && args.budgetsMs.length)
    ? args.budgetsMs.slice(0, 2)
    : [3000, 8000];

  const chrome = findChrome();
  if (!chrome) {
    return { error: 'Chrome/Edge not found in standard paths', hint: 'run_feedback 需要本机浏览器(无头模式运行预览页)' };
  }

  const shots = [];
  const allConsole = [];
  for (let i = 0; i < budgets.length; i++) {
    const shotPath = path.join(os.tmpdir(), 'cak-shot-' + Date.now() + '-' + i + '.png');
    const r = await captureOnce(chrome, url, budgets[i], shotPath);
    for (const l of r.consoleLines) allConsole.push({ t: budgets[i] + 'ms', msg: l.slice(0, 300) });
    const b64 = shotBase64(shotPath);
    if (b64) shots.push({ budgetMs: budgets[i], base64: b64 });
  }

  const errors = allConsole.filter((l) => /error|uncaught|exception|failed/i.test(l.msg));

  // 游戏状态探针:按来源分类——preview(预览页运行,真正的运行时反馈)vs editor(编辑器编辑态心跳,仅证明脚本已加载)
  const allProbes = (global.__cakProbes || []).splice(0);
  const probes = allProbes.filter((p) => p.data && p.data.origin && p.data.origin.startsWith('http'));

  return {
    url,
    probes,
    editorHeartbeats: allProbes.length - probes.length,
    chrome: path.basename(chrome),
    budgets,
    console: allConsole,
    errorCount: errors.length,
    errors,
    screenshots: shots.length,
    note: '截图按 MCP image content 返回;base64 已剥离,由 tools.js 组装;双时间点对比即运动判定',
    _shotsInternal: shots,
  };
}

module.exports = { runFeedback };
