import {
  createResourceRouteId,
  ensureResourceRouteId,
  getResourceRouteId,
  isResourceRouteId,
  normalizeResourceRouteIds,
} from './resource-route-id.js';

const DOCUMENT_ROUTE_ID_PREFIX = 'doc';

export function isDocumentRouteId(value) {
  return isResourceRouteId(value, DOCUMENT_ROUTE_ID_PREFIX);
}

export function createDocumentRouteId(existingRouteIds = new Set()) {
  return createResourceRouteId(DOCUMENT_ROUTE_ID_PREFIX, existingRouteIds);
}

export function getDocumentRouteId(document) {
  return getResourceRouteId(document, DOCUMENT_ROUTE_ID_PREFIX);
}

export function findDocumentByRouteId(documents = [], requestedId = '') {
  if (!requestedId) return undefined;
  return documents.find((document) => (
    document?.id === requestedId || document?.routeId === requestedId
  ));
}

export function ensureDocumentRouteId(document, existingRouteIds = new Set()) {
  return ensureResourceRouteId(document, DOCUMENT_ROUTE_ID_PREFIX, existingRouteIds);
}

export function normalizeDocumentRouteIds(documents = []) {
  return normalizeResourceRouteIds(documents, DOCUMENT_ROUTE_ID_PREFIX);
}
