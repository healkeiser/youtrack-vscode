const vscode = acquireVsCodeApi();

window.addEventListener('message', (evt) => {
  const msg = evt.data;
  if (msg.type === 'init') {
    populateProjects(msg.projects, msg.defaultShortName);
    populateUsers(msg.users || []);
    // Fetch type/priority for the initially selected project
    maybeFetchProjectFields();
    document.getElementById('summaryIn').focus();
  }
  if (msg.type === 'projectFields') {
    populateField('typeSel', msg.typeValues || []);
    populateField('prioritySel', msg.priorityValues || []);
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
});

function setStatus(text, isError) {
  const s = document.getElementById('status');
  if (!s) return;
  s.textContent = text;
  s.classList.toggle('error', !!isError);
}

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function populateProjects(projects, defaultShortName) {
  const sel = document.getElementById('projectSel');
  sel.innerHTML = projects.map((p) =>
    `<option value="${escape(p.id)}" data-short="${escape(p.shortName)}"${p.shortName === defaultShortName ? ' selected' : ''}>${escape(p.shortName)} — ${escape(p.name)}</option>`
  ).join('');
  sel.addEventListener('change', () => {
    updateProjectHint();
    maybeFetchProjectFields();
  });
  updateProjectHint();
}

function updateProjectHint() {
  const sel = document.getElementById('projectSel');
  const hint = document.getElementById('projectHint');
  if (!sel || !hint) return;
  const opt = sel.options[sel.selectedIndex];
  hint.textContent = opt?.dataset?.short || '';
}

function maybeFetchProjectFields() {
  const sel = document.getElementById('projectSel');
  const id = sel?.value;
  if (!id) return;
  // Reset the two dropdowns to default while the request is in flight
  populateField('typeSel', []);
  populateField('prioritySel', []);
  vscode.postMessage({ type: 'fetchProjectFields', projectId: id });
}

function populateField(selectId, values) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const placeholder = selectId === 'assigneeSel' ? '(unassigned)' : '(default)';
  sel.innerHTML = `<option value="">${placeholder}</option>` + values.map((v) =>
    `<option value="${escape(v)}">${escape(v)}</option>`
  ).join('');
}

function populateUsers(users) {
  const sel = document.getElementById('assigneeSel');
  if (!sel) return;
  sel.innerHTML = '<option value="">(unassigned)</option>' +
    users.map((u) =>
      `<option value="${escape(u.login)}">${escape(u.fullName || u.login)} — ${escape(u.login)}</option>`
    ).join('');
}

function wrapSelection(el, before, after) {
  const start = el.selectionStart ?? 0, end = el.selectionEnd ?? 0;
  const sel = el.value.slice(start, end);
  el.value = el.value.slice(0, start) + before + sel + after + el.value.slice(end);
  el.setSelectionRange(start + before.length, start + before.length + sel.length);
  el.focus();
}

function prefixLines(el, prefix) {
  const start = el.selectionStart ?? 0, end = el.selectionEnd ?? 0;
  const text = el.value;
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = text.indexOf('\n', end);
  const effectiveEnd = lineEnd === -1 ? text.length : lineEnd;
  const block = text.slice(lineStart, effectiveEnd);
  const prefixed = block.split('\n').map((line, i) => (typeof prefix === 'function' ? prefix(line, i) : prefix + line)).join('\n');
  el.value = text.slice(0, lineStart) + prefixed + text.slice(effectiveEnd);
  el.setSelectionRange(lineStart, lineStart + prefixed.length);
  el.focus();
}

function applyMd(kind, ta) {
  switch (kind) {
    case 'bold':    wrapSelection(ta, '**', '**'); break;
    case 'italic':  wrapSelection(ta, '*', '*'); break;
    case 'strike':  wrapSelection(ta, '~~', '~~'); break;
    case 'code':    wrapSelection(ta, '`', '`'); break;
    case 'codeblock': wrapSelection(ta, '\n```\n', '\n```\n'); break;
    case 'link':    wrapSelection(ta, '[', '](https://)'); break;
    case 'quote':   prefixLines(ta, '> '); break;
    case 'ul':      prefixLines(ta, '- '); break;
    case 'ol':      prefixLines(ta, (_l, i) => `${i + 1}. `); break;
  }
}

function setupForm() {
  const form = document.getElementById('createForm');
  const ta = document.getElementById('descIn');
  const toolbar = document.querySelector('.comment-toolbar');
  const preview = document.querySelector('.md-preview');
  const tabs = document.querySelectorAll('.md-tab');

  document.querySelectorAll('.comment-toolbar button[data-md]').forEach((b) => {
    b.addEventListener('click', (e) => { e.preventDefault(); applyMd(b.dataset.md, ta); });
  });

  ta.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key === 'b') { e.preventDefault(); applyMd('bold', ta); }
    else if (e.key === 'i') { e.preventDefault(); applyMd('italic', ta); }
    else if (e.key === 'k') { e.preventDefault(); applyMd('link', ta); }
    else if (e.key === 'e') { e.preventDefault(); applyMd('code', ta); }
  });

  tabs.forEach((t) => {
    t.addEventListener('click', (e) => {
      e.preventDefault();
      tabs.forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      if (t.dataset.mdTab === 'preview') {
        toolbar.hidden = true;
        ta.hidden = true;
        preview.hidden = false;
        preview.innerHTML = '<p style="color:var(--vscode-descriptionForeground);font-style:italic">Rendering…</p>';
        vscode.postMessage({ type: 'renderPreview', text: ta.value });
      } else {
        toolbar.hidden = false;
        ta.hidden = false;
        preview.hidden = true;
      }
    });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const summary = (fd.get('summary') || '').toString().trim();
    if (!summary) return;
    vscode.postMessage({
      type: 'submit',
      projectId: fd.get('project'),
      summary,
      description: (fd.get('description') || '').toString(),
      issueType: (fd.get('type') || '').toString(),
      priority: (fd.get('priority') || '').toString(),
      assignee: (fd.get('assignee') || '').toString(),
    });
  });

  document.getElementById('cancelBtn').addEventListener('click', () => {
    vscode.postMessage({ type: 'cancel' });
  });
}

setupForm();
vscode.postMessage({ type: 'ready' });
