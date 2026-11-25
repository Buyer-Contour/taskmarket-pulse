const DAY = 86_400_000;
export const signalNames = {
  handoff: 'Demand handoff',
  cadence: 'Reward cadence',
};

export const cadenceLabels = {
  both: 'Offered and paid', offered: 'Offered only', paid: 'Paid only', quiet: 'Neither', missing: 'No report',
};

export function handoff(snapshot, net, week) {
  const weeks = snapshot.networks[net].handoffs ?? [];
  const row = weeks.find(row => row.week === week) ?? weeks.findLast(row => !row.partial);
  return row && {...row, unknown: row.tasks - row.returningTasks - row.absentLastWeekTasks};
}

export function cadence(snapshot, net) {
  const {shared, byNetwork} = snapshot.series;
  const rows = new Map((shared ?? byNetwork[net]).map(row => [row.day, row]));
  const midnight = Math.floor(Date.parse(snapshot.asOf) / DAY) * DAY;
  const days = Array.from({length: 14}, (_, i) => {
    const day = new Date(midnight - (14 - i) * DAY).toISOString().slice(0, 10);
    const row = rows.get(day);
    if (!row) return {day, state: 'missing'};
    const offered = BigInt(row.offered) > 0n, paid = BigInt(row.paid) > 0n;
    return {day, state: offered && paid ? 'both' : offered ? 'offered' : paid ? 'paid' : 'quiet'};
  });
  const counts = Object.fromEntries(Object.keys(cadenceLabels).map(key => [key, days.filter(row => row.state === key).length]));
  return {days, counts, shared: Boolean(shared), paidDays: counts.paid + counts.both};
}

export function signalParams(view, params) {
  const net = params.get('net') === 'base' ? 'base' : 'tempo';
  const week = params.get('week');
  return {view, net, week: view === 'handoff' && /^\d{4}-\d{2}-\d{2}$/.test(week ?? '') ? week : null};
}
