// Shared markdown-editor helpers. Loaded before each panel's main.js.
// Exposes `YT.mdEditor` with: wrapSelection, prefixLines, applyMd,
// wireToolbar, wireMdTabs.
(function (global) {
  function wrapSelection(el, before, after) {
    if (!el) return;
    el.focus();
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const selected = el.value.slice(start, end);
    el.value = el.value.slice(0, start) + before + selected + after + el.value.slice(end);
    const caretStart = start + before.length;
    el.setSelectionRange(caretStart, caretStart + selected.length);
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

  function applyMd(kind, ta, opts) {
    switch (kind) {
      case 'bold':      wrapSelection(ta, '**', '**'); break;
      case 'italic':    wrapSelection(ta, '*', '*'); break;
      case 'strike':    wrapSelection(ta, '~~', '~~'); break;
      case 'code':      wrapSelection(ta, '`', '`'); break;
      case 'codeblock': wrapSelection(ta, '\n```\n', '\n```\n'); break;
      case 'link':      wrapSelection(ta, '[', '](https://)'); break;
      case 'quote':     prefixLines(ta, '> '); break;
      case 'ul':        prefixLines(ta, '- '); break;
      case 'ol':        prefixLines(ta, (_l, i) => `${i + 1}. `); break;
      case 'mention':
        if (opts && typeof opts.onMention === 'function') opts.onMention(ta);
        break;
    }
  }

  // Wire a single .comment-toolbar + its sibling <textarea>.
  // `opts.onMention` is optional; when the toolbar has no data-md="mention"
  // button it's never called.
  function wireToolbar(bar, ta, opts) {
    if (!bar || !ta) return;
    bar.querySelectorAll('button[data-md]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.preventDefault();
        applyMd(b.dataset.md, ta, opts);
      });
    });
    ta.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'b')      { e.preventDefault(); applyMd('bold', ta, opts); }
      else if (e.key === 'i') { e.preventDefault(); applyMd('italic', ta, opts); }
      else if (e.key === 'k') { e.preventDefault(); applyMd('link', ta, opts); }
      else if (e.key === 'e') { e.preventDefault(); applyMd('code', ta, opts); }
    });
  }

  // Wire Write/Preview tab switching for a `.md-form` container.
  // `onPreview(form, text)` is called when Preview is activated —
  // the caller is responsible for delivering rendered HTML back
  // (typically by postMessage + listening for a 'previewHtml' reply).
  let mdFormCounter = 0;
  function wireMdTabs(form, onPreview) {
    if (!form) return;
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
      if (typeof onPreview === 'function') onPreview(form, textarea.value);
    };

    tabs.forEach((t) => {
      t.addEventListener('click', (e) => {
        e.preventDefault();
        if (t.dataset.mdTab === 'preview') showPreview();
        else showWrite();
      });
    });
  }

  global.YT = global.YT || {};
  global.YT.mdEditor = { wrapSelection, prefixLines, applyMd, wireToolbar, wireMdTabs };
})(window);
