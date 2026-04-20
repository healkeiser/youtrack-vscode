const vscode = acquireVsCodeApi();
let pendingMentionTarget = null;

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

function wrapSelection(el, before, after) {
  if (!el) return;
  el.focus();
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  const selected = el.value.slice(start, end);
  const replacement = before + selected + after;
  el.value = el.value.slice(0, start) + replacement + el.value.slice(end);
  const caretStart = start + before.length;
  const caretEnd = caretStart + selected.length;
  el.setSelectionRange(caretStart, caretEnd);
}

function prefixLines(el, prefix) {
  if (!el) return;
  el.focus();
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  const text = el.value;
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = text.indexOf('\n', end);
  const effectiveEnd = lineEnd === -1 ? text.length : lineEnd;
  const block = text.slice(lineStart, effectiveEnd);
  const prefixed = block.split('\n').map((line, idx) => (
    typeof prefix === 'function' ? prefix(line, idx) : prefix + line
  )).join('\n');
  el.value = text.slice(0, lineStart) + prefixed + text.slice(effectiveEnd);
  el.setSelectionRange(lineStart, lineStart + prefixed.length);
}

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
    case 'mention':
      pendingMentionTarget = ta;
      vscode.postMessage({ type: 'pickMention' });
      break;
  }
}

function wireCommentToolbars() {
  document.querySelectorAll('.comment-toolbar').forEach((bar) => {
    const form = bar.closest('form');
    const ta = form?.querySelector('textarea');
    bar.querySelectorAll('button[data-md]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.preventDefault();
        applyMd(b.dataset.md, ta);
      });
    });

    if (ta) {
      ta.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        if (e.key === 'b') { e.preventDefault(); applyMd('bold', ta); }
        else if (e.key === 'i') { e.preventDefault(); applyMd('italic', ta); }
        else if (e.key === 'k') { e.preventDefault(); applyMd('link', ta); }
        else if (e.key === 'e') { e.preventDefault(); applyMd('code', ta); }
      });
    }
  });
}

let mdFormCounter = 0;
function wireMdTabs() {
  document.querySelectorAll('.md-form').forEach((form) => {
    if (!form.id) form.id = `md-form-${++mdFormCounter}`;
    const tabs = form.querySelectorAll('.md-tab');
    const toolbar = form.querySelector('.comment-toolbar');
    const textarea = form.querySelector('textarea');
    const preview = form.querySelector('.md-preview');
    if (!tabs.length || !textarea || !preview) return;

    const showWrite = () => {
      tabs.forEach((t) => t.classList.toggle('active', t.dataset.mdTab === 'write'));
      if (toolbar) toolbar.hidden = false;
      textarea.hidden = false;
      preview.hidden = true;
    };
    const showPreview = () => {
      tabs.forEach((t) => t.classList.toggle('active', t.dataset.mdTab === 'preview'));
      if (toolbar) toolbar.hidden = true;
      textarea.hidden = true;
      preview.hidden = false;
      preview.innerHTML = '<p style="color:var(--vscode-descriptionForeground);font-style:italic">Rendering…</p>';
      vscode.postMessage({ type: 'renderPreview', formId: form.id, text: textarea.value });
    };

    tabs.forEach((t) => {
      t.addEventListener('click', (e) => {
        e.preventDefault();
        if (t.dataset.mdTab === 'preview') showPreview();
        else showWrite();
      });
    });
  });
}

function wirePills() {
  document.querySelectorAll('.editable-pill[data-pill]').forEach((el) => {
    el.addEventListener('click', () => {
      vscode.postMessage({ type: 'cmd', id: el.dataset.pill });
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
    const openLabel = trigger.textContent?.trim() ?? '';
    const closeLabel = openLabel.replace(/^\+/, '−').replace('Add', 'Hide');
    trigger.addEventListener('click', () => {
      const collapsed = form.classList.toggle('collapsed');
      trigger.textContent = collapsed ? openLabel : closeLabel;
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
