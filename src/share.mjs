import {Resvg} from '@resvg/resvg-wasm';
import {cadence, cadenceLabels, handoff, signalNames, signalParams} from '../public/signals.js';

const colors = {returning: '#e74079', absent: '#d9a097', unknown: '#988a80', both: '#e74079', offered: '#d9a097', paid: '#99d9bb', quiet: '#675449', missing: '#332c27'};
const displayNet = net => net === 'base' ? 'Base' : 'Tempo';

export function signalStory(snapshot, params) {
  const {view, net, week} = signalParams(params.get('view'), params);
  if (!snapshot || !Object.hasOwn(signalNames, view)) return null;
  if (view === 'handoff') {
    const row = handoff(snapshot, net, week);
    if (!row) return null;
    return {
      title: signalNames[view], key: `${view}/${net}/${row.week}`,
      scope: `${displayNet(net)} · UTC week of ${row.week}${row.partial ? ' (partial)' : ''}`,
      headline: row.tasks ? `${row.returningTasks} / ${row.tasks} tasks` : 'No tasks this week',
      description: row.tasks ? 'From requesters who posted the preceding week' : 'No denominator for a returning share',
      detail: `Returning ${row.returningTasks}  ·  Absent prior week ${row.absentLastWeekTasks}  ·  Unknown ${row.unknown}`,
      segments: [['returning', row.returningTasks], ['absent', row.absentLastWeekTasks], ['unknown', row.unknown]].map(([kind, n]) => [kind, n / (row.tasks || 1)]),
    };
  }
  const {days, counts, shared, paidDays} = cadence(snapshot, net);
  return {
    title: signalNames[view], key: `${view}/${shared ? 'shared' : net}`,
    scope: `${shared ? 'Shared Tempo + Base API series' : displayNet(net)} · ${days[0].day} to ${days.at(-1).day} UTC`,
    headline: paidDays ? `${counts.paid} / ${paidDays} payment days` : 'No reported payment days',
    description: paidDays ? 'Had no reward offers recorded on the same UTC date' : 'No denominator for a paid-only share',
    detail: Object.entries(cadenceLabels).map(([key, label]) => `${label} ${counts[key]}`).join('  ·  '),
    segments: days.map(({state}) => [state, 1 / days.length]),
    gap: 6,
  };
}

export function preview(snapshot, url, view) {
  const story = signalStory(snapshot, url.searchParams);
  const image = new URL(story ? '/share-signal.png' : view?.[2] === '/share-signal.png' ? '/share.png' : view?.[2] ?? '/share.png', url);
  if (story) {
    const {view, net, week} = signalParams(url.searchParams.get('view'), url.searchParams);
    image.search = new URLSearchParams({view, net, rev: snapshot.asOf});
    if (week) image.searchParams.set('week', week);
  }
  return {image: image.href, description: story ? `${story.headline}. ${story.description}. ${story.scope}.` : view?.[1]};
}

const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function cardSvg(story, asOf) {
  let x = 80;
  const chart = story.segments.map(([key, part]) => {
    const width = part * 1040;
    const segment = width > 0 ? `<rect x="${x}" y="390" width="${Math.max(1, width - (story.gap ?? 0))}" height="28" fill="${colors[key]}"/>` : '';
    x += width;
    return segment;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="#12100e"/>
    <rect x="36" y="36" width="1128" height="558" rx="16" fill="#221e1a" stroke="#774054" stroke-width="2"/>
    <rect x="36" y="36" width="1128" height="105" rx="16" fill="#3a1420"/>
    <g font-family="Inter Tight" fill="#d9a097" font-size="29">
      <text x="80" y="100">TASKMARKET PULSE / ${escape(story.title.toUpperCase())}</text>
      <text x="80" y="192">${escape(story.scope)}</text>
      <text x="80" y="351" fill="#fff6e8" font-size="35">${escape(story.description)}</text>
      <text x="80" y="464" fill="#fff6e8" font-size="25">${escape(story.detail)}</text>
      <text x="80" y="555" fill="#b0a79d">BuyerContour · Data as of ${asOf.slice(0, 16).replace('T', ' ')} UTC</text>
    </g>
    <text x="76" y="297" fill="#fff6e8" font-family="Instrument Serif" font-size="83">${escape(story.headline)}</text>
    <rect x="80" y="390" width="1040" height="28" fill="#332c27"/>
    ${chart}
    <path d="M80 502H1120" stroke="#774054"/>
  </svg>`;
}

export function renderCard(story, asOf, fontBuffers) {
  const renderer = new Resvg(cardSvg(story, asOf), {font: {fontBuffers, loadSystemFonts: false}});
  try {
    const image = renderer.render();
    try { return image.asPng().slice(); } finally { image.free(); }
  } finally {
    renderer.free();
  }
}
