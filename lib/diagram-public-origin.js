export const DEFAULT_ANCHORREAD_PUBLIC_ORIGIN = 'https://anchorread.flowguide.cc';

const WILDCARD_HOSTS = new Set(['0.0.0.0', '::']);
const LOOPBACK_HOSTS = new Set(['localhost', '::1']);

function firstForwardedValue(value = '') {
  return String(value || '').split(',')[0].trim();
}

function runtimePublicUrl() {
  if (typeof process === 'undefined') return '';
  return String(process.env?.ANCHORREAD_PUBLIC_URL || '').trim();
}

function runtimeIsProduction() {
  return typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';
}

function browserOrigin() {
  if (typeof window === 'undefined') return '';
  return String(window.location?.origin || '').trim();
}

function normalizedHostname(value = '') {
  return String(value || '').trim().toLowerCase().replace(/^\[|\]$/gu, '');
}

function isIpv4InRange(hostname, first, secondStart = 0, secondEnd = 255) {
  const parts = normalizedHostname(hostname).split('.').map(Number);
  return parts.length === 4
    && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    && parts[0] === first
    && parts[1] >= secondStart
    && parts[1] <= secondEnd;
}

export function isInternalBrowserHostname(hostname = '') {
  const host = normalizedHostname(hostname);
  if (!host) return true;
  if (WILDCARD_HOSTS.has(host) || LOOPBACK_HOSTS.has(host) || host.endsWith('.localhost')) return true;
  if (!host.includes('.') && !host.includes(':')) return true;
  if (isIpv4InRange(host, 127) || isIpv4InRange(host, 10) || isIpv4InRange(host, 192, 168, 168)) return true;
  if (isIpv4InRange(host, 172, 16, 31) || isIpv4InRange(host, 169, 254, 254)) return true;
  if (isIpv4InRange(host, 100, 64, 127)) return true;
  return host.includes(':') && (
    host.startsWith('fc')
    || host.startsWith('fd')
    || host.startsWith('fe8')
    || host.startsWith('fe9')
    || host.startsWith('fea')
    || host.startsWith('feb')
  );
}

export function normalizeBrowserOrigin(value = '', { production = runtimeIsProduction() } = {}) {
  const source = String(value || '').trim();
  if (!source) return '';
  try {
    const url = new URL(source);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    const host = normalizedHostname(url.hostname);
    if (WILDCARD_HOSTS.has(host)) return '';
    if (production && isInternalBrowserHostname(host)) return '';
    return url.origin;
  } catch {
    return '';
  }
}

export function forwardedBrowserOrigin(request) {
  if (!request?.headers?.get) return '';
  const host = firstForwardedValue(request.headers.get('x-forwarded-host'));
  if (!host) return '';
  let protocol = firstForwardedValue(request.headers.get('x-forwarded-proto')).toLowerCase();
  if (!['http', 'https'].includes(protocol)) {
    try {
      protocol = new URL(request.url).protocol.replace(':', '');
    } catch {
      return '';
    }
  }
  return `${protocol}://${host}`;
}

function rawBaseUrl(baseUrl) {
  if (baseUrl instanceof URL) return baseUrl.href;
  if (baseUrl && typeof baseUrl.url === 'string') return baseUrl.url;
  return String(baseUrl || '').trim();
}

export function resolveAnchorReadPublicOrigin({
  baseUrl = '',
  publicUrl = runtimePublicUrl(),
  production = runtimeIsProduction(),
  fallbackToDefault = true,
} = {}) {
  const request = baseUrl && typeof baseUrl === 'object' && typeof baseUrl.url === 'string'
    ? baseUrl
    : null;
  const candidates = [
    publicUrl,
    browserOrigin(),
    request ? forwardedBrowserOrigin(request) : '',
    rawBaseUrl(baseUrl),
  ];
  for (const candidate of candidates) {
    const origin = normalizeBrowserOrigin(candidate, { production });
    if (origin) return origin;
  }
  return fallbackToDefault ? DEFAULT_ANCHORREAD_PUBLIC_ORIGIN : '';
}

export function isSafeDiagramWorkspaceUrl(value, options = {}) {
  try {
    const url = new URL(String(value || ''));
    const origin = normalizeBrowserOrigin(url.origin, options);
    return Boolean(origin && url.origin === origin && /^\/diagrams(?:\/|$)/u.test(url.pathname));
  } catch {
    return false;
  }
}
