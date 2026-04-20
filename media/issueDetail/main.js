const vscode = acquireVsCodeApi();

window.addEventListener('message', (evt) => {
  const msg = evt.data;
  if (msg.type === 'render') {
    document.getElementById('root').innerHTML = msg.html;
    wireForms();
    wireToolbar();
  }
});

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

vscode.postMessage({ type: 'ready' });
