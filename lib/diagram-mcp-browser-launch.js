import { spawn } from 'node:child_process';

const DIAGRAM_PATH_PATTERN = /^\/diagrams(?:\/|$)/u;
const launchHistory = new Map();
const DEDUPE_WINDOW_MS = 2_500;

function launchCommand(url) {
  if (process.platform === 'win32') return { command: 'cmd.exe', args: ['/d', '/c', 'start', '', url] };
  if (process.platform === 'darwin') return { command: 'open', args: [url] };
  return { command: 'xdg-open', args: [url] };
}

export function isOpenableDiagramUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && DIAGRAM_PATH_PATTERN.test(url.pathname);
  } catch {
    return false;
  }
}

/**
 * Ask the local operating system to open an AnchorRead diagram URL.
 * Remote HTTP MCP servers cannot spawn a process on the user's desktop;
 * a local stdio companion can provide this best-effort handoff.
 */
export function openDiagramUrl(value, { force = false } = {}) {
  const url = String(value || '').trim();
  if (!isOpenableDiagramUrl(url)) return { opened: false, code: 'WORKSPACE_URL_UNSAFE', url };
  if (String(process.env.ANCHORREAD_DIAGRAM_AUTO_OPEN || '').toLowerCase() === 'false') {
    return { opened: false, code: 'AUTO_OPEN_DISABLED', url };
  }

  const now = Date.now();
  const previous = launchHistory.get(url) || 0;
  if (!force && now - previous < DEDUPE_WINDOW_MS) return { opened: true, deduplicated: true, url };
  launchHistory.set(url, now);

  const { command, args } = launchCommand(url);
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    // spawn reports missing desktop launchers asynchronously. Keep that
    // best-effort failure from becoming an uncaught MCP process error.
    child.on('error', () => {});
    child.unref();
    return { opened: true, command, url };
  } catch (error) {
    return { opened: false, code: 'BROWSER_OPEN_FAILED', error: String(error?.message || error), command, url };
  }
}
