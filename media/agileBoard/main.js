const vscode = acquireVsCodeApi();
let state = { columns: [], issuesByColumn: {} };
let meta = { boardTitle: '', boardId: '', sprintId: '', sprints: [] };
const persisted = vscode.getState() ?? {};
let sortMode = persisted.sortMode ?? 'default';
let filters = persisted.filters ?? { text: '', assignee: '', priority: '', tag: '' };
let colorBy = persisted.colorBy ?? 'state';

function persist() {
  // Webview state: survives panel hide/show within the session.
  vscode.setState({ ...(vscode.getState() ?? {}), sortMode, filters, colorBy });
  // GlobalState via host: survives panel close + VS Code restart.
  vscode.postMessage({ type: 'saveBoardPrefs', sortMode, filters, colorBy });
}

window.addEventListener('message', (evt) => {
  const msg = evt.data;
  if (msg.type === 'render') {
    state = msg.state;
    if (msg.meta) meta = msg.meta;
    // On the first render of a fresh panel, hydrate from the host's
    // globalState so the prefs survive across sessions. We prefer the
    // webview state if it's already set (live edits in this session).
    if (msg.prefs && !persisted.sortMode && !persisted.filters && !persisted.colorBy) {
      if (typeof msg.prefs.sortMode === 'string') sortMode = msg.prefs.sortMode;
      if (typeof msg.prefs.colorBy === 'string') colorBy = msg.prefs.colorBy;
      if (msg.prefs.filters) filters = { text: '', assignee: '', priority: '', tag: '', ...msg.prefs.filters };
      vscode.setState({ ...(vscode.getState() ?? {}), sortMode, filters, colorBy });
    }
    renderHeader();
    renderFilters();
    render();
  }
  if (msg.type === 'rollback') {
    const { issueId, fromColumnId } = msg;
    for (const cid of Object.keys(state.issuesByColumn)) {
      const idx = state.issuesByColumn[cid].findIndex((i) => i.idReadable === issueId);
      if (idx !== -1) {
        const [issue] = state.issuesByColumn[cid].splice(idx, 1);
        state.issuesByColumn[fromColumnId].push(issue);
        break;
      }
    }
    render();
  }
});

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function customField(issue, name) {
  return (issue.customFields || []).find((f) => f && f.name === name);
}

function issueStateName(issue) {
  const f = customField(issue, 'State');
  if (!f || !f.value) return '';
  if (f.value.kind === 'state' || f.value.kind === 'enum') return f.value.name || '';
  return '';
}

function issuePriority(issue) {
  const f = customField(issue, 'Priority');
  if (!f || !f.value) return '';
  if (f.value.kind === 'enum') return f.value.name || '';
  return '';
}

function issuePriorityColor(issue) {
  const f = customField(issue, 'Priority');
  if (!f || !f.value || f.value.kind !== 'enum') return null;
  return f.value.color || null;
}

function issueStateColor(issue) {
  const f = customField(issue, 'State');
  if (!f || !f.value) return null;
  if (f.value.kind === 'state' || f.value.kind === 'enum') return f.value.color || null;
  return null;
}

function cardAccentColor(issue, mode) {
  if (mode === 'priority') return issuePriorityColor(issue)?.background || null;
  if (mode === 'state')    return issueStateColor(issue)?.background || null;
  return null; // 'none' or unknown
}

function priorityRank(name) {
  const s = (name || '').toLowerCase();
  if (/show-?stopper|blocker/.test(s)) return 0;
  if (/critical/.test(s)) return 1;
  if (/major|high/.test(s)) return 2;
  if (/normal|medium/.test(s)) return 3;
  if (/minor|low/.test(s)) return 4;
  if (/trivial/.test(s)) return 5;
  return 99;
}

const SWIMLANE_MODES = new Set(['priority', 'assignee', 'state']);

function isSwimlaneMode() { return SWIMLANE_MODES.has(sortMode); }

function sortIssues(issues) {
  if (sortMode === 'default' || isSwimlaneMode()) return issues;
  const sorted = [...issues];
  switch (sortMode) {
    case 'updated':  sorted.sort((a, b) => (b.updated || 0) - (a.updated || 0)); break;
    case 'created':  sorted.sort((a, b) => (b.created || 0) - (a.created || 0)); break;
    case 'id':       sorted.sort((a, b) => a.idReadable.localeCompare(b.idReadable, undefined, { numeric: true })); break;
    case 'summary':  sorted.sort((a, b) => a.summary.localeCompare(b.summary)); break;
  }
  return sorted;
}

function swimlaneKey(issue) {
  if (sortMode === 'priority') return issuePriority(issue) || '—';
  if (sortMode === 'state')    return issueStateName(issue) || '—';
  if (sortMode === 'assignee') {
    const u = issueAssignee(issue);
    return u ? (u.fullName || u.login || '—') : 'Unassigned';
  }
  return '—';
}

function swimlaneOrder(keys) {
  if (sortMode === 'priority') {
    return [...keys].sort((a, b) => priorityRank(a) - priorityRank(b));
  }
  if (sortMode === 'state') {
    // Preserve the column order roughly: push unresolved first, done last
    return [...keys].sort((a, b) => {
      const rank = (s) => {
        const l = s.toLowerCase();
        if (/(cancel|reject|won|invalid|duplicate|obsolete)/.test(l)) return 98;
        if (/(done|fixed|closed|resolved|verified|complete)/.test(l)) return 99;
        if (/(review|pending|waiting|qa|test)/.test(l)) return 20;
        if (/(progress|develop|working|wip|active)/.test(l)) return 10;
        if (/(block|hold|paused)/.test(l)) return 30;
        if (/(submit|open|reopen|new|backlog|todo|to do)/.test(l)) return 1;
        return 50;
      };
      const d = rank(a) - rank(b);
      return d !== 0 ? d : a.localeCompare(b);
    });
  }
  return [...keys].sort((a, b) => {
    if (a === 'Unassigned') return 1;
    if (b === 'Unassigned') return -1;
    return a.localeCompare(b);
  });
}

function stateClass(name) {
  const s = (name || '').toLowerCase();
  if (!s) return '';
  if (/(done|fixed|closed|resolved|verified|complete)/.test(s)) return 'state-done';
  if (/(progress|develop|working|wip|active)/.test(s)) return 'state-progress';
  if (/(review|pending|waiting|qa|test)/.test(s)) return 'state-review';
  if (/(cancel|reject|won|invalid|duplicate|obsolete)/.test(s)) return 'state-cancelled';
  if (/(block|hold|paused)/.test(s)) return 'state-blocked';
  return '';
}

function priorityClass(name) {
  const s = (name || '').toLowerCase().replace(/\s+/g, '-');
  return s ? `prio-${s}` : '';
}

function issueAssignee(issue) {
  if (issue.assignee) return issue.assignee;
  const f = customField(issue, 'Assignee');
  if (f && f.value && f.value.kind === 'user') {
    return { fullName: f.value.fullName, login: f.value.login, avatarUrl: f.value.avatarUrl };
  }
  return null;
}

function initials(user) {
  if (user.fullName) {
    const parts = user.fullName.split(/\s+/).filter(Boolean).slice(0, 2);
    const out = parts.map((p) => p[0] || '').join('').toUpperCase();
    if (out) return out;
  }
  return (user.login || '?').slice(0, 2).toUpperCase();
}

function avatarHtml(user) {
  if (!user) return '';
  const init = escape(initials(user));
  if (user.avatarUrl && /^https?:/.test(user.avatarUrl)) {
    return `<span class="avatar">${init}<img src="${escape(user.avatarUrl)}" referrerpolicy="no-referrer" onerror="this.style.display='none'" alt=""></span>`;
  }
  return `<span class="avatar">${init}</span>`;
}

function renderHeader() {
  const titleEl = document.getElementById('boardTitle');
  if (titleEl) titleEl.textContent = meta.boardTitle || 'Agile Board';

  // Hide the sprint picker entirely for boards that have sprints
  // disabled in YouTrack — there's nothing to choose between.
  const picker = document.getElementById('sprintPicker');
  const sprintWrap = picker?.closest('.sprint-label');
  if (sprintWrap) sprintWrap.hidden = meta.sprintsEnabled === false;
  if (picker && Array.isArray(meta.sprints) && meta.sprintsEnabled !== false) {
    picker.innerHTML = meta.sprints.map((s) =>
      `<option value="${escape(s.id)}"${s.id === meta.sprintId ? ' selected' : ''}>${escape(s.name)}${s.current ? ' (current)' : ''}</option>`
    ).join('');
    picker.onchange = () => {
      vscode.postMessage({ type: 'switchSprint', sprintId: picker.value });
    };
  }

  const refresh = document.getElementById('refreshBtn');
  if (refresh) refresh.onclick = () => vscode.postMessage({ type: 'refresh' });
  const create = document.getElementById('createBtn');
  if (create) create.onclick = () => vscode.postMessage({ type: 'createIssue' });
  const openExternal = document.getElementById('openInBrowserBtn');
  if (openExternal) openExternal.onclick = () => vscode.postMessage({ type: 'openInBrowser' });

  const sortSelect = document.getElementById('sortPicker');
  if (sortSelect) {
    sortSelect.value = sortMode;
    sortSelect.onchange = () => {
      sortMode = sortSelect.value;
      persist();
      render();
    };
  }
  const colorBySelect = document.getElementById('colorByPicker');
  if (colorBySelect) {
    colorBySelect.value = colorBy;
    colorBySelect.onchange = () => {
      colorBy = colorBySelect.value;
      persist();
      render();
    };
  }
}

// ---------- filters ----------
function issueMatchesFilters(issue) {
  if (filters.assignee) {
    const u = issueAssignee(issue);
    const login = u?.login || '';
    if (filters.assignee === '__unassigned__') {
      if (u) return false;
    } else if (login !== filters.assignee) {
      return false;
    }
  }
  if (filters.priority) {
    if ((issuePriority(issue) || '').toLowerCase() !== filters.priority.toLowerCase()) return false;
  }
  if (filters.tag) {
    const tags = (issue.tags || []).map((t) => t.name);
    if (!tags.includes(filters.tag)) return false;
  }
  if (filters.text) {
    const needle = filters.text.toLowerCase();
    const haystack = [
      issue.idReadable,
      issue.summary,
      ...(issue.tags || []).map((t) => t.name),
    ].join(' ').toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

function filtersActive() {
  return !!(filters.text || filters.assignee || filters.priority || filters.tag);
}

function gatherFilterOptions() {
  const assignees = new Map(); // login → fullName
  const priorities = new Set();
  const tags = new Set();
  let hasUnassigned = false;
  for (const col of state.columns) {
    for (const issue of state.issuesByColumn[col.id] ?? []) {
      const u = issueAssignee(issue);
      if (u) assignees.set(u.login, u.fullName || u.login);
      else hasUnassigned = true;
      const p = issuePriority(issue);
      if (p) priorities.add(p);
      for (const t of issue.tags || []) tags.add(t.name);
    }
  }
  return {
    assignees: [...assignees.entries()].sort((a, b) => a[1].localeCompare(b[1])),
    hasUnassigned,
    priorities: [...priorities].sort((a, b) => priorityRank(a) - priorityRank(b)),
    tags: [...tags].sort(),
  };
}

function renderFilters() {
  const opts = gatherFilterOptions();

  const textEl = document.getElementById('filterText');
  const assigneeEl = document.getElementById('filterAssignee');
  const priorityEl = document.getElementById('filterPriority');
  const tagEl = document.getElementById('filterTag');
  const clearEl = document.getElementById('filterClear');

  if (textEl && textEl.value !== filters.text) textEl.value = filters.text;

  if (assigneeEl) {
    const unassigned = opts.hasUnassigned
      ? '<option value="__unassigned__">— Unassigned —</option>'
      : '';
    assigneeEl.innerHTML =
      `<option value="">Assignee: Any</option>`
      + unassigned
      + opts.assignees.map(([login, name]) =>
          `<option value="${escape(login)}"${login === filters.assignee ? ' selected' : ''}>${escape(name)}</option>`
        ).join('');
    if (filters.assignee && ![...assigneeEl.options].some((o) => o.value === filters.assignee)) {
      filters.assignee = '';
    }
    assigneeEl.value = filters.assignee || '';
  }

  if (priorityEl) {
    priorityEl.innerHTML =
      `<option value="">Priority: Any</option>`
      + opts.priorities.map((p) =>
          `<option value="${escape(p)}"${p === filters.priority ? ' selected' : ''}>${escape(p)}</option>`
        ).join('');
    if (filters.priority && ![...priorityEl.options].some((o) => o.value === filters.priority)) {
      filters.priority = '';
    }
    priorityEl.value = filters.priority || '';
  }

  if (tagEl) {
    tagEl.innerHTML =
      `<option value="">Tag: Any</option>`
      + opts.tags.map((t) =>
          `<option value="${escape(t)}"${t === filters.tag ? ' selected' : ''}>${escape(t)}</option>`
        ).join('');
    if (filters.tag && ![...tagEl.options].some((o) => o.value === filters.tag)) {
      filters.tag = '';
    }
    tagEl.value = filters.tag || '';
  }

  if (clearEl) clearEl.hidden = !filtersActive();

  // Wire once; `renderFilters` is called on every render but listeners
  // only attach if not yet bound (guarded by a dataset flag).
  if (textEl && !textEl.dataset.wired) {
    textEl.dataset.wired = '1';
    textEl.addEventListener('input', () => {
      filters.text = textEl.value;
      persist();
      applyFilters();
    });
  }
  for (const [el, key] of [[assigneeEl, 'assignee'], [priorityEl, 'priority'], [tagEl, 'tag']]) {
    if (el && !el.dataset.wired) {
      el.dataset.wired = '1';
      el.addEventListener('change', () => {
        filters[key] = el.value;
        persist();
        applyFilters();
      });
    }
  }
  if (clearEl && !clearEl.dataset.wired) {
    clearEl.dataset.wired = '1';
    clearEl.addEventListener('click', () => {
      filters = { text: '', assignee: '', priority: '', tag: '' };
      persist();
      renderFilters();
      render();
    });
  }

  updateFilterCount();
}

// Hide/show already-rendered cards without re-rendering the whole board
// — keeps scroll position and drag state intact. Column counts and
// swimlane counts still reflect the unfiltered totals by design.
function applyFilters() {
  const board = document.getElementById('board');
  if (!board) return;
  let visible = 0;
  let total = 0;
  board.querySelectorAll('.card[data-issue-id]').forEach((card) => {
    total++;
    const id = card.dataset.issueId;
    const issue = findIssueById(id);
    const keep = !issue || issueMatchesFilters(issue);
    card.classList.toggle('filter-hidden', !keep);
    if (keep) visible++;
  });
  updateFilterCount(visible, total);
  const clearEl = document.getElementById('filterClear');
  if (clearEl) clearEl.hidden = !filtersActive();
}

function updateFilterCount(visible, total) {
  const el = document.getElementById('filterCount');
  if (!el) return;
  if (visible == null || total == null) {
    total = 0;
    visible = 0;
    for (const col of state.columns) {
      for (const i of state.issuesByColumn[col.id] ?? []) {
        total++;
        if (issueMatchesFilters(i)) visible++;
      }
    }
  }
  if (!filtersActive()) {
    el.textContent = `${total} card${total === 1 ? '' : 's'}`;
    el.classList.remove('dimmed');
  } else {
    el.textContent = `${visible} / ${total} shown`;
    el.classList.toggle('dimmed', visible < total);
  }
}

function findIssueById(id) {
  for (const col of state.columns) {
    const hit = (state.issuesByColumn[col.id] ?? []).find((i) => i.idReadable === id);
    if (hit) return hit;
  }
  return null;
}
// ---------- /filters ----------

function renderCard(issue, colId) {
  const stateName = issueStateName(issue);
  const priority = issuePriority(issue);
  const assignee = issueAssignee(issue);
  const sCls = stateClass(stateName);
  const pCls = priorityClass(priority);

  const tagsHtml = (issue.tags || []).map((tag) => {
    const bg = tag.color && tag.color.background ? tag.color.background : 'var(--vscode-editor-inactiveSelectionBackground)';
    const fg = tag.color && tag.color.foreground ? tag.color.foreground : 'var(--vscode-foreground)';
    return `<span class="tag-pill" style="background:${escape(bg)};color:${escape(fg)}">${escape(tag.name)}</span>`;
  }).join('');

  const priColor = issuePriorityColor(issue);
  const priStyle = priColor && priColor.background
    ? `background:${priColor.background};color:${priColor.foreground || 'white'}`
    : '';
  const priClass = priStyle ? '' : ` ${pCls}`;
  const priorityBadge = priority
    ? `<span class="badge-letter priority-badge${priClass}" style="${escape(priStyle)}" title="${escape(priority)}">${escape((priority[0] || '?').toUpperCase())}</span>`
    : '';

  const metaBits = [];
  if (stateName) metaBits.push(`<span class="user-chip"><span class="state-dot ${sCls}"></span>${escape(stateName)}</span>`);

  const metaRight = assignee
    ? `<span class="spacer"></span><span class="user-chip">${avatarHtml(assignee)}${escape(assignee.fullName || assignee.login || '')}</span>`
    : '';

  // Card left-border color is driven by the user-picked field (State
  // by default, Priority optional, None to disable). Prefer the literal
  // YouTrack hex; fall back to the name-heuristic class for State when
  // the bundle has no color configured.
  const accent = cardAccentColor(issue, colorBy);
  const accentStyle = accent ? ` style="border-left-color:${escape(accent)}"` : '';
  const legacyStateCls = colorBy === 'state' && !accent ? sCls : '';
  const colorClass = colorBy === 'none' ? 'no-accent' : '';

  return `
    <div class="card ${legacyStateCls} ${colorClass}"${accentStyle} draggable="true" data-issue-id="${escape(issue.idReadable)}" data-from-column="${escape(colId)}">
      <div class="id-row">
        <span class="id">${escape(issue.idReadable)}</span>
        ${priorityBadge}
      </div>
      <div class="summary">${escape(issue.summary)}</div>
      ${tagsHtml ? `<div class="tags">${tagsHtml}</div>` : ''}
      <div class="meta">${metaBits.join('  ·  ')}${metaRight}</div>
    </div>`;
}

function attachCardBehavior(card, issue, colId) {
  card.addEventListener('dragstart', (e) => {
    card.classList.add('dragging');
    document.body.classList.add('is-dragging');
    e.dataTransfer.setData('text/plain', issue.idReadable + '|' + colId);
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    document.body.classList.remove('is-dragging');
  });
  card.addEventListener('click', () => vscode.postMessage({ type: 'openIssue', issueId: issue.idReadable }));
}

function attachColumnDrop(el, toColumnId) {
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drop-target'); });
  el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('drop-target');
    const [issueId, fromColumnId] = (e.dataTransfer.getData('text/plain') || '').split('|');
    if (!issueId || fromColumnId === toColumnId) return;
    const fromList = state.issuesByColumn[fromColumnId];
    const idx = fromList.findIndex((i) => i.idReadable === issueId);
    if (idx === -1) return;
    const [issue] = fromList.splice(idx, 1);
    (state.issuesByColumn[toColumnId] ??= []).push(issue);
    render();
    vscode.postMessage({ type: 'moveCard', issueId, fromColumnId, toColumnId });
  });
}

function renderFlatBoard(board) {
  board.className = 'board board-flat';
  const cols = state.columns;
  const colsGrid = `repeat(${cols.length}, minmax(260px, 1fr))`;

  const container = document.createElement('div');
  container.className = 'swim-container';

  const header = document.createElement('div');
  header.className = 'swim-header';
  header.style.gridTemplateColumns = colsGrid;
  for (const col of cols) {
    const count = (state.issuesByColumn[col.id] ?? []).length;
    const h = document.createElement('div');
    h.className = 'swim-header-col';
    h.innerHTML = `
      <span class="col-name">${escape(col.name)}</span>
      <span class="count-badge">${count}</span>
      <button type="button" class="col-new-btn" data-new-in-column="${escape(col.id)}" title="Create issue in ${escape(col.name)}"><i class="codicon codicon-add"></i></button>
    `;
    header.appendChild(h);
  }
  container.appendChild(header);

  const body = document.createElement('div');
  body.className = 'swim-lane-body';
  body.style.gridTemplateColumns = colsGrid;
  for (const col of cols) {
    const cell = document.createElement('div');
    cell.className = 'swim-cell';
    cell.dataset.columnId = col.id;
    const issues = sortIssues(state.issuesByColumn[col.id] ?? []);
    for (const issue of issues) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = renderCard(issue, col.id).trim();
      const card = wrapper.firstElementChild;
      attachCardBehavior(card, issue, col.id);
      cell.appendChild(card);
    }
    attachColumnDrop(cell, col.id);
    body.appendChild(cell);
  }
  container.appendChild(body);

  board.appendChild(container);
}

const collapsedLanes = new Set();

function renderSwimlaneBoard(board) {
  board.className = 'board board-swimlanes';

  // Gather unique swimlane keys in order
  const seenKeys = new Set();
  for (const col of state.columns) {
    for (const issue of state.issuesByColumn[col.id] ?? []) {
      seenKeys.add(swimlaneKey(issue));
    }
  }
  if (!seenKeys.size) {
    board.innerHTML = '<div class="board-loading">Empty sprint.</div>';
    return;
  }
  const orderedKeys = swimlaneOrder(seenKeys);
  const cols = state.columns;
  const colsGrid = `repeat(${cols.length}, minmax(260px, 1fr))`;

  const container = document.createElement('div');
  container.className = 'swim-container';

  // Sticky top header row
  const header = document.createElement('div');
  header.className = 'swim-header';
  header.style.gridTemplateColumns = colsGrid;
  for (const col of cols) {
    const total = state.issuesByColumn[col.id]?.length ?? 0;
    const h = document.createElement('div');
    h.className = 'swim-header-col';
    h.innerHTML = `
      <span class="col-name">${escape(col.name)}</span>
      <span class="count-badge">${total}</span>
      <button type="button" class="col-new-btn" data-new-in-column="${escape(col.id)}" title="Create issue in ${escape(col.name)}"><i class="codicon codicon-add"></i></button>
    `;
    header.appendChild(h);
  }
  container.appendChild(header);

  for (const key of orderedKeys) {
    const laneIssueCount = cols.reduce(
      (acc, col) => acc + (state.issuesByColumn[col.id] ?? []).filter((i) => swimlaneKey(i) === key).length,
      0,
    );
    const laneEl = document.createElement('section');
    laneEl.className = 'swim-lane';
    if (collapsedLanes.has(key)) laneEl.classList.add('collapsed');

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'swim-lane-head';
    head.innerHTML = `
      <span class="swim-chevron">▾</span>
      <span class="swim-lane-title">${escape(key)}</span>
      <span class="swim-lane-count">${laneIssueCount}</span>
    `;
    head.addEventListener('click', () => {
      if (collapsedLanes.has(key)) { collapsedLanes.delete(key); laneEl.classList.remove('collapsed'); }
      else                         { collapsedLanes.add(key);    laneEl.classList.add('collapsed'); }
    });
    laneEl.appendChild(head);

    const body = document.createElement('div');
    body.className = 'swim-lane-body';
    body.style.gridTemplateColumns = colsGrid;
    for (const col of cols) {
      const cell = document.createElement('div');
      cell.className = 'swim-cell';
      cell.dataset.columnId = col.id;

      const issuesInCell = (state.issuesByColumn[col.id] ?? []).filter((i) => swimlaneKey(i) === key);
      for (const issue of issuesInCell) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = renderCard(issue, col.id).trim();
        const card = wrapper.firstElementChild;
        attachCardBehavior(card, issue, col.id);
        cell.appendChild(card);
      }
      attachColumnDrop(cell, col.id);
      body.appendChild(cell);
    }
    laneEl.appendChild(body);
    container.appendChild(laneEl);
  }

  board.appendChild(container);
}

function render() {
  const board = document.getElementById('board');
  if (!state.columns.length) {
    board.className = 'board';
    board.innerHTML = '<div class="board-loading">No columns in this sprint.</div>';
    return;
  }
  board.innerHTML = '';
  if (isSwimlaneMode()) renderSwimlaneBoard(board);
  else renderFlatBoard(board);
  wireColumnCreateButtons(board);
  if (filtersActive()) applyFilters();
  else updateFilterCount();
}

function wireColumnCreateButtons(board) {
  board.querySelectorAll('[data-new-in-column]').forEach((btn) => {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const columnId = btn.dataset.newInColumn;
      const col = state.columns.find((c) => c.id === columnId);
      const stateName = col?.states?.[0] ?? '';
      vscode.postMessage({ type: 'createIssueInColumn', columnId, state: stateName });
    });
  });
}

vscode.postMessage({ type: 'ready' });
