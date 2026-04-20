const vscode = acquireVsCodeApi();

window.addEventListener('message', (evt) => {
  const msg = evt.data;
  if (msg.type === 'render') {
    document.getElementById('root').innerHTML = msg.html;
    wireForms();
  }
});

function wireForms() {
  const form = document.querySelector('form.log-time');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    vscode.postMessage({
      type: 'logTime',
      duration: fd.get('duration'),
      date: fd.get('date'),
      typeId: fd.get('type'),
      text: fd.get('text'),
    });
  });
}

vscode.postMessage({ type: 'ready' });
