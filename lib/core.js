// 수입식품 조회 웹앱 - 공통 로직 (로컬 서버와 Vercel 함수가 함께 사용)
// 공공데이터포털 호출, 응답 정리, 짧은 캐시, 예시 데이터

let SERVICE_KEY = (process.env.SERVICE_KEY || '').trim();
// 포털의 "Encoding" 키를 넣어도 동작하도록 한 번 디코딩
try { if (SERVICE_KEY.includes('%')) SERVICE_KEY = decodeURIComponent(SERVICE_KEY); } catch (_) {}
const MOCK = !SERVICE_KEY || process.env.MOCK === '1';

// 같은 조건 조회는 60초 동안 재사용 (여러 사람이 써도 호출 한도를 아끼기 위해)
const CACHE_SECONDS = Number(process.env.CACHE_SECONDS || 60);
const cache = new Map();

const BASE = 'https://apis.data.go.kr/1471000';
const API = {
  // 수입식품 제품DB 정보 (data.go.kr/data/15073949)
  products: `${BASE}/IprtFoodPrdtDBService02/getIprtFoodPrdtDBInq02`,
  // 수입식품 수입신고 접수 업체 (data.go.kr/data/15073921)
  receipts: `${BASE}/IprtFoodIprtDclrRcptEntpService01/getIprtFoodIprtDclrRcptEntpInq01`,
  // 수입식품 고유제품 상세정보 (data.go.kr/data/15098132)
  detail: `${BASE}/IprtFoodUniqPrdtDtlInfoService/getIprtFoodUniqPrdtDtlInfoInq`,
};

// ── 공공데이터포털 호출 ──────────────────────────────────
async function callApi(url, params) {
  const qs = new URLSearchParams({ serviceKey: SERVICE_KEY, type: 'json' });
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v).trim() !== '') qs.set(k, String(v).trim());
  }
  const res = await fetch(`${url}?${qs}`, { signal: AbortSignal.timeout(15000) });
  const text = await res.text();

  let json;
  try { json = JSON.parse(text); } catch (_) {
    // 인증 오류 등은 JSON 요청이어도 XML이나 평문으로 오는 경우가 많음
    const msg = pick(text, 'returnAuthMsg') || pick(text, 'resultMsg') || pick(text, 'errMsg') || text.slice(0, 200);
    const code = pick(text, 'returnReasonCode') || pick(text, 'resultCode') || String(res.status);
    throw apiError(code, msg);
  }

  const header = json.header || json.response?.header || {};
  const body = json.body || json.response?.body || {};
  const code = String(header.resultCode ?? '00');
  if (!['00', '0', '000'].includes(code)) throw apiError(code, header.resultMsg || '알 수 없는 오류');

  return {
    totalCount: Number(body.totalCount || 0),
    pageNo: Number(body.pageNo || params.pageNo || 1),
    numOfRows: Number(body.numOfRows || params.numOfRows || 10),
    items: normalizeItems(body.items),
  };
}

// 식약처 API는 items가 배열 / {item: [...]} / {item: {...}} / [{item: {...}}] 등으로 섞여 옴
function normalizeItems(items) {
  if (!items) return [];
  let arr = Array.isArray(items) ? items : (items.item !== undefined ? items.item : [items]);
  if (!Array.isArray(arr)) arr = [arr];
  return arr.map((x) => (x && typeof x === 'object' && x.item && typeof x.item === 'object' ? x.item : x)).filter(Boolean);
}

function pick(text, tag) {
  const m = text.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m ? m[1].trim() : '';
}
function apiError(code, message) {
  const e = new Error(message);
  e.code = code;
  e.hint = hintFor(code, message);
  return e;
}
function hintFor(code, msg) {
  const s = `${code} ${msg}`;
  if (/30|NOT_REGISTERED/.test(s)) return '인증키가 등록되지 않았습니다. 해당 API를 활용신청했는지, 승인 후 1~2시간이 지났는지 확인하세요.';
  if (/20|ACCESS_DENIED|PERMISSION/.test(s)) return '이 API에 대한 활용신청이 필요합니다. 공공데이터포털에서 API별로 각각 신청해야 합니다.';
  if (/22|EXCEEDS/.test(s)) return '오늘 호출 한도를 넘었습니다. 자동 새로고침 간격을 늘리거나 운영계정 트래픽 증설을 신청하세요.';
  if (/23/.test(s)) return '짧은 시간에 너무 많이 호출했습니다. 잠시 후 다시 조회하세요.';
  if (/31|EXPIRED/.test(s)) return '인증키 사용 기한이 만료됐습니다. 공공데이터포털에서 연장 신청하세요.';
  return '';
}

// ── 화면용으로 필드 정리 ─────────────────────────────────
const mapProduct = (r) => ({
  mngNo: r.IPRT_FOOD_MNG_NO || '',
  divsCd: r.DCLR_PRDT_DIVS_CD || '',
  divs: r.DCLR_PRDT_DIVS_NM || '',
  countryCd: r.MNFT_NATN_CD || '',
  country: r.MNFT_NATN_NM || '',
  name: r.PRDT_NM || '',
  meat: r.MEAT_PRDLST_NM || '',
  itemCd: r.PRDLST_CD || '',
  item: r.PRDLST_NM || '',
});
const mapReceipt = (r) => ({
  rcptNo: r.IPRT_DCLR_RCPT_NO || '',
  rcptDt: r.RCPT_DT || '',
  mnftCd: r.OCTR_MNFT_BSSH_CD || '',
  mnft: r.OCTR_MNFT_BSSH_NM || '',
  mnftAddr: r.OCTR_MNFT_BSSH_ADDR || '',
  exprtCd: r.EXPRT_ENTP_CD || '',
  exprt: r.EXPRT_BSSH_CO_NM || '',
});
const mapDetail = (r) => ({
  mngNo: r.IPRT_FOOD_MNG_NO || '',
  divs: r.DCLR_PRDT_DIVS_NM || '',
  name: r.RPRS_PRDT_NM || '',
  nameKor: r.RPRS_PRDT_KOR_NM || '',
  item: r.RPRS_PRDLST_NM || r.PRDLST_NM || '',
  country: r.NTNNM || '',
  mnft: r.OCTR_MNFT_BSSH_NM || '',
  mnftAddr: r.OCTR_MNFT_BSSH_ADDR || '',
  wksh: r.OCTR_WKSH_NM || '',
  wkshAddr: r.OCTR_WKSH_ADDR || '',
  pck: r.PCKLOC_NM || '',
  pckAddr: r.PCKLOC_ADDR || '',
  exprt: r.EXPRT_ENTP_NM || '',
  exprtAddr: r.EXPRT_ENTP_ADDR || '',
  irdnt: r.IRDNT_NM || '',
});

// ── 라우트 ────────────────────────────────────────────
const rowsOf = (q) => Math.min(Math.max(Number(q.get('rows')) || 20, 1), 100);
const pageOf = (q) => Math.max(Number(q.get('page')) || 1, 1);

const handlers = {
  status: async () => ({ mock: MOCK, cacheSeconds: CACHE_SECONDS }),

  products: async (q) => {
    if (MOCK) return mock.products(q);
    const r = await callApi(API.products, {
      pageNo: pageOf(q), numOfRows: rowsOf(q),
      DCLR_PRDT_DIVS_NM: q.get('divs'), MNFT_NATN_NM: q.get('country'),
      PRDT_NM: q.get('name'), PRDLST_NM: q.get('item'),
    });
    return { ...r, items: r.items.map(mapProduct) };
  },

  receipts: async (q) => {
    if (MOCK) return mock.receipts(q);
    const r = await callApi(API.receipts, {
      pageNo: pageOf(q), numOfRows: rowsOf(q),
      IPRT_DCLR_RCPT_NO: q.get('rcptNo'), OCTR_MNFT_BSSH_NM: q.get('mnft'),
    });
    return { ...r, items: r.items.map(mapReceipt) };
  },

  // 상세 API에는 관리번호 조건이 없어서 제품명·국가·품목으로 찾은 뒤 관리번호로 맞춤
  detail: async (q) => {
    if (MOCK) return mock.detail(q);
    const r = await callApi(API.detail, {
      pageNo: 1, numOfRows: 50,
      DCLR_PRDT_DIVS_NM: q.get('divs'), NTNNM: q.get('country'),
      RPSNT_PRDUCT_NM: q.get('name'), PRDLST_NM: q.get('item'),
    });
    const all = r.items.map(mapDetail);
    const mngNo = q.get('mngNo');
    const exact = mngNo ? all.filter((d) => d.mngNo === mngNo) : [];
    return { matched: exact.length > 0, items: exact.length ? exact : all.slice(0, 5) };
  },
};


// 이름으로 핸들러 실행: { status, body, cacheSeconds }
async function run(name, searchParams) {
  const handler = handlers[name];
  if (!handler) return { status: 404, body: { error: '없는 주소입니다.' }, cacheSeconds: 0 };
  const params = new URLSearchParams(searchParams);
  params.sort();
  const key = `${name}?${params}`;
  const hit = cache.get(key);
  if (name !== 'status' && hit && hit.exp > Date.now()) return { status: 200, body: hit.body, cacheSeconds: CACHE_SECONDS };
  try {
    const body = await handler(params);
    if (name !== 'status') {
      if (cache.size > 500) cache.delete(cache.keys().next().value);
      cache.set(key, { body, exp: Date.now() + CACHE_SECONDS * 1000 });
    }
    return { status: 200, body, cacheSeconds: name === 'status' ? 0 : CACHE_SECONDS };
  } catch (e) {
    const timeout = e.name === 'TimeoutError' || e.name === 'AbortError';
    return {
      status: 502, cacheSeconds: 0,
      body: {
        error: timeout ? '공공데이터포털 응답이 15초 안에 오지 않았습니다.' : (e.message === 'fetch failed' ? '공공데이터포털에 연결하지 못했습니다.' : (e.message || '조회에 실패했습니다.')),
        code: e.code || '', hint: e.hint || (timeout ? '잠시 후 다시 조회하세요.' : ''),
      },
    };
  }
}

module.exports = { run, MOCK };

// ── 예시 데이터 (인증키 없을 때 화면 확인용) ─────────────────
const mock = (() => {
  const P = [
    ['수산물', 'PE', '페루', 'FROZEN GIANT SQUID TENTACLE', '오징어(냉동,다리)'],
    ['수산물', 'VN', '베트남', 'FROZEN VANNAMEI SHRIMP PD', '새우(냉동,살)'],
    ['수산물', 'NO', '노르웨이', 'FRESH ATLANTIC SALMON', '연어(냉장)'],
    ['수산물', 'CN', '중국', 'FROZEN YELLOW CROAKER', '참조기(냉동)'],
    ['농.임산물', 'US', '미국', 'CALIFORNIA ALMONDS', '아몬드'],
    ['농.임산물', 'CN', '중국', 'DRIED RED PEPPER', '고추(건조)'],
    ['농.임산물', 'CL', '칠레', 'FRESH SEEDLESS GRAPES', '포도(열매)'],
    ['농.임산물', 'PH', '필리핀', 'FRESH CAVENDISH BANANA', '바나나'],
    ['축산물', 'US', '미국', 'BEEF CHUCK EYE ROLL', '쇠고기(냉장,목심)'],
    ['축산물', 'AU', '호주', 'FROZEN BEEF BRISKET', '쇠고기(냉동,양지)'],
    ['축산물', 'ES', '스페인', 'FROZEN PORK BELLY', '돼지고기(냉동,삼겹살)'],
    ['가공식품', 'IT', '이탈리아', 'SPAGHETTI N.5', '건면'],
    ['가공식품', 'JP', '일본', 'INSTANT MISO SOUP', '즉석조리식품'],
    ['가공식품', 'TH', '태국', 'COCONUT MILK 17%', '음료베이스'],
    ['가공식품', 'FR', '프랑스', 'BUTTER CROISSANT FROZEN DOUGH', '빵류'],
    ['건강기능식품', 'US', '미국', 'OMEGA-3 FISH OIL 1000MG', 'EPA 및 DHA 함유 유지'],
    ['식품첨가물', 'DE', '독일', 'CITRIC ACID ANHYDROUS', '구연산'],
  ];
  const products = P.map((p, i) => ({
    mngNo: `${(95 + i) % 100}${p[1]}${String(10000 + i * 731).padStart(5, '0')}A${i % 10}`,
    divsCd: String(['농.임산물', '수산물', '축산물', '가공식품', '건강기능식품', '식품첨가물'].indexOf(p[0]) + 1),
    divs: p[0], countryCd: p[1], country: p[2], name: p[3], meat: p[0] === '축산물' ? p[4].split('(')[0] : '',
    itemCd: `B0${i}0602${String(i).padStart(2, '0')}0000002${8300 + i}`, item: p[4],
  }));
  const plants = [
    ['CN000014041', 'WEIHAI TONGDING FOODSTUFFS CO., LTD.', 'WEST OF HIGHWAY STATION, GEJIA TOWN, WENDENG DISTRICT, WEIHAI, SHANDONG', '중국'],
    ['VN000820113', 'MINH PHU SEAFOOD CORP.', 'KHANH AN WARD, CA MAU PROVINCE', '베트남'],
    ['US000203877', 'BLUE DIAMOND GROWERS', '1802 C STREET, SACRAMENTO, CA', '미국'],
    ['PE000110592', 'PESQUERA DIAMANTE S.A.', 'AV. CIRCUNVALACION 2104, PAITA, PIURA', '페루'],
    ['AU000077150', 'TEYS AUSTRALIA PTY LTD', 'BEENLEIGH, QUEENSLAND', '호주'],
    ['IT000331208', 'PASTIFICIO DI MARTINO S.P.A.', 'VIA ROMA 1, GRAGNANO, NAPOLI', '이탈리아'],
  ];
  const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
  let seq = 533392;
  const receipts = [];
  const addReceipt = (date) => {
    const p = plants[seq % plants.length];
    receipts.unshift({ rcptNo: `${date.getFullYear()}00${seq++}`, rcptDt: ymd(date), mnftCd: p[0], mnft: p[1], mnftAddr: p[2], exprtCd: '', exprt: seq % 3 ? '' : 'KOREA TRADING LINK CO., LTD.' });
  };
  for (let i = 30; i >= 0; i--) addReceipt(new Date(Date.now() - i * 3.6e6 * 7));

  const has = (v, q) => !q || String(v).toUpperCase().includes(String(q).trim().toUpperCase());
  const page = (list, q) => {
    const rows = rowsOf(q), pg = pageOf(q);
    return { totalCount: list.length, pageNo: pg, numOfRows: rows, items: list.slice((pg - 1) * rows, pg * rows) };
  };
  let lastReceiptCall = Date.now();
  return {
    products: (q) => page(products.filter((p) => has(p.divs, q.get('divs')) && has(p.country, q.get('country')) && has(p.name, q.get('name')) && has(p.item, q.get('item'))), q),
    receipts: (q) => {
      // 자동 새로고침 확인용: 30초 이상 지나 다시 부르면 새 접수 1건이 생김
      if (Date.now() - lastReceiptCall > 30000) addReceipt(new Date());
      lastReceiptCall = Date.now();
      return page(receipts.filter((r) => has(r.rcptNo, q.get('rcptNo')) && has(r.mnft, q.get('mnft'))), q);
    },
    detail: (q) => {
      const p = products.find((x) => x.mngNo === q.get('mngNo')) || products[0];
      const pl = plants.find((x) => x[3] === p.country) || plants[0];
      return { matched: true, items: [{ mngNo: p.mngNo, divs: p.divs, name: p.name, nameKor: '', item: p.item, country: p.country, mnft: pl[1], mnftAddr: pl[2], wksh: '', wkshAddr: '', pck: pl[1], pckAddr: pl[2], exprt: '', exprtAddr: '', irdnt: '' }] };
    },
  };
})();
