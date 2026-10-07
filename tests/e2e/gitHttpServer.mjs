// A real git smart-HTTP server for tests: Node in front of `git http-backend`
// (the CGI program git itself ships), plus the CORS headers a browser needs.
// Lets the e2e tests push and clone with isomorphic-git exactly like against
// GitHub, but offline and on localhost.
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function startGitServer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-git-srv-'));
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Git-Protocol, User-Agent, Accept',
    'Access-Control-Expose-Headers': 'Content-Type',
  };
  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors).end(); return; }
    const url = new URL(req.url, 'http://x');
    const cgi = spawn('git', ['http-backend'], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: decodeURIComponent(url.pathname),
        QUERY_STRING: url.search.slice(1),
        REQUEST_METHOD: req.method,
        CONTENT_TYPE: req.headers['content-type'] || '',
        REMOTE_USER: 'tester',
        REMOTE_ADDR: '127.0.0.1',
      },
    });
    req.pipe(cgi.stdin);
    let buf = Buffer.alloc(0);
    let headersDone = false;
    cgi.stdout.on('data', (chunk) => {
      if (headersDone) { res.write(chunk); return; }
      buf = Buffer.concat([buf, chunk]);
      const end = buf.indexOf('\r\n\r\n');
      if (end < 0) return;
      const head = buf.subarray(0, end).toString();
      const headers = { ...cors };
      let status = 200;
      for (const line of head.split('\r\n')) {
        const i = line.indexOf(':');
        const k = line.slice(0, i).trim();
        const v = line.slice(i + 1).trim();
        if (k.toLowerCase() === 'status') status = parseInt(v, 10);
        else headers[k] = v;
      }
      res.writeHead(status, headers);
      headersDone = true;
      res.write(buf.subarray(end + 4));
    });
    cgi.stdout.on('end', () => res.end());
    cgi.stderr.on('data', (d) => process.stderr.write(d));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        root,
        createBare(name) {
          const dir = path.join(root, name);
          execFileSync('git', ['init', '--bare', '--initial-branch=main', dir]);
          execFileSync('git', ['-C', dir, 'config', 'http.receivepack', 'true']);
          return dir;
        },
        log(name) {
          return execFileSync('git', ['-C', path.join(root, name), 'log', '--format=%s', 'main'], { encoding: 'utf8' }).trim().split('\n');
        },
        /** Commits a file to the bare repo with the git CLI (someone else pushing). */
        commitFromCli(name, file, content, message) {
          const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-git-work-'));
          execFileSync('git', ['clone', '-q', path.join(root, name), work]);
          fs.writeFileSync(path.join(work, file), content);
          execFileSync('git', ['-C', work, 'add', file]);
          execFileSync('git', ['-C', work, '-c', 'user.name=Other', '-c', 'user.email=o@example.com', 'commit', '-qm', message]);
          execFileSync('git', ['-C', work, 'push', '-q', 'origin', 'main']);
          fs.rmSync(work, { recursive: true, force: true });
        },
        close() { server.close(); fs.rmSync(root, { recursive: true, force: true }); },
      });
    });
  });
}
