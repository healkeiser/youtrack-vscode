const vscode = acquireVsCodeApi();
let state = { columns: [], issuesByColumn: {} };

window.addEventListener('message', (evt) => {
  const msg = evt.data;
  if (msg.type === 'render') { state = msg.state; render(); }
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

function issueStateName(issue) {
  const f = (issue.customFields || []).find((x) => x && x.name === 'State');
  if (!f) return '';
  const v = f.value;
  if (!v) return '';
  if (v.kind === 'state' || v.kind === 'enum') return v.name || '';
  return '';
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

function issueAssignee(issue) {
  if (issue.assignee) return issue.assignee.fullName || issue.assignee.login || '';
  const f = (issue.customFields || []).find((x) => x && x.name === 'Assignee');
  if (f && f.value && f.value.kind === 'user') return f.value.fullName || f.value.login || '';
  return '';
}

function render() {
  const board = document.getElementById('board');
  board.innerHTML = '';
  for (const col of state.columns) {
    const issues = state.issuesByColumn[col.id] ?? [];
    const colEl = document.createElement('div');
    colEl.className = 'column';
    colEl.dataset.columnId = col.id;
    colEl.innerHTML = `<h4><span>${escape(col.name)}</span><span class="count-badge">${issues.length}</span></h4>`;

    for (const issue of issues) {
      const stateName = issueStateName(issue);
      const assignee = issueAssignee(issue);
      const cls = stateClass(stateName);

      const card = document.createElement('div');
      card.className = 'card' + (cls ? ' ' + cls : '');
      card.draggable = true;
      card.dataset.issueId = issue.idReadable;
      card.dataset.fromColumn = col.id;

      const metaBits = [];
      if (stateName) metaBits.push(`<span class="state-dot ${cls}"></span>${escape(stateName)}`);
      if (assignee) metaBits.push(escape(assignee));
      const meta = metaBits.length ? `<div class="meta">${metaBits.join(' · ')}</div>` : '';

      card.innerHTML = `<div class="id">${escape(issue.idReadable)}</div><div class="summary">${escape(issue.summary)}</div>${meta}`;
      card.addEventListener('dragstart', (e) => { card.classList.add('dragging'); e.dataTransfer.setData('text/plain', issue.idReadable + '|' + col.id); });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      card.addEventListener('click', () => vscode.postMessage({ type: 'openIssue', issueId: issue.idReadable }));
      colEl.appendChild(card);
    }

    colEl.addEventListener('dragover', (e) => { e.preventDefault(); colEl.classList.add('drop-target'); });
    colEl.addEventListener('dragleave', () => colEl.classList.remove('drop-target'));
    colEl.addEventListener('drop', (e) => {
      e.preventDefault();
      colEl.classList.remove('drop-target');
      const [issueId, fromColumnId] = (e.dataTransfer.getData('text/plain') || '').split('|');
      if (!issueId || fromColumnId === col.id) return;
      const fromList = state.issuesByColumn[fromColumnId];
      const idx = fromList.findIndex((i) => i.idReadable === issueId);
      if (idx === -1) return;
      const [issue] = fromList.splice(idx, 1);
      (state.issuesByColumn[col.id] ??= []).push(issue);
      render();
      vscode.postMessage({ type: 'moveCard', issueId, fromColumnId, toColumnId: col.id });
    });

    board.appendChild(colEl);
  }
}

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

vscode.postMessage({ type: 'ready' });
