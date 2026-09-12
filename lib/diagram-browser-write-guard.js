import { createBrowserBuildStaleError, getDiagramAgentBuildInfo } from './diagram-agent-protocol.js';

const GUARD_KEY = Symbol.for('anchor-read.diagram-browser-write-guard');

function state() {
  if (!globalThis[GUARD_KEY]) {
    globalThis[GUARD_KEY] = {
      writable: true,
      actual: getDiagramAgentBuildInfo(),
      expected: getDiagramAgentBuildInfo(),
      workspaceUrl: '/diagrams',
    };
  }
  return globalThis[GUARD_KEY];
}

export function beginDiagramBrowserHandshake({ workspaceUrl } = {}) {
  Object.assign(state(), {
    writable: false,
    actual: getDiagramAgentBuildInfo(),
    expected: getDiagramAgentBuildInfo(),
    workspaceUrl: workspaceUrl || globalThis.location?.href || '/diagrams',
  });
}

export function allowDiagramBrowserWrites(actual = getDiagramAgentBuildInfo()) {
  Object.assign(state(), { writable: true, actual, expected: getDiagramAgentBuildInfo() });
}

export function blockDiagramBrowserWrites(error) {
  Object.assign(state(), {
    writable: false,
    actual: error?.actual || state().actual,
    expected: error?.expected || getDiagramAgentBuildInfo(),
    workspaceUrl: error?.recovery?.url || state().workspaceUrl,
  });
}

export function assertDiagramBrowserWritable() {
  const current = state();
  if (!current.writable) {
    throw createBrowserBuildStaleError(current.actual, {
      expected: current.expected,
      workspaceUrl: current.workspaceUrl,
    });
  }
}

export function resetDiagramBrowserWriteGuardForTests() {
  delete globalThis[GUARD_KEY];
}

