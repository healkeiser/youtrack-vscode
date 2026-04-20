const vscode = acquireVsCodeApi();

window.addEventListener('message', (evt) => {
  const msg = evt.data;
  if (msg.type === 'render') {
    document.getElementById('root').innerHTML = msg.html;
    wireForms();
    wireToolbar();
    wireCommentToolbar();
    wireLogTimeToggle();
    wireEditables();
  }
  if (msg.type === 'insertMention' && typeof msg.login === 'string') {
    insertAtCursor(getCommentTextarea(), '@' + msg.login + ' ');
  }
});

function getCommentTextarea() {
  return document.querySelector('form.add-comment textarea');
}

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

function wireCommentToolbar() {
  const bar = document.querySelector('.comment-toolbar');
  if (!bar) return;
  const ta = getCommentTextarea();
  bar.querySelectorAll('button[data-md]').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.preventDefault();
      const kind = b.dataset.md;
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
        case 'mention': vscode.postMessage({ type: 'pickMention' }); break;
      }
    });
  });

  if (ta) {
    ta.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'b') { e.preventDefault(); wrapSelection(ta, '**', '**'); }
      else if (e.key === 'i') { e.preventDefault(); wrapSelection(ta, '*', '*'); }
      else if (e.key === 'k') { e.preventDefault(); wrapSelection(ta, '[', '](https://)'); }
      else if (e.key === 'e') { e.preventDefault(); wrapSelection(ta, '`', '`'); }
    });
  }
}

function wireEditables() {
  document.querySelectorAll('.editable').forEach((block) => {
    const field = block.dataset.field;
    const view = block.querySelector('.editable-view');
    const form = block.querySelector('.editable-edit');
    const input = form?.querySelector('input[name="text"], textarea[name="text"]');
    const cancel = form?.querySelector('[data-edit-cancel]');
    const editBtn = view?.querySelector('[data-edit]');

    editBtn?.addEventListener('click', () => {
      view.hidden = true;
      form.hidden = false;
      input?.focus();
    });
    cancel?.addEventListener('click', () => {
      form.hidden = true;
      view.hidden = false;
    });
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = input?.value ?? '';
      vscode.postMessage({ type: 'updateField', field, value });
    });
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { form.hidden = true; view.hidden = false; }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { form.requestSubmit(); }
    });
  });
}

function wireLogTimeToggle() {
  const trigger = document.querySelector('[data-log-toggle]');
  const form = document.querySelector('form.log-time');
  if (!trigger || !form) return;
  trigger.addEventListener('click', () => {
    const collapsed = form.classList.toggle('collapsed');
    trigger.textContent = collapsed ? '+ Add spent time' : '− Hide form';
    if (!collapsed) form.querySelector('input[name="duration"]')?.focus();
  });
}

vscode.postMessage({ type: 'ready' });
