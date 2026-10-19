// Pure standings logic, shared by the page (inlined) and a quick node check.
function seasonForDate(seasons, date) {
  return seasons.find(s => s.start <= date && date <= s.end) || null;
}

function computeStandings(season, rounds, metric) {
  const y = Math.max(1, Number(season.bestOf) || 1);
  const inSeason = rounds.filter(r => r.date >= season.start && r.date <= season.end);
  const byPlayer = new Map();
  for (const r of inSeason) {
    for (const s of r.scores || []) {
      const name = String(s.player || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!byPlayer.has(key)) byPlayer.set(key, { name, entries: [] });
      byPlayer.get(key).entries.push({
        roundId: r.id, date: r.date,
        points: num(s.points), gross: num(s.gross),
      });
    }
  }
  const rows = [];
  for (const p of byPlayer.values()) {
    p.entries.sort((a, b) => a.date.localeCompare(b.date));
    const usable = p.entries.filter(e => e[metric] != null);
    // Stableford: higher is better. Gross: lower is better.
    const ranked = [...usable].sort((a, b) => metric === 'points' ? b.points - a.points : a.gross - b.gross);
    const counting = ranked.slice(0, y);
    const countingIds = new Set(counting.map(e => e.roundId));
    const total = counting.reduce((t, e) => t + e[metric], 0);
    rows.push({
      name: p.name,
      played: p.entries.length,
      entries: p.entries.map(e => ({ ...e, counts: countingIds.has(e.roundId) })),
      counting: counting.map(e => e[metric]),
      total,
      avg: counting.length ? total / counting.length : null,
      best: ranked.length ? ranked[0][metric] : null,
      complete: counting.length >= y,
    });
  }
  if (metric === 'points') {
    // Total of best y, then countback on best rounds.
    rows.sort((a, b) => b.total - a.total || countback(b.counting, a.counting) || a.name.localeCompare(b.name));
  } else {
    // Gross: full sets first, then lowest average of counting rounds.
    rows.sort((a, b) => (b.complete - a.complete) || ((a.avg ?? 1e9) - (b.avg ?? 1e9)) || countback(a.counting, b.counting) || a.name.localeCompare(b.name));
  }
  let rank = 0, prev = null;
  rows.forEach((r, i) => {
    const key = metric === 'points' ? r.total + '|' + r.counting.join(',') : r.complete + '|' + r.avg + '|' + r.counting.join(',');
    if (key !== prev) rank = i + 1;
    r.rank = rank; prev = key;
  });
  return { rows, roundCount: inSeason.length, y };
}

function countback(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? -1e9) - (b[i] ?? -1e9);
    if (d) return d;
  }
  return 0;
}

function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

if (typeof module !== 'undefined') module.exports = { computeStandings, seasonForDate };
