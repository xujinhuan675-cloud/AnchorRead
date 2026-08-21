const ROUTE_TOKEN_LENGTH = 8;
const ROUTE_TOKEN_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function createRouteToken() {
  const bytes = new Uint8Array(ROUTE_TOKEN_LENGTH);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => ROUTE_TOKEN_ALPHABET[value % ROUTE_TOKEN_ALPHABET.length]).join('');
  }
  return Array.from({ length: ROUTE_TOKEN_LENGTH }, () => (
    ROUTE_TOKEN_ALPHABET[Math.floor(Math.random() * ROUTE_TOKEN_ALPHABET.length)]
  )).join('');
}

function assertRoutePrefix(prefix) {
  if (!/^[a-z][a-z0-9]*$/.test(String(prefix || ''))) {
    throw new TypeError('A lowercase route id prefix is required.');
  }
}

export function isResourceRouteId(value, prefix) {
  if (!/^[a-z][a-z0-9]*$/.test(String(prefix || ''))) return false;
  return new RegExp(`^${prefix}-[a-z0-9]{${ROUTE_TOKEN_LENGTH}}$`).test(String(value || ''));
}

export function createResourceRouteId(prefix, existingRouteIds = new Set()) {
  assertRoutePrefix(prefix);
  const used = existingRouteIds instanceof Set ? existingRouteIds : new Set(existingRouteIds);
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const routeId = `${prefix}-${createRouteToken()}`;
    if (!used.has(routeId)) return routeId;
  }
  throw new Error(`Unable to allocate a unique ${prefix} route id.`);
}

export function getResourceRouteId(resource, prefix) {
  return isResourceRouteId(resource?.routeId, prefix) ? resource.routeId : resource?.id;
}

export function ensureResourceRouteId(resource, prefix, existingRouteIds = new Set()) {
  if (!resource) return resource;
  const used = existingRouteIds instanceof Set ? existingRouteIds : new Set(existingRouteIds);
  if (isResourceRouteId(resource.routeId, prefix) && !used.has(resource.routeId)) {
    used.add(resource.routeId);
    return resource;
  }
  const routeId = createResourceRouteId(prefix, used);
  used.add(routeId);
  return { ...resource, routeId };
}

export function normalizeResourceRouteIds(resources = [], prefix) {
  const used = new Set();
  return resources.map((resource) => ensureResourceRouteId(resource, prefix, used));
}
