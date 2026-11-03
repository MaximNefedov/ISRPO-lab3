'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { Game } = require('../src/game');
function host() {
  const commands = new Map(), intervals = [], timeouts = new Map(), panels = [], saved = [];
  let focusHandler, configHandler, time = 0, clockId = 0;
  const settings = { enabled: true };
  const disposable = () => ({ dispose() {} });
  const status = { ...disposable(), show() {} };
  const context = { subscriptions: [], extensionUri: '/extension', globalState: {
    get: () => ({ score: 50, best: 50 }), update: async (key, value) => saved.push(value)
  } };
  const vscode = {
    StatusBarAlignment: { Right: 1 }, ViewColumn: { Beside: 2 }, ConfigurationTarget: { Global: 1, Workspace: 2 },
    Uri: { joinPath: (...parts) => parts.join('/') },
    commands: { registerCommand: (id, fn) => { commands.set(id, fn); return disposable(); }, executeCommand: id => commands.get(id)() },
    workspace: {
      getConfiguration: () => ({ get: key => settings[key], inspect: () => ({}), update: async (key, value) => { settings[key] = value; configHandler({ affectsConfiguration: () => true }); } }),
      onDidChangeConfiguration: fn => { configHandler = fn; return disposable(); }
    },
    window: {
      state: { focused: true }, createOutputChannel: () => ({ ...disposable(), appendLine() {} }),
      createStatusBarItem: () => status,
      showInformationMessage: async () => undefined, showWarningMessage: async () => 'Сбросить',
      onDidChangeWindowState: fn => { focusHandler = fn; return disposable(); },
      createWebviewPanel: () => {
        let receive, dispose;
        const panel = {
          disposed: false, messages: [],
          webview: { cspSource: 'https://resources.test', asWebviewUri: uri => uri,
            onDidReceiveMessage: fn => { receive = fn; }, postMessage: async message => { panel.messages.push(structuredClone(message)); return true; } },
          onDidDispose: fn => { dispose = fn; },
          dispose() { if (!panel.disposed) { panel.disposed = true; dispose?.(); } },
          send(message) { receive(message); }
        };
        panels.push(panel); return panel;
      }
    }
  };
  const sandbox = {
    module: { exports: {} },
    require: name => name === 'vscode' ? vscode : name === './game' ? { Game: class extends Game {
      constructor(options) { super({ ...options, now: () => time, random: () => 0 }); }
    } } : require(name),
    setInterval: (fn, delay) => { intervals.push({ fn, delay }); return intervals.length; }, clearInterval() {},
    setTimeout: (fn, delay) => { const id = ++clockId; timeouts.set(id, { fn, delay }); return id; }, clearTimeout: id => timeouts.delete(id)
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/extension.js'), 'utf8'), sandbox);
  sandbox.module.exports.activate(context);
  return {
    commands, panels, saved, status, settings, context,
    focus: focused => focusHandler({ focused }),
    advance: ms => { time += ms; intervals.find(i => i.delay === 50).fn(); },
    timeout: delay => { for (const [id, t] of timeouts) if (t.delay === delay) { timeouts.delete(id); t.fn(); } },
    shutdown: () => sandbox.module.exports.deactivate()
  };
}
test('host sends challenge after ready, persists success and ignores duplicate input', async () => {
  const h = host(); h.commands.get('codeQte.playNow')();
  const p = h.panels[0]; assert.match(p.webview.html, /Content-Security-Policy/);
  p.send({ type: 'ready' });
  const e = p.messages[0].event;
  p.send({ type: 'input', id: e.id, code: e.keys[0] });
  p.send({ type: 'input', id: e.id, code: e.keys[0] });
  assert.equal(p.messages.filter(m => m.type === 'result').length, 1);
  await h.shutdown(); assert.equal(h.saved.at(-1).score, 70);
  h.timeout(1600); assert.equal(p.disposed, true);
});
test('host closes on focus loss, saves away time and starts no background events', async () => {
  const h = host(); h.commands.get('codeQte.playNow')(); const p = h.panels[0];
  p.send({ type: 'ready' }); h.focus(false); assert.equal(p.disposed, true);
  h.advance(200000); assert.equal(h.panels.length, 1);
  h.focus(true); await h.shutdown();
  assert.equal(h.saved.at(-1).score, 50); assert.equal(h.saved.at(-1).awayMs, 200000);
  assert.equal(h.saved.at(-1).failures, 0);
});
test('closing an active panel fails exactly once', async () => {
  const h = host(); h.commands.get('codeQte.playNow')(); const p = h.panels[0]; p.send({ type: 'ready' });
  p.dispose(); h.advance(6000); await h.shutdown();
  assert.equal(h.saved.at(-1).score, 0); assert.equal(h.saved.at(-1).failures, 1);
  h.commands.get('codeQte.playNow')();
  const next = h.panels.at(-1); next.send({ type: 'ready' }); h.timeout(1600);
  assert.equal(next.disposed, false, 'Previous result timer must not close a new challenge');
});
test('loading timeout cancels neutrally and permits a new event', async () => {
  const h = host(); h.commands.get('codeQte.playNow')(); h.timeout(10000);
  assert.equal(h.panels[0].disposed, true); h.commands.get('codeQte.playNow')();
  assert.equal(h.panels.length, 2); await h.shutdown();
  assert.equal(h.saved.at(-1).score, 50);
});
test('pause cancels without loss and explicit reset clears saved statistics', async () => {
  const h = host(); h.commands.get('codeQte.playNow')();
  await h.commands.get('codeQte.toggle')(); assert.equal(h.panels[0].disposed, true);
  h.advance(200000); h.commands.get('codeQte.playNow')(); assert.equal(h.panels.length, 1);
  await h.shutdown(); assert.equal(h.saved.at(-1).score, 50);
  await h.commands.get('codeQte.reset')(); assert.equal(h.saved.at(-1).best, 0);
});
test('late webview messages and timeout cannot award a score', async () => {
  const h = host(); h.commands.get('codeQte.playNow')(); const p = h.panels[0]; p.send({ type: 'ready' });
  const e = p.messages[0].event; h.advance(5000);
  p.send({ type: 'input', id: e.id, code: e.keys[0] }); await h.shutdown();
  assert.equal(h.saved.at(-1).failures, 1); assert.equal(h.saved.at(-1).score, 0);
});
