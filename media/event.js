/* global acquireVsCodeApi */
'use strict';
const api = acquireVsCodeApi();
const el = id => document.getElementById(id);
let current;
let started;
let frame;
let finished = false;
function animate() {
  if (!current || finished) return;
  const elapsed = performance.now() - started;
  const remaining = Math.max(0, current.duration - elapsed);
  el('time').textContent = `${(remaining / 1000).toFixed(1)} с`;
  el('countdown').value = remaining / current.duration;
  if (current.kind === 'timing') {
    el('cursor').style.left = `${100 * ((elapsed % current.period) / current.period)}%`;
  }
  frame = requestAnimationFrame(animate);
}
window.addEventListener('message', ({ data }) => {
  if (data.type === 'start' && !current) {
    current = data.event;
    started = performance.now();
    const text = {
      key: ['Быстрое нажатие', 'Нажмите указанную клавишу.'],
      sequence: ['Кодовая комбинация', 'Нажмите четыре клавиши по порядку.'],
      timing: ['Поймайте момент', 'Нажмите пробел, когда маркер окажется в зеленой зоне.']
    }[current.kind];
    el('title').textContent = text[0];
    el('hint').textContent = `${text[1]} Используются физические клавиши, раскладка не важна.`;
    for (const code of current.keys) {
      const key = document.createElement('kbd');
      key.textContent = code.replace('Key', '');
      el('keys').appendChild(key);
    }
    if (current.kind === 'timing') {
      el('track').hidden = false;
      el('target').style.left = `${current.targetStart * 100}%`;
      el('target').style.width = `${current.targetWidth * 100}%`;
      const space = document.createElement('kbd');
      space.textContent = 'SPACE';
      el('keys').appendChild(space);
    }
    animate();
  } else if (data.type === 'progress') {
    [...el('keys').children].forEach((key, i) => key.classList.toggle('done', i < data.progress));
  } else if (data.type === 'result') {
    finished = true;
    cancelAnimationFrame(frame);
    el('badge').textContent = data.success ? 'УСПЕХ' : 'НЕ УСПЕЛИ';
    el('title').textContent = data.success ? `+${data.points} очков` : 'Счет сброшен';
    el('feedback').textContent = `Очки: ${data.score} · Рекорд: ${data.best}`;
    document.body.classList.add(data.success ? 'success' : 'failure');
    el('hint').textContent = data.success ? 'Отличная реакция. Можно вернуться к коду.' : 'Следующее задание — новая попытка.';
  }
});
window.addEventListener('keydown', e => {
  if (!current || finished || e.repeat || e.isComposing || e.ctrlKey || e.altKey || e.metaKey || ['ShiftLeft', 'ShiftRight'].includes(e.code)) return;
  e.preventDefault();
  api.postMessage({ type: 'input', id: current.id, code: e.code });
});
api.postMessage({ type: 'ready' });
