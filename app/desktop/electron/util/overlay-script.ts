export const buildInjectScript = (base64Image: string, opacity: number): string => {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64Image)) {
    throw new Error("不正なbase64文字列です");
  }
  const safeOpacity = Math.min(1, Math.max(0, Number(opacity))).toFixed(2);

  return `
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
  img.style.cssText = 'width:100%;height:100%;object-fit:contain;opacity:${safeOpacity};pointer-events:none;';
  shadow.appendChild(img);
})();
`;
};

export const buildUpdateOpacityScript = (opacity: number): string => {
  const safeOpacity = Math.min(1, Math.max(0, Number(opacity))).toFixed(2);
  return `
(function() {
  const host = document.getElementById('__figdiff_overlay_host__');
  if (host && host.shadowRoot) {
    const img = host.shadowRoot.querySelector('img');
    if (img) img.style.opacity = '${safeOpacity}';
  }
})();
`;
};

export const buildRemoveScript = (): string => `
(function() {
  const host = document.getElementById('__figdiff_overlay_host__');
  if (host) host.remove();
})();
`;
