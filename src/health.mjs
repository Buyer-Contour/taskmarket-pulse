export function snapshotHealth(asOf, failed = false, now = Date.now()) {
  const ageSeconds = asOf ? Math.max(0, Math.floor((now - Date.parse(asOf)) / 1000)) : null;
  return {
    status: ageSeconds === null ? 'warming' : ageSeconds >= 3600 ? 'stale' : failed ? 'last-good' : 'fresh',
    asOf: asOf ?? null,
    ageSeconds,
  };
}
