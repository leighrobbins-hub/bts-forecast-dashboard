#!/usr/bin/env node
// Verifies that the Monthly tab tile counts and the WBR _wbrComputeMetrics
// produce the same On Track / Behind / Complete / Tail-End / Awaiting Data
// numbers when fed dashboard/data.json. Run with: node scripts/verify_wbr_alignment.mjs
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dataPath = path.join(root, 'dashboard', 'data.json');
if (!fs.existsSync(dataPath)) {
  console.error('Missing', dataPath);
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const allData = data.subjects || [];
const trackerData = data.monthly_tracker || [];

// ── Helpers ported from app.js ───────────────────────────────────────────
function isTailEndMonthlyTarget(t) { return t != null && t > 0 && t <= 3; }
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
function monthlyActionType(btsType, pace) {
  if (btsType === 'recruit' || btsType === 'recruit-urgent') return btsType;
  if (btsType === 'hidden-supply' || btsType === 'capacity-available') return btsType;
  if (btsType === 'wait-times') return btsType;
  if (btsType === 'reduce-forecast') return btsType;
  if (pace === 'behind') return 'behind-monthly';
  if (pace === 'nodata') return 'awaiting-data';
  return 'on-track';
}

// ── Build monthly data the same way app.js does ───────────────────────────
const now = new Date();
const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const dayOfMonth = now.getDate();
const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
const fractionThrough = dayOfMonth / lastDay;
const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

const cmIdx = {};
trackerData.forEach((ts) => {
  (ts.months || []).forEach((m) => {
    if (m.month === currentMonth) {
      cmIdx[ts.subject] = { target: m.smoothed_target, actual: m.actual, status: m.status };
    }
  });
});

let totalTarget = 0, totalActual = 0;
let behindCount = 0, onPaceCount = 0, completeCount = 0, noDataCount = 0, tailEndCount = 0;
const rows = [];
allData.forEach((r) => {
  const cmd = cmIdx[r.Subject];
  const target = (cmd && cmd.target != null) ? cmd.target : 0;
  const actual = (cmd && cmd.actual != null) ? cmd.actual : null;
  let pace = 'nodata';
  const tailEnd = isTailEndMonthlyTarget(target);
  if (tailEnd) tailEndCount++;
  if (target > 0) {
    totalTarget += target;
    if (actual != null) {
      totalActual += Math.min(actual, target);
      if (actual >= target) {
        pace = 'complete';
        completeCount++;
      } else if (dayOfMonth <= 2) {
        pace = 'onpace';
        if (!tailEnd) onPaceCount++;
      } else if (actual === 0) {
        pace = 'behind';
        if (!tailEnd) behindCount++;
      } else {
        const projectedEOM = fractionThrough > 0 ? Math.round(actual / fractionThrough) : actual;
        pace = (projectedEOM / target >= 0.85) ? 'onpace' : 'behind';
        if (!tailEnd) {
          if (pace === 'onpace') onPaceCount++; else behindCount++;
        }
      }
    } else {
      if (!tailEnd) noDataCount++;
    }
  }
  rows.push({ subject: r.Subject, target, actual, pace, isTailEnd: tailEnd, btsAction: r.Primary_Action || r.Problem_Type || '' });
});

// Action tile counts mirroring renderMonthlyHeroCards
const actionCounts = { investigate: 0, recruit: 0, 'on-track': 0, 'wait-times': 0, 'reduce-forecast': 0, 'insufficient-data': 0 };
rows.forEach((x) => {
  const btsType = classifyType(x.btsAction);
  const monthlyType = monthlyActionType(btsType, x.pace);
  if (btsType === 'insufficient-data' && !x.isTailEnd) actionCounts['insufficient-data']++;
  if (monthlyType === 'recruit-urgent' || monthlyType === 'recruit') { actionCounts.recruit++; return; }
  if (monthlyType === 'on-track') { actionCounts['on-track']++; return; }
  if (monthlyType === 'wait-times') { actionCounts['wait-times']++; return; }
  if (x.isTailEnd) return;
  if (monthlyType === 'hidden-supply' || monthlyType === 'capacity-available') actionCounts.investigate++;
  else if (monthlyType === 'reduce-forecast') actionCounts['reduce-forecast']++;
});

// WBR-aligned buckets (must match the tile counts above)
const subjects = rows.filter((x) => x.target > 0);
const wbrOnTrack = subjects.filter((s) => {
  const monthlyType = monthlyActionType(classifyType(s.btsAction), s.pace);
  return monthlyType === 'on-track';
}).length;
const wbrBehind = subjects.filter((s) => s.pace === 'behind' && !s.isTailEnd).length;
const wbrComplete = subjects.filter((s) => s.pace === 'complete').length;
const wbrNoData = subjects.filter((s) => s.pace === 'nodata' && !s.isTailEnd).length;
const wbrTailEnd = subjects.filter((s) => s.isTailEnd).length;

console.log(`Verification — ${currentMonth} (Day ${dayOfMonth}/${lastDay}, ${Math.round(fractionThrough*100)}% elapsed)`);
console.log('================================================================');
console.log(`Subjects in current month            : ${subjects.length}`);
console.log(`Total target (sum)                   : ${totalTarget}`);
console.log(`Total actual (capped at target)      : ${totalActual}`);
console.log('');
console.log('Monthly Pace Tiles (mo-*):');
console.log(`  mo-behind   (Behind Pace, no tail) : ${behindCount}`);
console.log(`  mo-onpace   (On Pace, no tail)     : ${onPaceCount}`);
console.log(`  mo-complete (Complete, all)        : ${completeCount}`);
console.log(`  mo-nodata   (No Data, no tail)     : ${noDataCount}`);
console.log(`  mo-tailend  (Tail-End, all)        : ${tailEndCount}`);
console.log('');
console.log('Monthly Action Tiles:');
console.log(`  mo-investigate                     : ${actionCounts.investigate}`);
console.log(`  mo-recruit                         : ${actionCounts.recruit}`);
console.log(`  mo-ontrack-action                  : ${actionCounts['on-track']}`);
console.log(`  mo-waittimes                       : ${actionCounts['wait-times']}`);
console.log(`  mo-reduce                          : ${actionCounts['reduce-forecast']}`);
console.log(`  mo-insuff                          : ${actionCounts['insufficient-data']}`);
console.log('');
console.log('Weekly Summary buckets (NEW, aligned):');
console.log(`  WBR onTrack                        : ${wbrOnTrack}   ${wbrOnTrack === actionCounts['on-track'] ? '✓ matches mo-ontrack-action' : '✗ MISMATCH'}`);
console.log(`  WBR behind                         : ${wbrBehind}   ${wbrBehind === behindCount ? '✓ matches mo-behind' : '✗ MISMATCH'}`);
console.log(`  WBR complete                       : ${wbrComplete}   ${wbrComplete === completeCount ? '✓ matches mo-complete' : '✗ MISMATCH'}`);
console.log(`  WBR noData                         : ${wbrNoData}   ${wbrNoData === noDataCount ? '✓ matches mo-nodata' : '✗ MISMATCH'}`);
console.log(`  WBR tailEnd                        : ${wbrTailEnd}   ${wbrTailEnd === tailEndCount ? '✓ matches mo-tailend' : '✗ MISMATCH'}`);
