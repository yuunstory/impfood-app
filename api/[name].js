// Vercel 서버리스 함수: /api/status, /api/products, /api/receipts, /api/detail
// 인증키는 Vercel 프로젝트의 환경변수 SERVICE_KEY에서 읽습니다.

const { run } = require('../lib/core');

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const name = (req.query && req.query.name) || url.pathname.split('/').pop();
  url.searchParams.delete('name'); // Vercel이 동적 경로 값을 쿼리에 붙여줌

  const r = await run(name, url.searchParams);
  res.statusCode = r.status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // 성공한 조회는 Vercel CDN에 잠깐 저장해서, 같은 조건을 여러 사람이 조회해도 API는 한 번만 호출
  res.setHeader('Cache-Control', r.cacheSeconds ? `public, s-maxage=${r.cacheSeconds}, stale-while-revalidate=30` : 'no-store');
  res.end(JSON.stringify(r.body));
};
