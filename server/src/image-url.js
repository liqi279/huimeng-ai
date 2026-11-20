'use strict';

function imageCandidates(value, base) {
  const raw = String(value || '').trim();
  if (/^https?:\/\//i.test(raw)) return [raw];
  if (!raw || raw.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return [];

  const rootRelative = raw.startsWith('/');
  const bases = [base, 'https://www.rayinai.com/v1', 'https://www.rayinai.com'];
  const candidates = [];
  for (const item of bases) {
    if (!item) continue;
    try {
      const normalized = String(item).replace(/\/+$/, '') + '/';
      const candidate = new URL(raw, normalized).href;
      if (!candidates.includes(candidate)) candidates.push(candidate);
    } catch (err) {}
    /* Older Rayin endpoints expose root-relative assets below their /v1 prefix. */
    if (rootRelative) {
      const joined = String(item).replace(/\/+$/, '') + raw;
      if (!candidates.includes(joined)) candidates.push(joined);
    }
  }
  return candidates;
}

module.exports = { imageCandidates };
