const vscode = acquireVsCodeApi();
let pendingMentionTarget = null;
let pendingPasteTarget = null;
let firstRender = true;
const mentionRoster = new Map(); // login -> {login, fullName, avatarUrl}

// Panel-wide keyboard shortcuts. Only fire when the user isn't typing
// into an input/textarea and no modal (inline picker/input) is open.
document.addEventListener('keydown', (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const t = e.target;
  const tag = t?.tagName;
  const editing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable;
  if (editing) return;
  if (document.querySelector('.inline-picker, .yt-lightbox')) return;

  switch (e.key.toLowerCase()) {
    case 'c': {
      const toggle = document.querySelector('[data-inline-toggle="comment"]');
      if (toggle?.classList.contains('btn')) toggle.click();
      const ta = document.querySelector('form.add-comment textarea');
      if (ta) { e.preventDefault(); ta.focus(); }
      break;
    }
    case 'r': {
      const sort = document.querySelector('[data-sort-toggle]');
      if (sort) { e.preventDefault(); sort.click(); }
      break;
    }
    case 'e': {
      const edit = document.querySelector('.editable[data-field="description"] [data-edit="description"]');
      if (edit) { e.preventDefault(); edit.click(); }
      break;
    }
    case '?': {
      e.preventDefault();
      showKeyboardHelp();
      break;
    }
  }
});

function showKeyboardHelp() {
  vscode.postMessage({ type: 'showKeyboardHelp' });
}

window.addEventListener('message', (evt) => {
  const msg = evt.data;
  if (msg.type === 'render') {
    if (firstRender) {
      firstRender = false;
      document.body.classList.add('ytvsc-initial');
      // Remove once the stagger has finished so subsequent reloads
      // (picker apply, sort toggle, refresh) render instantly.
      setTimeout(() => document.body.classList.remove('ytvsc-initial'), 600);
    }
    document.getElementById('root').innerHTML = msg.html;
    wireForms();
    wireToolbar();
    wireCommentToolbars();
    wireLogTimeToggle();
    wireEditables();
    wireMdTabs();
    wireCommentEdits();
    wireCommentReactions();
    wirePills();
    wireLinkChips();
    wireDraftPersistence();
    wireMentionAutocomplete();
    wireAttachPicker();
    wirePasteUpload();
    wireWorkTypePicker();
    wireSortToggle();
    wireImageLightbox();
  }
  if (msg.type === 'pasteInserted' && typeof msg.markdown === 'string') {
    const ta = pendingPasteTarget ?? document.querySelector('form.add-comment textarea');
    if (ta) YT.mdEditor.insertAtCursor(ta, msg.markdown);
    pendingPasteTarget = null;
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
      onConfirm: req.onConfirm,
    });
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

// Attachments that will be posted with the next new comment. Bytes
// stay in webview memory until submit; on submit we POST the text
// comment first, then upload each file to the comment's own
// /attachments endpoint so YouTrack binds them to the comment.
// Item shape: { name, mime, bytes: Uint8Array, dataBase64, blobUrl }.
let queuedCommentAttachments = [];

function uploadMode(ta) {
  // Only the add-comment form uses the queue flow; description /
  // comment-edit textareas keep the inline-markdown behavior because
  // they're long-form markdown.
  return ta?.closest('form.add-comment') ? 'queue' : 'inline';
}

const onAttach = (ta) => {
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.multiple = true;
  picker.style.display = 'none';
  picker.addEventListener('change', async () => {
    const files = picker.files ? Array.from(picker.files) : [];
    const mode = uploadMode(ta);
    for (const file of files) {
      const buf = new Uint8Array(await file.arrayBuffer());
      if (mode === 'queue') {
        queueCommentFile({
          name: file.name,
          mime: file.type || 'application/octet-stream',
          bytes: buf,
        });
      } else {
        pendingPasteTarget = ta;
        vscode.postMessage({
          type: 'uploadAttachment',
          name: file.name,
          mime: file.type || 'application/octet-stream',
          dataBase64: YT.mdEditor.toBase64(buf),
          mode,
        });
      }
    }
    picker.remove();
  });
  document.body.appendChild(picker);
  picker.click();
};

function queueCommentFile(file) {
  // Use a local blob URL for the preview thumbnail so we don't round-
  // trip the bytes through the host just to show it.
  const blob = new Blob([file.bytes], { type: file.mime });
  const blobUrl = URL.createObjectURL(blob);
  queuedCommentAttachments.push({
    name: file.name,
    mime: file.mime,
    bytes: file.bytes,
    blobUrl,
  });
  renderCommentAttachmentQueue();
}

function renderCommentAttachmentQueue() {
  const holder = document.querySelector('form.add-comment .queued-attachments');
  if (!holder) return;
  if (!queuedCommentAttachments.length) {
    holder.innerHTML = '';
    holder.hidden = true;
    return;
  }
  holder.hidden = false;
  holder.innerHTML = queuedCommentAttachments.map((a, i) => {
    const isImage = (a.mime ?? '').toLowerCase().startsWith('image/')
      || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(a.name);
    const inner = isImage
      ? `<img src="${escapeText(a.blobUrl)}" alt="${escapeText(a.name)}">`
      : `<i class="codicon codicon-file"></i>`;
    return `<div class="attachment-tile ${isImage ? 'image' : 'file'} queued" data-idx="${i}" title="${escapeText(a.name)}">
      ${inner}
      <span class="attachment-meta"><span class="name">${escapeText(a.name)}</span></span>
      <button type="button" class="queued-remove" data-remove="${i}" title="Remove from this comment"><i class="codicon codicon-close"></i></button>
    </div>`;
  }).join('');
  holder.querySelectorAll('.queued-remove').forEach((btn) => {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const idx = Number(btn.dataset.remove);
      if (!Number.isNaN(idx)) {
        const removed = queuedCommentAttachments.splice(idx, 1)[0];
        if (removed?.blobUrl) URL.revokeObjectURL(removed.blobUrl);
        renderCommentAttachmentQueue();
      }
    });
  });
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
      const files = queuedCommentAttachments.map((a) => ({
        name: a.name,
        mime: a.mime,
        dataBase64: YT.mdEditor.toBase64(a.bytes),
      }));
      if (!text && !files.length) return;
      vscode.postMessage({ type: 'addComment', text, files });
      queuedCommentAttachments.forEach((a) => a.blobUrl && URL.revokeObjectURL(a.blobUrl));
      queuedCommentAttachments = [];
      renderCommentAttachmentQueue();
      commentForm.reset();
    });
    renderCommentAttachmentQueue();
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
    YT.mdEditor.wireToolbar(bar, ta, { onMention, onAttach });
  });
}

function wireMdTabs() {
  document.querySelectorAll('.md-form').forEach((form) => {
    YT.mdEditor.wireMdTabs(form, (f, text) => {
      vscode.postMessage({ type: 'renderPreview', formId: f.id, text });
    });
  });
}

let pickerRequestId = 0;
const pendingPicker = new Map(); // requestId -> { anchor, kind, fieldName, onPick }

function wirePills() {
  document.querySelectorAll('.editable-pill[data-pill]').forEach((el) => {
    el.addEventListener('click', () => openPill(el));
  });
}

function openPill(el) {
  const kind = el.dataset.inlineKind;
  if (!kind) {
    vscode.postMessage({ type: 'cmd', id: el.dataset.pill, fieldName: el.dataset.fieldName });
    return;
  }
  const fieldName = el.dataset.fieldName || defaultFieldName(el.dataset.pill);
  const requestId = `rq-${++pickerRequestId}`;

  if (kind === 'tags') {
    const currentIds = (el.dataset.currentIds || '').split(',').filter(Boolean);
    pendingPicker.set(requestId, {
      anchor: el,
      multiSelect: true,
      onToggle: (item, picked) => {
        vscode.postMessage({ type: 'toggleIssueTag', tagId: item.id, picked });
      },
      onAction: (item) => {
        if (item.id === '__new_tag__') vscode.postMessage({ type: 'createAndAttachTag' });
      },
      onConfirm: () => {
        vscode.postMessage({ type: 'reloadIssue' });
      },
    });
    vscode.postMessage({
      type: 'openInlinePicker', requestId, kind: 'tags', currentIds,
    });
    return;
  }

  if (kind === 'links') {
    let existingLinks = [];
    try { existingLinks = JSON.parse(el.dataset.existingLinks || '[]'); } catch { /* ignore */ }
    pendingPicker.set(requestId, {
      anchor: el,
      onAction: (item) => {
        if (item.id.startsWith('__remove__')) {
          const [verb, target] = item.id.slice('__remove__'.length).split('|');
          vscode.postMessage({ type: 'removeIssueLink', verb, targetId: target });
        } else if (item.id.startsWith('__add__')) {
          const verb = item.id.slice('__add__'.length);
          vscode.postMessage({ type: 'addIssueLink', verb });
        }
      },
    });
    vscode.postMessage({
      type: 'openInlinePicker', requestId, kind: 'links', existingLinks,
    });
    return;
  }

  // Bool: two-item inline picker, no roundtrip needed.
  if (kind === 'bool') {
    YT.inlinePicker.open(el, {
      items: [
        { id: '1', label: 'Yes', icon: { kind: 'codicon', name: 'check' } },
        { id: '0', label: 'No',  icon: { kind: 'codicon', name: 'close' } },
      ],
      onPick: (item) => {
        vscode.postMessage({ type: 'applyInlinePick', kind: 'bool', fieldName, valueId: item.id });
      },
    });
    return;
  }

  // Text/date/number edits: open the inline input anchored to the pill.
  if (kind === 'date' || kind === 'datetime' || kind === 'period' || kind === 'string' || kind === 'int' || kind === 'float') {
    const raw = el.dataset.rawValue || '';
    const allowClear = el.dataset.allowClear === '1';
    const hints = {
      date: 'Pick a date.',
      datetime: 'Pick a date and time.',
      period: 'Like "1h 30m", "45m", "3h".',
      int: 'Whole number.',
      float: 'Number.',
      string: '',
    };
    const inputType = kind === 'date'
      ? 'date'
      : kind === 'datetime'
      ? 'datetime-local'
      : (kind === 'int' || kind === 'float' ? 'number' : 'text');
    YT.inlinePicker.openInput(el, {
      value: raw,
      inputType,
      hint: hints[kind],
      allowClear,
      validate: (v) => {
        const t = (v ?? '').trim();
        if (!t) return undefined;
        if (kind === 'int' && !/^-?\d+$/.test(t)) return 'Must be an integer';
        if (kind === 'float' && Number.isNaN(Number(t))) return 'Must be a number';
        if (kind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(t)) return 'Format: YYYY-MM-DD';
        if (kind === 'datetime' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(t)) return 'Format: YYYY-MM-DDThh:mm';
        return undefined;
      },
      onSubmit: (v) => {
        const payload = v == null ? null : (v === '' ? null : v);
        vscode.postMessage({ type: 'applyInlinePick', kind, fieldName, valueId: payload });
      },
    });
    return;
  }

  pendingPicker.set(requestId, {
    anchor: el,
    kind,
    fieldName,
    onPick: (item) => {
      vscode.postMessage({
        type: 'applyInlinePick',
        kind,
        fieldName,
        valueId: item.id === '__clear__' ? null : item.id,
      });
    },
  });
  vscode.postMessage({
    type: 'openInlinePicker',
    requestId,
    kind,
    fieldName,
    allowClear: el.dataset.allowClear === '1',
    clearLabel: el.dataset.clearLabel,
  });
}

function defaultFieldName(pill) {
  if (pill === 'changeState') return 'State';
  if (pill === 'changePriority') return 'Priority';
  if (pill === 'changeAssignee') return 'Assignee';
  return undefined;
}

function wireLinkChips() {
  document.querySelectorAll('[data-open-issue]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      vscode.postMessage({ type: 'openLinkedIssue', id: el.dataset.openIssue });
    });
  });
}

function wireCommentReactions() {
  // The emoji set matches the host's REACTION_EMOJI. Kept inline so we
  // can render the inline picker without a host round-trip.
  const REACTIONS = [
    { name: 'thumbs-up',  glyph: '👍', label: 'thumbs up' },
    { name: 'thumbs-down', glyph: '👎', label: 'thumbs down' },
    { name: 'smile',      glyph: '😄', label: 'smile' },
    { name: 'tada',       glyph: '🎉', label: 'tada' },
    { name: 'thinking',   glyph: '🤔', label: 'thinking' },
    { name: 'heart',      glyph: '❤️', label: 'heart' },
    { name: 'rocket',     glyph: '🚀', label: 'rocket' },
    { name: 'eyes',       glyph: '👀', label: 'eyes' },
  ];
  document.querySelectorAll('[data-react-comment]').forEach((btn) => {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const commentId = btn.dataset.reactComment;
      if (!commentId) return;
      YT.inlinePicker.open(btn, {
        items: REACTIONS.map((r) => ({
          id: r.name,
          label: `${r.glyph}  ${r.label}`,
        })),
        onPick: (item) => {
          vscode.postMessage({
            type: 'addCommentReaction',
            commentId,
            reaction: item.id,
          });
        },
      });
    });
  });
  // Toggle chips (existing reactions). "active" chip → remove my reaction,
  // otherwise → add my own (in addition to the group).
  document.querySelectorAll('.reaction-chip').forEach((chip) => {
    chip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const commentId = chip.dataset.reactCommentTarget;
      if (!commentId) return;
      const removeId = chip.dataset.removeReactionId;
      const addName = chip.dataset.addReaction;
      if (removeId) {
        vscode.postMessage({ type: 'removeCommentReaction', commentId, reactionId: removeId });
      } else if (addName) {
        vscode.postMessage({ type: 'addCommentReaction', commentId, reaction: addName });
      }
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

// Image lightbox: a minimal gallery with a thumbnail strip and arrow-key
// navigation. Opened by clicking any attachment tile OR inline image.
// Gallery set is whatever the caller passes; callers typically pass the
// full list of image attachments on the panel.
let lightboxState = null;

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function openLightbox(images, startIndex) {
  closeLightbox();
  if (!Array.isArray(images) || !images.length) return;
  const idx = Math.max(0, Math.min(images.length - 1, startIndex || 0));

  const overlay = document.createElement('div');
  overlay.className = 'yt-lightbox';
  overlay.innerHTML = `
    <button type="button" class="yt-lb-close" title="Close (Esc)"><i class="codicon codicon-close"></i></button>
    <button type="button" class="yt-lb-nav yt-lb-prev" title="Previous (←)" ${images.length < 2 ? 'hidden' : ''}><i class="codicon codicon-chevron-left"></i></button>
    <button type="button" class="yt-lb-nav yt-lb-next" title="Next (→)" ${images.length < 2 ? 'hidden' : ''}><i class="codicon codicon-chevron-right"></i></button>
    <div class="yt-lb-stage"><img class="yt-lb-img" alt=""></div>
    <div class="yt-lb-caption"></div>
    <div class="yt-lb-strip" ${images.length < 2 ? 'hidden' : ''}>
      ${images.map((it, i) => `
        <div class="yt-lb-thumb" data-i="${i}" title="${escHtml(it.name)}">
          <img src="${escHtml(it.src)}" alt="">
        </div>
      `).join('')}
    </div>
  `;
  document.body.appendChild(overlay);

  const imgEl = overlay.querySelector('.yt-lb-img');
  const capEl = overlay.querySelector('.yt-lb-caption');
  const stripEl = overlay.querySelector('.yt-lb-strip');

  lightboxState = { overlay, images, idx };
  render();

  function render() {
    const cur = images[lightboxState.idx];
    imgEl.src = cur.src;
    capEl.textContent = cur.name
      ? `${cur.name}${images.length > 1 ? `  ·  ${lightboxState.idx + 1} / ${images.length}` : ''}`
      : (images.length > 1 ? `${lightboxState.idx + 1} / ${images.length}` : '');
    overlay.querySelectorAll('.yt-lb-thumb').forEach((t) => {
      t.classList.toggle('active', Number(t.dataset.i) === lightboxState.idx);
    });
    // Scroll active thumbnail into view
    overlay.querySelector('.yt-lb-thumb.active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  function step(delta) {
    if (!lightboxState) return;
    const n = lightboxState.images.length;
    lightboxState.idx = (lightboxState.idx + delta + n) % n;
    render();
  }

  overlay.addEventListener('pointerdown', (e) => {
    const t = e.target;
    if (t.closest('.yt-lb-close')) { closeLightbox(); return; }
    if (t.closest('.yt-lb-prev')) { e.stopPropagation(); step(-1); return; }
    if (t.closest('.yt-lb-next')) { e.stopPropagation(); step(1); return; }
    const thumb = t.closest('.yt-lb-thumb');
    if (thumb) {
      e.stopPropagation();
      const i = Number(thumb.dataset.i);
      if (!Number.isNaN(i)) { lightboxState.idx = i; render(); }
      return;
    }
    if (t.closest('.yt-lb-stage') || t.closest('.yt-lb-strip') || t === stripEl) {
      e.stopPropagation();
      return;
    }
    if (t === overlay) closeLightbox();
  });
}

function closeLightbox() {
  lightboxState?.overlay.remove();
  lightboxState = null;
}

document.addEventListener('keydown', (e) => {
  if (!lightboxState) return;
  if (e.key === 'Escape')    { e.preventDefault(); closeLightbox(); }
  else if (e.key === 'ArrowLeft')  { e.preventDefault(); stepLightbox(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); stepLightbox(1); }
});

function stepLightbox(delta) {
  if (!lightboxState) return;
  const n = lightboxState.images.length;
  lightboxState.idx = (lightboxState.idx + delta + n) % n;
  const cur = lightboxState.images[lightboxState.idx];
  const imgEl = lightboxState.overlay.querySelector('.yt-lb-img');
  const capEl = lightboxState.overlay.querySelector('.yt-lb-caption');
  imgEl.src = cur.src;
  capEl.textContent = cur.name
    ? `${cur.name}  ·  ${lightboxState.idx + 1} / ${n}`
    : `${lightboxState.idx + 1} / ${n}`;
  lightboxState.overlay.querySelectorAll('.yt-lb-thumb').forEach((t) => {
    t.classList.toggle('active', Number(t.dataset.i) === lightboxState.idx);
  });
  lightboxState.overlay.querySelector('.yt-lb-thumb.active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
}

// Walk every image attachment tile on the panel to build the gallery
// list. Inline images in comments/description become part of the same
// list if they resolve to one of the issue's attachments; otherwise the
// clicked image opens standalone.
function collectGallery() {
  const tiles = document.querySelectorAll('[data-lightbox="1"]');
  return Array.from(tiles).map((t) => ({
    src: t.getAttribute('data-href') || '',
    name: t.querySelector('.name')?.textContent || '',
  }));
}

function wireImageLightbox() {
  // Tiles open with the full gallery set and the clicked tile as the
  // starting index. pointerdown because click events are sometimes
  // swallowed inside the webview for fixed-position descendants.
  const tiles = Array.from(document.querySelectorAll('[data-lightbox="1"]'));
  tiles.forEach((tile, i) => {
    tile.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      openLightbox(collectGallery(), i);
    });
  });

  // Inline <img> in comments/description/work-item bodies: open the
  // same gallery if the inline image matches one of the tiles by src,
  // otherwise open a standalone one-image lightbox.
  document.querySelectorAll('.md-body img, .comment-view img').forEach((img) => {
    img.style.cursor = 'zoom-in';
    const open = (e) => {
      e.preventDefault();
      const src = img.getAttribute('src') || '';
      const gallery = collectGallery();
      const match = gallery.findIndex((g) => g.src === src);
      if (match >= 0) openLightbox(gallery, match);
      else openLightbox([{ src, name: img.getAttribute('alt') || '' }], 0);
    };
    img.addEventListener('pointerdown', open);
    img.addEventListener('click', (e) => e.preventDefault());
    const anchor = img.closest('a');
    if (anchor) {
      anchor.addEventListener('click', (e) => e.preventDefault());
      anchor.addEventListener('pointerdown', open);
      anchor.removeAttribute('target');
    }
  });
}

function wireSortToggle() {
  document.querySelectorAll('[data-sort-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => vscode.postMessage({ type: 'toggleActivitySort' }));
  });
}

function wireWorkTypePicker() {
  document.querySelectorAll('[data-work-type-pick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const form = btn.closest('form');
      const hidden = form?.querySelector('input[name="type"]');
      const requestId = `rq-${++pickerRequestId}`;
      pendingPicker.set(requestId, {
        anchor: btn,
        onPick: (item) => {
          const id = item.id === '__clear__' ? '' : item.id;
          btn.dataset.workTypeId = id;
          btn.innerHTML = id
            ? `<span>${escapeText(item.label)}</span>`
            : '<span class="muted">(no type)</span>';
          if (hidden) hidden.value = id;
        },
      });
      vscode.postMessage({ type: 'openInlinePicker', requestId, kind: 'workItemType' });
    });
  });
}

function escapeText(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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

function wirePasteUpload() {
  document.querySelectorAll('form.add-comment textarea, form.comment-edit textarea, .editable-edit textarea').forEach((ta) => {
    YT.mdEditor.attachPasteUpload(ta, (payload) => {
      if (uploadMode(payload.textarea) === 'queue') {
        // Convert base64 back to bytes for the local preview path.
        const raw = atob(payload.dataBase64);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        queueCommentFile({ name: payload.name, mime: payload.mime, bytes });
      } else {
        pendingPasteTarget = payload.textarea;
        vscode.postMessage({
          type: 'uploadAttachment',
          name: payload.name,
          mime: payload.mime,
          dataBase64: payload.dataBase64,
          mode: 'inline',
        });
      }
    });
  });
}

function wireAttachPicker() {
  const btn = document.querySelector('[data-attach-pick]');
  const input = document.querySelector('[data-attach-input]');
  if (!btn || !input) return;
  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const files = input.files ? Array.from(input.files) : [];
    for (const file of files) {
      const buf = new Uint8Array(await file.arrayBuffer());
      vscode.postMessage({
        type: 'uploadAttachment',
        name: file.name,
        mime: file.type || 'application/octet-stream',
        dataBase64: toBase64(buf),
      });
    }
    input.value = '';
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
