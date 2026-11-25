const $ = selector => document.querySelector(selector);
const format = new Intl.NumberFormat('en');
const numberWithDecimals = new Intl.NumberFormat('en', {maximumFractionDigits: 6});
const numeric = n => format.format(n);
const shortDay = day => new Intl.DateTimeFormat('en', {month: 'short', day: 'numeric', timeZone: 'UTC'}).format(new Date(day));
const fullTime = value => value.slice(0, 16).replace('T', ' ') + ' UTC';
const pretty = text => text.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
const headings = [
  ['registeredWorkers', 'Registered workers', 'All-time registrations'],
  ['activeWorkers7d', 'Active workers', 'Last 7 days'],
  ['activeAgents7d', 'Active agents', 'Last 7 days'],
  ['openTasks', 'Open tasks', 'Market stats endpoint'],
  ['paidWorkers', 'Paid workers', 'Workers receiving payment'],
  ['activeWallets', 'Active wallets', 'Wallets reported by the API'],
];
const metrics = [['agents', 'Daily active agents'], ['tasks', 'Tasks posted'], ['offered', 'Rewards offered'], ['paid', 'Rewards paid']];
const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const initial = new URLSearchParams(location.search);
let snapshot, net = initial.get('net') === 'base' ? 'base' : 'tempo';
let range = ['7', '90', 'all'].includes(initial.get('range')) ? initial.get('range') : '30';

function setControls(selector, key, value) {
  document.querySelectorAll(selector).forEach(button => button.setAttribute('aria-pressed', button.dataset[key] === value));
}

function updateLink() {
  const url = new URL(location.href);
  url.search = new URLSearchParams({net, range});
  history.replaceState(null, '', url);
}

function plot(rows, key, name, unit) {
  const values = rows.map(row => Number(row[key]) / (unit ? 1e6 : 1));
  const ceiling = Math.max(1, ...values);
  const x = i => 3 + i * 354 / Math.max(1, values.length - 1);
  const y = v => 96 - 92 * v / ceiling;
  const path = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
  const top = unit ? numeric(ceiling) + ' ' + unit : numeric(ceiling);
  return `<article class="panel chart"><h3>${name}</h3><div class="chart-scale"><span>${top}</span><span>0</span></div>
    <svg viewBox="0 0 360 100" preserveAspectRatio="none" role="img" aria-label="${name}, scale 0 to ${top}">
    <path class="grid" d="M0 4H360 M0 50H360 M0 96H360"></path>
    <path class="area" d="${path} L${x(values.length - 1)},96 L3,96 Z"></path><path class="trace" d="${path}"></path>
    </svg><div class="chart-dates"><span>${shortDay(rows[0].day)}</span><span>${shortDay(rows.at(-1).day)}</span></div>
    <details class="values"><summary>Daily values</summary><div class="value-scroll"><table><thead><tr><th scope="col">UTC date</th><th scope="col">${unit || 'Count'}</th></tr></thead><tbody>${rows.map((row, i) => `<tr><th scope="row">${row.day}</th><td>${numberWithDecimals.format(values[i])}</td></tr>`).join('')}</tbody></table></div></details></article>`;
}

function renderTrends() {
  const values = snapshot.series.shared ?? snapshot.series.byNetwork[net];
  const latest = values.at(-1)?.day;
  const start = Date.parse(latest) - (Number(range) - 1) * 86_400_000;
  const rows = range === 'all' ? values : values.filter(row => Date.parse(row.day) >= start);
  const token = snapshot.series.shared ? 'units' : net === 'tempo' ? 'OUSD' : 'USDC';
  $('#series-scope').textContent = snapshot.series.shared ? 'Shared API series for Tempo and Base · daily UTC buckets' : 'Daily UTC buckets · latest day may be incomplete';
  $('#charts').innerHTML = rows.length ? metrics.map(([key, name], i) => plot(rows, key, name, i >= 2 ? token : '')).join('') : '<p>No daily observations returned.</p>';
}

function bars(rows) {
  const max = Math.max(1, ...rows.map(row => row.count));
  return rows.length ? `<ul class="bars">${rows.map(row => `<li><span>${pretty(row.key)}</span><meter aria-label="${pretty(row.key)}" min="0" max="${max}" value="${row.count}"></meter><strong>${numeric(row.count)}</strong></li>`).join('')}</ul>` : '<p>No counts returned.</p>';
}

function renderPosters(rows) {
  const max = Math.max(1, ...rows.map(row => row.posters));
  const last = rows.at(-2);
  const concentration = last.tasks ? `${numeric(Math.round(100 * last.repeatTasks / last.tasks))}%` : null;
  $('#posters').innerHTML = `<div class="posters-title"><h3>Weekly distinct posters</h3><span class="caption">12 full weeks + current</span></div>
    <p class="insight">${concentration ? `In the week of ${shortDay(last.week)}, <strong>${concentration}</strong> of tasks came from requesters who posted more than once (${numeric(last.repeatTasks)} of ${numeric(last.tasks)} tasks).` : 'No tasks in the last full UTC week.'}</p>
    <div class="week-chart" aria-hidden="true">${rows.map(row => `<div class="week"><span>${row.posters}</span><div class="week-bar"><i class="${row.partial ? 'partial' : ''}" style="height:${100 * row.posters / max}%"></i></div><span>${shortDay(row.week)}</span></div>`).join('')}</div>
    <details class="values"><summary>Weekly values</summary><div class="value-scroll"><table><thead><tr><th scope="col">Week of</th><th scope="col">Posters</th><th scope="col">Posted twice or more</th><th scope="col">Tasks</th></tr></thead><tbody>
    ${rows.map(row => `<tr><th scope="row">${row.week}${row.partial ? ' (partial)' : ''}</th><td>${numeric(row.posters)}</td><td>${numeric(row.repeat)}</td><td>${numeric(row.tasks)}</td></tr>`).join('')}
    </tbody></table></div></details>`;
}

function renderHeat(grid) {
  const peak = Math.max(...grid.flat());
  const order = [1, 2, 3, 4, 5, 6, 0];
  $('#heat').innerHTML = `<div class="heat-scroll"><table class="heat-table"><thead><tr><th scope="col">UTC</th>${grid[0].map((_, x) => `<th scope="col">${x}</th>`).join('')}</tr></thead><tbody>
  ${order.map(y => `<tr><th scope="row">${days[y]}</th>${grid[y].map((n, x) => `<td aria-label="${days[y]}, ${x}:00 UTC: ${numeric(n)} events" title="${days[y]}, ${x}:00 UTC: ${numeric(n)} events" style="--heat:${n ? 0.16 + 0.84 * Math.sqrt(n / peak) : 0}"><span class="sr">${numeric(n)}</span></td>`).join('')}</tr>`).join('')}
  </tbody></table></div><div class="heat-legend"><span>0</span><i></i><span>${numeric(peak)} events / hour-of-week</span></div>`;
}

function render() {
  const {posters, feed} = snapshot.networks[net];
  $('#headline').innerHTML = headings.map(([key, label, caption]) => `<article class="panel metric"><span>${label}</span><strong>${numeric(snapshot.headline[net][key])}</strong><small>${caption}</small></article>`).join('');
  renderTrends();
  renderPosters(posters);
  const breakdown = snapshot.breakdown.shared ?? snapshot.breakdown.byNetwork[net];
  $('#modes').innerHTML = bars(breakdown.mode);
  $('#statuses').innerHTML = bars(breakdown.status);
  $('#breakdown-scope').textContent = snapshot.breakdown.shared ? 'Shared API breakdown for Tempo and Base.' : 'Counts as returned for the selected network.';
  renderHeat(snapshot.heat.shared ?? snapshot.heat.byNetwork[net]);
  $('#heat-scope').textContent = `Trailing 30 days · UTC${snapshot.heat.shared ? ' · shared API heatmap for Tempo and Base' : ''}`;
  $('#feed').innerHTML = feed.length ? `<ul class="events">${feed.map(event => `<li><span>${pretty(event.type)}</span>
    <a href="https://taskmarket.dev/tasks/${event.id}">Task ${event.id.slice(0, 8)}…${event.id.slice(-4)} <span aria-hidden="true">↗</span></a>
    <time datetime="${event.at}">${fullTime(event.at)}</time></li>`).join('')}</ul>` : '<p>No events for this chain in the scanned feed pages.</p>';
}

async function refresh() {
  try {
    const response = await fetch('/api/pulse');
    if (!response.ok) throw new Error('Snapshot unavailable');
    const next = await response.json();
    if (snapshot?.asOf !== next.asOf) {
      snapshot = next;
      render();
    }
    $('#as-of').textContent = `Data as of ${fullTime(snapshot.asOf)}`;
    $('#dashboard').hidden = false;
    const stale = Date.now() - Date.parse(snapshot.asOf) > 3_600_000;
    $('#notice').textContent = stale ? 'This snapshot is over an hour old. Showing the last successful refresh.' : '';
    $('#notice').hidden = !stale;
  } catch {
    $('#as-of').textContent = snapshot ? `Data as of ${fullTime(snapshot.asOf)}` : 'No snapshot available';
    $('#notice').textContent = snapshot ? 'Could not check for newer data. Showing the last loaded snapshot.' : 'The market snapshot is not available yet. Retrying automatically.';
    $('#notice').hidden = false;
  }
}

document.querySelectorAll('[data-net]').forEach(button => button.addEventListener('click', () => {
  net = button.dataset.net;
  setControls('[data-net]', 'net', net);
  updateLink();
  if (snapshot) render();
}));
document.querySelectorAll('[data-range]').forEach(button => button.addEventListener('click', () => {
  range = button.dataset.range;
  setControls('[data-range]', 'range', range);
  updateLink();
  if (snapshot) renderTrends();
}));
setControls('[data-net]', 'net', net);
setControls('[data-range]', 'range', range);
refresh();
setInterval(refresh, 60_000);
