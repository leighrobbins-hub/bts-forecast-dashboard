#!/usr/bin/env node
// Runs the classifyTroubleTier logic against real data.json and prints a
// breakdown of Critical / High / Medium / Cap-Available subjects among the
// current behind-pace set. Used to eyeball the classifier against live
// Looker metrics before merging Phase A.
// Run with: node scripts/verify_trouble_tiers.mjs
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dataPath = path.join(root, 'dashboard', 'data.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const subjects = data.subjects || [];
const tracker = data.monthly_tracker || [];

function classifyType(pt) {
  if (!pt) return 'on-track';
  pt = pt.toLowerCase();
  if (pt.includes('recruit more') && pt.includes('urgent')) return 'recruit-urgent';
  if (pt.includes('recruit more')) return 'recruit';
  if (pt.includes('hidden supply')) return 'hidden-supply';
  if (pt.includes('capacity available')) return 'capacity-available';
  if (pt.includes('wait times') || pt.includes('high wait time')) return 'wait-times';
  if (pt === 'reduce forecast') return 'reduce-forecast';
  if (pt === 'insufficient data') return 'insufficient-data';
  if (pt.includes('under-used') || pt.includes('under used')) return 'hidden-supply';
  if (pt.includes('placement suspect') || pt.includes('placement bottleneck') || pt.includes('possible placement')) return 'hidden-supply';
  if (pt.includes('over-supplied') || pt.includes('low util')) return 'reduce-forecast';
  if (pt.includes('true supply')) return 'recruit';
  if (pt.includes('no util data')) return 'insufficient-data';
  if (pt.includes('high wait')) return 'wait-times';
  if (pt === 'on track') return 'on-track';
  return 'on-track';
}

function classifyTroubleTier(row) {
  const result = { tier: 'medium', reasons: [] };
  if (!row) return result;
  const btsType = classifyType(row.Primary_Action || row.Problem_Type);
  const flags = Array.isArray(row.Stress_Flags) ? row.Stress_Flags : [];
  const hasFlag = (f) => flags.includes(f);

  const p90 = (typeof row.P90_NAT_Hours === 'number' && isFinite(row.P90_NAT_Hours)) ? row.P90_NAT_Hours : null;
  const p90Goal = (typeof row.P90_Goal === 'number' && isFinite(row.P90_Goal) && row.P90_Goal > 0) ? row.P90_Goal : null;
  const thu = (typeof row.Tutor_Hours_Util_Pct === 'number' && isFinite(row.Tutor_Hours_Util_Pct)) ? row.Tutor_Hours_Util_Pct : null;

  const p90Str = (p90 != null && p90Goal != null) ? `P90 ${Math.round(p90 * 10) / 10}h vs ${p90Goal}h goal` : null;
  const thuStr = (thu != null) ? `THU ${Math.round(thu)}%` : null;

  if (btsType === 'recruit-urgent') result.reasons.push('recruit-urgent action');
  if (hasFlag('critical_wait')) result.reasons.push('critical_wait flag');
  if (hasFlag('paper_supply')) result.reasons.push('paper_supply flag');
  const p90x15Maxed = (p90 != null && p90Goal != null && thu != null && p90 > 1.5 * p90Goal && thu >= 90);
  if (p90x15Maxed) result.reasons.push(`${p90Str} · ${thuStr} (pool maxed, students waiting)`);
  if (btsType === 'recruit-urgent' || hasFlag('critical_wait') || hasFlag('paper_supply') || p90x15Maxed) {
    result.tier = 'critical'; return result;
  }

  if (btsType === 'recruit') result.reasons.push('recruit action');
  if (btsType === 'wait-times') result.reasons.push('wait-times action');
  if (hasFlag('high_wait')) result.reasons.push('high_wait flag');
  if (hasFlag('burnout_risk')) result.reasons.push('burnout_risk flag');
  const thuOverGoal = (p90 != null && p90Goal != null && thu != null && thu >= 80 && p90 > p90Goal);
  if (thuOverGoal) result.reasons.push(`${thuStr} · ${p90Str}`);
  if (btsType === 'recruit' || btsType === 'wait-times' || hasFlag('high_wait') || hasFlag('burnout_risk') || thuOverGoal) {
    result.tier = 'high'; return result;
  }

  const urgentFlags = hasFlag('high_wait') || hasFlag('critical_wait') || hasFlag('burnout_risk');
  if (btsType === 'reduce-forecast') result.reasons.push('reduce-forecast action');
  if (btsType === 'capacity-available') result.reasons.push('capacity-available action');
  const lowThuNoStress = (thu != null && thu < 60 && !urgentFlags);
  if (lowThuNoStress) result.reasons.push(`${thuStr} (pool has headroom)`);
  if (btsType === 'reduce-forecast' || btsType === 'capacity-available' || lowThuNoStress) {
    result.tier = 'cap_avail';
    if (!result.reasons.length && thuStr) result.reasons.push(thuStr);
    return result;
  }

  if (!result.reasons.length) {
    if (thuStr) result.reasons.push(thuStr);
    if (p90Str) result.reasons.push(p90Str);
    if (!result.reasons.length && btsType && btsType !== 'on-track') result.reasons.push(`${btsType} action`);
  }
  return result;
}

// Figure out current month by finding the row whose Actual is null latest
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const now = new Date();
const monthLabel = MONTHS[now.getMonth()];
const dayOfMonth = now.getDate();
const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
const monthFraction = dayOfMonth / daysInMonth;

// Pull current (in_progress) month per subject from the nested months array
const behindCandidates = [];
tracker.forEach((t) => {
  const currentMonth = (t.months || []).find((m) => m.status === 'in_progress');
  if (!currentMonth) return;
  const target = currentMonth.adjusted_target != null ? currentMonth.adjusted_target : currentMonth.smoothed_target;
  if (!(target > 0)) return;
  if (target <= 3) return; // tail-end excluded
  const actual = currentMonth.actual != null ? currentMonth.actual : 0;
  const paceTarget = target * monthFraction;
  const remaining = Math.max(0, Math.round(target - actual));
  if (currentMonth.actual != null && actual < paceTarget) {
    const row = subjects.find((s) => s.Subject === t.subject);
    behindCandidates.push({
      subject: t.subject,
      target,
      actual,
      remaining,
      pacePct: Math.round(actual / paceTarget * 100),
      row
    });
  }
});

console.log(`Month: ${monthLabel} · day ${dayOfMonth}/${daysInMonth} (${Math.round(monthFraction * 100)}%)`);
console.log(`Behind candidates (quick approximation): ${behindCandidates.length}`);
console.log('');

const buckets = { critical: [], high: [], medium: [], cap_avail: [] };
behindCandidates.forEach((b) => {
  const tt = classifyTroubleTier(b.row);
  buckets[tt.tier].push({ ...b, tier: tt.tier, reasons: tt.reasons });
});

Object.entries(buckets).forEach(([tier, list]) => {
  console.log(`── ${tier.toUpperCase()} (${list.length}) ──`);
  list.sort((a, b) => b.remaining - a.remaining).slice(0, 10).forEach((x) => {
    console.log(`  ${x.subject.padEnd(45)} ${String(x.pacePct).padStart(3)}%  gap ${String(x.remaining).padStart(3)}  ${x.reasons.join(' | ')}`);
  });
  if (list.length > 10) console.log(`  ... (${list.length - 10} more)`);
  console.log('');
});
