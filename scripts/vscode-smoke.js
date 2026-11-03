'use strict';
// Run with VS Code --extensionTestsPath=<absolute path to this file>.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
exports.run = async function run() {
  const vscode = require('vscode');
  const output = path.join(__dirname, '../.work/vscode-smoke.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  try {
    const extension = vscode.extensions.getExtension('maxim-nefedov.code-qte');
    assert.ok(extension, 'Extension is registered');
    await extension.activate();
    assert.equal(extension.isActive, true);
    const commands = await vscode.commands.getCommands(true);
    for (const command of ['toggle', 'playNow', 'stats', 'reset']) assert.ok(commands.includes(`codeQte.${command}`));
    const settings = vscode.workspace.getConfiguration('codeQte');
    await settings.update('enabled', true, vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand('codeQte.playNow');
    await new Promise(resolve => setTimeout(resolve, 1200));
    await vscode.commands.executeCommand('codeQte.toggle');
    assert.equal(vscode.workspace.getConfiguration('codeQte').get('enabled'), false);
    fs.writeFileSync(output, JSON.stringify({ passed: true, vscode: vscode.version, checks: ['activation', 'command registration', 'open challenge', 'pause'] }, null, 2));
  } catch (error) {
    fs.writeFileSync(output, JSON.stringify({ passed: false, error: error.stack }, null, 2));
    throw error;
  }
};
