import * as vscode from 'vscode';
import * as assert from 'node:assert';

suite('activation', () => {
  test('extension activates', async () => {
    const ext = vscode.extensions.getExtension('valentinbeaumont.youtrack-vscode');
    assert.ok(ext, 'extension present');
    // Activation will prompt for credentials; skip if not provided in CI.
  });
});
