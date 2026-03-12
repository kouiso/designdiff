/**
 * WebContentsView 上の外部サイトに executeJavaScript で注入するスクリプト
 * Shadow DOM を使い、外部サイトの CSS と干渉しない
 * pointer-events:none で外部サイトの操作をブロックしない
 */

export const buildInjectScript = (base64Image: string, opacity: number): string => `
(function() {
  const OVERLAY_ID = '__figdiff_overlay_host__';
  let host = document.getElementById(OVERLAY_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = OVERLAY_ID;
    host.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;';
    host.attachShadow({ mode: 'open' });
    document.documentElement.appendChild(host);
  }
  const shadow = host.shadowRoot;
  shadow.innerHTML = '';
  const img = document.createElement('img');
  img.src = 'data:image/png;base64,${base64Image}';
  img.style.cssText = 'width:100%;height:100%;object-fit:contain;opacity:${opacity};pointer-events:none;';
  shadow.appendChild(img);
})();
`;

export const buildUpdateOpacityScript = (opacity: number): string => `
(function() {
  const host = document.getElementById('__figdiff_overlay_host__');
  if (host && host.shadowRoot) {
    const img = host.shadowRoot.querySelector('img');
    if (img) img.style.opacity = '${opacity}';
  }
})();
`;

export const buildRemoveScript = (): string => `
(function() {
  const host = document.getElementById('__figdiff_overlay_host__');
  if (host) host.remove();
})();
`;
