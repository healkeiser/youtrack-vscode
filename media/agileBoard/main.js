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

function render() {
  const board = document.getElementById('board');
  board.innerHTML = '';
  for (const col of state.columns) {
    const colEl = document.createElement('div');
    colEl.className = 'column';
    colEl.dataset.columnId = col.id;
    colEl.innerHTML = `<h4>${escape(col.name)}</h4>`;

    for (const issue of state.issuesByColumn[col.id] ?? []) {
      const card = document.createElement('div');
      card.className = 'card';
      card.draggable = true;
      card.dataset.issueId = issue.idReadable;
      card.dataset.fromColumn = col.id;
      card.innerHTML = `<div class="id">${escape(issue.idReadable)}</div><div class="summary">${escape(issue.summary)}</div>`;
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
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

vscode.postMessage({ type: 'ready' });
