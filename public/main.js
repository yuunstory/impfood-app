// 수입식품 조회 웹앱 - 화면 로직
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (s) => (/^\d{8}/.test(s || '') ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}${s.length >= 12 ? ' ' + s.slice(8, 10) + ':' + s.slice(10, 12) : ''}` : s || '');
  const nowTime = () => new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // 탭별 정의
  const TABS = {
    products: {
      endpoint: '/api/products',
      form: $('#form-products'),
      key: (r) => r.mngNo || `${r.name}|${r.item}|${r.country}`,
      columns: [
        { label: '구분', render: (r) => `<span class="tag">${esc(r.divs)}</span>` },
        { label: '제품명', render: (r) => `<span class="strong">${esc(r.name)}</span>` },
        { label: '품목명', render: (r) => esc(r.item) + (r.meat ? `<span class="dim">육류: ${esc(r.meat)}</span>` : '') },
        { label: '제조국', render: (r) => esc(r.country) + (r.countryCd ? ` <span class="dim mono">${esc(r.countryCd)}</span>` : '') },
        { label: '수입식품등 관리번호', cls: 'mono', render: (r) => esc(r.mngNo) },
      ],
      csv: [['관리번호', 'mngNo'], ['신고제품구분', 'divs'], ['제품명', 'name'], ['품목코드', 'itemCd'], ['품목명', 'item'], ['육류품목', 'meat'], ['제조국코드', 'countryCd'], ['제조국', 'country']],
      empty: '조건에 맞는 수입식품이 없습니다. 제품명은 영문 일부로, 품목명은 한글로 입력해 보세요.',
    },
    receipts: {
      endpoint: '/api/receipts',
      form: $('#form-receipts'),
      key: (r) => r.rcptNo,
      columns: [
        { label: '접수번호', cls: 'mono', render: (r) => esc(r.rcptNo) },
        { label: '접수일', cls: 'mono', render: (r) => esc(fmtDate(r.rcptDt)) },
        { label: '해외제조업소', render: (r) => `<span class="strong">${esc(r.mnft)}</span><span class="dim">${esc(r.mnftAddr)}</span>` },
        { label: '수출업소', render: (r) => esc(r.exprt) || '<span class="dim">—</span>' },
      ],
      csv: [['접수번호', 'rcptNo'], ['접수일시', 'rcptDt'], ['해외제조업소코드', 'mnftCd'], ['해외제조업소', 'mnft'], ['해외제조업소주소', 'mnftAddr'], ['수출업소코드', 'exprtCd'], ['수출업소', 'exprt']],
      empty: '조건에 맞는 수입신고 접수 건이 없습니다.',
    },
  };

  const state = {
    tab: 'products',
    page: 1,
    rows: 20,
    data: { products: null, receipts: null },
    query: { products: {}, receipts: {} },
    seen: { products: null, receipts: null }, // 신규 감지용: 직전 조회의 키 목록
    seenSig: { products: '', receipts: '' },
    timer: null,
    busy: false,
  };

  // 저장된 설정 복원 (브라우저별 편의 기능)
  try {
    const saved = JSON.parse(localStorage.getItem('impfood:prefs') || '{}');
    if (saved.rows) { state.rows = saved.rows; $('#rows').value = String(saved.rows); }
    if (saved.auto) $('#auto').value = String(saved.auto);
  } catch (_) {}
  const savePrefs = () => { try { localStorage.setItem('impfood:prefs', JSON.stringify({ rows: state.rows, auto: Number($('#auto').value) })); } catch (_) {} };

  // ── 연결 상태 ─────────────────────────────
  fetch('/api/status').then((r) => r.json()).then((s) => {
    const chip = $('#modeChip');
    chip.textContent = s.mock ? '예시 데이터' : 'API 연결됨';
    chip.className = 'chip ' + (s.mock ? 'mock' : 'live');
    chip.title = s.mock ? '.env 파일에 SERVICE_KEY를 넣고 서버를 다시 시작하면 실제 데이터로 바뀝니다.' : '공공데이터포털 Open API에서 실시간 조회합니다.';
  }).catch(() => {});

  // ── 조회 ──────────────────────────────────
  async function load({ silent = false } = {}) {
    if (state.busy) return;
    state.busy = true;
    const tab = state.tab, def = TABS[tab];
    const params = new URLSearchParams({ ...state.query[tab], page: state.page, rows: state.rows });
    if (!silent) renderLoading();
    $('#error').hidden = true;

    try {
      const res = await fetch(`${def.endpoint}?${params}`);
      const json = await res.json();
      if (!res.ok) throw Object.assign(new Error(json.error || '조회에 실패했습니다.'), json);

      // 같은 조건·같은 페이지를 다시 조회했을 때만 신규 표시
      const sig = JSON.stringify([state.query[tab], state.page, state.rows]);
      const prev = state.seenSig[tab] === sig ? state.seen[tab] : null;
      const newKeys = new Set();
      if (prev) for (const r of json.items) if (!prev.has(def.key(r))) newKeys.add(def.key(r));
      state.seen[tab] = new Set(json.items.map(def.key));
      state.seenSig[tab] = sig;

      state.data[tab] = { ...json, newKeys, at: nowTime() };
      render();
      if (silent && newKeys.size) toast(`신규 ${newKeys.size}건이 들어왔습니다`);
    } catch (e) {
      showError(e);
      if (!state.data[tab]) renderEmpty('데이터를 불러오지 못했습니다.');
    } finally {
      state.busy = false;
    }
  }

  // ── 렌더링 ────────────────────────────────
  function renderHead() {
    const def = TABS[state.tab];
    $('#thead').innerHTML = `<tr><th>No</th>${def.columns.map((c) => `<th>${c.label}</th>`).join('')}</tr>`;
  }
  function renderLoading() {
    renderHead();
    const n = TABS[state.tab].columns.length + 1;
    $('#tbody').innerHTML = `<tr class="loading empty"><td colspan="${n}">불러오는 중…</td></tr>`;
  }
  function renderEmpty(msg) {
    const n = TABS[state.tab].columns.length + 1;
    $('#tbody').innerHTML = `<tr class="empty"><td colspan="${n}">${esc(msg)}</td></tr>`;
    $('#pager').innerHTML = '';
  }
  function render() {
    const tab = state.tab, def = TABS[tab], d = state.data[tab];
    renderHead();
    if (!d) { $('#count').innerHTML = '조건을 입력하고 조회하세요'; $('#meta').textContent = ''; renderEmpty('아직 조회하지 않았습니다.'); return; }

    $('#count').innerHTML = `총 <b>${d.totalCount.toLocaleString('ko-KR')}</b>건`;
    const auto = Number($('#auto').value);
    $('#meta').textContent = `마지막 조회 ${d.at}` + (auto ? ` · ${auto}분마다 자동 새로고침` : '') + ' · 같은 조건은 최대 1분간 저장된 결과를 보여줍니다';

    if (!d.items.length) return renderEmpty(def.empty);
    const start = (d.pageNo - 1) * d.numOfRows;
    $('#tbody').innerHTML = d.items.map((r, i) => {
      const isNew = d.newKeys.has(def.key(r));
      return `<tr tabindex="0" data-i="${i}" class="${isNew ? 'is-new' : ''}">
        <td class="num">${start + i + 1}</td>
        ${def.columns.map((c, ci) => `<td class="${c.cls || ''}">${c.render(r)}${ci === 0 && isNew ? '<span class="badge-new">신규</span>' : ''}</td>`).join('')}
      </tr>`;
    }).join('');
    renderPager(d);
  }

  function renderPager(d) {
    const pages = Math.max(1, Math.ceil(d.totalCount / d.numOfRows));
    const cur = d.pageNo, win = 5;
    let from = Math.max(1, cur - Math.floor(win / 2)), to = Math.min(pages, from + win - 1);
    from = Math.max(1, to - win + 1);
    const btn = (p, label, opts = {}) => `<button type="button" data-p="${p}" ${opts.disabled ? 'disabled' : ''} ${opts.current ? 'aria-current="page"' : ''} aria-label="${opts.aria || p + '페이지'}">${label}</button>`;
    let html = btn(1, '«', { disabled: cur === 1, aria: '첫 페이지' }) + btn(cur - 1, '‹', { disabled: cur === 1, aria: '이전 페이지' });
    for (let p = from; p <= to; p++) html += btn(p, p, { current: p === cur });
    html += btn(cur + 1, '›', { disabled: cur === pages, aria: '다음 페이지' }) + btn(pages, '»', { disabled: cur === pages, aria: '마지막 페이지' });
    $('#pager').innerHTML = pages > 1 ? html : '';
  }

  function showError(e) {
    const box = $('#error');
    box.innerHTML = `<b>${esc(e.message)}${e.code ? ` (코드 ${esc(e.code)})` : ''}</b>${esc(e.hint || '')}`;
    box.hidden = false;
  }

  // ── 상세 패널 ──────────────────────────────
  async function openDetail(row) {
    const tab = state.tab;
    $('#drawer').hidden = false; $('#scrim').hidden = false;
    $('#drawerClose').focus();
    const dl = (pairs) => `<dl class="dl">${pairs.filter(([, v]) => v).map(([k, v, mono]) => `<dt>${k}</dt><dd class="${mono ? 'mono' : ''}">${esc(v)}</dd>`).join('')}</dl>`;

    if (tab === 'receipts') {
      $('#drawerEyebrow').textContent = '수입신고 접수';
      $('#drawerTitle').textContent = row.rcptNo;
      $('#drawerBody').innerHTML = `
        <div class="group"><h3>접수 정보</h3>${dl([['접수번호', row.rcptNo, 1], ['접수일시', fmtDate(row.rcptDt), 1]])}</div>
        <div class="group"><h3>해외제조업소</h3>${dl([['업소코드', row.mnftCd, 1], ['회사명', row.mnft], ['주소', row.mnftAddr]])}</div>
        <div class="group"><h3>수출업소</h3>${row.exprt || row.exprtCd ? dl([['업소코드', row.exprtCd, 1], ['회사명', row.exprt]]) : '<p class="note">수출업소 정보가 없습니다.</p>'}</div>`;
      return;
    }

    $('#drawerEyebrow').textContent = row.divs || '수입식품';
    $('#drawerTitle').textContent = row.name || row.item;
    const base = `<div class="group"><h3>제품 정보</h3>${dl([['관리번호', row.mngNo, 1], ['신고제품구분', row.divs], ['제품명', row.name], ['품목명', row.item], ['품목코드', row.itemCd, 1], ['육류품목', row.meat], ['제조국', [row.country, row.countryCd].filter(Boolean).join(' · ')]])}</div>`;
    $('#drawerBody').innerHTML = base + '<p class="note">제조·수출업소 정보를 불러오는 중…</p>';

    try {
      const q = new URLSearchParams({ mngNo: row.mngNo, divs: row.divs, country: row.country, name: row.name, item: row.item });
      const res = await fetch(`/api/detail?${q}`);
      const json = await res.json();
      if (!res.ok) throw Object.assign(new Error(json.error), json);
      if (!json.items.length) {
        $('#drawerBody').innerHTML = base + '<p class="note">고유제품 상세정보에서 일치하는 제품을 찾지 못했습니다.</p>';
        return;
      }
      const d = json.items[0];
      $('#drawerBody').innerHTML = base +
        (json.matched ? '' : '<p class="note">관리번호가 정확히 일치하는 상세정보가 없어, 제품명·국가·품목이 같은 가장 가까운 결과를 보여줍니다.</p>') +
        `<div class="group"><h3>해외제조업소</h3>${dl([['회사명', d.mnft], ['주소', d.mnftAddr]]) || '<p class="note">정보 없음</p>'}</div>
         ${d.wksh || d.wkshAddr ? `<div class="group"><h3>해외작업장</h3>${dl([['작업장명', d.wksh], ['주소', d.wkshAddr]])}</div>` : ''}
         ${d.pck || d.pckAddr ? `<div class="group"><h3>포장장소</h3>${dl([['장소명', d.pck], ['주소', d.pckAddr]])}</div>` : ''}
         ${d.exprt || d.exprtAddr ? `<div class="group"><h3>수출업소</h3>${dl([['회사명', d.exprt], ['주소', d.exprtAddr]])}</div>` : ''}
         ${d.nameKor || d.irdnt ? `<div class="group"><h3>기타</h3>${dl([['한글 제품명', d.nameKor], ['성분명', d.irdnt]])}</div>` : ''}`;
    } catch (e) {
      $('#drawerBody').innerHTML = base + `<p class="note">상세정보를 불러오지 못했습니다: ${esc(e.message)} ${esc(e.hint || '')}</p>`;
    }
  }
  function closeDetail() { $('#drawer').hidden = true; $('#scrim').hidden = true; }

  // ── CSV ────────────────────────────────────
  function downloadCsv() {
    const d = state.data[state.tab];
    if (!d || !d.items.length) return toast('저장할 조회 결과가 없습니다');
    const cols = TABS[state.tab].csv;
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [cols.map((c) => cell(c[0])).join(','), ...d.items.map((r) => cols.map((c) => cell(r[c[1]])).join(','))];
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `수입식품_${state.tab === 'products' ? '제품' : '수입신고접수'}_${new Date().toISOString().slice(0, 10)}_p${d.pageNo}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ── 자동 새로고침 ──────────────────────────
  function setAuto() {
    clearInterval(state.timer);
    const min = Number($('#auto').value);
    if (min) state.timer = setInterval(() => { if (!document.hidden) load({ silent: true }); }, min * 60000);
    savePrefs();
    if (state.data[state.tab]) render();
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3500);
  }

  // ── 이벤트 ────────────────────────────────
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
    state.tab = b.dataset.tab;
    document.querySelectorAll('.tab').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    for (const k of Object.keys(TABS)) $(`#panel-${k}`).hidden = k !== state.tab;
    state.page = state.data[state.tab]?.pageNo || 1;
    if (state.data[state.tab]) render(); else load();
  }));

  for (const [name, def] of Object.entries(TABS)) {
    def.form.addEventListener('submit', (e) => {
      e.preventDefault();
      state.query[name] = Object.fromEntries([...new FormData(def.form)].filter(([, v]) => String(v).trim()));
      state.page = 1;
      load();
    });
    def.form.addEventListener('reset', () => setTimeout(() => def.form.requestSubmit(), 0));
  }

  $('#rows').addEventListener('change', (e) => { state.rows = Number(e.target.value); state.page = 1; savePrefs(); load(); });
  $('#auto').addEventListener('change', setAuto);
  $('#csv').addEventListener('click', downloadCsv);
  $('#pager').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-p]');
    if (!b || b.disabled) return;
    state.page = Number(b.dataset.p); load();
    $('#table').scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  $('#tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-i]');
    if (tr) openDetail(state.data[state.tab].items[Number(tr.dataset.i)]);
  });
  $('#tbody').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('tr[data-i]')) openDetail(state.data[state.tab].items[Number(e.target.dataset.i)]);
  });
  $('#drawerClose').addEventListener('click', closeDetail);
  $('#scrim').addEventListener('click', closeDetail);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDetail(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Number($('#auto').value) && state.data[state.tab]) load({ silent: true }); });

  // 첫 화면: 전체 목록 1페이지
  setAuto();
  load();
})();
