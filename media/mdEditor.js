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

  // =================================================================
  // Inline @mention autocomplete. Given a <textarea> and a `getRoster`
  // thunk returning `Map<login, {login, fullName, avatarUrl}>`, shows
  // a floating popup as the user types `@<prefix>`. Arrow keys move,
  // Enter/Tab accepts, Esc dismisses, click picks, blur closes.
  // =================================================================
  function mentionEscapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function attachMentionAutocomplete(ta, getRoster) {
    if (!ta || ta.dataset.mentionWired === '1') return;
    ta.dataset.mentionWired = '1';

    let popup = null;
    let items = [];
    let active = 0;
    let triggerStart = -1;

    const closePopup = () => {
      if (popup) { popup.remove(); popup = null; }
      items = []; active = 0; triggerStart = -1;
    };

    const render = () => {
      if (!popup) return;
      popup.innerHTML = items.map((u, i) =>
        `<div class="mention-row${i === active ? ' active' : ''}" data-i="${i}" title="@${u.login}">`
        + `<span class="mention-name">${mentionEscapeHtml(u.fullName)}</span>`
        + `<span class="mention-login">@${mentionEscapeHtml(u.login)}</span>`
        + `</div>`
      ).join('');
    };

    const accept = (idx) => {
      const pick = items[idx];
      if (!pick || triggerStart < 0) { closePopup(); return; }
      const caret = ta.selectionStart ?? ta.value.length;
      const before = ta.value.slice(0, triggerStart);
      const after = ta.value.slice(caret);
      const insertion = '@' + pick.login + ' ';
      ta.value = before + insertion + after;
      const newCaret = before.length + insertion.length;
      ta.setSelectionRange(newCaret, newCaret);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      closePopup();
    };

    const position = () => {
      if (!popup) return;
      const rect = ta.getBoundingClientRect();
      popup.style.left = `${Math.round(rect.left + 4)}px`;
      popup.style.top = `${Math.round(rect.bottom + 2)}px`;
      popup.style.minWidth = `${Math.max(220, Math.round(rect.width * 0.45))}px`;
    };

    const openPopup = () => {
      if (popup) return;
      popup = document.createElement('div');
      popup.className = 'mention-popup';
      document.body.appendChild(popup);
      position();
    };

    const update = () => {
      const caret = ta.selectionStart ?? 0;
      const upto = ta.value.slice(0, caret);
      const m = upto.match(/(?:^|[\s(])(@([A-Za-z0-9._\-]{0,40}))$/);
      if (!m) { closePopup(); return; }
      triggerStart = caret - m[1].length;
      const prefix = m[2].toLowerCase();
      const roster = getRoster();
      if (!roster || !roster.size) { closePopup(); return; }
      const pool = [...roster.values()];
      items = pool
        .filter((u) =>
          u.login.toLowerCase().includes(prefix)
          || (u.fullName || '').toLowerCase().includes(prefix))
        .slice(0, 6);
      if (!items.length) { closePopup(); return; }
      active = 0;
      openPopup();
      render();
    };

    ta.addEventListener('input', update);
    ta.addEventListener('keydown', (e) => {
      if (!popup) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % items.length; render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + items.length) % items.length; render(); }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); accept(active); }
      else if (e.key === 'Escape') { e.preventDefault(); closePopup(); }
    });
    ta.addEventListener('blur', () => setTimeout(closePopup, 120));
    ta.addEventListener('scroll', position);
    window.addEventListener('resize', position);

    document.addEventListener('mousedown', (e) => {
      if (!popup) return;
      const row = e.target.closest?.('.mention-row');
      if (row && popup.contains(row)) {
        e.preventDefault();
        accept(parseInt(row.dataset.i, 10) || 0);
      }
    });
  }

  global.YT = global.YT || {};
  global.YT.mdEditor = { wrapSelection, prefixLines, applyMd, wireToolbar, wireMdTabs, attachMentionAutocomplete };
})(window);
