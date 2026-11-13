'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const widget = process.argv.includes('--work-motivator-widget');

contextBridge.exposeInMainWorld('workMotivatorDesktop', {
  widget,
  openWidget: () => ipcRenderer.invoke('widget:open'),
  closeWidget: () => ipcRenderer.invoke('widget:close'),
  focusMain: () => ipcRenderer.invoke('widget:focus-main'),
  reportMeasure: (size) => ipcRenderer.send('widget:measure', size),
  requestPreviewFit: (scale) => ipcRenderer.send('desktop:request-preview-fit', { scale }),
  previewSize: (size) => ipcRenderer.send('widget:preview-size', size),
  onWidgetBounds: (listener) => ipcRenderer.on('widget:bounds', (_event, value) => listener(value)),
  loginItem: { get: () => ipcRenderer.invoke('login-item:get'), set: (enabled) => ipcRenderer.invoke('login-item:set', Boolean(enabled)), onChange: (listener) => ipcRenderer.on('login-item:changed', (_event, value) => listener(value)) },
  openSettings: () => ipcRenderer.invoke('main:open-settings'),
  onOpenSettings: (listener) => ipcRenderer.on('desktop:open-settings', () => listener()),
});

window.addEventListener('DOMContentLoaded', () => {
  if (!widget) {
    // Keep the web build's normal flow, but route its PiP action to the native widget.
    document.addEventListener('click', (event) => {
      const button = event.target.closest?.('#btn-float');
      if (!button || button.disabled) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      ipcRenderer.invoke('widget:open');
    }, true);
    const reportState = () => {
      const value = localStorage.getItem('work-motivator-v1');
      if (typeof value === 'string') ipcRenderer.send('desktop:state', value);
    };
    window.addEventListener('load', reportState, { once: true });
    document.addEventListener('change', () => setTimeout(reportState, 0), true);
    // The native widget may be closed (or not exist after a relaunch).  In that
    // state, measure a small-card clone in the main renderer so its next open
    // and its main-page preview use the same natural content size.
    const measureMainCard = ({ reason = 'measure', width } = {}) => {
      const card = document.querySelector('#status-card');
      if (!card || !Number.isFinite(width) || width <= 0) return;
      const clone = card.cloneNode(true);
      for (const node of [clone, ...clone.querySelectorAll('[id]')]) node.removeAttribute('id');
      clone.dataset.size = 'sm';
      clone.setAttribute('aria-hidden', 'true');
      clone.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;left:-99999px;top:0;width:${Math.round(width)}px;height:auto;min-height:0;`;
      document.body.append(clone);
      const measured = { width: Math.ceil(clone.scrollWidth), height: Math.ceil(Math.max(clone.getBoundingClientRect().height, clone.scrollHeight)) };
      clone.remove();
      ipcRenderer.send('widget:measure', { measured, reason, scale: request.scale });
    };
    ipcRenderer.on('desktop:measure-main-card', (_event, request) => measureMainCard(request));
    let lastChange = 0;
    const reportMainChange = () => {
      const now = Date.now();
      if (now - lastChange < 80) return;
      lastChange = now;
      ipcRenderer.send('desktop:main-card-changed');
    };
    const watchMainCard = () => {
      const card = document.querySelector('#status-card');
      if (!card) return requestAnimationFrame(watchMainCard);
      new ResizeObserver(reportMainChange).observe(card);
      reportMainChange();
    };
    requestAnimationFrame(watchMainCard);
    return;
  }
  document.documentElement.dataset.desktopWidget = 'true';
  const style = document.createElement('style');
  style.textContent = `
    html[data-desktop-widget] body { margin:0; min-width:0; overflow:auto; }
    html[data-desktop-widget] .app-header, html[data-desktop-widget] .main-panel, html[data-desktop-widget] .float-controls, html[data-desktop-widget] #card-slot > :not(#status-card) { display:none !important; }
    html[data-desktop-widget] .app, html[data-desktop-widget] .left-col, html[data-desktop-widget] #card-slot { display:block !important; width:auto !important; min-height:0 !important; padding:0 !important; }
    html[data-desktop-widget] #status-card { border-radius:0; min-height:0 !important; }
  `;
  document.head.append(style);
  const report = () => {
    const card = document.querySelector('#status-card');
    if (card) ipcRenderer.send('widget:measure', { width: Math.ceil(card.scrollWidth), height: Math.ceil(card.scrollHeight) });
  };
  new ResizeObserver(report).observe(document.documentElement);
  setTimeout(report, 0);
  ipcRenderer.on('desktop:measure-widget-content', (_event, { reason = 'content', scale } = {}) => {
    const card = document.querySelector('#status-card');
    if (card) ipcRenderer.send('widget:measure', { measured: { width: Math.ceil(card.scrollWidth), height: Math.ceil(card.scrollHeight) }, reason, scale });
  });
  document.addEventListener('click', (event) => {
    if (event.target.closest?.('.card-gear')) { event.preventDefault(); ipcRenderer.invoke('widget:focus-main'); }
  }, true);
});
