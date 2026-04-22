const vscode = acquireVsCodeApi();
document.body.classList.add('ytvsc-initial');
setTimeout(() => document.body.classList.remove('ytvsc-initial'), 600);

let selectedTags = [];       // Array<{id, name, color?}>
let templates = [];          // Array<{name, summary, description}>
let project = null;          // {id, shortName, name} | null
let projects = [];           // Array<{id, shortName, name}>
let users = [];              // Array<{login, fullName, avatarUrl}>
let issueType = '';          // string
let priority = '';           // string
let assignee = null;         // {login, fullName} | null
let defaultShortName = '';
let saveDraftTimer = null;

window.addEventListener('message', (evt) => {
  const msg = evt.data;
  if (msg.type === 'init') {
    projects = msg.projects || [];
    users = msg.users || [];
    defaultShortName = msg.defaultShortName || '';
    templates = Array.isArray(msg.templates) ? msg.templates : [];
    populateTemplates(templates);
    const initialProject = projects.find((p) => p.shortName === defaultShortName) || projects[0] || null;
    setProject(initialProject);
    applyPrefill(msg.initial);
    if (msg.draft) applyDraft(msg.draft);
    wireDraftAutosave();
    const summaryEl = document.getElementById('summaryIn');
    const descEl = document.getElementById('descIn');
    if (summaryEl && !summaryEl.value) summaryEl.focus();
    else if (descEl) descEl.focus();
  }
  if (msg.type === 'prefill') applyPrefill(msg.initial);
  if (msg.type === 'tagsPicked' && Array.isArray(msg.tags)) {
    selectedTags = msg.tags;
    renderTagsPill();
    scheduleDraftSave();
  }
  if (msg.type === 'projectPicked' && msg.project) {
    setProject(msg.project);
    scheduleDraftSave();
  }
  if (msg.type === 'typePicked' && typeof msg.name === 'string') {
    issueType = msg.name;
    renderEnumPill('typeValue', issueType, '(default)');
    document.getElementById('typeNameIn').value = issueType;
    scheduleDraftSave();
  }
  if (msg.type === 'priorityPicked' && typeof msg.name === 'string') {
    priority = msg.name;
    renderEnumPill('priorityValue', priority, '(default)');
    document.getElementById('priorityNameIn').value = priority;
    scheduleDraftSave();
  }
  if (msg.type === 'assigneePicked') {
    if (msg.login == null) {
      assignee = null;
    } else {
      assignee = { login: msg.login, fullName: msg.fullName || msg.login };
    }
    renderAssigneePill();
    document.getElementById('assigneeLoginIn').value = assignee?.login ?? '';
    scheduleDraftSave();
  }
  if (msg.type === 'creating') {
    document.getElementById('submitBtn').disabled = true;
    setStatus('Creating…');
  }
  if (msg.type === 'error') {
    document.getElementById('submitBtn').disabled = false;
    setStatus(msg.message || 'Error', true);
  }
  if (msg.type === 'previewHtml') {
    const preview = document.querySelector('.md-preview');
    if (preview) preview.innerHTML = msg.html;
  }
  if (msg.type === 'inlinePickerItems' && typeof msg.requestId === 'string') {
    const req = pendingPicker.get(msg.requestId);
    if (!req) return;
    pendingPicker.delete(msg.requestId);
    const actions = Array.isArray(msg.actions) ? msg.actions : [];
    const items = Array.isArray(msg.items) ? msg.items : [];
    if (!items.length && !actions.length) return;
    const composed = [
      ...actions,
      ...(actions.length ? [{ separator: true }] : []),
      ...items,
    ];
    YT.inlinePicker.open(req.anchor, {
      items: composed,
      multiSelect: !!req.multiSelect,
      onPick: req.onPick,
      onToggle: req.onToggle,
      onAction: req.onAction,
    });
  }
  if (msg.type === 'newTagCreated' && msg.tag) {
    selectedTags.push(msg.tag);
    renderTagsPill();
    scheduleDraftSave();
  }
});

function applyPrefill(initial) {
  if (!initial) return;
  const summaryEl = document.getElementById('summaryIn');
  const descEl = document.getElementById('descIn');
  if (summaryEl && typeof initial.summary === 'string' && !summaryEl.value) {
    summaryEl.value = initial.summary;
  }
  if (descEl && typeof initial.description === 'string') {
    descEl.value = initial.description + (descEl.value ? '\n\n' + descEl.value : '');
  }
}

function applyDraft(draft) {
  const summaryEl = document.getElementById('summaryIn');
  const descEl = document.getElementById('descIn');
  if (summaryEl && !summaryEl.value && draft.summary) summaryEl.value = draft.summary;
  if (descEl && !descEl.value && draft.description) descEl.value = draft.description;
  if (draft.projectId) {
    const p = projects.find((x) => x.id === draft.projectId);
    if (p) setProject(p);
  }
  if (draft.issueType) {
    issueType = draft.issueType;
    renderEnumPill('typeValue', issueType, '(default)');
    document.getElementById('typeNameIn').value = issueType;
  }
  if (draft.priority) {
    priority = draft.priority;
    renderEnumPill('priorityValue', priority, '(default)');
    document.getElementById('priorityNameIn').value = priority;
  }
  if (draft.assignee) {
    const u = users.find((x) => x.login === draft.assignee);
    assignee = u ? { login: u.login, fullName: u.fullName || u.login }
                 : { login: draft.assignee, fullName: draft.assignee };
    renderAssigneePill();
    document.getElementById('assigneeLoginIn').value = assignee.login;
  }
  if (Array.isArray(draft.selectedTags) && draft.selectedTags.length) {
    selectedTags = draft.selectedTags;
    renderTagsPill();
  }
}

function setProject(p) {
  project = p;
  const value = document.getElementById('projectValue');
  const hint = document.getElementById('projectHint');
  const hidden = document.getElementById('projectIdIn');
  if (value) {
    value.innerHTML = p
      ? `<b>${escape(p.shortName)}</b> <span class="muted">— ${escape(p.name)}</span>`
      : '<span class="muted">Click to pick…</span>';
  }
  if (hint) hint.textContent = p?.shortName || '';
  if (hidden) hidden.value = p?.id ?? '';
  // Reset Type/Priority when project changes — they're project-scoped
  issueType = '';
  priority = '';
  renderEnumPill('typeValue', '', '(default)');
  renderEnumPill('priorityValue', '', '(default)');
  document.getElementById('typeNameIn').value = '';
  document.getElementById('priorityNameIn').value = '';
}

function renderEnumPill(targetId, value, fallback) {
  const el = document.getElementById(targetId);
  if (!el) return;
  el.innerHTML = value ? escape(value) : `<span class="muted">${escape(fallback)}</span>`;
}

function renderAssigneePill() {
  const el = document.getElementById('assigneeValue');
  if (!el) return;
  if (!assignee?.login) {
    el.innerHTML = '<span class="muted">(unassigned)</span>';
    return;
  }
  el.innerHTML = `<b>${escape(assignee.fullName || assignee.login)}</b> <span class="muted">— ${escape(assignee.login)}</span>`;
}

function setStatus(text, isError) {
  const s = document.getElementById('status');
  if (!s) return;
  s.textContent = text;
  s.classList.toggle('error', !!isError);
}

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function populateTemplates(list) {
  const row = document.getElementById('templateRow');
  const sel = document.getElementById('templateSel');
  if (!row || !sel) return;
  if (!list.length) { row.remove(); return; }
  row.hidden = false;
  sel.innerHTML = '<option value="">(none)</option>' +
    list.map((t, i) => `<option value="${i}">${escape(t.name)}</option>`).join('');
  sel.addEventListener('change', () => {
    const idx = Number(sel.value);
    if (!Number.isFinite(idx)) return;
    const tpl = list[idx];
    if (!tpl) return;
    const summaryEl = document.getElementById('summaryIn');
    const descEl = document.getElementById('descIn');
    if (summaryEl && tpl.summary) summaryEl.value = tpl.summary;
    if (descEl) descEl.value = tpl.description || '';
    scheduleDraftSave();
  });
}

function wireDraftAutosave() {
  const form = document.getElementById('createForm');
  if (!form) return;
  form.addEventListener('input', scheduleDraftSave);
}

function scheduleDraftSave() {
  if (saveDraftTimer) clearTimeout(saveDraftTimer);
  saveDraftTimer = setTimeout(() => {
    const form = document.getElementById('createForm');
    if (!form) return;
    const fd = new FormData(form);
    vscode.postMessage({
      type: 'saveDraft',
      projectId: project?.id ?? '',
      summary: (fd.get('summary') || '').toString(),
      description: (fd.get('description') || '').toString(),
      issueType,
      priority,
      assignee: assignee?.login ?? '',
      selectedTags,
    });
  }, 400);
}

function setupForm() {
  const form = document.getElementById('createForm');
  const descForm = document.getElementById('descForm');
  const ta = document.getElementById('descIn');

  YT.mdEditor.wireToolbar(descForm.querySelector('.comment-toolbar'), ta);
  YT.mdEditor.wireMdTabs(descForm, (_f, text) => {
    vscode.postMessage({ type: 'renderPreview', text });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!project?.id) {
      setStatus('Pick a project first.', true);
      return;
    }
    const fd = new FormData(form);
    const summary = (fd.get('summary') || '').toString().trim();
    if (!summary) return;
    vscode.postMessage({
      type: 'submit',
      projectId: project.id,
      summary,
      description: (fd.get('description') || '').toString(),
      issueType,
      priority,
      assignee: assignee?.login ?? '',
      tagIds: selectedTags.map((t) => t.id),
    });
  });

  document.getElementById('cancelBtn').addEventListener('click', () => {
    vscode.postMessage({ type: 'cancel' });
  });

  bindInlinePicker('projectRow', (anchor) => requestPicker(anchor, {
    kind: 'project',
    onPick: (item) => {
      const p = projects.find((x) => x.id === item.id);
      if (p) { setProject(p); scheduleDraftSave(); }
    },
  }));
  bindInlinePicker('typeRow', (anchor) => {
    if (!project?.id) { setStatus('Pick a project first.', true); return; }
    requestPicker(anchor, {
      kind: 'enum', fieldName: 'Type', projectId: project.id,
      allowClear: true, clearLabel: 'Use project default',
      onPick: (item) => {
        issueType = item.id === '__clear__' ? '' : item.id;
        renderEnumPill('typeValue', issueType, '(default)');
        document.getElementById('typeNameIn').value = issueType;
        scheduleDraftSave();
      },
    });
  });
  bindInlinePicker('priorityRow', (anchor) => {
    if (!project?.id) { setStatus('Pick a project first.', true); return; }
    requestPicker(anchor, {
      kind: 'priority', fieldName: 'Priority', projectId: project.id,
      allowClear: true, clearLabel: 'Use project default',
      onPick: (item) => {
        priority = item.id === '__clear__' ? '' : item.id;
        renderEnumPill('priorityValue', priority, '(default)');
        document.getElementById('priorityNameIn').value = priority;
        scheduleDraftSave();
      },
    });
  });
  bindInlinePicker('assigneeRow', (anchor) => requestPicker(anchor, {
    kind: 'user',
    allowClear: true, clearLabel: 'Unassigned',
    onPick: (item) => {
      if (item.id === '__clear__') assignee = null;
      else assignee = { login: item.id, fullName: item.label };
      renderAssigneePill();
      document.getElementById('assigneeLoginIn').value = assignee?.login ?? '';
      scheduleDraftSave();
    },
  }));
  bindInlinePicker('tagsRow', (anchor) => {
    const currentIds = selectedTags.map((t) => t.id);
    const requestId = `rq-${++pickerRequestId}`;
    pendingPicker.set(requestId, {
      anchor,
      multiSelect: true,
      onToggle: (item, picked) => {
        if (picked) {
          const color = item.icon?.kind === 'dot' ? { background: item.icon.color } : undefined;
          selectedTags.push({ id: item.id, name: item.label, color });
        } else {
          const i = selectedTags.findIndex((t) => t.id === item.id);
          if (i >= 0) selectedTags.splice(i, 1);
        }
        renderTagsPill();
        scheduleDraftSave();
      },
      onAction: (item) => {
        if (item.id === '__new_tag__') {
          vscode.postMessage({ type: 'createTagPromptForDraft' });
        }
      },
    });
    vscode.postMessage({ type: 'openInlinePicker', requestId, kind: 'tags', currentIds });
  });
}

let pickerRequestId = 0;
const pendingPicker = new Map();

function bindInlinePicker(id, handler) {
  const el = document.getElementById(id);
  el?.addEventListener('click', () => handler(el));
}

function requestPicker(anchor, opts) {
  const requestId = `rq-${++pickerRequestId}`;
  pendingPicker.set(requestId, { anchor, onPick: opts.onPick });
  vscode.postMessage({
    type: 'openInlinePicker',
    requestId,
    kind: opts.kind,
    fieldName: opts.fieldName,
    projectId: opts.projectId,
    allowClear: !!opts.allowClear,
    clearLabel: opts.clearLabel,
  });
}

function renderTagsPill() {
  const value = document.getElementById('tagsValue');
  if (!value) return;
  if (!selectedTags.length) {
    value.innerHTML = '<span class="muted">Click to add…</span>';
    return;
  }
  value.innerHTML = selectedTags.map((t) => {
    const bg = t.color?.background || 'var(--vscode-editor-inactiveSelectionBackground)';
    const fg = t.color?.foreground || 'var(--vscode-foreground)';
    return `<span class="tag-pill" style="background:${escape(bg)};color:${escape(fg)}">${escape(t.name)}</span>`;
  }).join('');
}

setupForm();
vscode.postMessage({ type: 'ready' });
