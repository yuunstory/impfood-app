// 수입식품 조회 웹앱 - 로컬/일반 서버용 실행 파일 (Node.js 18+, 외부 패키지 없음)
// Vercel에 배포할 때는 이 파일 대신 api/[name].js가 쓰입니다.
// Render, Railway, 사내 서버처럼 node를 직접 실행하는 곳에서는 이 파일로 실행합니다.

const http = require('http');
const fs = require('fs');
const path = require('path');

loadDotEnv(path.join(__dirname, '.env')); // core를 불러오기 전에 인증키를 읽어야 함
const { run, MOCK } = require('./lib/core');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  const m = url.pathname.match(/^\/api\/([a-z]+)$/);
  if (m) {
    const r = await run(m[1], url.searchParams);
    res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(r.body));
  }

  const file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('없는 페이지입니다.'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`수입식품 조회 웹앱: http://localhost:${PORT}`);
  console.log(MOCK ? '※ 인증키가 없어 예시 데이터 모드로 실행 중입니다 (.env에 SERVICE_KEY 설정)' : '공공데이터포털 API 연결 모드');
});

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
