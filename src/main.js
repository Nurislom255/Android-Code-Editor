// main.js — entry point. Everything is assembled in app/app.js.

import { App } from './app/app.js';

const app = new App();
window.__app = app; // handy in devtools, and used by the end-to-end tests
app.start().catch((err) => {
  console.error(err);
  const t = document.getElementById('toasts');
  if (t) t.textContent = `Startup failed: ${err.message}`;
});
