import { App } from '@modelcontextprotocol/ext-apps/app-with-deps';

const handlersRef = { current: {} };
const pendingEventsRef = { current: [] };
const app = new App({ name: 'AnchorRead Excalidraw', version: '1.0.0' }, {}, { autoResize: true });
const dispatchEvent = (kind, payload) => {
  const handler = handlersRef.current[kind];
  if (handler) handler(payload);
  else pendingEventsRef.current.push({ kind, payload });
};

// The host can send one-shot tool notifications during the handshake.
app.ontoolinputpartial = (input) => dispatchEvent('partial', input);
app.ontoolinput = (input) => dispatchEvent('input', input);
app.ontoolresult = (result) => dispatchEvent('result', result);
app.onerror = (error) => dispatchEvent('error', error);

const ready = app.connect();
window.anchorReadMcpApp = { app, ready, handlersRef, pendingEventsRef };
ready.catch((error) => {
  document.getElementById('root').textContent = 'MCP App 连接失败：' + (error?.message || error);
});
