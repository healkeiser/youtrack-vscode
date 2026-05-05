import * as vscode from 'vscode';
import * as path from 'path';
import { marked } from 'marked';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Tag } from '../client/types';
import { renderPanelHtml } from './webviewSecurity';
import { showYouTrackError, formatYouTrackError } from '../client/errors';
import { pickProject, pickFieldValue, pickUser } from './pickers';
import { buildPickerItems } from './inlinePickerBroker';

export interface CreateIssueInitial {
  summary?: string;
  description?: string;
  /**
   * Pre-filled hints from the AI drafter (or any other auto-fill flow).
   * The panel surfaces these as suggestions — the user is still the one
   * who picks Project/Type/Priority/Assignee/Tags before submitting.
   */
  ai?: {
    suggestedProject?: string;
    suggestedType?: string;
    suggestedPriority?: string;
    suggestedTags?: string[];
    similarIssues?: Array<{ idReadable: string; summary: string; reason?: string }>;
  };
}

// Optional dependencies the panel needs to call into AI features. Wired
// in by extension.ts when the panel is opened; older call sites that
// don't pass `ai` keep working — the "Draft with AI" button just stays
// hidden.
export interface CreateIssueAiDeps {
  draft: (input: import('../ai/draftIssue').DraftIssueInput) => Promise<import('../ai/draftIssue').DraftIssueProposal | undefined>;
  baseUrl: string;
}

interface CreateIssueDraft {
  projectId?: string;
  summary?: string;
  description?: string;
  issueType?: string;
  priority?: string;
  assignee?: string;
  selectedTags?: Array<{ id: string; name: string; color?: { background?: string; foreground?: string } }>;
}

interface IssueTemplate {
  name: string;
  summary: string;
  description: string;
}

const DRAFT_KEY = 'youtrack.createIssueDraft';

async function loadIssueTemplates(): Promise<IssueTemplate[]> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return [];
  const out: IssueTemplate[] = [];
  for (const folder of folders) {
    const dir = vscode.Uri.joinPath(folder.uri, '.youtrack', 'templates');
    let entries: [string, vscode.FileType][] = [];
    try { entries = await vscode.workspace.fs.readDirectory(dir); }
    catch { continue; }
    for (const [name, type] of entries) {
      if (!(type & vscode.FileType.File)) continue;
      if (!/\.md$/i.test(name)) continue;
      try {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, name));
        const raw = new TextDecoder('utf-8').decode(bytes);
        out.push(parseTemplate(name, raw));
      } catch { /* skip unreadable */ }
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function parseTemplate(filename: string, raw: string): IssueTemplate {
  // If the first non-blank line is a markdown H1, treat it as the summary;
  // the rest (with the H1 stripped) becomes the description. Otherwise the
  // whole body goes into the description with no default summary.
  const lines = raw.replace(/^﻿/, '').split(/\r?\n/);
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  const displayName = path.basename(filename, path.extname(filename));
  const h1 = lines[i]?.match(/^#\s+(.+?)\s*$/);
  if (h1) {
    return {
      name: displayName,
      summary: h1[1].trim(),
      description: lines.slice(i + 1).join('\n').replace(/^\s+/, ''),
    };
  }
  return { name: displayName, summary: '', description: raw };
}

export class CreateIssuePanel {
  private static current: CreateIssuePanel | undefined;
  private panel: vscode.WebviewPanel;
  private projectsPromise: Promise<Array<{ id: string; shortName: string; name: string }>> | null = null;
  private initial: CreateIssueInitial;

  private constructor(
    private extensionUri: vscode.Uri,
    private client: YouTrackClient,
    private context: vscode.ExtensionContext,
    private onCreated?: (idReadable: string) => void,
    initial?: CreateIssueInitial,
    private aiDeps?: CreateIssueAiDeps,
  ) {
    this.initial = initial ?? {};
    this.panel = vscode.window.createWebviewPanel(
      'youtrackCreate',
      'Create Issue',
      vscode.ViewColumn.Active,
      { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media'), context.globalStorageUri], retainContextWhenHidden: false },
    );
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'youtrack.png');
    this.panel.webview.html = this.shellHtml();
    this.panel.onDidDispose(() => { CreateIssuePanel.current = undefined; });
    this.panel.webview.onDidReceiveMessage((m) => this.onMessage(m));
  }

  static show(
    extensionUri: vscode.Uri,
    client: YouTrackClient,
    context: vscode.ExtensionContext,
    onCreated?: (id: string) => void,
    initial?: CreateIssueInitial,
    aiDeps?: CreateIssueAiDeps,
  ): void {
    if (CreateIssuePanel.current) {
      CreateIssuePanel.current.panel.reveal();
      if (initial) CreateIssuePanel.current.applyInitial(initial);
      return;
    }
    CreateIssuePanel.current = new CreateIssuePanel(extensionUri, client, context, onCreated, initial, aiDeps);
  }

  private applyInitial(initial: CreateIssueInitial): void {
    // Called when show() is invoked again while the panel is already up —
    // merge + resend so the webview can overwrite its fields.
    this.initial = { ...this.initial, ...initial };
    this.panel.webview.postMessage({ type: 'prefill', initial: this.initial });
  }

  private shellHtml(): string {
    return renderPanelHtml(this.panel.webview, this.extensionUri, 'createIssue');
  }

  private getProjects() {
    if (!this.projectsPromise) {
      this.projectsPromise = this.client.listProjects().then((list) =>
        list.sort((a, b) => a.shortName.localeCompare(b.shortName)),
      );
    }
    return this.projectsPromise;
  }

  private async onMessage(msg: any): Promise<void> {
    if (msg.type === 'ready') {
      try {
        const [projects, users, templates] = await Promise.all([
          this.getProjects(),
          this.client.listUsers('', 200).catch(() => []),
          loadIssueTemplates().catch(() => [] as IssueTemplate[]),
        ]);
        const defaultShortName = vscode.workspace.getConfiguration('youtrack').get<string>('defaultProject', '');
        const draft = this.context.globalState.get<CreateIssueDraft>(DRAFT_KEY);
        this.panel.webview.postMessage({
          type: 'init',
          projects,
          defaultShortName,
          users,
          initial: this.initial,
          templates,
          draft,
          // The webview reveals the "Draft with AI" button and the
          // "Similar issues" panel only when this is true.
          aiEnabled: !!this.aiDeps,
        });
      } catch (e) {
        this.panel.webview.postMessage({ type: 'error', message: formatYouTrackError(e, 'load projects') });
      }
      return;
    }
    if (msg.type === 'saveDraft') {
      const draft: CreateIssueDraft = {
        projectId: String(msg.projectId ?? ''),
        summary: String(msg.summary ?? ''),
        description: String(msg.description ?? ''),
        issueType: String(msg.issueType ?? ''),
        priority: String(msg.priority ?? ''),
        assignee: String(msg.assignee ?? ''),
        selectedTags: Array.isArray(msg.selectedTags) ? msg.selectedTags : [],
      };
      const empty = !draft.summary && !draft.description && !draft.selectedTags?.length;
      await this.context.globalState.update(DRAFT_KEY, empty ? undefined : draft);
      return;
    }
    if (msg.type === 'discardDraft') {
      await this.context.globalState.update(DRAFT_KEY, undefined);
      return;
    }
    if (msg.type === 'aiDraft') {
      // The webview's "Draft with AI" button. We pass whatever the user
      // already typed in the form (treating both as the free-form input
      // for the agent) plus any prefill we still have around — that lets
      // "re-draft" iterate on the user's edits, not blow them away.
      if (!this.aiDeps) {
        this.panel.webview.postMessage({ type: 'aiDraftError', message: 'AI is disabled. Enable youtrack.ai.enabled in settings.' });
        return;
      }
      const freeText = [String(msg.summary ?? '').trim(), String(msg.description ?? '').trim()]
        .filter(Boolean)
        .join('\n\n');
      const checkDuplicates = vscode.workspace.getConfiguration('youtrack.ai.draft').get<boolean>('checkDuplicates', true);
      this.panel.webview.postMessage({ type: 'aiDraftStarted' });
      try {
        const proposal = await this.aiDeps.draft({
          freeText,
          knownProjectShortName: typeof msg.projectShortName === 'string' ? msg.projectShortName : undefined,
          checkDuplicates,
        });
        if (proposal) {
          this.panel.webview.postMessage({ type: 'aiDraftReady', proposal });
        } else {
          // User cancelled the progress notification.
          this.panel.webview.postMessage({ type: 'aiDraftCancelled' });
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        this.panel.webview.postMessage({ type: 'aiDraftError', message });
      }
      return;
    }
    if (msg.type === 'openSimilarIssue') {
      const id = String(msg.id ?? '');
      if (id) vscode.commands.executeCommand('youtrack.openIssue', id);
      return;
    }
    if (msg.type === 'createTagPromptForDraft') {
      const name = await vscode.window.showInputBox({
        title: 'Create new tag',
        prompt: 'Tag name',
        validateInput: (v) => (v.trim() ? undefined : 'Name required'),
      });
      if (!name || !name.trim()) return;
      try {
        const tag = await this.client.createTag(name.trim());
        this.panel.webview.postMessage({ type: 'newTagCreated', tag });
      } catch (e) {
        showYouTrackError(e, 'create tag');
      }
      return;
    }
    if (msg.type === 'openInlinePicker') {
      try {
        const req = {
          requestId: String(msg.requestId),
          kind: msg.kind,
          fieldName: msg.fieldName,
          projectId: msg.projectId,
          allowClear: !!msg.allowClear,
          clearLabel: msg.clearLabel,
        };
        const payload = await buildPickerItems(this.client, this.panel.webview, req);
        this.panel.webview.postMessage({ type: 'inlinePickerItems', requestId: req.requestId, ...payload });
      } catch (e) {
        showYouTrackError(e, 'load options');
      }
      return;
    }
    if (msg.type === 'pickProject') {
      try {
        const p = await pickProject(this.client);
        if (p) this.panel.webview.postMessage({ type: 'projectPicked', project: p });
      } catch (e) { showYouTrackError(e, 'load projects'); }
      return;
    }
    if (msg.type === 'pickType') {
      try {
        const picked = await pickFieldValue(this.client, String(msg.projectId || ''), 'Type', { allowClear: true, clearLabel: 'Use project default' });
        if (picked) this.panel.webview.postMessage({ type: 'typePicked', name: picked.name ?? '' });
      } catch (e) { showYouTrackError(e, 'load types'); }
      return;
    }
    if (msg.type === 'pickPriority') {
      try {
        const picked = await pickFieldValue(this.client, String(msg.projectId || ''), 'Priority', { allowClear: true, clearLabel: 'Use project default' });
        if (picked) this.panel.webview.postMessage({ type: 'priorityPicked', name: picked.name ?? '' });
      } catch (e) { showYouTrackError(e, 'load priorities'); }
      return;
    }
    if (msg.type === 'pickAssignee') {
      try {
        const picked = await pickUser(this.client, 'Assignee', { allowClear: true, clearLabel: 'Unassigned' });
        if (picked) this.panel.webview.postMessage({ type: 'assigneePicked', login: picked.login, fullName: picked.fullName });
      } catch (e) { showYouTrackError(e, 'load users'); }
      return;
    }
    if (msg.type === 'renderPreview') {
      const text = String(msg.text ?? '');
      const html = text.trim()
        ? (marked.parse(text, { async: false }) as string)
        : '<p style="color:var(--vscode-descriptionForeground);font-style:italic">Nothing to preview.</p>';
      this.panel.webview.postMessage({ type: 'previewHtml', html });
      return;
    }
    if (msg.type === 'cancel') {
      this.panel.dispose();
      return;
    }
    if (msg.type === 'pickTags') {
      const selectedIds = new Set<string>(Array.isArray(msg.selectedIds) ? msg.selectedIds.map(String) : []);
      try {
        const all = await this.client.listTags();
        type Item = vscode.QuickPickItem & { tag?: Tag; create?: true };
        const items: Item[] = [
          { label: '$(add) Create new tag…', create: true },
          { label: '', kind: vscode.QuickPickItemKind.Separator } as any,
          ...all
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map<Item>((t) => ({ label: t.name, picked: selectedIds.has(t.id), tag: t })),
        ];
        const picked = await vscode.window.showQuickPick<Item>(items, {
          title: 'Tags',
          placeHolder: 'Pick tags to attach on create',
          canPickMany: true,
        });
        if (!picked) return;
        const keep = picked.filter((p) => p.tag).map((p) => p.tag!);
        if (picked.some((p) => p.create)) {
          const name = await vscode.window.showInputBox({
            title: 'Create new tag',
            prompt: 'Tag name',
            validateInput: (v) => (v.trim() ? undefined : 'Name required'),
          });
          if (name && name.trim()) {
            const tag = await this.client.createTag(name.trim());
            keep.push(tag);
          }
        }
        this.panel.webview.postMessage({ type: 'tagsPicked', tags: keep });
      } catch (e) {
        showYouTrackError(e, 'load tags');
      }
      return;
    }
    if (msg.type === 'submit') {
      const projectId = String(msg.projectId || '');
      const summary = String(msg.summary || '').trim();
      const description = String(msg.description || '');
      if (!projectId || !summary) {
        this.panel.webview.postMessage({ type: 'error', message: 'Project and summary are required.' });
        return;
      }
      this.panel.webview.postMessage({ type: 'creating' });
      try {
        const { idReadable } = await this.client.createIssue(projectId, summary, description);
        const type = String(msg.issueType ?? '').trim();
        const priority = String(msg.priority ?? '').trim();
        const assignee = String(msg.assignee ?? '').trim();

        const followUps: Array<Promise<unknown>> = [];
        if (type)     followUps.push(this.client.setEnumField(idReadable, 'Type', type).catch((e) => showYouTrackError(e, 'set Type', 'warning')));
        if (priority) followUps.push(this.client.setEnumField(idReadable, 'Priority', priority).catch((e) => showYouTrackError(e, 'set Priority', 'warning')));
        if (assignee) followUps.push(this.client.assignIssue(idReadable, assignee).catch((e) => showYouTrackError(e, 'assign', 'warning')));
        const tagIds: string[] = Array.isArray(msg.tagIds) ? msg.tagIds.map(String) : [];
        for (const tid of tagIds) {
          followUps.push(this.client.addTagToIssue(idReadable, tid).catch((e) => showYouTrackError(e, 'attach tag', 'warning')));
        }
        // Resolve AI-suggested tag names: match against existing tags
        // case-insensitively; create any that don't exist. Done after
        // the create call so a tag-resolution failure can't block issue
        // creation.
        const tagNames: string[] = Array.isArray(msg.tagNames) ? msg.tagNames.map((s: unknown) => String(s).trim()).filter(Boolean) : [];
        if (tagNames.length) {
          followUps.push((async () => {
            try {
              const existing = await this.client.listTags();
              const byLower = new Map(existing.map((t) => [t.name.toLowerCase(), t]));
              for (const name of tagNames) {
                let tag = byLower.get(name.toLowerCase());
                if (!tag) {
                  try { tag = await this.client.createTag(name); }
                  catch (e) { showYouTrackError(e, `create tag "${name}"`, 'warning'); continue; }
                }
                try { await this.client.addTagToIssue(idReadable, tag.id); }
                catch (e) { showYouTrackError(e, `attach tag "${name}"`, 'warning'); }
              }
            } catch (e) {
              showYouTrackError(e, 'resolve AI-suggested tags', 'warning');
            }
          })());
        }
        await Promise.all(followUps);

        await this.context.globalState.update(DRAFT_KEY, undefined);
        this.panel.dispose();
        vscode.window.showInformationMessage(`YouTrack: created ${idReadable}`);
        if (this.onCreated) this.onCreated(idReadable);
        vscode.commands.executeCommand('youtrack.openIssue', idReadable);
      } catch (e) {
        this.panel.webview.postMessage({ type: 'error', message: formatYouTrackError(e, 'create issue') });
      }
    }
  }
}
