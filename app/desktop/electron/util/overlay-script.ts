export const buildInjectScript = (base64Image: string, opacity: number): string => {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64Image)) {
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
    host.attachShadow({ mode: 'open' });
    document.documentElement.appendChild(host);
  }
  host.style.cssText = 'position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:2147483647;';
  host.style.display = '';
  host.dataset.overlayScale = host.dataset.overlayScale || '1';
  host.dataset.scaleMode = host.dataset.scaleMode || 'fit_width';
  if (host.__figdiff_cleanup__) host.__figdiff_cleanup__();
  const shadow = host.shadowRoot;
  var oldImg = shadow.querySelector('img');
  if (oldImg) oldImg.src = '';
  shadow.innerHTML = '';
  const stage = document.createElement('div');
  stage.className = '__figdiff_overlay_stage__';
  stage.style.cssText = 'position:absolute;top:0;left:0;width:100%;pointer-events:none;transform-origin:top left;';
  const img = document.createElement('img');
  img.className = '__figdiff_overlay_image__';
  img.src = 'data:image/png;base64,${base64Image}';
  img.style.cssText = 'display:block;width:100%;height:auto;max-width:none;opacity:${safeOpacity};pointer-events:none;';
  stage.appendChild(img);
  shadow.appendChild(stage);
  function syncLayout() {
    const scale = Number(host.dataset.overlayScale || '1') || 1;
    const scaleMode = host.dataset.scaleMode || 'fit_width';
    img.style.width = scaleMode === 'actual_size' ? 'auto' : '100%';
    stage.style.transform = 'translateY(' + (-window.scrollY) + 'px) scale(' + scale + ')';
  }
  syncLayout();
  host.__figdiff_sync_layout__ = syncLayout;
  window.addEventListener('scroll', syncLayout, { passive: true });
  host.__figdiff_cleanup__ = function() {
    window.removeEventListener('scroll', syncLayout);
  };
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

export const buildUpdateScaleScript = (
  scale: number,
  scaleMode: "fit_width" | "actual_size",
): string => {
  const safeScale = Math.min(2, Math.max(0.25, Number(scale))).toFixed(2);
  const safeScaleMode = scaleMode === "actual_size" ? "actual_size" : "fit_width";
  return `
(function() {
  const host = document.getElementById('__figdiff_overlay_host__');
  if (!host || !host.shadowRoot) return;
  host.dataset.overlayScale = '${safeScale}';
  host.dataset.scaleMode = '${safeScaleMode}';
  if (host.__figdiff_sync_layout__) {
    host.__figdiff_sync_layout__();
    return;
  }
  const stage = host.shadowRoot.querySelector('.__figdiff_overlay_stage__');
  const img = host.shadowRoot.querySelector('.__figdiff_overlay_image__');
  if (!stage || !img) return;
  stage.style.transformOrigin = 'top left';
  img.style.width = '${safeScaleMode}' === 'actual_size' ? 'auto' : '100%';
  stage.style.transform = 'translateY(' + (-window.scrollY) + 'px) scale(${safeScale})';
})();
`;
};

export const buildRemoveScript = (): string => `
(function() {
  const host = document.getElementById('__figdiff_overlay_host__');
  if (!host) return;
  var tid = host.dataset.toggleInterval;
  if (tid) clearInterval(Number(tid));
  if (host.__figdiff_cleanup__) host.__figdiff_cleanup__();
  if (host.shadowRoot) {
    var img = host.shadowRoot.querySelector('img');
    if (img) img.src = '';
  }
  host.remove();
})();
`;

export const buildHideOverlayScript = (): string => `
(function() {
  const host = document.getElementById('__figdiff_overlay_host__');
  if (host) host.style.display = 'none';
})();
`;

export const buildShowOverlayScript = (): string => `
(function() {
  const host = document.getElementById('__figdiff_overlay_host__');
  if (host) host.style.display = '';
})();
`;

export const buildSplitScreenScript = (base64Image: string, splitPosition: number): string => {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64Image)) {
    throw new Error("不正なbase64文字列です");
  }
  const pos = Math.min(100, Math.max(0, splitPosition * 100)).toFixed(1);

  return `
(function() {
  const OVERLAY_ID = '__figdiff_overlay_host__';
  let host = document.getElementById(OVERLAY_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = OVERLAY_ID;
    host.attachShadow({ mode: 'open' });
    document.documentElement.appendChild(host);
  }
  host.style.cssText = 'position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:2147483647;';
  host.style.display = '';
  host.dataset.mode = 'split_screen';
  host.dataset.splitPos = '${pos}';
  host.dataset.overlayScale = host.dataset.overlayScale || '1';
  host.dataset.scaleMode = host.dataset.scaleMode || 'fit_width';
  if (host.__figdiff_cleanup__) host.__figdiff_cleanup__();
  const shadow = host.shadowRoot;
  var oldImg = shadow.querySelector('img');
  if (oldImg) oldImg.src = '';
  shadow.innerHTML = '';
  const stage = document.createElement('div');
  stage.className = '__figdiff_overlay_stage__';
  stage.style.cssText = 'position:absolute;top:0;left:0;width:100%;pointer-events:none;transform-origin:top left;';
  const img = document.createElement('img');
  img.className = '__figdiff_overlay_image__';
  img.src = 'data:image/png;base64,${base64Image}';
  img.style.cssText = 'display:block;width:100%;height:auto;max-width:none;opacity:1;pointer-events:none;clip-path:polygon(0 0,${pos}% 0,${pos}% 100%,0 100%);';
  stage.appendChild(img);
  shadow.appendChild(stage);
  const divider = document.createElement('div');
  divider.className = '__figdiff_divider__';
  divider.style.cssText = 'position:absolute;top:0;left:${pos}%;width:2px;height:100%;background:rgba(255,255,255,0.8);pointer-events:none;box-shadow:0 0 4px rgba(0,0,0,0.5);';
  shadow.appendChild(divider);
  function syncLayout() {
    const scale = Number(host.dataset.overlayScale || '1') || 1;
    const scaleMode = host.dataset.scaleMode || 'fit_width';
    img.style.width = scaleMode === 'actual_size' ? 'auto' : '100%';
    stage.style.transform = 'translateY(' + (-window.scrollY) + 'px) scale(' + scale + ')';
  }
  syncLayout();
  host.__figdiff_sync_layout__ = syncLayout;
  window.addEventListener('scroll', syncLayout, { passive: true });
  host.__figdiff_cleanup__ = function() {
    window.removeEventListener('scroll', syncLayout);
  };
})();
`;
};

export const buildUpdateSplitPositionScript = (splitPosition: number): string => {
  const pos = Math.min(100, Math.max(0, splitPosition * 100)).toFixed(1);
  return `
(function() {
  const host = document.getElementById('__figdiff_overlay_host__');
  if (!host || !host.shadowRoot) return;
  host.dataset.splitPos = '${pos}';
  const img = host.shadowRoot.querySelector('img');
  if (img) img.style.clipPath = 'polygon(0 0,${pos}% 0,${pos}% 100%,0 100%)';
  const divider = host.shadowRoot.querySelector('.__figdiff_divider__');
  if (divider) divider.style.left = '${pos}%';
})();
`;
};

export const buildBlendedDiffScript = (base64Image: string): string => {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64Image)) {
    throw new Error("不正なbase64文字列です");
  }

  return `
(function() {
  const OVERLAY_ID = '__figdiff_overlay_host__';
  let host = document.getElementById(OVERLAY_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = OVERLAY_ID;
    host.attachShadow({ mode: 'open' });
    document.documentElement.appendChild(host);
  }
  host.style.cssText = 'position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:2147483647;';
  host.style.display = '';
  host.dataset.mode = 'blended_diff';
  host.dataset.overlayScale = host.dataset.overlayScale || '1';
  host.dataset.scaleMode = host.dataset.scaleMode || 'fit_width';
  if (host.__figdiff_cleanup__) host.__figdiff_cleanup__();
  const shadow = host.shadowRoot;
  var oldImg = shadow.querySelector('img');
  if (oldImg) oldImg.src = '';
  shadow.innerHTML = '';
  const stage = document.createElement('div');
  stage.className = '__figdiff_overlay_stage__';
  stage.style.cssText = 'position:absolute;top:0;left:0;width:100%;pointer-events:none;transform-origin:top left;';
  const img = document.createElement('img');
  img.className = '__figdiff_overlay_image__';
  img.src = 'data:image/png;base64,${base64Image}';
  img.style.cssText = 'display:block;width:100%;height:auto;max-width:none;opacity:1;mix-blend-mode:difference;pointer-events:none;';
  stage.appendChild(img);
  shadow.appendChild(stage);
  function syncLayout() {
    const scale = Number(host.dataset.overlayScale || '1') || 1;
    const scaleMode = host.dataset.scaleMode || 'fit_width';
    img.style.width = scaleMode === 'actual_size' ? 'auto' : '100%';
    stage.style.transform = 'translateY(' + (-window.scrollY) + 'px) scale(' + scale + ')';
  }
  syncLayout();
  host.__figdiff_sync_layout__ = syncLayout;
  window.addEventListener('scroll', syncLayout, { passive: true });
  host.__figdiff_cleanup__ = function() {
    window.removeEventListener('scroll', syncLayout);
  };
})();
`;
};

export const buildDraggableScript = (base64Image: string, opacity: number): string => {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64Image)) {
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
    host.attachShadow({ mode: 'open' });
    document.documentElement.appendChild(host);
  }
  host.style.cssText = 'position:fixed;inset:0;overflow:hidden;pointer-events:auto;z-index:2147483647;';
  host.style.display = '';
  host.dataset.mode = 'draggable';
  host.dataset.dragX = '0';
  host.dataset.dragY = '0';
  host.dataset.overlayScale = host.dataset.overlayScale || '1';
  host.dataset.scaleMode = host.dataset.scaleMode || 'fit_width';
  if (host.__figdiff_cleanup__) host.__figdiff_cleanup__();
  const shadow = host.shadowRoot;
  var oldImg = shadow.querySelector('img');
  if (oldImg) oldImg.src = '';
  shadow.innerHTML = '';
  const stage = document.createElement('div');
  stage.className = '__figdiff_overlay_stage__';
  stage.style.cssText = 'position:absolute;top:0;left:0;width:100%;pointer-events:none;transform-origin:top left;';
  const img = document.createElement('img');
  img.className = '__figdiff_overlay_image__';
  img.src = 'data:image/png;base64,${base64Image}';
  img.style.cssText = 'display:block;width:100%;height:auto;max-width:none;opacity:${safeOpacity};cursor:grab;pointer-events:auto;transform:translate(0px,0px);';
  stage.appendChild(img);
  shadow.appendChild(stage);
  let dragging = false, startX = 0, startY = 0, offsetX = 0, offsetY = 0;
  function syncLayout() {
    const scale = Number(host.dataset.overlayScale || '1') || 1;
    const scaleMode = host.dataset.scaleMode || 'fit_width';
    img.style.width = scaleMode === 'actual_size' ? 'auto' : '100%';
    stage.style.transform = 'translateY(' + (-window.scrollY) + 'px) scale(' + scale + ')';
  }
  syncLayout();
  host.__figdiff_sync_layout__ = syncLayout;
  img.addEventListener('mousedown', function(e) {
    dragging = true;
    startX = e.clientX - offsetX;
    startY = e.clientY - offsetY;
    img.style.cursor = 'grabbing';
    e.preventDefault();
  });
  function onMove(e) {
    if (!dragging) return;
    offsetX = e.clientX - startX;
    offsetY = e.clientY - startY;
    img.style.transform = 'translate(' + offsetX + 'px,' + offsetY + 'px)';
    host.dataset.dragX = String(offsetX);
    host.dataset.dragY = String(offsetY);
  }
  function onUp() {
    if (!dragging) return;
    dragging = false;
    img.style.cursor = 'grab';
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  window.addEventListener('scroll', syncLayout, { passive: true });
  host.__figdiff_cleanup__ = function() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    window.removeEventListener('scroll', syncLayout);
  };
})();
`;
};

export const buildToggleStartScript = (intervalMs: number): string => {
  const safeInterval = Math.min(2000, Math.max(100, Math.round(intervalMs)));
  return `
(function() {
  const host = document.getElementById('__figdiff_overlay_host__');
  if (!host || !host.shadowRoot) return;
  const existing = host.dataset.toggleInterval;
  if (existing) clearInterval(Number(existing));
  const img = host.shadowRoot.querySelector('img');
  if (!img) return;
  const id = setInterval(function() {
    img.style.visibility = img.style.visibility === 'hidden' ? 'visible' : 'hidden';
  }, ${safeInterval});
  host.dataset.toggleInterval = String(id);
})();
`;
};

export const buildToggleStopScript = (): string => `
(function() {
  const host = document.getElementById('__figdiff_overlay_host__');
  if (!host) return;
  const id = host.dataset.toggleInterval;
  if (id) {
    clearInterval(Number(id));
    delete host.dataset.toggleInterval;
  }
  if (host.shadowRoot) {
    const img = host.shadowRoot.querySelector('img');
    if (img) img.style.visibility = 'visible';
  }
})();
`;
