import { Node } from '@tiptap/core';
import { sanitizeMailHtmlComposer } from './mailHtmlSanitize';

// Remember explicit quote containers even when Tiptap flattens their generic div.
export const MAIL_QUOTED_SELECTOR = 'blockquote,[type="cite"],.gmail_quote,.yahoo_quoted,[data-mail-signature-quoted="1"]';

// Only email presentation properties; no positioning, external CSS resources,
// animation, arbitrary classes or executable content inside the managed node.
const SIGNATURE_STYLES = new Set([
  'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-style',
  'line-height', 'text-align', 'text-decoration', 'vertical-align', 'white-space',
  'width', 'min-width', 'max-width', 'height', 'min-height', 'max-height',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-width', 'border-style', 'border-color', 'border-collapse', 'border-spacing',
  'table-layout', 'display',
]);

export function sanitizeMailSignatureContent(html: string): string {
  if (typeof document === 'undefined') return '';
  const root = document.createElement('div');
  root.innerHTML = sanitizeMailHtmlComposer(html);
  for (const element of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    // Inner signature HTML cannot create another managed region or carry classes.
    for (const attr of Array.from(element.attributes)) {
      if (attr.name.startsWith('data-') || attr.name === 'class') element.removeAttribute(attr.name);
    }
    if (element.getAttribute('role') !== 'presentation') element.removeAttribute('role');
    const original = element.style;
    const clean = document.createElement('span').style;
    for (let i = 0; i < original.length; i++) {
      const key = original.item(i), value = original.getPropertyValue(key);
      if (SIGNATURE_STYLES.has(key) && value.length <= 250 && !/[\\\x00-\x1f]|url\s*\(|expression|@import|javascript:|var\s*\(/i.test(value)) {
        if (key !== 'display' || /^(block|inline|inline-block|table|table-row|table-cell)$/.test(value)) {
          clean.setProperty(key, value, original.getPropertyPriority(key));
        }
      }
    }
    // Existing signatures use the background shorthand for solid color only.
    if (original.backgroundColor) clean.backgroundColor = original.backgroundColor;
    if (clean.cssText) element.setAttribute('style', clean.cssText);
    else element.removeAttribute('style');
  }
  return root.innerHTML;
}

/** A schema node, not an unsupported generic div. Its children are an immutable,
 * sanitized signature snapshot; message text is edited in surrounding blocks. */
export const MailSignatureNode = Node.create({
  name: 'mailSignature',
  group: 'block',
  atom: true,
  selectable: true,
  isolating: true,
  addAttributes() {
    return {
      html: { default: '', rendered: false, parseHTML: element => sanitizeMailSignatureContent(element.innerHTML) },
      signatureId: { default: null, rendered: false, parseHTML: element => element.getAttribute('data-signature-id') },
      quoted: { default: false, rendered: false, parseHTML: element => Boolean(element.closest(MAIL_QUOTED_SELECTOR)) },
    };
  },
  parseHTML() { return [{ tag: 'div[data-mail-signature="1"]' }, { tag: 'div[data-signature="1"]' }]; },
  renderHTML({ node }) {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-signature', '1');
    wrapper.setAttribute('data-mail-signature', '1');
    if (node.attrs.quoted) wrapper.setAttribute('data-mail-signature-quoted', '1');
    if (node.attrs.signatureId) wrapper.setAttribute('data-signature-id', String(node.attrs.signatureId).slice(0, 200));
    wrapper.innerHTML = sanitizeMailSignatureContent(String(node.attrs.html || ''));
    return wrapper;
  },
});
