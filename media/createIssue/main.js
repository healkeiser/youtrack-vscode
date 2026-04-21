const vscode = acquireVsCodeApi();

window.addEventListener('message', (evt) => {
  const msg = evt.data;
  if (msg.type === 'init') {
    populateProjects(msg.projects, msg.defaultShortName);
    populateUsers(msg.users || []);
    // Fetch type/priority for the initially selected project
    maybeFetchProjectFields();
    applyPrefill(msg.initial);
    // Focus summary if empty, otherwise the description for edit flow.
    const summaryEl = document.getElementById('summaryIn');
    const descEl = document.getElementById('descIn');
    if (summaryEl && !summaryEl.value) summaryEl.focus();
    else if (descEl) descEl.focus();
  }
  if (msg.type === 'prefill') applyPrefill(msg.initial);
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

function applyPrefill(initial) {
  if (!initial) return;
  const summaryEl = document.getElementById('summaryIn');
  const descEl = document.getElementById('descIn');
  if (summaryEl && typeof initial.summary === 'string' && !summaryEl.value) {
    summaryEl.value = initial.summary;
  }
  if (descEl && typeof initial.description === 'string') {
    // Merge: if the textarea already has text, prepend the prefill
    // so the user's in-flight content isn't lost.
    descEl.value = initial.description + (descEl.value ? '\n\n' + descEl.value : '');
  }
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
