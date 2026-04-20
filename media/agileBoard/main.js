const vscode = acquireVsCodeApi();
let state = { columns: [], issuesByColumn: {} };
let meta = { boardTitle: '', boardId: '', sprintId: '', sprints: [] };
let sortMode = (vscode.getState()?.sortMode) ?? 'default';

window.addEventListener('message', (evt) => {
  const msg = evt.data;
  if (msg.type === 'render') {
    state = msg.state;
    if (msg.meta) meta = msg.meta;
    renderHeader();
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

  const picker = document.getElementById('sprintPicker');
  if (picker && Array.isArray(meta.sprints)) {
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

  const sortSelect = document.getElementById('sortPicker');
  if (sortSelect) {
    sortSelect.value = sortMode;
    sortSelect.onchange = () => {
      sortMode = sortSelect.value;
      vscode.setState({ ...(vscode.getState() ?? {}), sortMode });
      render();
    };
  }
}

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

  return `
    <div class="card ${sCls}" draggable="true" data-issue-id="${escape(issue.idReadable)}" data-from-column="${escape(colId)}">
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
    h.innerHTML = `<span>${escape(col.name)}</span><span class="count-badge">${count}</span>`;
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
    h.innerHTML = `<span>${escape(col.name)}</span><span class="count-badge">${total}</span>`;
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
}

vscode.postMessage({ type: 'ready' });
