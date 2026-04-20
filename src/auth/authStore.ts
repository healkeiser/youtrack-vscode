import * as vscode from 'vscode';
import { YouTrackClient } from '../client/youtrackClient';

const TOKEN_KEY = 'youtrack.token';

export interface Credentials {
  baseUrl: string;
  token: string;
}

export class AuthStore {
  constructor(private context: vscode.ExtensionContext) {}

  async getCredentials(): Promise<Credentials | null> {
    const token = await this.context.secrets.get(TOKEN_KEY);
    const baseUrl = vscode.workspace.getConfiguration('youtrack').get<string>('baseUrl', '');
    if (!token || !baseUrl) return null;
    return { baseUrl, token };
  }

  async promptAndValidate(): Promise<Credentials | null> {
    const baseUrl = await vscode.window.showInputBox({
      prompt: 'YouTrack Cloud base URL',
      placeHolder: 'https://<workspace>.youtrack.cloud',
      ignoreFocusOut: true,
      validateInput: (v) => (v && /^https:\/\/.+/.test(v) ? null : 'Must be an https URL'),
    });
    if (!baseUrl) return null;

    const token = await vscode.window.showInputBox({
      prompt: 'YouTrack permanent token',
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) => (v && v.length > 10 ? null : 'Token looks too short'),
    });
    if (!token) return null;

    try {
      const me = await new YouTrackClient(baseUrl, token).getMe();
      await this.context.secrets.store(TOKEN_KEY, token);
      await vscode.workspace.getConfiguration('youtrack').update(
        'baseUrl', baseUrl, vscode.ConfigurationTarget.Global,
      );
      vscode.window.showInformationMessage(`YouTrack: signed in as ${me.fullName}`);
      return { baseUrl, token };
    } catch (e) {
      vscode.window.showErrorMessage(`YouTrack: sign-in failed: ${(e as Error).message}`);
      return null;
    }
  }

  async signOut(): Promise<void> {
    await this.context.secrets.delete(TOKEN_KEY);
    const cfg = vscode.workspace.getConfiguration('youtrack');
    await cfg.update('baseUrl', undefined, vscode.ConfigurationTarget.Global);
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      try {
        await cfg.update('baseUrl', undefined, vscode.ConfigurationTarget.Workspace);
      } catch {
        // ignore if no workspace write is allowed
      }
    }
  }
}
