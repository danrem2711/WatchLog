const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = n => `<i class="fa-solid fa-${n}"></i>`;
const IMG = 'https://image.tmdb.org/t/p/';
const STATUSES = ['Watching', 'Completed', 'On Hold', 'Plan to Watch', 'Dropped'];
const SC = ['#3b82f6', '#10b981', '#f59e0b', '#a855f7', '#ef4444'];
let me = null, mine = {};

const ago = t => { if (!t) return '—'; const d = (Date.now() - t) / 864e5; return d < 1 ? 'Today' : d < 2 ? 'Yesterday' : d < 30 ? Math.floor(d) + 'd ago' : new Date(t).toLocaleDateString(); };
function toast(m, bad) { const t = $('#toast'); t.textContent = m; t.className = 'show' + (bad ? ' bad' : ''); clearTimeout(toast.t); toast.t = setTimeout(() => t.className = '', 2600); }
async function api(p, o = {}) {
  const r = await fetch('/api' + p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json' }, body: o.body ? JSON.stringify(o.body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
}
async function loadMine() { mine = {}; if (me) (await api('/list')).forEach(e => mine[e.media_type + e.id] = e); }

// ---------- shared components ----------
const card = i => {
  const e = mine[i.media_type + i.id];
  return `<article class="card" data-t="${i.media_type}" data-id="${i.id}"><div class="po">${i.poster ? `<img loading="lazy" src="${IMG}w342${i.poster}" alt="">` : '<div class="np">No poster</div>'}</div>
    <span class="ty">${i.media_type === 'tv' ? 'Series' : 'Movie'}</span>${i.score ? `<span class="sc">${icon('star')} ${i.score}</span>` : ''}
    ${e ? `<span class="st s${STATUSES.indexOf(e.status)}">${e.status}</span>` : ''}
    <div class="meta"><b>${esc(i.title)}</b><small>${i.year || '—'}${e?.rating ? ` · ★ ${e.rating}` : ''}</small></div>
    ${i.why?.length ? `<div class="why">Because you like ${esc(i.why.join(', '))}</div>` : ''}</article>`;
};
const grid = items => `<div class="grid">${items.map(card).join('') || '<p class="mu">Nothing here yet.</p>'}</div>`;
const stat = (ic, c, l, v) => `<div class="stat"><div class="si" style="--c:${c}">${icon(ic)}</div><div><small>${l}</small><b>${v}</b></div></div>`;
const bars = rows => { const m = Math.max(1, ...rows.map(r => r[1])); return rows.map(([k, v]) => `<div class="r"><span>${esc(k)}</span><i style="width:${v / m * 100}%"></i><b>${v}</b></div>`).join('') || '<p class="mu">No data yet.</p>'; };
const table = (h, rows) => `<div class="tw"><table><thead><tr>${h.map(x => `<th class="${x.hm ? 'hm' : ''}">${x.hm ? x.t : x}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${h.length}" class="mu">Nothing to show.</td></tr>`}</tbody></table></div>`;
const hero = (tag, title, sub, btns) => `<section class="hero"><span class="tag">${tag}</span><h1>${title}</h1><p>${sub}</p><div class="row">${btns}</div></section>`;
function lineChart(days, series) {
  const W = 600, H = 210, P = 30, max = Math.max(1, ...series.flatMap(s => s.data));
  const x = i => P + i * (W - 2 * P) / (days.length - 1), y = v => H - P - v * (H - 2 * P) / max;
  const grid = [0, .5, 1].map(f => `<line x1="${P}" x2="${W - P}" y1="${y(max * f)}" y2="${y(max * f)}" stroke="#1f2937"/><text x="2" y="${y(max * f) + 4}" fill="#6b7280" font-size="11">${Math.round(max * f)}</text>`).join('');
  const lines = series.map(s => `<polyline fill="none" stroke="${s.c}" stroke-width="2.5" stroke-linejoin="round" points="${s.data.map((v, i) => x(i) + ',' + y(v)).join(' ')}"/>` +
    s.data.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3.5" fill="${s.c}"><title>${days[i]}: ${v}</title></circle>`).join('')).join('');
  const lbl = days.map((d, i) => i % 3 === 0 ? `<text x="${x(i)}" y="${H - 8}" fill="#6b7280" font-size="11" text-anchor="middle">${d}</text>` : '').join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart">${grid}${lines}${lbl}</svg>`;
}

// ---------- user views ----------
async function dashboard() {
  if (!me) {
    $('#view').innerHTML = hero('Cloud synced tracker', 'Track Movies & Series in One Place', 'Build watchlists, rate and review what you watch, see your stats and get recommendations based on your taste.',
      `<a class="btn light" href="#/login">${icon('right-to-bracket')} Get started</a><a class="btn ghost" href="#/explore">${icon('compass')} Explore catalog</a>`) + '<h2>Trending this week</h2><div id="res"></div>';
    $('#res').innerHTML = grid(await api('/trending')); return;
  }
  const s = await api('/stats'), recent = Object.values(mine).slice(0, 6);
  $('#view').innerHTML = hero('Welcome back', `Hi ${esc(me.username)}, what are you watching?`, 'Pick up where you left off, log a new title or check what we recommend next.',
    `<a class="btn light" href="#/list">${icon('list-check')} Open watchlist</a><a class="btn ghost" href="#/explore">${icon('compass')} Explore</a>`) +
    `<div class="tiles">${stat('film', '#ec4899', 'Total titles', s.total)}${stat('circle-check', '#10b981', 'Completed', s.byStatus.Completed || 0)}${stat('play', '#3b82f6', 'Watching', s.byStatus.Watching || 0)}${stat('star', '#fbbf24', 'Mean score', s.avgRating ?? '—')}</div>
    <div class="cols"><section class="panel"><h3>${icon('clock-rotate-left')} Recent activity</h3>${recent.map(e => `<div class="actrow" data-t="${e.media_type}" data-id="${e.id}">${e.poster ? `<img src="${IMG}w92${e.poster}" alt="">` : '<div class="np"></div>'}<div><b>${esc(e.title)}</b><small>${ago(e.updated)}${e.rating ? ` · ★ ${e.rating}` : ''}</small></div><span class="pill" style="background:${SC[STATUSES.indexOf(e.status)]}33">${e.status}</span></div>`).join('') || '<p class="mu">Nothing yet. Add a title from Explore.</p>'}</section>
    <section class="panel"><h3>${icon('tags')} Genre breakdown</h3><div class="bars">${bars(s.topGenres)}</div><h3 style="margin-top:1.2rem">${icon('star')} Your ratings</h3><div class="bars">${bars(Array.from({ length: 10 }, (_, i) => [10 - i, s.ratingDist[10 - i] || 0]))}</div></section></div>`;
}

async function explore() {
  $('#view').innerHTML = `<div class="bar"><form id="sf" class="bar" style="flex:1;margin:0"><input id="q" type="search" placeholder="Search movies & series…" required><button class="btn">${icon('magnifying-glass')} Search</button></form>
    <select id="xt"><option value="">Movies & Series</option><option value="movie">Movies</option><option value="tv">Series</option></select></div><h2 id="ht"></h2><div id="res"></div>`;
  let R = [], title = '';
  const draw = () => { const t = $('#xt').value; $('#ht').textContent = title; $('#res').innerHTML = grid(R.filter(i => !t || i.media_type === t)); };
  const show = async q => { R = await api(q ? `/search?q=${encodeURIComponent(q)}` : '/trending'); title = q ? `Results for “${q}”` : 'Trending this week'; draw(); };
  $('#sf').onsubmit = e => { e.preventDefault(); show($('#q').value.trim()).catch(err => toast(err.message, 1)); };
  $('#xt').onchange = draw;
  await show();
}

async function list() {
  let status = 'All'; const all = Object.values(mine);
  $('#view').innerHTML = `<div class="tabs" id="tabs"></div><div class="bar"><input id="fq" type="search" placeholder="Search your watchlist…">
    <select id="ft"><option value="">All types</option><option value="movie">Movies</option><option value="tv">Series</option></select><select id="fg"><option value="">All genres</option></select>
    <select id="fs"><option value="updated">Recently updated</option><option value="rating">My rating</option><option value="title">Title A–Z</option><option value="year">Year</option></select></div><div id="res"></div>`;
  [...new Set(all.flatMap(e => e.genres))].sort().forEach(g => $('#fg').insertAdjacentHTML('beforeend', `<option>${esc(g)}</option>`));
  const draw = () => {
    $('#tabs').innerHTML = ['All', ...STATUSES].map(s => `<button class="${s === status ? 'on' : ''}" data-s="${s}">${s} (${s === 'All' ? all.length : all.filter(e => e.status === s).length})</button>`).join('');
    const q = $('#fq').value.toLowerCase(), t = $('#ft').value, g = $('#fg').value, s = $('#fs').value;
    $('#res').innerHTML = grid(all.filter(e => (status === 'All' || e.status === status) && (!t || e.media_type === t) && (!g || e.genres.includes(g)) && e.title.toLowerCase().includes(q))
      .sort((a, b) => s === 'title' ? a.title.localeCompare(b.title) : s === 'rating' ? (b.rating || 0) - (a.rating || 0) : s === 'year' ? b.year - a.year : b.updated - a.updated));
  };
  $('#tabs').onclick = e => { if (e.target.dataset.s) { status = e.target.dataset.s; draw(); } };
  ['fq', 'ft', 'fg', 'fs'].forEach(id => $('#' + id).oninput = draw); draw();
}

async function recs() {
  const r = await api('/recommendations');
  $('#view').innerHTML = hero(r.basedOn.length ? 'Personalised' : 'Trending', r.basedOn.length ? 'Picked for you' : 'Start rating to get picks',
    r.basedOn.length ? `Based on your favourite genres: ${esc(r.basedOn.join(', '))}. Rate more titles to sharpen these.` : 'Add and rate titles and recommendations will adapt to your taste.', '') + '<h2>Recommended</h2>' + grid(r.items);
}

function authView(mode = 'login') {
  $('#view').innerHTML = `<form class="auth" id="af"><h2 style="margin:0">${mode === 'login' ? 'Welcome back' : 'Create account'}</h2>
    <input name="username" placeholder="Username" autocomplete="username" required><input name="password" type="password" placeholder="Password (8+ chars)" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required>
    <button class="btn" style="justify-content:center">${mode === 'login' ? 'Log in' : 'Sign up'}</button><p id="ae" class="err" style="margin:0"></p>
    <small><a href="#" id="sw" style="color:#ec4899">${mode === 'login' ? 'Need an account? Sign up' : 'Have an account? Log in'}</a></small></form>`;
  $('#sw').onclick = e => { e.preventDefault(); authView(mode === 'login' ? 'register' : 'login'); };
  $('#af').onsubmit = async e => {
    e.preventDefault();
    try { me = (await api('/' + mode, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) })).user; await loadMine(); location.hash = '#/dashboard'; route(); }
    catch (err) { $('#ae').textContent = err.message; }
  };
}

// ---------- admin ----------
const A = { tab: 'overview', users: [], reviews: [] };
async function admin() {
  const tabs = [['overview', 'chart-line', 'Overview'], ['users', 'users', 'Users'], ['reviews', 'comments', 'Reviews']];
  $('#view').innerHTML = `<div class="ah"><div><h1>Admin dashboard</h1><small>Monitor activity and moderate the community</small></div>
    <div class="tabs" id="seg" style="margin:0">${tabs.map(([k, i, l]) => `<button data-tab="${k}" class="${A.tab === k ? 'on' : ''}">${icon(i)} ${l}</button>`).join('')}</div></div><div id="ab" style="margin-top:1rem"></div>`;
  $('#seg').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) { A.tab = b.dataset.tab; admin().catch(err => toast(err.message, 1)); } };
  await ({ overview: aOverview, users: aUsers, reviews: aReviews })[A.tab]();
}
async function aOverview() {
  const d = await api('/admin/overview'), c = d.cards, tot = d.status.reduce((s, x) => s + x.n, 0);
  let acc = 0; const seg = d.status.map(x => { const a = acc / tot * 100; acc += x.n; return `${SC[STATUSES.indexOf(x.k)]} ${a}% ${acc / tot * 100}%`; }).join(',');
  $('#ab').innerHTML = `<div class="tiles">${stat('users', '#ec4899', 'Total users', c.users)}${stat('user-plus', '#3b82f6', 'New users (7d)', c.newUsers)}${stat('bolt', '#10b981', 'Active users (7d)', c.active)}${stat('film', '#a855f7', 'Titles tracked', c.entries)}${stat('comment', '#f59e0b', 'Reviews', c.reviews)}${stat('star', '#eab308', 'Avg rating', c.avg ?? '—')}</div>
    <div class="cols"><section class="panel"><h3>Last 14 days</h3><div class="leg"><span style="--c:#ec4899">New users</span><span style="--c:#3b82f6">List updates</span></div>${lineChart(d.days, [{ c: '#ec4899', data: d.signups }, { c: '#3b82f6', data: d.activity }])}</section>
    <section class="panel"><h3>Status split</h3>${tot ? `<div class="donut" style="background:conic-gradient(${seg})" data-n="${tot}"></div><div class="leg v">${d.status.map(x => `<span style="--c:${SC[STATUSES.indexOf(x.k)]}">${x.k} · ${x.n}</span>`).join('')}</div>` : '<p class="mu">No data yet.</p>'}</section></div>
    <div class="cols eq"><section class="panel"><h3>Top genres</h3><div class="bars">${bars(d.genres)}</div></section>
    <section class="panel"><h3>Most tracked titles</h3>${table(['Title', 'Type', 'Users', 'Avg'], d.top.map(t => `<tr><td>${esc(t.title)}</td><td>${t.media_type === 'tv' ? 'Series' : 'Movie'}</td><td>${t.n}</td><td>${t.avg ?? '—'}</td></tr>`))}</section></div>
    <section class="panel"><h3>Recent activity</h3>${table(['User', 'Title', 'Status', { t: 'Rating', hm: 1 }, { t: 'When', hm: 1 }], d.recent.map(r => `<tr><td>${esc(r.username)}</td><td>${esc(r.title)}</td><td><span class="pill" style="background:${SC[STATUSES.indexOf(r.status)]}33">${r.status}</span></td><td class="hm">${r.rating ?? '—'}</td><td class="hm">${ago(r.updated)}</td></tr>`))}</section>`;
}
async function aUsers() {
  A.users = await api('/admin/users');
  $('#ab').innerHTML = `<section class="panel"><div class="bar"><input id="uq" type="search" placeholder="Search users…"><select id="ur"><option value="">All roles</option><option value="admin">Admins</option><option value="user">Users</option></select>
    <select id="us"><option value="">Any status</option><option value="0">Active</option><option value="1">Banned</option></select><small id="uc"></small></div><div id="ut"></div></section>`;
  const draw = () => {
    const q = $('#uq').value.toLowerCase(), r = $('#ur').value, s = $('#us').value;
    const rows = A.users.filter(u => u.username.toLowerCase().includes(q) && (!r || u.role === r) && (s === '' || String(u.banned) === s));
    $('#uc').textContent = `${rows.length} of ${A.users.length}`;
    $('#ut').innerHTML = table(['User', 'Role', 'Status', 'Titles', { t: 'Last active', hm: 1 }, { t: 'Joined', hm: 1 }, 'Actions'], rows.map(u => {
      const self = u.id === me.id, b = (a, i, t, cls = '') => `<button class="ib ${cls}" data-uid="${u.id}" data-act="${a}" title="${t}" ${self ? 'disabled' : ''}>${icon(i)}</button>`;
      return `<tr><td><b>${esc(u.username)}</b>${self ? ' <small>(you)</small>' : ''}</td><td><span class="pill ${u.role === 'admin' ? 'admin' : ''}">${u.role}</span></td><td><span class="pill ${u.banned ? 'bad' : 'ok'}">${u.banned ? 'Banned' : 'Active'}</span></td><td>${u.entries}</td><td class="hm">${ago(u.last)}</td><td class="hm">${u.created ? new Date(u.created).toLocaleDateString() : '—'}</td>
        <td class="ac">${u.role === 'admin' ? b('demote', 'user-minus', 'Remove admin') : b('promote', 'user-shield', 'Make admin')}${u.banned ? b('unban', 'unlock', 'Unban') : b('ban', 'ban', 'Ban user')}${b('delete', 'trash', 'Delete user', 'danger')}</td></tr>`;
    }));
  };
  ['uq', 'ur', 'us'].forEach(id => $('#' + id).oninput = draw); draw();
}
async function aReviews() {
  A.reviews = await api('/admin/reviews');
  $('#ab').innerHTML = `<section class="panel"><div class="bar"><input id="rq" type="search" placeholder="Search user, title or text…"><select id="rr"><option value="">Any rating</option><option value="hi">8–10</option><option value="mid">5–7</option><option value="lo">1–4</option></select><small id="rc"></small></div><div id="rt"></div></section>`;
  const draw = () => {
    const q = $('#rq').value.toLowerCase(), f = $('#rr').value;
    const rows = A.reviews.filter(r => `${r.username} ${r.title} ${r.review}`.toLowerCase().includes(q) && (!f || (f === 'hi' ? r.rating >= 8 : f === 'mid' ? r.rating >= 5 && r.rating < 8 : r.rating && r.rating < 5)));
    $('#rc').textContent = `${rows.length} of ${A.reviews.length}`;
    $('#rt').innerHTML = table(['User', 'Title', 'Rating', 'Review', { t: 'Date', hm: 1 }, ''], rows.map(r => `<tr><td>${esc(r.username)}</td><td>${esc(r.title)}</td><td>${r.rating ? '★ ' + r.rating : '—'}</td><td class="rt" title="${esc(r.review)}">${esc(r.review)}</td><td class="hm">${ago(r.updated)}</td>
      <td><button class="ib danger" data-rv="${r.uid}/${r.media_type}/${r.id}" title="Remove review">${icon('trash')}</button></td></tr>`));
  };
  ['rq', 'rr'].forEach(id => $('#' + id).oninput = draw); draw();
}
async function adminAct(b) {
  try {
    if (b.dataset.rv) { if (!confirm('Remove this review text? The rating stays.')) return; await api('/admin/review/' + b.dataset.rv, { method: 'DELETE' }); toast('Review removed'); aReviews(); return; }
    const a = b.dataset.act;
    if ((a === 'delete' && !confirm('Permanently delete this user and all their data?')) || (a === 'ban' && !confirm('Ban this user? They will be signed out.'))) return;
    await api(`/admin/users/${b.dataset.uid}/${a}`, { method: 'POST' }); toast('Done'); aUsers();
  } catch (err) { toast(err.message, 1); }
}

// ---------- title modal ----------
async function openModal(t, id) {
  const m = $('#modal'); m.innerHTML = '<p class="pad">Loading…</p>'; m.showModal();
  try {
    const [d, rv] = await Promise.all([api(`/title/${t}/${id}`), api(`/reviews/${t}/${id}`)]), e = mine[t + id];
    m.innerHTML = `<div class="mh" style="background-image:url(${d.backdrop ? IMG + 'w780' + d.backdrop : ''})"></div>
      <div class="mbody">${d.poster ? `<img src="${IMG}w342${d.poster}" alt="">` : ''}<div><h3>${esc(d.title)} <small>(${d.year || '—'})</small></h3>
        <small>${t === 'tv' ? `Series · ${d.seasons || '?'} seasons · ${d.episodes || '?'} eps` : `Movie · ${d.runtime || '?'} min`} · ★ ${d.score ?? '—'}</small>
        <p style="color:#c4b5fd;margin:.4rem 0">${icon('tags')} ${esc(d.genres.join(', '))}</p><p style="color:#d1d5db">${esc(d.overview) || 'No synopsis available.'}</p></div></div>
      <form class="f" id="ef"><div class="row2"><label>Status<select name="status">${STATUSES.map(s => `<option ${e?.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label>Your rating<select name="rating"><option value="">—</option>${[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(n => `<option ${e?.rating === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        ${t === 'tv' ? `<label>Episodes watched<input type="number" name="progress" min="0" max="${d.episodes || 9999}" value="${e?.progress || 0}"></label>` : ''}</div>
        <label>Your review<textarea name="review" rows="3" maxlength="5000">${esc(e?.review)}</textarea></label><p class="err" id="me" style="margin:0"></p>
        <div class="actions">${e ? '<button type="button" class="btn danger" id="del">Remove</button>' : ''}<button type="button" class="btn ghost" id="cl">Close</button><button class="btn">${e ? 'Update' : 'Add to list'}</button></div></form>
      ${rv.map(r => `<div class="rv"><b>${esc(r.username)}</b> ${r.rating ? `· ★ ${r.rating}` : ''}<br><span style="color:#d1d5db">${esc(r.review)}</span></div>`).join('')}`;
    $('#cl').onclick = () => m.close();
    const done = async msg => { await loadMine(); m.close(); toast(msg); route(); };
    if (e) $('#del').onclick = async () => { await api(`/entry/${t}/${id}`, { method: 'DELETE' }); done('Removed from your list'); };
    $('#ef').onsubmit = async ev => {
      ev.preventDefault();
      if (!me) { m.close(); location.hash = '#/login'; return; }
      const f = Object.fromEntries(new FormData(ev.target));
      if (f.status === 'Completed' && t === 'tv' && d.episodes) f.progress = d.episodes;
      try { await api('/entry', { method: 'PUT', body: { ...f, id: d.id, media_type: t, title: d.title, poster: d.poster, year: d.year, genre_ids: d.genre_ids } }); done('Saved'); }
      catch (err) { $('#me').textContent = err.message; }
    };
  } catch (err) { m.innerHTML = `<p class="pad err">${esc(err.message)}</p>`; }
}

// ---------- shell ----------
function chrome() {
  const h = location.hash.slice(2) || 'dashboard';
  const n = [['dashboard', 'chart-pie', 'Dashboard'], ['explore', 'compass', 'Explore'], ...(me ? [['list', 'list-check', 'Watchlist'], ['recs', 'wand-magic-sparkles', 'For You']] : []), ...(me?.role === 'admin' ? [['admin', 'shield-halved', 'Admin']] : [])];
  $('#nav').innerHTML = n.map(([k, i, l]) => `<a href="#/${k}" class="${k === h ? 'on' : ''}">${icon(i)}${l}</a>`).join('');
  $('#bnav').innerHTML = n.map(([k, i, l]) => `<a href="#/${k}" class="${k === h ? 'on' : ''}">${icon(i)}<span>${l}</span></a>`).join('');
  $('#auth').innerHTML = me ? `<a class="btn hide-m" href="#/explore">${icon('plus')} Add title</a><span class="badge"><i class="dot"></i><span>${esc(me.username)}</span>${me.role === 'admin' ? '<em>admin</em>' : ''}</span><button class="ib" id="lo" title="Log out">${icon('right-from-bracket')}</button>`
    : `<a class="btn" href="#/login">${icon('right-to-bracket')} Log in</a>`;
  if (me) $('#lo').onclick = async () => { await api('/logout', { method: 'POST' }); me = null; mine = {}; location.hash = '#/dashboard'; route(); };
}
const views = { dashboard, explore, list, recs, admin, login: () => authView() };
function route() {
  const h = location.hash.slice(2) || 'dashboard';
  if (['list', 'recs', 'admin'].includes(h) && !me) { location.hash = '#/login'; return; }
  if (h === 'admin' && me.role !== 'admin') { location.hash = '#/dashboard'; return; }
  chrome(); $('#view').innerHTML = '<p class="pad mu">Loading…</p>';
  (views[h] || dashboard)().catch(e => $('#view').innerHTML = `<p class="pad err">${esc(e.message)}</p>`);
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act],[data-rv]'); if (b) { if (!b.disabled) adminAct(b); return; }
  const c = e.target.closest('[data-t][data-id]'); if (c) openModal(c.dataset.t, c.dataset.id);
});
$('#modal').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });
addEventListener('hashchange', route);
(async () => { try { me = (await api('/me')).user; await loadMine(); } catch {} route(); })();
