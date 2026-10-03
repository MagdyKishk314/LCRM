/**
 * Merge-field rendering for templates.
 *
 * Fields look like `{{contact.firstName}}`. Resolution is deliberately restricted to a
 * whitelist of root objects — a template author is not a developer, and templates are
 * stored data, so an unrestricted path lookup would let a stored template read anything
 * the render context happens to hold.
 */
const FIELD_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
const ALLOWED_ROOTS = new Set(['contact', 'user', 'account', 'agency']);

export type MergeContext = Record<string, unknown>;

export function renderTemplate(template: string, context: MergeContext): string {
  return template.replace(FIELD_PATTERN, (match, path: string) => {
    const value = resolvePath(path, context);
    // An unresolved field renders empty rather than leaking `{{contact.phone}}`
    // into an email a land owner will read.
    return value === undefined || value === null ? '' : String(value);
  });
}

/**
 * The HTML part of a message, derived from its text.
 *
 * Messages are written as plain text. Sending text alone is legitimate but renders in a
 * fixed-width face in several clients and is scored lower by some filters; sending the same
 * words as a simple HTML alternative costs nothing. Escaped first — the body can contain
 * merge values typed by anyone, and an owner's name must never be read as markup.
 */
export function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const paragraphs = escaped
    .split(/\r?\n\s*\r?\n/)
    .map((p) => `<p>${p.replace(/\r?\n/g, '<br>')}</p>`)
    .join('\n');

  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">${paragraphs}</div>`;
}

/** Every distinct merge field referenced, for the template editor's field chips. */
export function extractMergeFields(...sources: string[]): string[] {
  const found = new Set<string>();
  for (const source of sources) {
    for (const m of source.matchAll(FIELD_PATTERN)) {
      if (m[1]) found.add(m[1]);
    }
  }
  return [...found].sort();
}

function resolvePath(path: string, context: MergeContext): unknown {
  const parts = path.split('.');
  const root = parts[0];
  if (!root || !ALLOWED_ROOTS.has(root)) return undefined;

  let current: unknown = context;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') return undefined;
    // Guard against prototype traversal via a crafted template path.
    if (part === '__proto__' || part === 'constructor' || part === 'prototype') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
