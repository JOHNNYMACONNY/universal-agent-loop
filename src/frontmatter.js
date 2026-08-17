// Minimal deterministic YAML-frontmatter-subset parser. No dependencies.
// Supports: `key: scalar`, `key: [a, b]`, `key:` + indented `- item`
// lists, and `key:` + one level of indented `sub: value` maps.
// Anything more complex is left as a raw string. This is intentional:
// protocol artifacts use only this subset.

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(text) {
  if (typeof text !== 'string') return { data: {}, body: '' };
  const m = text.match(FRONTMATTER_RE);
  if (!m) return { data: {}, body: text };
  return { data: parseYamlSubset(m[1]), body: text.slice(m[0].length) };
}

export function parseYamlSubset(src) {
  const data = {};
  const lines = src.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    i += 1;
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (/^\s/.test(line)) continue; // handled by parent consumption
    const km = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!km) continue;
    const [, key, rest] = km;
    if (rest === '' ) {
      // look ahead: list items or nested map
      const items = [];
      const map = {};
      let consumed = false;
      while (i < lines.length && /^\s+\S/.test(lines[i])) {
        const sub = lines[i];
        const lm = sub.match(/^\s+-\s+(.*)$/);
        if (lm) {
          items.push(scalar(lm[1]));
          consumed = true;
          i += 1;
          continue;
        }
        const sm = sub.match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
        if (sm) {
          map[sm[1]] = scalar(sm[2]);
          consumed = true;
          i += 1;
          continue;
        }
        i += 1;
      }
      if (!consumed) data[key] = null;
      else if (Object.keys(map).length && items.length) data[key] = { map, items };
      else if (Object.keys(map).length) data[key] = map;
      else data[key] = items;
      continue;
    }
    data[key] = scalar(rest);
  }
  return data;
}

function scalar(raw) {
  const v = raw.trim();
  if (v === '' || v === '~' || v === 'null') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((s) => scalar(s));
  }
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

export function countCheckboxes(body) {
  const unchecked = (body.match(/- \[ \]/g) || []).length;
  const checked = (body.match(/- \[[xX]\]/g) || []).length;
  return { checked, unchecked };
}
