const vscode = acquireVsCodeApi();
let pendingMentionTarget = null;
const mentionRoster = new Map(); // login -> {login, fullName, avatarUrl}

window.addEventListener('message', (evt) => {
  const msg = evt.data;
  if (msg.type === 'render') {
    document.getElementById('root').innerHTML = msg.html;
    wireForms();
    wireToolbar();
    wireCommentToolbars();
    wireLogTimeToggle();
    wireEditables();
    wireMdTabs();
    wireCommentEdits();
    wirePills();
    wireLinkChips();
    wireDraftPersistence();
    wireMentionAutocomplete();
  }
  if (msg.type === 'userRoster' && Array.isArray(msg.users)) {
    mentionRoster.clear();
    for (const u of msg.users) mentionRoster.set(u.login, u);
  }
  if (msg.type === 'insertMention' && typeof msg.login === 'string') {
    const target = pendingMentionTarget ?? document.querySelector('form.add-comment textarea');
    insertAtCursor(target, '@' + msg.login + ' ');
    pendingMentionTarget = null;
  }
  if (msg.type === 'previewHtml' && typeof msg.formId === 'string') {
    const form = document.getElementById(msg.formId);
    const preview = form?.querySelector('.md-preview');
    if (preview) preview.innerHTML = msg.html;
  }
});

function insertAtCursor(el, text) {
  if (!el) return;
  el.focus();
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  el.value = el.value.slice(0, start) + text + el.value.slice(end);
  const caret = start + text.length;
  el.setSelectionRange(caret, caret);
}

const onMention = (ta) => {
  pendingMentionTarget = ta;
  vscode.postMessage({ type: 'pickMention' });
};

function wireForms() {
  const logForm = document.querySelector('form.log-time');
  if (logForm) {
    logForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(logForm);
      vscode.postMessage({
        type: 'logTime',
        duration: fd.get('duration'),
        date: fd.get('date'),
        typeId: fd.get('type'),
        text: fd.get('text'),
      });
    });
  }

  const commentForm = document.querySelector('form.add-comment');
  if (commentForm) {
    commentForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(commentForm);
      const text = (fd.get('text') || '').toString().trim();
      if (!text) return;
      vscode.postMessage({ type: 'addComment', text });
      commentForm.reset();
    });
  }
}

function wireToolbar() {
  const bar = document.querySelector('.toolbar');
  if (!bar) return;
  bar.querySelectorAll('button[data-cmd]').forEach((b) => {
    b.addEventListener('click', () => {
      vscode.postMessage({ type: 'cmd', id: b.dataset.cmd });
    });
  });
}

function wireCommentToolbars() {
  document.querySelectorAll('.comment-toolbar').forEach((bar) => {
    const ta = bar.closest('form')?.querySelector('textarea');
    YT.mdEditor.wireToolbar(bar, ta, { onMention });
  });
}

function wireMdTabs() {
  document.querySelectorAll('.md-form').forEach((form) => {
    YT.mdEditor.wireMdTabs(form, (f, text) => {
      vscode.postMessage({ type: 'renderPreview', formId: f.id, text });
    });
  });
}

function wirePills() {
  document.querySelectorAll('.editable-pill[data-pill]').forEach((el) => {
    el.addEventListener('click', () => {
      vscode.postMessage({
        type: 'cmd',
        id: el.dataset.pill,
        fieldName: el.dataset.fieldName,
      });
    });
  });
}

function wireLinkChips() {
  document.querySelectorAll('[data-open-issue]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      vscode.postMessage({ type: 'openLinkedIssue', id: el.dataset.openIssue });
    });
  });
}

function wireCommentEdits() {
  document.querySelectorAll('[data-activity-comment]').forEach((entry) => {
    const editBtn = entry.querySelector('[data-edit-comment]');
    const cancelBtn = entry.querySelector('[data-comment-edit-cancel]');
    const view = entry.querySelector('.comment-view');
    const form = entry.querySelector('form.comment-edit');
    const input = form?.querySelector('textarea[name="text"]');
    if (!form) return;

    editBtn?.addEventListener('click', () => {
      view.hidden = true;
      form.hidden = false;
      input?.focus();
    });
    cancelBtn?.addEventListener('click', () => {
      form.hidden = true;
      view.hidden = false;
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const commentId = form.dataset.commentId;
      const text = input?.value ?? '';
      if (!text.trim()) return;
      vscode.postMessage({ type: 'updateComment', commentId, text });
    });
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { form.hidden = true; view.hidden = false; }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { form.requestSubmit(); }
    });
  });
}

function wireMentionAutocomplete() {
  document.querySelectorAll('form.add-comment textarea, form.comment-edit textarea, .editable-edit textarea').forEach((ta) => {
    YT.mdEditor.attachMentionAutocomplete(ta, () => mentionRoster);
  });
}

// Persist textareas tagged with `data-draft-scope` so a closed panel,
// reload, or accidental Ctrl+W doesn't lose in-flight text. Debounced
// so we don't flood globalState writes.
function wireDraftPersistence() {
  document.querySelectorAll('textarea[data-draft-scope]').forEach((ta) => {
    const scope = ta.dataset.draftScope;
    if (!scope) return;
    let timer = null;
    ta.addEventListener('input', () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        vscode.postMessage({ type: 'saveDraft', scope, text: ta.value });
      }, 400);
    });
  });
}

function wireEditables() {
  document.querySelectorAll('.editable').forEach((block) => {
    const field = block.dataset.field;
    const view = block.querySelector('.editable-view');
    const form = block.querySelector('.editable-edit');
    const input = form?.querySelector('input[name="text"], textarea[name="text"]');
    const cancel = form?.querySelector('[data-edit-cancel]');
    const editBtn = view?.querySelector('[data-edit]');

    const enterEdit = () => {
      view.hidden = true;
      form.hidden = false;
      input?.focus();
      if (input && 'setSelectionRange' in input) {
        const len = input.value.length;
        input.setSelectionRange(len, len);
      }
    };
    const leaveEdit = () => {
      form.hidden = true;
      view.hidden = false;
    };

    editBtn?.addEventListener('click', enterEdit);
    cancel?.addEventListener('click', leaveEdit);

    view?.addEventListener('dblclick', (e) => {
      // ignore double-clicks on the edit button itself, on links, and on input controls
      const target = e.target;
      if (target.closest('a, button, input, select, textarea')) return;
      enterEdit();
    });

    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = input?.value ?? '';
      vscode.postMessage({ type: 'updateField', field, value });
    });
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { leaveEdit(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { form.requestSubmit(); }
    });
  });
}

function wireLogTimeToggle() {
  document.querySelectorAll('[data-inline-toggle]').forEach((trigger) => {
    const key = trigger.dataset.inlineToggle;
    const form = document.querySelector(`[data-collapsible="${key}"]`);
    if (!form) return;
    const labelEl = trigger.querySelector('.toggle-label');
    const icon = trigger.querySelector('i.codicon');
    const openLabel = labelEl?.textContent?.trim() ?? '';
    const closeLabel = openLabel.replace(/^Add/, 'Hide');
    trigger.addEventListener('click', () => {
      const collapsed = form.classList.toggle('collapsed');
      if (labelEl) labelEl.textContent = collapsed ? openLabel : closeLabel;
      if (icon) {
        icon.classList.toggle('codicon-add', collapsed);
        icon.classList.toggle('codicon-chevron-up', !collapsed);
      }
      if (!collapsed) {
        const firstField = form.querySelector('input, textarea, select');
        firstField?.focus();
      }
    });
  });
}

// Drag-and-drop attachments onto the panel
function toBase64(bytes) {
  let bin = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
document.addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types?.includes('Files')) {
    e.preventDefault();
    document.body.classList.add('drop-active');
  }
});
document.addEventListener('dragleave', (e) => {
  if (e.target === document.body || e.target === document.documentElement) {
    document.body.classList.remove('drop-active');
  }
});
document.addEventListener('drop', async (e) => {
  document.body.classList.remove('drop-active');
  const files = e.dataTransfer?.files;
  if (!files || !files.length) return;
  e.preventDefault();
  for (const file of files) {
    const buf = new Uint8Array(await file.arrayBuffer());
    vscode.postMessage({
      type: 'uploadAttachment',
      name: file.name,
      mime: file.type || 'application/octet-stream',
      dataBase64: toBase64(buf),
    });
  }
});

vscode.postMessage({ type: 'ready' });
