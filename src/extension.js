'use strict';
const vscode = require('vscode');
const { randomBytes } = require('node:crypto');
const { Game } = require('./game');

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)} ч ${Math.floor(s / 60) % 60} мин ${s % 60} с`;
}

function activate(context) {
  const readSettings = () => {
    const c = vscode.workspace.getConfiguration('codeQte');
    return Object.fromEntries(['enabled', 'minIntervalSeconds', 'maxIntervalSeconds', 'reactionSeconds'].map(k => [k, c.get(k)]));
  };
  const game = new Game({ saved: context.globalState.get('stats'), focused: vscode.window.state.focused, settings: readSettings() });
  let panel;
  let loadingTimer;
  let resultTimer;
  let writes = Promise.resolve();
  const output = vscode.window.createOutputChannel('Code QTE');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 80);
  status.command = 'codeQte.stats';
  function updateStatus() {
    status.text = `$(${game.settings.enabled ? 'zap' : 'debug-pause'}) QTE ${game.stats.score}  ·  $(clock) ${formatTime(game.stats.awayMs)}`;
    status.tooltip = `Рекорд: ${game.stats.best}\nВне фокуса: ${formatTime(game.stats.awayMs)}\n${game.focused ? 'Редактор в фокусе' : 'Задания приостановлены: редактор не в фокусе'}\nНажмите для просмотра статистики`;
    status.show();
  }
  function save() {
    game.accountTime();
    const snapshot = { ...game.stats };
    writes = writes.then(() => context.globalState.update('stats', snapshot)).catch(error => output.appendLine(`Ошибка сохранения: ${error.message}`));
    return writes;
  }
  function closePanel() {
    clearTimeout(loadingTimer);
    clearTimeout(resultTimer);
    const old = panel;
    panel = undefined;
    old?.dispose();
  }
  function cancel() {
    game.cancel();
    closePanel();
    updateStatus();
  }
  function result(value) {
    if (!value) return;
    if ('progress' in value) {
      panel?.webview.postMessage({ type: 'progress', progress: value.progress });
      return;
    }
    clearTimeout(loadingTimer);
    updateStatus();
    void save();
    panel?.webview.postMessage({ type: 'result', ...value, score: game.stats.score, best: game.stats.best });
    resultTimer = setTimeout(closePanel, 1600);
  }
  function play() {
    if (panel) return;
    const event = game.begin();
    if (!event) return;
    const current = vscode.window.createWebviewPanel('codeQte.event', '⚡ Code QTE', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false }, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
    });
    panel = current;
    const nonce = randomBytes(18).toString('hex');
    const script = current.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'event.js'));
    const css = current.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'event.css'));
    current.webview.html = `<!doctype html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${current.webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${css}"><title>Code QTE</title></head><body>
      <main><header><span class="brand">CODE QTE</span><span id="badge">РЕАКЦИЯ</span></header>
      <p class="eyebrow">ПЕРЕРЫВ НА РЕАКЦИЮ</p><h1 id="title">Приготовьтесь</h1><p id="hint">Загрузка задания…</p>
      <div id="keys" aria-label="Клавиши задания"></div>
      <div id="track" hidden><div id="target"></div><div id="cursor"></div></div>
      <div class="time"><span>Осталось</span><strong id="time">—</strong></div><progress id="countdown" max="1" value="1" aria-label="Оставшееся время"></progress>
      <p id="feedback" role="status" aria-live="polite"></p><footer>Esc — пропустить со сбросом очков<br>Потеря фокуса окна отменяет задание без штрафа</footer></main>
      <script nonce="${nonce}" src="${script}"></script></body></html>`;
    current.webview.onDidReceiveMessage(message => {
      if (panel !== current || !message || typeof message !== 'object') return;
      if (message.type === 'ready' && game.ready(event.id)) {
        clearTimeout(loadingTimer);
        void current.webview.postMessage({ type: 'start', event });
      } else if (message.type === 'input' && message.id === event.id && typeof message.code === 'string') {
        result(game.input(event.id, message.code));
      }
    });
    current.onDidDispose(() => {
      if (panel !== current) return;
      panel = undefined;
      clearTimeout(loadingTimer);
      clearTimeout(resultTimer);
      if (game.active) {
        if (game.focused && game.active.startedAt !== null) result(game.finish(false));
        else game.cancel();
      }
    });
    // Loading failures never consume the score or leave the scheduler stuck.
    loadingTimer = setTimeout(() => { if (panel === current && game.active?.startedAt === null) cancel(); }, 10000);
  }
  context.subscriptions.push(status, output,
    vscode.commands.registerCommand('codeQte.toggle', async () => {
      await vscode.workspace.getConfiguration('codeQte').update('enabled', !game.settings.enabled, vscode.ConfigurationTarget.Global);
    }),
    vscode.commands.registerCommand('codeQte.playNow', () => {
      if (!game.settings.enabled) void vscode.window.showInformationMessage('Code QTE приостановлен. Включите его командой «Code QTE: Включить / приостановить».');
      else play();
    }),
    vscode.commands.registerCommand('codeQte.stats', async () => {
      game.accountTime();
      const s = game.stats;
      const choice = await vscode.window.showInformationMessage(`Code QTE · Очки: ${s.score} · Рекорд: ${s.best} · Успехи: ${s.successes} · Ошибки: ${s.failures} · Вне фокуса: ${formatTime(s.awayMs)}`, 'Задание сейчас', game.settings.enabled ? 'Пауза' : 'Включить');
      if (choice === 'Задание сейчас') void vscode.commands.executeCommand('codeQte.playNow');
      else if (choice) void vscode.commands.executeCommand('codeQte.toggle');
    }),
    vscode.commands.registerCommand('codeQte.reset', async () => {
      const answer = await vscode.window.showWarningMessage('Сбросить очки, рекорд, счетчики и время вне фокуса?', { modal: true }, 'Сбросить');
      if (answer === 'Сбросить') { game.reset(); closePanel(); updateStatus(); await save(); }
    }),
    vscode.window.onDidChangeWindowState(state => {
      game.setFocus(state.focused);
      if (!state.focused) closePanel();
      updateStatus();
      void save();
    }),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('codeQte')) { game.configure(readSettings()); closePanel(); updateStatus(); }
    })
  );
  const ticker = setInterval(() => {
    result(game.tick());
    if (game.isDue()) play();
  }, 50);
  const refresh = setInterval(updateStatus, 1000);
  const autosave = setInterval(() => void save(), 15000);
  context.subscriptions.push({ dispose() {
    clearInterval(ticker); clearInterval(refresh); clearInterval(autosave);
    game.cancel(); closePanel();
  } });
  shutdown = save;
  updateStatus();
}
let shutdown;
function deactivate() { return shutdown?.(); }
module.exports = { activate, deactivate };
