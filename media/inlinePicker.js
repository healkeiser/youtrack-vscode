// Anchored dropdown picker that replaces top-of-screen QuickPicks for
// pill clicks inside the webview. Items shape:
//   { id, label, description?, icon?: { kind: 'codicon'|'dot'|'avatar', name?, color?, src? } }
// Action items (shown above a separator): same shape, with `action: true`.
(function (global) {
  let active = null;

  function escape(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function cssColor(c) {
    if (!c) return '';
    // Raw color literals (hex, rgb, hsl) pass through; theme-color IDs
    // like "charts.blue" become var(--vscode-charts-blue).
    if (/^(#|rgb|hsl)/i.test(c)) return c;
    return `var(--vscode-${c.replace(/\./g, '-')})`;
  }

  function iconHtml(icon) {
    if (!icon) return '';
    if (icon.kind === 'codicon') {
      const color = icon.color ? `color:${cssColor(icon.color)}` : '';
      return `<i class="codicon codicon-${escape(icon.name)} ip-icon" style="${color}"></i>`;
    }
    if (icon.kind === 'dot') {
      const bg = icon.color ? escape(icon.color) : 'var(--vscode-descriptionForeground)';
      return `<span class="ip-dot" style="background:${bg}"></span>`;
    }
    if (icon.kind === 'avatar') {
      return `<img class="ip-avatar" src="${escape(icon.src)}" alt="">`;
    }
    return '';
  }

  function close() {
    if (!active) return;
    const { pop, onDocDown, onKey, onConfirm } = active;
    pop.remove();
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onKey, true);
    active = null;
    if (onConfirm) onConfirm();
  }

  function open(anchor, opts) {
    close();
    const multi = !!opts.multiSelect;
    const allItems = [...(opts.actions || []).map((a) => ({ ...a, action: true })), ...(opts.items || [])];
    if (!allItems.length) return;
    const pickedSet = new Set(multi ? allItems.filter((it) => it.picked && !it.action).map((it) => it.id) : []);

    const pop = document.createElement('div');
    pop.className = 'inline-picker';
    pop.innerHTML = `
      <input type="text" class="ip-search" placeholder="${escape(opts.placeholder || 'Search…')}" autocomplete="off">
      <div class="ip-list" role="listbox"></div>
    `;
    document.body.appendChild(pop);

    // Position: anchored below the clicked pill, flip to above if there isn't
    // enough room at the bottom of the viewport.
    const rect = anchor.getBoundingClientRect();
    const listMaxH = 280;
    pop.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 320 - 8))}px`;
    pop.style.minWidth = `${Math.max(rect.width, 280)}px`;
    const below = window.innerHeight - rect.bottom;
    if (below < listMaxH + 40 && rect.top > listMaxH + 40) {
      pop.style.top = `${Math.max(8, rect.top - listMaxH - 40)}px`;
    } else {
      pop.style.top = `${rect.bottom + 2}px`;
    }

    const searchEl = pop.querySelector('.ip-search');
    const listEl = pop.querySelector('.ip-list');
    let filtered = allItems.slice();
    let activeIdx = 0;

    const nonSepIndexes = () => filtered.map((_, i) => i).filter((i) => !filtered[i].separator);
    const firstSelectableIdx = () => { const ns = nonSepIndexes(); return ns.length ? ns[0] : 0; };

    function render() {
      const parts = [];
      let sawSep = false;
      filtered.forEach((it, i) => {
        if (it.separator) {
          parts.push(`<div class="ip-sep"></div>`);
          sawSep = true;
          return;
        }
        const cls = `ip-item${i === activeIdx ? ' active' : ''}${it.action ? ' action' : ''}`;
        const iconH = iconHtml(it.icon);
        const descH = it.description ? `<span class="ip-desc">${escape(it.description)}</span>` : '';
        const checkH = multi && !it.action
          ? `<i class="codicon codicon-${pickedSet.has(it.id) ? 'check' : 'blank'} ip-check"></i>`
          : '';
        parts.push(
          `<div class="${cls}" role="option" data-idx="${i}" aria-selected="${multi && pickedSet.has(it.id)}">
            ${checkH}
            ${iconH}
            <span class="ip-label">${escape(it.label)}</span>
            ${descH}
          </div>`
        );
      });
      void sawSep;
      listEl.innerHTML = parts.join('');
      // Click events are not reliably dispatched inside VS Code webviews
      // for elements under a `position: fixed` container, so we pick on
      // pointerdown which always fires. preventDefault here stops the
      // synthetic focus/select side-effect.
      listEl.querySelectorAll('.ip-item').forEach((itemEl) => {
        const idx = Number(itemEl.dataset.idx);
        itemEl.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          pick(filtered[idx]);
        });
      });
      const el = listEl.querySelector(`.ip-item[data-idx="${activeIdx}"]`);
      if (el) el.scrollIntoView({ block: 'nearest' });
    }

    activeIdx = firstSelectableIdx();
    render();

    searchEl.addEventListener('input', () => {
      const q = searchEl.value.trim().toLowerCase();
      if (!q) filtered = allItems.slice();
      else filtered = allItems.filter((it) => !it.separator && (
        (it.label || '').toLowerCase().includes(q) ||
        (it.description || '').toLowerCase().includes(q)
      ));
      activeIdx = firstSelectableIdx();
      render();
    });

    function pick(item) {
      if (!item || item.separator) return;
      if (item.action) {
        close();
        (opts.onAction || opts.onPick)?.(item);
        return;
      }
      if (multi) {
        if (pickedSet.has(item.id)) pickedSet.delete(item.id);
        else pickedSet.add(item.id);
        opts.onToggle?.(item, pickedSet.has(item.id));
        render();
        return;
      }
      close();
      opts.onPick?.(item);
    }

    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const ns = nonSepIndexes();
        if (!ns.length) return;
        const cur = ns.indexOf(activeIdx);
        activeIdx = ns[(cur + 1) % ns.length];
        render();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const ns = nonSepIndexes();
        if (!ns.length) return;
        const cur = ns.indexOf(activeIdx);
        activeIdx = ns[(cur - 1 + ns.length) % ns.length];
        render();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        pick(filtered[activeIdx]);
        return;
      }
    };

    const onDocDown = (e) => {
      if (!pop.contains(e.target)) close();
    };

    listEl.addEventListener('mouseover', (e) => {
      const el = e.target.closest('.ip-item');
      if (!el) return;
      const idx = Number(el.dataset.idx);
      if (filtered[idx]?.separator) return;
      activeIdx = idx;
      render();
    });

    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onKey, true);

    const onConfirm = multi && opts.onConfirm ? () => opts.onConfirm([...pickedSet]) : null;
    active = { pop, onDocDown, onKey, onConfirm };
    setTimeout(() => searchEl.focus(), 0);
  }

  // Anchored text-input companion — shares positioning + close semantics
  // so the whole pill-click vocabulary lives in one file. Save/Clear/
  // Cancel fire on pointerdown to match the picker (VS Code webviews
  // drop synthesized click events for elements under a fixed container).
  function openInput(anchor, opts) {
    close();
    const pop = document.createElement('div');
    pop.className = 'inline-picker inline-input-box';
    pop.innerHTML = `
      <input type="${escape(opts.inputType || 'text')}" class="ip-search ip-input"
             value="${escape(opts.value ?? '')}"
             placeholder="${escape(opts.placeholder || '')}">
      ${opts.hint ? `<div class="ip-hint">${escape(opts.hint)}</div>` : ''}
      <div class="ip-error" hidden></div>
      <div class="ip-actions">
        <button type="button" class="btn primary ip-save">Save</button>
        ${opts.allowClear ? '<button type="button" class="btn ip-clear">Clear</button>' : ''}
        <button type="button" class="btn ip-cancel">Cancel</button>
      </div>
    `;
    document.body.appendChild(pop);

    const rect = anchor.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 320 - 8))}px`;
    pop.style.minWidth = `${Math.max(rect.width, 280)}px`;
    const below = window.innerHeight - rect.bottom;
    const needed = 140;
    if (below < needed + 40 && rect.top > needed + 40) {
      pop.style.top = `${Math.max(8, rect.top - needed - 40)}px`;
    } else {
      pop.style.top = `${rect.bottom + 2}px`;
    }

    const input = pop.querySelector('.ip-input');
    const saveBtn = pop.querySelector('.ip-save');
    const clearBtn = pop.querySelector('.ip-clear');
    const cancelBtn = pop.querySelector('.ip-cancel');
    const errEl = pop.querySelector('.ip-error');

    function showError(text) {
      errEl.textContent = text || '';
      errEl.hidden = !text;
    }
    function save() {
      const v = input.value;
      const err = opts.validate?.(v);
      if (err) { showError(err); return; }
      close();
      opts.onSubmit?.(v);
    }
    function clearValue() {
      close();
      opts.onSubmit?.(null);
    }

    input.addEventListener('input', () => showError(''));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    saveBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); save(); });
    clearBtn?.addEventListener('pointerdown', (e) => { e.preventDefault(); clearValue(); });
    cancelBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); close(); });

    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const onDocDown = (e) => { if (!pop.contains(e.target)) close(); };
    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onKey, true);

    active = { pop, onDocDown, onKey };
    setTimeout(() => { input.focus(); input.select?.(); }, 0);
  }

  global.YT = global.YT || {};
  global.YT.inlinePicker = { open, close, openInput };
  global.YT.inlineInput = { open: openInput, close };  // back-compat alias
})(window);
