// 建立节点的小工具：文字一律走 textContent / Text 节点，从不使用 innerHTML。
export function h(doc, tag, props = {}, ...children) {
  const el = doc.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'hidden') el.hidden = Boolean(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? doc.createTextNode(c) : c);
  }
  return el;
}

export function setText(el, s) {
  if (el.textContent !== s) el.textContent = s;
}

export function show(el, on) {
  if (el.hidden === on) el.hidden = !on;
}
