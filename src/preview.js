// preview.js
//
// WHY srcdoc INSTEAD OF writing into iframe.contentDocument DIRECTLY:
// Setting `iframe.srcdoc` tears down and recreates the iframe's document
// cleanly on every update — no leftover event listeners or global state
// from the previous run leaking into the next one. Writing into
// contentDocument directly is possible but you have to manually clear it
// first or you get subtly stale state (a classic source of "why is my
// preview showing old data" bugs).
//
// The iframe here is deliberately NOT the same mechanism as run.js's
// Worker — this one legitimately needs a DOM (that's the whole point of
// previewing HTML/CSS), so a Worker isn't an option. The `sandbox`
// attribute (set in index.html) still restricts it: no top-level
// navigation, no access to the parent page's DOM or cookies.

export function updatePreview(iframeEl, { htmlBody = '', css = '', js = '' } = {}) {
  const doc = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>${css}</style></head>
<body>${htmlBody}
<script>${js}<\/script>
</body>
</html>`;
  iframeEl.srcdoc = doc;
}
