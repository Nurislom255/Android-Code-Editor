// boilerplate.js
//
// The starter set for "New Project": index.html + style.css + two JS files.
// Two JS files, not one, because that's what you asked for — and it's a
// reasonable split even for small projects: main.js is where wiring/setup
// goes (things that run once, early), app.js is where your actual program
// logic goes. For a tiny page they'll feel interchangeable; the split
// starts paying off once main.js grows to include utility functions you
// don't want to scroll past to find your actual app code.

export const BOILERPLATE_FILES = [
  {
    name: 'index.html',
    content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Project</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <h1>Hello, world!</h1>
  <p>Edit index.html, style.css, and app.js to get started.</p>

  <!-- main.js first (setup), app.js second (your code) -->
  <script src="main.js"></script>
  <script src="app.js"></script>
</body>
</html>
`,
  },
  {
    name: 'style.css',
    content: `/* style.css — starter styles */

* {
  box-sizing: border-box;
}

body {
  font-family: system-ui, sans-serif;
  max-width: 640px;
  margin: 40px auto;
  padding: 0 20px;
  line-height: 1.5;
}
`,
  },
  {
    name: 'main.js',
    content: `// main.js — setup and one-time wiring goes here.
// Runs BEFORE app.js (see the <script> order in index.html).
// Put small utility/helper functions here as your project grows, so
// app.js stays focused on your actual program logic.

console.log('main.js loaded');
`,
  },
  {
    name: 'app.js',
    content: `// app.js — your actual app logic goes here.

console.log('app.js loaded — start writing your code!');

document.addEventListener('DOMContentLoaded', () => {
  // e.g. document.querySelector('h1').textContent = 'Edited from app.js';
});
`,
  },
];
