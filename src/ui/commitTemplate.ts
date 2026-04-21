import * as vscode from 'vscode';

const ISSUE_PATTERN = /\b([A-Z][A-Z0-9_]+-\d+)\b/;

type AutoFillMode = 'off' | 'empty-only' | 'always';

// Watches each Git repository's SCM input box. When the current branch
// carries an issue key AND the user hasn't already typed the template,
// inserts the rendered `youtrack.commit.template`. Mode:
//   - off         → never auto-apply, but the manual insert command works
//   - empty-only  → apply once when the input box is empty (branch
//                   switch, post-commit clear, first sight)
//   - always      → re-apply every time the input becomes empty
//
// Manual command `youtrack.insertIssueKeyInCommitMessage` bypasses mode
// and inserts at the start of the current message if the key isn't
// already there.
export class CommitTemplateService implements vscode.Disposable {
  private subs: vscode.Disposable[] = [];
  private lastAppliedPerRepo = new Map<any, string>();

  constructor() {
    const gitExt = vscode.extensions.getExtension<any>('vscode.git');
    if (!gitExt) return;
    const bind = (api: any) => {
      for (const repo of api.repositories ?? []) this.subscribeRepo(repo);
      if (api.onDidOpenRepository) this.subs.push(api.onDidOpenRepository((r: any) => this.subscribeRepo(r)));
    };
    const activate = gitExt.isActive
      ? Promise.resolve(gitExt.exports)
      : Promise.resolve(gitExt.activate());
    activate
      .then((exp: any) => { try { bind(exp.getAPI(1)); } catch { /* ignore */ } })
      .catch(() => { /* ignore */ });
  }

  private subscribeRepo(repo: any): void {
    // state.onDidChange fires on branch/HEAD changes, post-commit, etc.
    try {
      this.subs.push(repo.state.onDidChange?.(() => this.maybeApply(repo)));
    } catch { /* noop */ }
    // Also watch the input box itself — if the user or VS Code clears
    // it (after a successful commit), re-apply when mode is 'always'.
    try {
      const input = repo.inputBox;
      if (input && typeof input.onDidChange === 'function') {
        this.subs.push(input.onDidChange(() => {
          if (this.mode() === 'always' && !input.value) this.maybeApply(repo);
        }));
      }
    } catch { /* noop */ }
    this.maybeApply(repo);
  }

  private mode(): AutoFillMode {
    return vscode.workspace.getConfiguration('youtrack').get<AutoFillMode>('commit.autoFill', 'empty-only');
  }

  private template(): string {
    return vscode.workspace.getConfiguration('youtrack').get<string>('commit.template', '{id}: ');
  }

  private maybeApply(repo: any): void {
    const mode = this.mode();
    if (mode === 'off') return;

    const id = issueKeyOf(repo);
    if (!id) return;

    const input = repo.inputBox;
    if (!input) return;

    const current = typeof input.value === 'string' ? input.value : '';
    const rendered = this.template().replace(/\{id\}/g, id);

    if (mode === 'empty-only') {
      if (current) return;
      // Avoid re-applying for the same branch in the same session — the
      // user might have deleted the prefix on purpose.
      if (this.lastAppliedPerRepo.get(repo) === id) return;
    }
    if (mode === 'always' && current) return;

    input.value = rendered;
    this.lastAppliedPerRepo.set(repo, id);
  }

  // Public entry point for the manual command.
  insertNow(): void {
    const repo = getPrimaryRepo();
    if (!repo) {
      vscode.window.showWarningMessage('YouTrack: no Git repository is currently open.');
      return;
    }
    const id = issueKeyOf(repo);
    if (!id) {
      vscode.window.showWarningMessage('YouTrack: no issue key found in the current branch name.');
      return;
    }
    const input = repo.inputBox;
    if (!input) return;
    const current = typeof input.value === 'string' ? input.value : '';
    if (current.includes(id)) {
      vscode.window.showInformationMessage(`YouTrack: ${id} is already in the commit message.`);
      return;
    }
    const rendered = this.template().replace(/\{id\}/g, id);
    input.value = rendered + current;
  }

  dispose(): void {
    for (const s of this.subs) s?.dispose?.();
    this.subs = [];
  }
}

function issueKeyOf(repo: any): string | undefined {
  const branch: string | undefined = repo.state?.HEAD?.name;
  if (!branch) return undefined;
  const m = ISSUE_PATTERN.exec(branch);
  return m ? m[1] : undefined;
}

function getPrimaryRepo(): any | undefined {
  const gitExt = vscode.extensions.getExtension<any>('vscode.git');
  if (!gitExt?.isActive) return undefined;
  try {
    const api = gitExt.exports.getAPI(1);
    return api.repositories?.[0];
  } catch {
    return undefined;
  }
}
