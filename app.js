function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function debounce(fn, delay) {
    var timer;
    return function() {
        var ctx = this, args = arguments;
        clearTimeout(timer);
        timer = setTimeout(function() { fn.apply(ctx, args); }, delay);
    };
}

var allData = [];
var trackerData = [];
var historyData = [];
var uploadsData = [];
var summaryData = {};
var recommendationsData = [];
var recsBySubject = {};
var weeklySummaryData = {};
var btsMonths = [];        // e.g. ['2026-04', '2026-05', ...]
var btsMonthLabels = [];   // e.g. ['Apr', 'May', ...]
var fetchStatus = {};      // pipeline run metadata from data.fetch_status
var pendingActualsCSV = null;
var pendingForecastFile = null;
var pendingRunRatesFile = null;
var pendingUtilizationFile = null;
var pendingAdjustmentsCSV = null;
var lastAdjustmentsRawText = null;
var REPO_OWNER = 'leighrobbins-hub';
var REPO_NAME = 'bts-forecast-dashboard';

var currentSorts = {
    priority: { col: 5, asc: false }
};
var trackerSort = { key: 'subject', asc: true };

var PROBLEM_TIPS = {
    'placement': 'Anomaly: low subject-level utilization (<50%) coincident with a demand gap. Investigation needed — could be a placement or algorithm issue, low real demand, multi-subject tutors utilized on other subjects, or scheduling mismatch.',
    'over-supplied': 'Run rate meets or exceeds target but tutors under 50% utilized. Consider reducing forecast — demand may be overestimated.',
    'true-supply': 'Tutors well-utilized (>50%) and target exceeds run rate. Supply is genuinely short — deploy recruiting levers.',
    'no-util-data': 'Target exceeds run rate but no utilization data available. Gather data to determine root cause.',
    'on-track': 'Supply meets demand and utilization is healthy. No action needed.',
    'on-track-highwait': 'Supply meets demand on paper, but P90 wait time exceeds 24h — students are waiting too long. Investigate matching/placement delays.'
};

// Volume tier metadata. Badge class maps to styles.css rules.
var TIER_META = {
    'CORE':   { label: 'Core',   badge: 'tier-core'   },
    'HIGH':   { label: 'High',   badge: 'tier-high'   },
    'MEDIUM': { label: 'Medium', badge: 'tier-medium' },
    'LOW':    { label: 'Low',    badge: 'tier-low'    },
    'NICHE':  { label: 'Niche',  badge: 'tier-niche'  }
};
var TIER_ORDER = { 'CORE': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3, 'NICHE': 4 };

function renderTierBadge(tier, btsTotal) {
    if (!tier) return '';
    var meta = TIER_META[tier];
    if (!meta) return '';
    var tip;
    switch (tier) {
        case 'CORE':   tip = 'CORE — 150+ tutors forecasted for BTS.\nLargest business impact if we miss.'; break;
        case 'HIGH':   tip = 'HIGH — 75 to 149 tutors forecasted for BTS.'; break;
        case 'MEDIUM': tip = 'MEDIUM — 30 to 74 tutors forecasted for BTS.'; break;
        case 'LOW':    tip = 'LOW — 10 to 29 tutors forecasted for BTS.'; break;
        case 'NICHE':  tip = 'NICHE — fewer than 10 tutors forecasted for BTS.\nSmall-volume long-tail subject.'; break;
        default:       tip = 'Volume tier based on total BTS forecast.';
    }
    if (btsTotal != null) tip += '\nThis subject: ' + btsTotal + ' total.';
    return '<span class="badge ' + meta.badge + '" data-tip="' + escapeHtml(tip) + '">' + meta.label + '</span>';
}

function classifyType(problemType) {
    if (!problemType) return 'on-track';
    var pt = problemType.toLowerCase();
    if (pt.includes('under-used') || pt.includes('under used')) return 'placement';
    if (pt.includes('placement suspect')) return 'placement';      // back-compat
    if (pt.includes('placement bottleneck')) return 'placement';   // back-compat
    if (pt.includes('possible placement')) return 'placement';     // back-compat
    if (pt.includes('over-supplied')) return 'over-supplied';
    if (pt.includes('true supply')) return 'true-supply';
    if (pt.includes('no util data')) return 'no-util-data';
    if (pt.includes('low util')) return 'over-supplied';
    if (pt.includes('high wait')) return 'on-track-highwait';
    return 'on-track';
}

function buildUtilDisplay(row) {
    if (row.Util_Rate === null || row.Util_Rate === undefined) return 'N/A';
    var html = Math.round(row.Util_Rate) + '%';
    if (row.Util_Trend && row.Util_Trend_Delta != null) {
        var arrow = row.Util_Trend === 'up' ? '↑' : row.Util_Trend === 'down' ? '↓' : '→';
        var delta = row.Util_Trend_Delta > 0 ? '+' + row.Util_Trend_Delta : '' + row.Util_Trend_Delta;
        var p90 = row.P90_NAT_Hours;
        var highP90 = p90 != null && p90 >= 24;
        var color, tip;
        if (row.Util_Trend === 'up') {
            if (highP90) {
                color = '#e74c3c';
                tip = delta + '% vs trailing — High P90 (' + Math.round(p90) + 'h): demand stress, tutors used immediately but students still waiting';
            } else {
                color = '#27ae60';
                tip = delta + '% vs trailing — Healthy: demand being met efficiently';
            }
        } else if (row.Util_Trend === 'down') {
            if (highP90) {
                color = '#e67e22';
                tip = delta + '% vs trailing — High P90 (' + Math.round(p90) + 'h): students waiting but new tutors not being matched';
            } else {
                color = '#27ae60';
                tip = delta + '% vs trailing — Demand easing, less pressure on supply';
            }
        } else {
            color = '#7f8c8d';
            tip = delta + '% vs trailing — Stable';
        }
        html += ' <span style="color:' + color + ';font-weight:600" title="' + tip + '">' + arrow + '</span>';
    }
    if (row.Util_Recent_Contracted != null && row.Util_Recent_Utilized != null) {
        html += '<div style="font-size:11px;color:#7f8c8d">(' + Math.round(row.Util_Recent_Utilized) + ' of ' + Math.round(row.Util_Recent_Contracted) + ' recent)</div>';
    } else if (row.Total_Contracted != null && row.Utilized_30d != null) {
        html += '<div style="font-size:11px;color:#7f8c8d">(' + Math.round(row.Utilized_30d) + ' of ' + Math.round(row.Total_Contracted) + ')</div>';
    }
    return html;
}

/* ── Load saved PAT ── */
(function() {
    var saved = sessionStorage.getItem('bts_github_pat');
    if (saved) {
        var el = document.getElementById('github-pat');
        if (el) el.value = saved;
    }
})();

/* ── Data loading ── */
fetch('data.json?v=' + Date.now())
    .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
    })
    .then(function(data) {
        allData = data.subjects || [];
        trackerData = data.monthly_tracker || [];
        historyData = data.history || [];
        uploadsData = data.uploads || [];
        summaryData = data.summary || {};
        recommendationsData = data.recommendations || [];
        recsBySubject = {};
        recommendationsData.forEach(function(r) {
            if (!recsBySubject[r.subject]) recsBySubject[r.subject] = [];
            recsBySubject[r.subject].push(r);
        });
        weeklySummaryData = data.weekly_summary || {};
        btsMonths = data.bts_months || [];
        btsMonthLabels = data.bts_month_labels || [];
        fetchStatus = data.fetch_status || {};
        updateSummary(summaryData);
        updateTabCounts();
        populateCategoryDropdowns();
        renderCriticalFindings();
        renderOverviewPulse();
        renderMonthSnapshot();
        renderAllTables();
        renderMonthlyTracker();
        renderMarchBaseline(summaryData);
        renderProgressBar(summaryData);
        renderHistoryTab();
        renderSubjectsAndActions();
        renderDecisionHistory();
        lockFinalizedMonths();
        showFetchStatusBanner(data.fetch_status);
        populateLookerSyncBanner(data.fetch_status);
        initTrackerKey();
        loadSharedDecisions();
        document.getElementById('loading-overlay').style.display = 'none';
        document.getElementById('main-tabs').style.display = '';
        document.getElementById('main-content').style.display = '';
    })
    .catch(function(e) {
        console.error('Error loading data:', e);
        document.getElementById('loading-overlay').style.display = 'none';
        document.getElementById('load-error').style.display = 'block';
        document.getElementById('load-error-detail').textContent =
            'Error: ' + e.message + '. Please try refreshing the page.';
    });

function showFetchStatusBanner(fetchStatus) {
    if (!fetchStatus) return;
    if (fetchStatus.skipped) return;
    if (!fetchStatus.any_failed) return;
    var failed = Object.entries(fetchStatus.sources || {})
        .filter(function(kv) { return !kv[1]; })
        .map(function(kv) { return kv[0].replace(/_/g, ' '); });
    if (!failed.length) return;
    var banner = document.getElementById('looker-fetch-warning');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'looker-fetch-warning';
        banner.className = 'fetch-warning-banner';
        var firstTab = document.getElementById('main-content');
        if (firstTab) firstTab.insertBefore(banner, firstTab.firstChild);
    }
    var when = fetchStatus.fetched_at
        ? new Date(fetchStatus.fetched_at).toLocaleString()
        : 'unknown time';
    var lastGood = fetchStatus.last_successful_fetch
        ? ' Last successful pull: ' + new Date(fetchStatus.last_successful_fetch).toLocaleString() + '.'
        : '';
    banner.innerHTML = '&#9888; <strong>Looker pull failed</strong> at ' + escapeHtml(when) + ' for: ' + escapeHtml(failed.join(', ')) + '. Using most recent cached data.' + lastGood + ' <span style="color:#7f8c8d">(Looker refreshes daily.)</span>';
}

function populateLookerSyncBanner(fetchStatus) {
    var detail = document.getElementById('looker-sync-detail');
    if (!detail) return;
    var base = 'Actuals, run rates, and utilization are automatically synced from Looker daily.';
    if (!fetchStatus) {
        detail.textContent = base;
        return;
    }
    var parts = [base];
    if (fetchStatus.last_successful_fetch) {
        var d = new Date(fetchStatus.last_successful_fetch);
        parts.push('Last successful sync: ' + d.toLocaleString() + '.');
    } else if (fetchStatus.fetched_at) {
        var d2 = new Date(fetchStatus.fetched_at);
        parts.push('Last checked: ' + d2.toLocaleString() + '.');
    }
    var sources = fetchStatus.sources || {};
    var ok = Object.entries(sources).filter(function(kv) { return kv[1]; }).map(function(kv) { return kv[0].replace(/_/g, ' '); });
    var fail = Object.entries(sources).filter(function(kv) { return !kv[1]; }).map(function(kv) { return kv[0].replace(/_/g, ' '); });
    if (fail.length) {
        parts.push('Failed: ' + fail.join(', ') + '.');
    }
    detail.textContent = parts.join(' ');
}

function lockFinalizedMonths() {
    if (!trackerData.length) return;
    var finalMonths = {};
    trackerData[0].months.forEach(function(m) {
        if (m.status === 'final') finalMonths[m.month] = m.label;
    });
    var select = document.getElementById('actuals-month');
    var locked = [];
    for (var i = select.options.length - 1; i >= 0; i--) {
        var val = select.options[i].value;
        if (finalMonths[val]) {
            select.remove(i);
            locked.push(finalMonths[val]);
        }
    }
    if (locked.length > 0) {
        var lockDiv = document.getElementById('locked-months-display');
        lockDiv.style.display = 'flex';
        document.getElementById('locked-months-list').innerHTML = '&#128274; Locked: ' + escapeHtml(locked.join(', '));
    }
    var monthLabels = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];
    var trackerHeaders = document.querySelectorAll('#tracker-table thead th');
    trackerHeaders.forEach(function(th) {
        var txt = th.textContent.trim();
        var idx = monthLabels.indexOf(txt);
        if (idx !== -1) {
            var mk = '2026-' + String(idx + 4).padStart(2, '0');
            if (finalMonths[mk]) {
                th.innerHTML = txt + ' &#128274;';
                th.style.background = '#2c3e50';
            }
        }
    });
}

/* ── Summary + tab counts ── */
var _lastSummary = null; // cache so refreshOverviewLive() can reuse it

function updateSummary(summary) {
    _lastSummary = summary;
    refreshOverviewLive();

    // One-time updates (don't depend on live decisions)
    document.getElementById('footer-time').textContent = 'Last updated: ' + summary.last_updated;
    document.getElementById('method-updated').textContent = summary.last_updated;

    // Data quality badge: show util coverage from summary if available
    var qualityEl = document.getElementById('util-coverage-badge');
    if (qualityEl && summary.util_coverage_pct != null) {
        var pct = summary.util_coverage_pct;
        var withUtil = summary.subjects_with_util_data || 0;
        var total = summary.total_subjects || 0;
        qualityEl.textContent = pct + '% (' + withUtil + '/' + total + ' subjects have util data)';
        qualityEl.className = 'util-coverage-badge ' + (pct >= 80 ? 'good' : pct >= 50 ? 'warn' : 'bad');
    }
}

// Live-refreshed counts — called on initial load AND every time a decision
// is saved or revoked. Updates the Overview stat cards + the Priority Table
// so the dashboard reflects current state of Leigh's review workflow.
function refreshOverviewLive() {
    if (!allData || !allData.length) return;

    var clientTotal = allData.length;
    var clientPlacement = allData.filter(function(r) { return classifyType(r.Problem_Type) === 'placement'; }).length;
    var clientSupply = allData.filter(function(r) { return classifyType(r.Problem_Type) === 'true-supply'; }).length;
    var clientNoUtil = allData.filter(function(r) { return classifyType(r.Problem_Type) === 'no-util-data'; }).length;
    var clientOnTrack = allData.filter(function(r) { var t = classifyType(r.Problem_Type); return t === 'on-track'; }).length;
    var clientHighWait = allData.filter(function(r) { return classifyType(r.Problem_Type) === 'on-track-highwait'; }).length;
    var overSuppliedCount = allData.filter(function(r) { return classifyType(r.Problem_Type) === 'over-supplied'; }).length;

    // Pending counts: for each flagged-problem subject, check if it has any
    // recommendation without a decision yet. Subjects with 0 open decisions
    // have been "worked through" — they still exist in the count but pending
    // drops to 0.
    function pendingFor(predicate) {
        var count = 0;
        allData.forEach(function(r) {
            if (!predicate(classifyType(r.Problem_Type))) return;
            var recs = recsBySubject[r.Subject];
            if (!recs || recs.length === 0) return;
            var anyPending = recs.some(function(rec) { return !getDecision(rec); });
            if (anyPending) count++;
        });
        return count;
    }
    var placementPending = pendingFor(function(t) { return t === 'placement'; });
    var supplyPending = pendingFor(function(t) { return t === 'true-supply' || t === 'no-util-data'; });
    var overSuppliedPending = pendingFor(function(t) { return t === 'over-supplied'; });

    document.getElementById('total-subjects').textContent = clientTotal;
    document.getElementById('util-problems').textContent = clientPlacement;
    document.getElementById('stat-supply-problems').textContent = clientSupply + clientNoUtil;
    document.getElementById('ontrack-subjects').textContent = clientOnTrack;
    var hwEl = document.getElementById('highwait-subjects');
    if (hwEl) hwEl.textContent = clientHighWait;
    document.getElementById('lowutil-subjects').textContent = overSuppliedCount;
    var callout = document.getElementById('lowutil-count-callout');
    if (callout) callout.textContent = overSuppliedCount;

    // Update pending sub-text (elements added to index.html; use if-exists guard)
    function setPending(elId, n) {
        var el = document.getElementById(elId);
        if (!el) return;
        el.textContent = n === 0 ? 'All reviewed \u2714' : n + ' pending review';
        el.className = 'stat-pending' + (n === 0 ? ' all-done' : '');
    }
    setPending('pending-underused', placementPending);
    setPending('pending-supply', supplyPending);
    setPending('pending-oversupplied', overSuppliedPending);

    // Reconciliation check (dev-console only)
    if (_lastSummary) {
        var discrepancies = [];
        if (clientTotal !== (_lastSummary.total_subjects || 0)) discrepancies.push('Total: card=' + clientTotal + ' vs data=' + _lastSummary.total_subjects);
        if (clientPlacement !== (_lastSummary.under_used || 0)) discrepancies.push('Under-Used: card=' + clientPlacement + ' vs data=' + _lastSummary.under_used);
        var serverSupply = (_lastSummary.supply_problems || 0);
        if ((clientSupply + clientNoUtil) !== serverSupply) discrepancies.push('Supply Problems: card=' + (clientSupply + clientNoUtil) + ' vs data=' + serverSupply);
        if (discrepancies.length > 0) console.warn('Reconciliation differences (expected from reclassification):', discrepancies);
    }

    var topOverSupplied = allData
        .filter(function(r) { return classifyType(r.Problem_Type) === 'over-supplied'; })
        .sort(function(a, b) { return (b.Run_Rate || 0) - (a.Run_Rate || 0); })
        .slice(0, 5)
        .map(function(r) { return r.Subject + ' (' + (r.Util_Rate || 0) + '% util, run rate ' + r.Run_Rate + '/mo)'; });
    var lowutilExamplesEl = document.getElementById('lowutil-examples');
    if (lowutilExamplesEl) lowutilExamplesEl.textContent = topOverSupplied.join('; ');

    // Priority table + Critical Findings refresh too so the Overview tab
    // reflects decision state everywhere
    if (typeof renderPriorityTable === 'function') {
        try { renderPriorityTable(); } catch (e) {}
    }
    if (typeof renderCriticalFindings === 'function') {
        try { renderCriticalFindings(); } catch (e) {}
    }
}

function updateTabCounts() {
    // Subjects & Actions tab shows total subject count
    var saCount = document.getElementById('tab-count-sa');
    if (saCount) saCount.textContent = allData.length;
    // Decision History count is managed by renderDecisionHistory() itself.
}

var CATEGORY_ORDER = [
    'Elementary', 'Middle School', 'High School', 'College',
    'AP', 'IB', 'Test Prep', 'Professional/Cert',
    'Arts & Music', 'Technology', 'Language', 'Other'
];

function populateCategoryDropdowns() {
    var present = {};
    allData.forEach(function(r) {
        var cat = r.Category || 'Other';
        present[cat] = true;
    });
    var cats = CATEGORY_ORDER.filter(function(c) { return present[c]; });
    document.querySelectorAll('.category-dropdown').forEach(function(sel) {
        while (sel.options.length > 1) sel.remove(1);
        cats.forEach(function(cat) {
            var opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = cat;
            sel.appendChild(opt);
        });
    });
}

function renderCriticalFindings() {
    // Retained for backward compat; body element may no longer exist
    var tbody = document.getElementById('critical-findings-body');
    if (!tbody) return;
    tbody.innerHTML = '';
}

function renderOverviewPulse() {
    var s = _lastSummary || {};
    var ws = weeklySummaryData || {};

    var total = s.portfolio_bts_total || 0;
    var actual = s.portfolio_actual_to_date || 0;
    var monthsDone = s.months_completed || 0;
    var pct = total > 0 ? Math.round(actual / total * 100) : 0;

    setText('ov-pulse-actual', actual.toLocaleString());
    setText('ov-pulse-total', Math.round(total).toLocaleString());
    setText('ov-pulse-pct', pct + '%');
    setText('ov-pulse-months', monthsDone);
    setText('ov-pulse-updated', s.last_updated || '-');

    var bar = document.getElementById('ov-pulse-bar');
    if (bar) bar.style.width = Math.max(pct, 1) + '%';

    setText('ov-pulse-actions', ws.total_actions || 0);
    setText('ov-pulse-high', ws.high_priority_actions || 0);

    var paceIdx = buildPaceIndex();
    var behindN = 0, onpaceN = 0;
    for (var subj in paceIdx) {
        if (paceIdx[subj] === 'behind') behindN++;
        else if (paceIdx[subj] === 'onpace') onpaceN++;
    }
    setText('ov-pulse-behind', behindN + ' subjects');
    setText('ov-pulse-onpace', onpaceN + ' subjects');
}

function renderMonthSnapshot() {
    _ovPaceIndex = null;
    var monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var now = new Date();
    var currentLabel = monthNames[now.getMonth()];

    var labelEl = document.getElementById('ov-current-month-label');
    if (labelEl) labelEl.textContent = currentLabel;

    var currentMonth = saGetCurrentMonth();
    var cmIdx = saBuildCurrentMonthIndex(currentMonth);

    var dayOfMonth = now.getDate();
    var lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    var fractionThrough = dayOfMonth / lastDay;

    var totalTarget = 0;
    var totalActual = 0;
    var behindCount = 0;
    var onPaceCount = 0;
    var noDataCount = 0;

    trackerData.forEach(function(ts) {
        var cmd = cmIdx[ts.subject];
        if (!cmd || cmd.target == null || cmd.target === 0) {
            if (cmd && cmd.actual != null) {
                totalActual += cmd.actual;
            } else {
                var curMonth = null;
                ts.months.forEach(function(m) { if (m.label === currentLabel) curMonth = m; });
                var t = curMonth ? (curMonth.adjusted_target || curMonth.smoothed_target || 0) : 0;
                if (t > 0) noDataCount++;
            }
            return;
        }

        var target = cmd.target;
        var actual = cmd.actual;
        totalTarget += target;

        if (actual == null) {
            noDataCount++;
            return;
        }

        totalActual += actual;

        if (actual >= target) {
            onPaceCount++;
        } else if (dayOfMonth <= 2) {
            onPaceCount++;
        } else if (actual === 0) {
            behindCount++;
        } else {
            var projectedEOM = fractionThrough > 0 ? Math.round(actual / fractionThrough) : actual;
            var projectionRatio = projectedEOM / target;
            if (projectionRatio >= 0.85) {
                onPaceCount++;
            } else {
                behindCount++;
            }
        }
    });

    setText('ov-month-contracted', totalActual.toLocaleString());
    var ut = (_lastSummary || {}).unique_tutors_contracted;
    setText('ov-month-unique-tutors', ut != null ? ut.toLocaleString() : '—');
    setText('ov-month-target', Math.round(totalTarget).toLocaleString());
    setText('ov-month-behind', behindCount);
    setText('ov-month-onpace', onPaceCount);
    setText('ov-month-nodata', noDataCount);

    var behindEl = document.getElementById('ov-month-behind');
    if (behindEl) {
        behindEl.style.color = behindCount > 10 ? '#e74c3c' : behindCount > 0 ? '#e67e22' : '#27ae60';
    }
}

function setText(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
}

function showTab(tabName, el) {
    var target = document.getElementById(tabName);
    if (!target) return;
    document.querySelectorAll('.tab-content').forEach(function(tc) { tc.classList.remove('active'); });
    document.querySelectorAll('.tab').forEach(function(t) {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
    });
    target.classList.add('active');
    el.classList.add('active');
    el.setAttribute('aria-selected', 'true');
}

function navigateToFiltered(filterValue) {
    overviewFilter(filterValue);
}

/* ── Original table renderers ── */
function renderAllTables() {
    renderBarChart();
    renderPriorityTable();
}

function renderBarChart() {
    var problems = allData
        .filter(function(r) { var t = classifyType(r.Problem_Type); return (t === 'true-supply' || t === 'placement' || t === 'no-util-data') && r.Raw_Gap != null && r.Raw_Gap < 0; })
        .sort(function(a, b) { return a.Raw_Gap - b.Raw_Gap; })
        .slice(0, 15);

    var currentMonth = saGetCurrentMonth();
    var cmIdx = saBuildCurrentMonthIndex(currentMonth);
    var monthLabel = (currentMonth && currentMonth.label) || 'Apr';

    var maxGap = 100;
    problems.forEach(function(row) {
        var abs = Math.abs(row.Raw_Gap);
        if (abs > maxGap) maxGap = abs;
        var cm = cmIdx[row.Subject];
        if (cm && cm.variance != null) {
            var cmAbs = Math.abs(cm.variance);
            if (cmAbs > maxGap) maxGap = cmAbs;
        }
    });

    var container = document.getElementById('gap-chart');
    container.innerHTML = '';

    problems.forEach(function(row) {
        var absGap = Math.abs(row.Raw_Gap);
        var seasonPct = Math.min(100, (absGap / maxGap) * 100);
        var type = classifyType(row.Problem_Type);
        var barClass = type === 'placement' ? 'util-bar' : type === 'no-util-data' ? 'nodata-bar' : 'supply-bar';
        var covPct = row.Coverage_Pct != null ? row.Coverage_Pct : 0;

        var cm = cmIdx[row.Subject];
        var cmGap = (cm && cm.variance != null) ? cm.variance : null;
        var cmPct = (cmGap != null) ? Math.min(100, (Math.abs(cmGap) / maxGap) * 100) : 0;
        var cmLabel = '';
        if (cmGap != null) {
            if (cmGap >= 0) {
                cmLabel = '<span class="bar-cm-ok">+' + cmGap + ' ahead</span>';
            } else {
                cmLabel = '<span class="bar-cm-behind">' + cmGap + ' gap</span>';
            }
        } else {
            cmLabel = '<span class="bar-cm-nodata">—</span>';
        }

        var div = document.createElement('div');
        div.className = 'bar-row bar-row-combo';
        div.innerHTML =
            '<div class="bar-label" title="' + escapeHtml(row.Subject) + '">' + escapeHtml(row.Subject) + '</div>' +
            '<div class="bar-combo-tracks">' +
                '<div class="bar-combo-line">' +
                    '<span class="bar-combo-tag">Season</span>' +
                    '<div class="bar-track"><div class="bar-fill ' + barClass + '" style="width:' + seasonPct + '%"></div></div>' +
                    '<div class="bar-value">' + row.Raw_Gap + ' <span class="bar-coverage">(' + covPct + '%)</span></div>' +
                '</div>' +
                '<div class="bar-combo-line bar-combo-month">' +
                    '<span class="bar-combo-tag">' + monthLabel + '</span>' +
                    '<div class="bar-track"><div class="bar-fill ' + (cmGap != null && cmGap >= 0 ? 'month-ok-bar' : 'month-behind-bar') + '" style="width:' + cmPct + '%"></div></div>' +
                    '<div class="bar-value">' + cmLabel + '</div>' +
                '</div>' +
            '</div>';
        container.appendChild(div);
    });
}

var _ovPaceIndex = null;

function buildPaceIndex() {
    if (_ovPaceIndex) return _ovPaceIndex;
    _ovPaceIndex = {};
    var currentMonth = saGetCurrentMonth();
    if (!currentMonth || currentMonth.state !== 'in-bts') return _ovPaceIndex;
    var cmIdx = saBuildCurrentMonthIndex(currentMonth);

    var now = new Date();
    var dayOfMonth = now.getDate();
    var lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    var fractionThrough = dayOfMonth / lastDay;

    trackerData.forEach(function(ts) {
        var cmd = cmIdx[ts.subject];
        if (!cmd || cmd.target == null || cmd.target === 0) {
            _ovPaceIndex[ts.subject] = (cmd && cmd.actual != null) ? 'onpace' : 'nodata';
            return;
        }
        if (cmd.actual == null) { _ovPaceIndex[ts.subject] = 'nodata'; return; }

        var target = cmd.target;
        var actual = cmd.actual;

        if (actual >= target) {
            _ovPaceIndex[ts.subject] = 'onpace';
            return;
        }

        if (dayOfMonth <= 2) {
            _ovPaceIndex[ts.subject] = 'onpace';
            return;
        }

        if (actual === 0) {
            _ovPaceIndex[ts.subject] = 'behind';
            return;
        }

        var projectedEOM = fractionThrough > 0 ? Math.round(actual / fractionThrough) : actual;
        var projectionRatio = projectedEOM / target;
        _ovPaceIndex[ts.subject] = (projectionRatio >= 0.85) ? 'onpace' : 'behind';
    });
    return _ovPaceIndex;
}

function renderPriorityTable() {
    var tierFilterEl = document.getElementById('filter-tier-priority');
    var tierFilter = tierFilterEl ? tierFilterEl.value : 'hide-niche';

    var ptFilterEl = document.getElementById('filter-problemtype-priority');
    var ptFilter = ptFilterEl ? ptFilterEl.value : 'all-problems';

    var paceFilterEl = document.getElementById('filter-pace-priority');
    var paceFilter = paceFilterEl ? paceFilterEl.value : 'all';

    var paceIdx = buildPaceIndex();

    var isFiltered = (ptFilter !== 'all-problems') || (paceFilter !== 'all') || (tierFilter !== 'hide-niche');
    var clearBtn = document.getElementById('ov-clear-btn');
    if (clearBtn) clearBtn.style.display = isFiltered ? '' : 'none';

    var priority = allData.filter(function(r) {
        var t = classifyType(r.Problem_Type);

        if (ptFilter === 'all-problems') {
            if (!(t === 'true-supply' || t === 'placement' || t === 'no-util-data')) return false;
        } else if (ptFilter !== 'all') {
            if (t !== ptFilter) return false;
        }

        if (paceFilter !== 'all') {
            var pace = paceIdx[r.Subject] || 'nodata';
            if (pace !== paceFilter) return false;
        }

        if (tierFilter === 'all') return true;
        if (tierFilter === 'hide-niche') return r.Tier !== 'NICHE';
        if (tierFilter === 'core-only') return r.Tier === 'CORE';
        return r.Tier === tierFilter;
    });

    var s = currentSorts.priority;
    if (s && s.col !== undefined && s.col !== null) {
        priority = sortData(priority, s.col, s.asc, 'priority');
    } else {
        priority = priority.sort(function(a, b) { return (a.Raw_Gap || 0) - (b.Raw_Gap || 0); });
    }

    var maxRows = isFiltered ? 50 : 15;
    var totalMatched = priority.length;
    priority = priority.slice(0, maxRows);

    var currentMonth = saGetCurrentMonth();
    var cmIdx = saBuildCurrentMonthIndex(currentMonth);

    var cmHeader = document.getElementById('priority-current-month-header');
    if (cmHeader && currentMonth && currentMonth.label) {
        cmHeader.textContent = currentMonth.label;
    }

    var tbody = document.getElementById('priority-body');
    tbody.innerHTML = '';
    var countLabel = isFiltered
        ? 'Showing ' + priority.length + ' of ' + totalMatched + ' subjects'
        : 'Showing top ' + priority.length + ' problem subjects';
    document.getElementById('priority-count').textContent = countLabel;

    priority.forEach(function(row) {
        var tr = document.createElement('tr');
        var type = classifyType(row.Problem_Type);
        if (type === 'placement') tr.className = 'util-problem';
        else if (type === 'true-supply') tr.className = 'supply-problem';
        else if (type === 'no-util-data') tr.className = 'nodata-problem';
        var utilDisplay = buildUtilDisplay(row);
        var covPct = row.Coverage_Pct !== null && row.Coverage_Pct !== undefined ? row.Coverage_Pct : 100;
        var gapClass = covPct < 50 ? 'gap-critical' : covPct < 80 ? 'gap-high' : 'gap-medium';
        var action = '', badgeClass = '', badgeText = '';
        if (type === 'placement') { action = 'Investigate placement/algo'; badgeClass = 'util'; badgeText = 'Under-Used'; }
        else if (type === 'no-util-data') { action = 'Gather data'; badgeClass = 'nodata'; badgeText = 'No Util Data'; }
        else if (type === 'over-supplied') { action = 'Reduce forecast'; badgeClass = 'lowutil'; badgeText = 'Over-Supplied'; }
        else if (type === 'on-track') { action = 'No action needed'; badgeClass = 'ontrack'; badgeText = 'On Track'; }
        else if (type === 'on-track-highwait') { action = 'Investigate wait times'; badgeClass = 'highwait'; badgeText = 'High Wait'; }
        else if (covPct < 50) { action = 'CRITICAL: Recruit now'; badgeClass = 'supply'; badgeText = 'Supply'; }
        else { action = 'Targeted campaigns'; badgeClass = 'supply'; badgeText = 'Supply'; }
        var rawGap = row.Raw_Gap !== null && row.Raw_Gap !== undefined ? row.Raw_Gap : 0;
        var gapDisplay = '<div>' + rawGap + '</div><div style="font-size:11px;color:#7f8c8d">(' + covPct + '% cov)</div>';

        var cmd = cmIdx[row.Subject] || null;
        var cmCell = saRenderCurrentMonthCell(cmd, currentMonth);

        tr.innerHTML = '<td><strong>' + escapeHtml(row.Subject) + '</strong></td>'
            + '<td>' + renderTierBadge(row.Tier, row.BTS_Total) + '</td>'
            + '<td>' + row.Run_Rate + '</td>'
            + '<td>' + row.Smoothed_Target + '</td>'
            + '<td>' + utilDisplay + '</td>'
            + '<td class="' + gapClass + '">' + gapDisplay + '</td>'
            + '<td><span class="badge ' + badgeClass + '" data-tip="' + escapeHtml(PROBLEM_TIPS[type] || '') + '">' + badgeText + '</span></td>'
            + cmCell
            + '<td><small>' + action + '</small></td>';
        tbody.appendChild(tr);
    });
}

function overviewFilter(filterKey) {
    var ptEl = document.getElementById('filter-problemtype-priority');
    var paceEl = document.getElementById('filter-pace-priority');
    var tierEl = document.getElementById('filter-tier-priority');
    var hintEl = document.getElementById('ov-month-active-filter');

    if (filterKey === 'month-behind') {
        if (ptEl) ptEl.value = 'all';
        if (paceEl) paceEl.value = 'behind';
        if (tierEl) tierEl.value = 'all';
        if (hintEl) hintEl.textContent = 'Filtered: behind pace';
    } else if (filterKey === 'month-onpace') {
        if (ptEl) ptEl.value = 'all';
        if (paceEl) paceEl.value = 'onpace';
        if (tierEl) tierEl.value = 'all';
        if (hintEl) hintEl.textContent = 'Filtered: on pace';
    } else if (filterKey === 'month-nodata') {
        if (ptEl) ptEl.value = 'all';
        if (paceEl) paceEl.value = 'nodata';
        if (tierEl) tierEl.value = 'all';
        if (hintEl) hintEl.textContent = 'Filtered: awaiting data';
    } else if (filterKey === 'month-all') {
        if (ptEl) ptEl.value = 'all';
        if (paceEl) paceEl.value = 'all';
        if (tierEl) tierEl.value = 'all';
        if (hintEl) hintEl.textContent = 'Filtered: all subjects';
    } else if (filterKey === 'all') {
        if (ptEl) ptEl.value = 'all';
        if (paceEl) paceEl.value = 'all';
        if (tierEl) tierEl.value = 'hide-niche';
        if (hintEl) hintEl.textContent = 'Filtered: all subjects';
    } else {
        if (ptEl) ptEl.value = filterKey;
        if (paceEl) paceEl.value = 'all';
        if (tierEl) tierEl.value = 'hide-niche';
        if (hintEl) hintEl.textContent = 'Filtered: ' + (ptEl ? ptEl.options[ptEl.selectedIndex].text : filterKey);
    }

    _ovPaceIndex = null;
    renderPriorityTable();
    var table = document.getElementById('ov-table-header');
    if (table) table.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function clearOverviewFilters() {
    var ptEl = document.getElementById('filter-problemtype-priority');
    var paceEl = document.getElementById('filter-pace-priority');
    var tierEl = document.getElementById('filter-tier-priority');
    var hintEl = document.getElementById('ov-month-active-filter');
    if (ptEl) ptEl.value = 'all-problems';
    if (paceEl) paceEl.value = 'all';
    if (tierEl) tierEl.value = 'hide-niche';
    if (hintEl) hintEl.textContent = '';
    _ovPaceIndex = null;
    renderPriorityTable();
}

function matchesFilter(problemType, filter) {
    var type = classifyType(problemType);
    if (filter === 'all') return true;
    if (filter === 'all-problems') return type === 'placement' || type === 'true-supply' || type === 'no-util-data';
    if (filter === 'placement') return type === 'placement';
    if (filter === 'true-supply') return type === 'true-supply';
    if (filter === 'no-util-data') return type === 'no-util-data';
    if (filter === 'on-track') return type === 'on-track';
    if (filter === 'on-track-highwait') return type === 'on-track-highwait';
    if (filter === 'over-supplied') return type === 'over-supplied';
    return false;
}

// Map a row to its top-level recommendation bucket for the Recommendation filter.
function recommendationFor(row) {
    var t = classifyType(row.Problem_Type);
    if (t === 'placement') return 'investigate';
    if (t === 'true-supply' || t === 'no-util-data') return 'recruit';
    if (t === 'over-supplied') return 'reduce';
    if (t === 'on-track-highwait') return 'investigate';
    return 'none';
}



function sortTracker(key) {
    if (trackerSort.key === key) { trackerSort.asc = !trackerSort.asc; }
    else { trackerSort.key = key; trackerSort.asc = (key === 'subject'); }
    renderMonthlyTracker();
}

function sortTable(tableType, colIndex) {
    var sort = currentSorts[tableType];
    if (!sort) return;
    if (sort.col === colIndex) { sort.asc = !sort.asc; } else { sort.col = colIndex; sort.asc = false; }
    if (tableType === 'priority') renderPriorityTable();
}

function sortData(data, colIndex, asc, tableType) {
    // Column-index → field-key mapping for the priority table. Must stay in
    // lockstep with the <th onclick="sortTable(...)"> indices in index.html.
    var columnMaps = {
        'priority': ['Subject', 'Tier', 'Run_Rate', 'Smoothed_Target', 'Util_Rate', 'Raw_Gap', 'Problem_Type']
    };
    var map = columnMaps[tableType] || columnMaps['priority'];
    var key = map[colIndex] || 'Subject';
    return data.slice().sort(function(a, b) {
        var aVal = a[key], bVal = b[key];
        // Tier sorts by defined volume order, not alphabetically
        if (key === 'Tier') {
            aVal = (aVal != null && TIER_ORDER[aVal] !== undefined) ? TIER_ORDER[aVal] : 99;
            bVal = (bVal != null && TIER_ORDER[bVal] !== undefined) ? TIER_ORDER[bVal] : 99;
        }
        // Null/undefined values always sort to the bottom regardless of asc/desc
        // (without this, descending sort puts nulls at the top which feels buggy)
        var aNull = (aVal === null || aVal === undefined);
        var bNull = (bVal === null || bVal === undefined);
        if (aNull && bNull) return 0;
        if (aNull) return 1;
        if (bNull) return -1;
        if (aVal < bVal) return asc ? -1 : 1;
        if (aVal > bVal) return asc ? 1 : -1;
        return 0;
    });
}

function exportTable(tableId) {
    var table = document.getElementById(tableId);
    if (!table) return;
    var rows = table.querySelectorAll('tr');
    var csv = [];
    rows.forEach(function(row) {
        var cells = row.querySelectorAll('th, td');
        var rowData = [];
        cells.forEach(function(cell) { rowData.push('"' + cell.textContent.trim().replace(/"/g, '""') + '"'); });
        csv.push(rowData.join(','));
    });
    var blob = new Blob([csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = tableId.replace('-table', '').replace('-', '_') + '_export.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/* ── Monthly Tracker ── */
function buildMonthTooltip(m, label) {
    var fcst = m.original_forecast != null ? Math.round(m.original_forecast) : null;
    var smth = m.smoothed_target != null ? Math.round(m.smoothed_target) : null;
    var ovr = m.manual_override != null ? Math.round(m.manual_override) : null;
    var lines = ['<strong>' + escapeHtml(label) + '</strong>'];
    lines.push('Model forecast: ' + (fcst != null ? fcst : '\u2014'));
    if (ovr != null) lines.push('Manual override: ' + ovr);
    lines.push('Target: ' + (smth != null ? smth : '\u2014'));
    if (m.actual != null) {
        lines.push('Actual: ' + m.actual);
        if (smth != null) {
            var v = m.actual - smth;
            lines.push('Variance: ' + (v >= 0 ? '+' : '') + v);
        }
    }
    return lines.join('<br>');
}

function buildExpandedRow(ts, colspan) {
    var tr = document.createElement('tr');
    tr.className = 'tracker-detail-row';
    var td = document.createElement('td');
    td.colSpan = colspan;
    var pace = ts._pace;
    var paceLabel = pace >= 999 ? 'On track' : pace + '%';
    var problemLabel = ts.problem_type ? ts.problem_type.replace(/_/g, ' ') : 'On track';
    problemLabel = problemLabel.charAt(0).toUpperCase() + problemLabel.slice(1);

    var html = '<div class="detail-panel">';
    html += '<div class="detail-summary">';
    html += '<div class="detail-stat"><div class="detail-stat-val">' + Math.round(ts.bts_total) + '</div><div class="detail-stat-lbl">BTS Total</div></div>';
    html += '<div class="detail-stat"><div class="detail-stat-val">' + Math.round(ts.run_rate) + '</div><div class="detail-stat-lbl">Run Rate</div></div>';
    html += '<div class="detail-stat"><div class="detail-stat-val">' + Math.round(ts.actual_to_date) + '</div><div class="detail-stat-lbl">Actual to Date</div></div>';
    html += '<div class="detail-stat"><div class="detail-stat-val">' + Math.round(ts.remaining_need) + '</div><div class="detail-stat-lbl">Remaining</div></div>';
    html += '<div class="detail-stat"><div class="detail-stat-val">' + paceLabel + '</div><div class="detail-stat-lbl">Pace</div></div>';
    html += '<div class="detail-stat"><div class="detail-stat-val">' + escapeHtml(problemLabel) + '</div><div class="detail-stat-lbl">Classification</div></div>';
    var overrideCount = ts.months.filter(function(m) { return m.manual_override != null; }).length;
    if (overrideCount > 0) {
        html += '<div class="detail-stat"><div class="detail-stat-val" style="color:#e67e22;">' + overrideCount + ' mo</div><div class="detail-stat-lbl">Manual Adj</div></div>';
    }
    html += '</div>';

    html += '<table class="detail-months-table"><thead><tr><th></th>';
    var labels = ['Mar'];
    ts.months.forEach(function(m) { labels.push(m.label); });
    labels.forEach(function(l) { html += '<th>' + l + '</th>'; });
    html += '</tr></thead><tbody>';

    var mb = ts.march_baseline || {};
    html += '<tr><td>Forecast</td><td>' + (mb.forecast != null ? mb.forecast : '—') + '</td>';
    ts.months.forEach(function(m) {
        var f = m.original_forecast != null ? Math.round(m.original_forecast) : '—';
        html += '<td>' + f + '</td>';
    });
    html += '</tr>';

    var hasOverrides = ts.months.some(function(m) { return m.manual_override != null; });
    if (hasOverrides) {
        html += '<tr><td>Manual Adj</td><td style="color:#95a5a6">—</td>';
        ts.months.forEach(function(m) {
            if (m.manual_override != null) {
                var diff = Math.round(m.manual_override) - (m.original_forecast != null ? Math.round(m.original_forecast) : 0);
                var diffLabel = diff > 0 ? '+' + diff : diff === 0 ? '0' : '' + diff;
                html += '<td style="color:#e67e22;font-weight:600;" title="Override: ' + Math.round(m.manual_override) + ' (forecast was ' + (m.original_forecast != null ? Math.round(m.original_forecast) : 0) + ')">' + diffLabel + '</td>';
            } else {
                html += '<td style="color:#bdc3c7;">—</td>';
            }
        });
        html += '</tr>';
    }

    html += '<tr><td>Target</td><td style="color:#95a5a6">—</td>';
    ts.months.forEach(function(m) {
        var s = m.smoothed_target != null ? Math.round(m.smoothed_target) : '—';
        html += '<td>' + s + '</td>';
    });
    html += '</tr>';

    html += '<tr><td>Actual</td><td>' + (mb.actual != null ? mb.actual : '—') + '</td>';
    ts.months.forEach(function(m) {
        html += '<td>' + (m.actual != null ? m.actual : '—') + '</td>';
    });
    html += '</tr></tbody></table></div>';

    td.innerHTML = html;
    tr.appendChild(td);
    return tr;
}

function initTrackerKey() {
    var key = document.getElementById('tracker-key');
    if (!key) return;
    var stored = localStorage.getItem('tracker_key_closed');
    if (stored === '1') {
        key.removeAttribute('open');
    } else {
        key.setAttribute('open', '');
    }
    key.addEventListener('toggle', function() {
        localStorage.setItem('tracker_key_closed', key.open ? '0' : '1');
    });
}

var _openDetailSubject = null;

function getVisibleMonthIndices() {
    if (!trackerData.length || !trackerData[0].months) return { visible: [], hidden: [] };
    var months = trackerData[0].months;
    var finalIndices = [];
    for (var i = 0; i < months.length; i++) {
        if (months[i].status === 'final') finalIndices.push(i);
    }
    var visible = [];
    var hidden = [];
    for (var j = 0; j < months.length; j++) {
        var isFinal = months[j].status === 'final';
        if (isFinal && finalIndices.length > 1 && j < finalIndices[finalIndices.length - 1]) {
            hidden.push(j);
        } else {
            visible.push(j);
        }
    }
    return { visible: visible, hidden: hidden };
}

function renderCompletedMonthsBar(hiddenIndices) {
    var bar = document.getElementById('completed-months-bar');
    if (!bar || !hiddenIndices.length) {
        if (bar) bar.style.display = 'none';
        return;
    }
    var chips = [];
    hiddenIndices.forEach(function(idx) {
        var totalTarget = 0, totalActual = 0;
        trackerData.forEach(function(ts) {
            var m = ts.months[idx];
            if (m.actual != null) {
                totalTarget += m.smoothed_target || 0;
                totalActual += m.actual;
            }
        });
        var variance = Math.round(totalActual - totalTarget);
        var label = trackerData[0].months[idx].label;
        var cls = variance >= 0 ? 'chip-met' : 'chip-missed';
        chips.push('<span class="completed-chip ' + cls + '">' + label + ': <strong>' + (variance >= 0 ? '+' : '') + variance + '</strong></span>');
    });
    bar.innerHTML = '<span class="completed-bar-label">Completed months:</span> ' + chips.join(' ');
    bar.style.display = 'flex';
}

function renderMonthlyTracker() {
    if (!trackerData.length) return;
    var filter = document.getElementById('tracker-filter').value;
    var hintEl = document.getElementById('tracker-filter-hint');
    if (hintEl) hintEl.style.display = filter === 'has-actuals' ? 'block' : 'none';
    var catFilter = document.getElementById('filter-category-tracker').value;
    var search = document.getElementById('tracker-search').value.toLowerCase();

    trackerData.forEach(function(ts) {
        var rr = ts.run_rate || 0;
        var rem = ts.remaining_need || 0;
        var monthsRem = 7 - (ts.months_completed || 0);
        if (monthsRem < 1) monthsRem = 1;
        var projected = rr * monthsRem;
        ts._pace = rem > 0 ? Math.round(projected / rem * 100) : (rr > 0 ? 999 : 100);
    });

    var mv = getVisibleMonthIndices();
    var visibleMonths = mv.visible;
    var hiddenMonths = mv.hidden;

    renderCompletedMonthsBar(hiddenMonths);

    var thead = document.getElementById('tracker-head');
    if (!thead) return;
    var headerRow = '<tr>';
    headerRow += '<th class="sortable col-left" onclick="sortTracker(\'subject\')">Subject</th>';
    headerRow += '<th class="sortable col-left" onclick="sortTracker(\'run_rate\')">Run Rate</th>';
    headerRow += '<th class="sortable col-month col-month-baseline" onclick="sortTracker(\'march_baseline:actual\')">Mar</th>';
    visibleMonths.forEach(function(idx) {
        var m = trackerData[0].months[idx];
        headerRow += '<th class="sortable col-month" onclick="sortTracker(\'month:' + idx + '\')">' + m.label + '</th>';
    });
    headerRow += '<th class="sortable col-right col-right-first" onclick="sortTracker(\'bts_total\')">BTS Total</th>';
    headerRow += '<th class="sortable col-right" onclick="sortTracker(\'remaining_need\')">Remaining</th>';
    headerRow += '<th class="sortable col-right tooltip-wrap" onclick="sortTracker(\'_pace\')">Pace<span class="tooltip-text"><strong>Pace</strong> = (Run Rate &times; Months Left) &divide; Remaining Need</span></th>';
    headerRow += '</tr>';
    thead.innerHTML = headerRow;

    var totalCols = 3 + visibleMonths.length + 3;

    var filtered = trackerData.filter(function(ts) {
        if (search && ts.subject.toLowerCase().indexOf(search) === -1) return false;
        if (catFilter !== 'all' && ts.category !== catFilter) return false;
        if (filter === 'problems') { var _t = classifyType(ts.problem_type); return _t !== 'on-track' && _t !== 'on-track-highwait' && _t !== 'over-supplied'; }
        if (filter === 'will-miss') return ts._pace < 80;
        if (filter === 'at-risk') return ts._pace >= 80 && ts._pace < 100;
        if (filter === 'has-actuals') return ts.actual_to_date > 0;
        if (filter === 'behind') {
            for (var i = 0; i < ts.months.length; i++) {
                if (ts.months[i].actual !== null && ts.months[i].variance < 0) return true;
            }
            return false;
        }
        return true;
    });

    var missCount = trackerData.filter(function(ts) { return ts._pace < 80; }).length;
    var riskCount = trackerData.filter(function(ts) { return ts._pace >= 80 && ts._pace < 100; }).length;

    var sk = trackerSort.key;
    var sa = trackerSort.asc;

    // Nested-key lookup: "month:N" sorts by months[N].actual (fallback to
    // smoothed_target if no actual yet). "march_baseline:actual" sorts by
    // the March baseline actual. Plain keys do a direct property lookup.
    function getSortVal(ts) {
        if (typeof sk === 'string' && sk.indexOf('month:') === 0) {
            var idx = parseInt(sk.split(':')[1], 10);
            var m = ts.months && ts.months[idx];
            if (!m) return null;
            return m.actual !== null && m.actual !== undefined ? m.actual : m.smoothed_target;
        }
        if (sk === 'march_baseline:actual') {
            return ts.march_baseline && ts.march_baseline.actual;
        }
        return ts[sk];
    }

    filtered.sort(function(a, b) {
        var av = getSortVal(a), bv = getSortVal(b);
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        if (av < bv) return sa ? -1 : 1;
        if (av > bv) return sa ? 1 : -1;
        return 0;
    });

    document.getElementById('tracker-count').innerHTML = 'Showing ' + filtered.length + ' of ' + trackerData.length + ' subjects &nbsp;·&nbsp; <span style="color:#e74c3c;font-weight:600">' + missCount + ' will miss</span> &nbsp;·&nbsp; <span style="color:#f39c12;font-weight:600">' + riskCount + ' at risk</span>';
    var tbody = document.getElementById('tracker-body');
    tbody.innerHTML = '';

    filtered.forEach(function(ts) {
        var tr = document.createElement('tr');
        tr.className = 'tracker-row';
        var pace = ts._pace;
        if (pace < 80) tr.className += ' row-miss';
        else if (pace < 100) tr.className += ' row-risk';

        var cells = '<td class="col-left tracker-subject"><span class="tracker-chevron">&#9656;</span><strong>' + escapeHtml(ts.subject) + '</strong></td>';
        cells += '<td class="col-left">' + Math.round(ts.run_rate) + '</td>';

        var mb = ts.march_baseline || {};
        var marTip = 'March Baseline';
        if (mb.forecast != null) marTip += '\\nForecast: ' + mb.forecast;
        if (mb.actual != null) marTip += '\\nActual: ' + mb.actual;
        if (mb.variance != null) marTip += '\\nVariance: ' + (mb.variance >= 0 ? '+' : '') + mb.variance;
        var marContent = '<div class="month-cell">';
        if (mb.actual != null) {
            marContent += '<div class="mc-num">' + mb.actual + '</div>';
            if (mb.variance != null) {
                var marCls = mb.variance > 0 ? 'positive' : mb.variance < 0 ? 'negative' : 'zero';
                marContent += '<div class="mc-var ' + marCls + '">' + (mb.variance > 0 ? '+' : '') + mb.variance + '</div>';
            }
        } else {
            marContent += '<div class="mc-num mc-empty">—</div>';
        }
        marContent += '</div>';
        cells += '<td class="col-month col-month-baseline" title="' + marTip + '">' + marContent + '</td>';

        visibleMonths.forEach(function(idx) {
            var m = ts.months[idx];
            var isInProgress = m.status === 'in_progress';
            var isFinal = m.status === 'final';
            var smth = m.smoothed_target != null ? Math.round(m.smoothed_target) : null;
            var cellCls = 'col-month';
            if (isFinal) cellCls += ' month-past';
            else if (isInProgress) cellCls += ' month-in-progress';

            if (m.actual != null && smth != null && (isFinal || isInProgress)) {
                if (m.actual >= smth) cellCls += ' cell-met';
                else cellCls += ' cell-missed';
            }

            var content = '<div class="month-cell">';

            if (m.actual != null && (isFinal || isInProgress)) {
                content += '<div class="mc-num">' + m.actual + '</div>';
                if (isFinal && m.variance != null) {
                    var varCls = m.variance > 0 ? 'positive' : m.variance < 0 ? 'negative' : 'zero';
                    content += '<div class="mc-var ' + varCls + '">' + (m.variance > 0 ? '+' : '') + Math.round(m.variance) + '</div>';
                }
                if (isInProgress && smth) {
                    var pct = Math.min(Math.round(m.actual / smth * 100), 100);
                    content += '<div class="ip-progress-outer"><div class="ip-progress-fill" style="width:' + pct + '%"></div></div>';
                    content += '<div class="ip-badge">in progress</div>';
                }
            } else {
                content += '<div class="mc-num mc-future">' + (smth != null ? smth : '—') + '</div>';
            }
            content += '</div>';

            var tipHtml = buildMonthTooltip(m, m.label);
            cells += '<td class="' + cellCls + ' cell-tip" data-tip="' + escapeHtml(tipHtml) + '">' + content + '</td>';
        });

        cells += '<td class="col-right col-right-first"><strong>' + Math.round(ts.bts_total) + '</strong></td>';
        cells += '<td class="col-right">' + Math.round(ts.remaining_need) + '</td>';

        var paceCls = pace >= 100 ? 'pace-ok' : pace >= 80 ? 'pace-risk' : 'pace-miss';
        var paceWidth = Math.min(pace, 100);
        var paceLabel = pace >= 999 ? '&#10003;' : pace + '%';
        cells += '<td class="col-right"><div class="pace-bar-wrap"><div class="pace-bar-outer"><div class="pace-bar-fill ' + paceCls + '" style="width:' + paceWidth + '%"></div></div><div class="pace-label ' + paceCls + '">' + paceLabel + '</div></div></td>';

        tr.innerHTML = cells;

        tr.addEventListener('click', function(e) {
            if (e.target.closest('.cell-tip')) return;
            var next = tr.nextElementSibling;
            if (next && next.classList.contains('tracker-detail-row')) {
                next.remove();
                tr.classList.remove('tracker-row-expanded');
                _openDetailSubject = null;
                return;
            }
            var existing = tbody.querySelector('.tracker-detail-row');
            if (existing) {
                existing.previousElementSibling.classList.remove('tracker-row-expanded');
                existing.remove();
            }
            tr.classList.add('tracker-row-expanded');
            var detail = buildExpandedRow(ts, totalCols);
            tr.parentNode.insertBefore(detail, tr.nextSibling);
            _openDetailSubject = ts.subject;
        });

        tbody.appendChild(tr);

        if (_openDetailSubject === ts.subject) {
            tr.classList.add('tracker-row-expanded');
            tbody.appendChild(buildExpandedRow(ts, totalCols));
        }
    });

}

function renderMarchBaseline(summary) {
    var mb = summary.march_baseline;
    if (!mb || !mb.total_actual) return;
    document.getElementById('march-baseline-card').style.display = 'block';
    document.getElementById('mar-total-actual').textContent = mb.total_actual.toLocaleString();
    document.getElementById('mar-total-forecast').textContent = mb.total_forecast.toLocaleString();
    var v = mb.variance;
    var vColor = v >= 0 ? '#27ae60' : '#e74c3c';
    var vSign = v >= 0 ? '+' : '';
    document.getElementById('mar-total-variance').innerHTML = '<span style="color:' + vColor + '; font-weight:700;">' + vSign + v.toLocaleString() + '</span>';
    document.getElementById('mar-subject-count').textContent = mb.subjects_with_data;
    var pct = Math.round(v / mb.total_forecast * 100);
    var insight = v >= 0
        ? 'March saw ' + pct + '% more tutor-subject combos than forecast — strong baseline heading into BTS.'
        : 'March saw ' + Math.abs(pct) + '% fewer tutor-subject combos than forecast — gap to watch entering BTS.';
    document.getElementById('mar-insight').textContent = insight;
}

function renderProgressBar(summary) {
    var total = summary.portfolio_bts_total || 0;
    var actual = summary.portfolio_actual_to_date || 0;
    var monthsDone = summary.months_completed || 0;
    var monthsTotal = 7;

    if (total === 0) {
        document.getElementById('progress-label').textContent = 'BTS Total: calculating...';
        return;
    }

    var pct = Math.round(actual / total * 100);
    var expectedPct = Math.round(monthsDone / monthsTotal * 100);
    var paceClass = pct >= expectedPct ? 'ahead' : 'behind';

    document.getElementById('progress-label').textContent = actual + ' of ' + Math.round(total) + ' tutor-subject combos';
    document.getElementById('progress-pct').textContent = pct + '% complete';
    var fill = document.getElementById('progress-fill');
    fill.style.width = Math.max(pct, 2) + '%';
    fill.className = 'progress-bar-fill ' + paceClass;
    fill.textContent = pct + '%';
    document.getElementById('progress-months').textContent = monthsDone + ' of ' + monthsTotal + ' months completed';

    if (monthsDone > 0) {
        var rate = actual / monthsDone;
        var projected = Math.round(rate * monthsTotal);
        document.getElementById('progress-pace').textContent = 'Projected: ' + projected + ' (' + (projected >= total ? 'on pace' : Math.round(total - projected) + ' short') + ')';
    } else {
        document.getElementById('progress-pace').textContent = 'Upload actuals to see projections';
    }

    // Also update history tab progress
    document.getElementById('hist-progress-label').textContent = document.getElementById('progress-label').textContent;
    document.getElementById('hist-progress-pct').textContent = document.getElementById('progress-pct').textContent;
    document.getElementById('hist-progress-fill').style.width = fill.style.width;
    document.getElementById('hist-progress-fill').className = fill.className;
    document.getElementById('hist-progress-fill').textContent = fill.textContent;
    document.getElementById('hist-progress-months').textContent = document.getElementById('progress-months').textContent;
    document.getElementById('hist-progress-pace').textContent = document.getElementById('progress-pace').textContent;
}

/* ── History Tab ── */
function renderHistoryTab() {
    renderHistoryCards();
    renderUploadLog();
}

function renderHistoryCards() {
    var timeline = document.getElementById('history-timeline');
    if (!timeline) return;
    if (!historyData.length) {
        timeline.innerHTML = '<div style="padding: 40px; text-align: center; color: #95a5a6;">No completed months yet. Months move here once finalized.</div>';
        return;
    }
    timeline.innerHTML = '';
    var _openHistoryMonth = null;

    historyData.forEach(function(h) {
        var tolAcc = h.tolerance_accuracy || 0;
        var accCls = tolAcc >= 80 ? 'acc-good' : tolAcc >= 60 ? 'acc-warn' : 'acc-bad';
        var bias = h.forecast_bias || 0;
        var biasDir = bias > 0 ? 'over' : bias < 0 ? 'under' : 'neutral';
        var biasCls = bias >= -15 ? 'bias-good' : 'bias-bad';
        var met = h.subjects_met || 0;
        var missed = h.subjects_missed || 0;
        var total = met + missed;
        var hitRate = h.hit_rate || 0;
        var excludedCount = h.excluded_count || 0;
        var evalCount = h.total_subjects_evaluated || total;

        var card = document.createElement('div');
        card.className = 'history-card-v2';

        var html = '<div class="hc-header ' + accCls + '">';
        html += '<div class="hc-title">' + h.label + ' 2026</div>';
        html += '<div class="hc-bubbles">';
        html += '<div class="hc-bubble ' + accCls + '"><div class="hc-bubble-val">' + Math.round(tolAcc) + '%</div><div class="hc-bubble-lbl">on target (\u00b12)</div></div>';
        html += '<div class="hc-bubble ' + biasCls + '"><div class="hc-bubble-val">' + (bias >= 0 ? '+' : '') + bias + '%</div><div class="hc-bubble-lbl">bias (' + biasDir + ')</div></div>';
        html += '</div>';
        html += '</div>';

        html += '<div class="hc-body">';
        html += '<div class="hc-stats">';
        html += '<div class="hc-stat"><div class="hc-stat-val">' + Math.round(h.total_target) + '</div><div class="hc-stat-lbl">Target</div></div>';
        html += '<div class="hc-stat"><div class="hc-stat-val">' + Math.round(h.total_actual) + '</div><div class="hc-stat-lbl">Actual</div></div>';
        var vColor = h.variance >= 0 ? '#27ae60' : '#e74c3c';
        html += '<div class="hc-stat"><div class="hc-stat-val" style="color:' + vColor + '">' + (h.variance >= 0 ? '+' : '') + Math.round(h.variance) + '</div><div class="hc-stat-lbl">Variance (' + (h.variance_pct >= 0 ? '+' : '') + h.variance_pct + '%)</div></div>';
        var gap = h.coverage_gap || 0;
        var gapColor = gap === 0 ? '#27ae60' : '#e74c3c';
        html += '<div class="hc-stat"><div class="hc-stat-val">' + hitRate + '%</div><div class="hc-stat-lbl">Hit Rate (' + met + '/' + total + ')</div></div>';
        html += '<div class="hc-stat"><div class="hc-stat-val" style="color:' + gapColor + '">' + gap + '</div><div class="hc-stat-lbl">Tutors Short</div></div>';
        html += '<div class="hc-stat"><div class="hc-stat-val">' + Math.round(h.cumulative_actual) + ' / ' + Math.round(h.cumulative_target) + '</div><div class="hc-stat-lbl">Cumulative</div></div>';
        html += '</div>';

        html += '<div class="hc-subject-counts">';
        html += '<span class="hc-met-count">' + met + ' met (' + Math.round(hitRate) + '%)</span>';
        html += '<span class="hc-missed-count">' + missed + ' missed (' + Math.round(100 - hitRate) + '%)</span>';
        html += '</div>';
        if (excludedCount > 0) {
            html += '<div class="hc-excluded-note">' + excludedCount + ' subject' + (excludedCount > 1 ? 's' : '') + ' excluded from accuracy (manually adjusted to near-zero). Evaluated ' + evalCount + ' of ' + total + '.</div>';
        }

        html += '<div class="hc-performers-wrap">';
        if (h.under_performers && h.under_performers.length) {
            html += '<div class="hc-perf-section"><div class="hc-perf-label missed-label">Biggest Gaps</div>';
            h.under_performers.slice(0, 3).forEach(function(p) {
                html += '<div class="hc-perf-item missed-item">' + escapeHtml(p.subject) + ' <span>' + Math.round(p.variance) + '</span></div>';
            });
            html += '</div>';
        }
        if (h.over_performers && h.over_performers.length) {
            html += '<div class="hc-perf-section"><div class="hc-perf-label met-label">Over-Performed</div>';
            h.over_performers.slice(0, 3).forEach(function(p) {
                html += '<div class="hc-perf-item met-item">' + escapeHtml(p.subject) + ' <span>+' + Math.round(p.variance) + '</span></div>';
            });
            html += '</div>';
        }
        html += '</div>';

        html += '<div class="hc-expand-cta">Click to view accuracy tiers + all subjects &#9662;</div>';
        html += '</div>';

        card.innerHTML = html;

        var detailPanel = document.createElement('div');
        detailPanel.className = 'hc-detail-panel';
        detailPanel.style.display = 'none';

        card.addEventListener('click', function() {
            if (detailPanel.style.display === 'none') {
                if (_openHistoryMonth && _openHistoryMonth !== detailPanel) {
                    _openHistoryMonth.style.display = 'none';
                    _openHistoryMonth.previousElementSibling.querySelector('.hc-expand-cta').innerHTML = 'Click to view all subjects &#9662;';
                }
                detailPanel.style.display = 'block';
                card.querySelector('.hc-expand-cta').innerHTML = 'Click to collapse &#9652;';
                _openHistoryMonth = detailPanel;
                if (!detailPanel.dataset.rendered) {
                    renderHistoryDetail(detailPanel, h);
                    detailPanel.dataset.rendered = '1';
                }
            } else {
                detailPanel.style.display = 'none';
                card.querySelector('.hc-expand-cta').innerHTML = 'Click to view all subjects &#9662;';
                _openHistoryMonth = null;
            }
        });

        timeline.appendChild(card);
        timeline.appendChild(detailPanel);
    });
}

function renderHistoryDetail(panel, h) {
    var subjects = h.subjects || [];
    var met = h.subjects_met || 0;
    var missed = h.subjects_missed || 0;
    var total = met + missed;

    var html = '';

    // --- Tiered accuracy breakdown ---
    var excludedCount = h.excluded_count || 0;
    var excludedSubjects = h.excluded_subjects || [];
    var evalCount = h.total_subjects_evaluated || total;

    html += '<div class="hd-tiers">';
    html += '<div class="hd-tiers-title">Forecast Accuracy Tiers</div>';
    if (excludedCount > 0) {
        html += '<div class="hd-tiers-note">' + excludedCount + ' manually-adjusted subject' + (excludedCount > 1 ? 's' : '') + ' excluded from Tiers 1\u20132. Metrics below reflect ' + evalCount + ' planned subjects.</div>';
    }
    html += '<table class="hd-tier-table"><thead><tr><th>Metric</th><th>Tier</th><th>Value</th><th>Target</th><th></th></tr></thead><tbody>';

    var tolAcc = h.tolerance_accuracy || 0;
    var tolPass = tolAcc >= 80;
    html += '<tr><td><strong>Tolerance Accuracy</strong><div class="hd-tier-desc">% of subjects within &plusmn;2 tutors of target</div></td>';
    html += '<td>1</td><td>' + Math.round(tolAcc) + '%</td><td>&ge;80%</td>';
    html += '<td class="' + (tolPass ? 'tier-pass' : 'tier-fail') + '">' + (tolPass ? '&#10003;' : '&#10007;') + '</td></tr>';

    var gap = h.coverage_gap || 0;
    var gapPass = gap === 0;
    html += '<tr><td><strong>Coverage Gap</strong><div class="hd-tier-desc">Total tutors short across all subjects (ignores over-delivery)</div></td>';
    html += '<td>1</td><td>' + gap + ' tutors</td><td>0</td>';
    html += '<td class="' + (gapPass ? 'tier-pass' : 'tier-fail') + '">' + (gapPass ? '&#10003;' : '&#10007;') + '</td></tr>';

    var bias = h.forecast_bias || 0;
    var biasPass = bias >= -15;
    var biasLabel = bias > 0 ? '+' + bias + '% over' : bias < 0 ? bias + '% under' : '0% neutral';
    html += '<tr><td><strong>Forecast Bias</strong><div class="hd-tier-desc">Directional tendency — over-delivery is preferred; only significant under-delivery is flagged</div></td>';
    html += '<td>2</td><td>' + biasLabel + '</td><td>&ge; &minus;15%</td>';
    html += '<td class="' + (biasPass ? 'tier-pass' : 'tier-fail') + '">' + (biasPass ? '&#10003;' : '&#10007;') + '</td></tr>';

    var clAcc = Math.max(h.cluster_accuracy || 0, 0);
    var clPass = clAcc >= 75;
    html += '<tr><td><strong>Cluster MAE</strong><div class="hd-tier-desc">Accuracy by category — how well does recruiting match demand at cluster level</div></td>';
    html += '<td>2</td><td>' + Math.round(clAcc) + '%</td><td>&ge;75%</td>';
    html += '<td class="' + (clPass ? 'tier-pass' : 'tier-fail') + '">' + (clPass ? '&#10003;' : '&#10007;') + '</td></tr>';

    var sr = h.surprise_rate || 0;
    var srPass = sr <= 5;
    html += '<tr><td><strong>Surprise Rate</strong><div class="hd-tier-desc">Long-tail subjects with real demand we completely missed</div></td>';
    html += '<td>3</td><td>' + sr + '% (' + (h.surprise_count || 0) + '/' + (h.long_tail_count || 0) + ')</td><td>&le;5%</td>';
    html += '<td class="' + (srPass ? 'tier-pass' : 'tier-fail') + '">' + (srPass ? '&#10003;' : '&#10007;') + '</td></tr>';

    var wmape = h.weighted_mae_pct || 0;
    html += '<tr class="tier-ref"><td><strong>WMAPE</strong><div class="hd-tier-desc">Volume-weighted mean absolute error (reference — will replace tolerance accuracy once hourly data is available)</div></td>';
    html += '<td>\u2014</td><td>' + wmape + '%</td><td>\u2014</td><td></td></tr>';

    html += '</tbody></table>';

    // Cluster detail (collapsible)
    if (h.cluster_details && h.cluster_details.length) {
        html += '<details class="hd-cluster-detail"><summary>Cluster breakdown by category</summary>';
        html += '<table class="hd-cluster-table"><thead><tr><th>Category</th><th>Target</th><th>Actual</th><th>Error</th></tr></thead><tbody>';
        h.cluster_details.forEach(function(c) {
            var errCls = c.error_pct <= 20 ? 'tier-pass' : c.error_pct <= 40 ? '' : 'tier-fail';
            html += '<tr><td>' + escapeHtml(c.cluster) + '</td><td>' + Math.round(c.target) + '</td><td>' + Math.round(c.actual) + '</td>';
            html += '<td class="' + errCls + '">' + c.error_pct + '%</td></tr>';
        });
        html += '</tbody></table></details>';
    }
    if (excludedSubjects.length) {
        html += '<details class="hd-cluster-detail"><summary>Excluded subjects (' + excludedCount + ' manually adjusted to near-zero)</summary>';
        html += '<div class="hd-excluded-list">';
        excludedSubjects.forEach(function(name) {
            var s = subjects.find(function(x) { return x.subject === name; });
            var actVal = s ? Math.round(s.actual) : '?';
            html += '<span class="hd-excluded-chip">' + escapeHtml(name) + (s ? ' <em>(actual: ' + actVal + ')</em>' : '') + '</span>';
        });
        html += '</div></details>';
    }
    html += '</div>';

    // --- Header and controls ---
    html += '<div class="hd-header">';
    html += '<h3>Subject Breakdown</h3>';
    html += '<div class="hd-summary-stats">';
    html += '<span class="hd-badge hd-met">' + met + ' met</span>';
    html += '<span class="hd-badge hd-missed">' + missed + ' missed</span>';
    html += '<span class="hd-badge hd-total">' + total + ' total</span>';
    html += '</div>';
    html += '</div>';

    html += '<div class="hd-controls">';
    html += '<input type="text" class="hd-search" placeholder="Search subjects...">';
    html += '<select class="hd-filter"><option value="all">All Subjects</option><option value="met">Met Target</option><option value="missed">Missed Target</option></select>';
    html += '</div>';

    html += '<div class="hd-table-wrap"><table class="hd-table">';
    html += '<thead><tr>';
    html += '<th class="hd-sortable" data-col="subject">Subject</th>';
    html += '<th class="hd-sortable" data-col="category">Category</th>';
    html += '<th class="hd-sortable" data-col="target">Target</th>';
    html += '<th class="hd-sortable" data-col="actual">Actual</th>';
    html += '<th class="hd-sortable" data-col="variance">Variance</th>';
    html += '<th class="hd-sortable" data-col="pct_of_target">% of Target</th>';
    html += '</tr></thead>';
    html += '<tbody class="hd-tbody"></tbody></table></div>';

    panel.innerHTML = html;

    var sortKey = 'variance';
    var sortAsc = true;
    var tbody = panel.querySelector('.hd-tbody');
    var searchInput = panel.querySelector('.hd-search');
    var filterSelect = panel.querySelector('.hd-filter');

    function renderRows() {
        var q = searchInput.value.toLowerCase();
        var f = filterSelect.value;
        var rows = subjects.filter(function(s) {
            if (q && s.subject.toLowerCase().indexOf(q) === -1) return false;
            if (f === 'met') return s.actual >= s.target;
            if (f === 'missed') return s.actual < s.target;
            return true;
        });

        rows.sort(function(a, b) {
            var av = a[sortKey], bv = b[sortKey];
            if (typeof av === 'string') av = av.toLowerCase();
            if (typeof bv === 'string') bv = bv.toLowerCase();
            if (av == null) return 1;
            if (bv == null) return -1;
            if (av < bv) return sortAsc ? -1 : 1;
            if (av > bv) return sortAsc ? 1 : -1;
            return 0;
        });

        tbody.innerHTML = '';
        rows.forEach(function(s) {
            var rowCls = s.actual >= s.target ? 'hd-row-met' : 'hd-row-missed';
            var vColor = s.variance >= 0 ? '#27ae60' : '#e74c3c';
            var pctColor = s.pct_of_target >= 100 ? '#27ae60' : s.pct_of_target >= 80 ? '#f39c12' : '#e74c3c';
            var row = '<tr class="' + rowCls + '">';
            row += '<td>' + escapeHtml(s.subject) + '</td>';
            row += '<td>' + escapeHtml(s.category) + '</td>';
            row += '<td>' + Math.round(s.target) + '</td>';
            row += '<td><strong>' + s.actual + '</strong></td>';
            row += '<td style="color:' + vColor + '; font-weight:600;">' + (s.variance >= 0 ? '+' : '') + Math.round(s.variance) + '</td>';
            row += '<td style="color:' + pctColor + '; font-weight:600;">' + s.pct_of_target + '%</td>';
            row += '</tr>';
            tbody.innerHTML += row;
        });
    }

    panel.querySelectorAll('.hd-sortable').forEach(function(th) {
        th.addEventListener('click', function(e) {
            e.stopPropagation();
            var col = th.dataset.col;
            if (sortKey === col) sortAsc = !sortAsc;
            else { sortKey = col; sortAsc = true; }
            renderRows();
        });
    });

    searchInput.addEventListener('click', function(e) { e.stopPropagation(); });
    filterSelect.addEventListener('click', function(e) { e.stopPropagation(); });
    searchInput.addEventListener('input', debounce(renderRows, 200));
    filterSelect.addEventListener('change', renderRows);

    renderRows();
}

function renderUploadLog() {
    var tbody = document.getElementById('upload-log-body');
    if (!uploadsData.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#95a5a6; padding:20px;">No uploads yet</td></tr>';
        return;
    }
    tbody.innerHTML = '';
    uploadsData.forEach(function(u) {
        var tr = document.createElement('tr');
            tr.innerHTML = '<td><span class="badge ' + (u.type === 'actuals' ? 'util' : 'supply') + '">' + escapeHtml(u.type) + '</span></td><td>' + escapeHtml(u.filename) + '</td><td>' + escapeHtml(u.month || '-') + '</td><td>' + (u.subjects_count || '-') + '</td><td>' + escapeHtml(u.uploaded_at) + '</td>';
        tbody.appendChild(tr);
    });
}

/** Parse one CSV line (handles "quoted,fields" with commas inside). */
function parseCsvLine(line) {
    var out = [];
    var field = '';
    var i = 0;
    var inQ = false;
    while (i < line.length) {
        var c = line[i];
        if (inQ) {
            if (c === '"') {
                if (line[i + 1] === '"') {
                    field += '"';
                    i += 2;
                    continue;
                }
                inQ = false;
                i++;
                continue;
            }
            field += c;
            i++;
        } else {
            if (c === '"') {
                inQ = true;
                i++;
                continue;
            }
            if (c === ',') {
                out.push(field.trim());
                field = '';
                i++;
                continue;
            }
            field += c;
            i++;
        }
    }
    out.push(field.trim());
    return out;
}

function csvEscapeField(s) {
    if (s === null || s === undefined) return '';
    s = String(s);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
}

/** GET file contents from GitHub API (needs PAT). Returns null if missing or no token. */
function fetchRepoTextFile(path) {
    var pat = getPAT();
    if (!pat) return Promise.resolve(null);
    var apiUrl = 'https://api.github.com/repos/' + REPO_OWNER + '/' + REPO_NAME + '/contents/' + path;
    return fetch(apiUrl, { headers: { 'Authorization': 'token ' + pat, 'Accept': 'application/vnd.github.v3+json' } })
        .then(function(r) {
            if (r.status === 404) return null;
            if (!r.ok) return null;
            return r.json();
        })
        .then(function(data) {
            if (!data || !data.content) return null;
            var bin = atob(data.content.replace(/\n/g, ''));
            try {
                return decodeURIComponent(escape(bin));
            } catch (e) {
                return bin;
            }
        });
}

function parseAdjustmentsUploadText(text) {
    var lines = text.trim().split('\n');
    if (lines.length < 2) return { rows: [], error: 'File appears empty' };
    var header = parseCsvLine(lines[0]).map(function(h) { return h.replace(/^"|"$/g, '').trim(); });
    var nameIdx = header.indexOf('Subject Name');
    if (nameIdx === -1) nameIdx = header.indexOf('subject_name');
    var fcstIdx = header.indexOf('Final Forecast');
    if (fcstIdx === -1) fcstIdx = header.indexOf('final_forecast');
    if (fcstIdx === -1) fcstIdx = header.indexOf('Forecast');
    var goalIdx = header.indexOf('Goal');
    if (goalIdx === -1) goalIdx = header.indexOf('BTS Goal');
    if (goalIdx === -1) goalIdx = header.indexOf('Total Goal');
    if (nameIdx === -1 || (fcstIdx === -1 && goalIdx === -1)) {
        return { rows: [], error: 'CSV must have "Subject Name" and "Final Forecast" (or legacy "Goal" if Forecast is blank)' };
    }
    var rows = [];
    for (var i = 1; i < lines.length; i++) {
        var cols = parseCsvLine(lines[i]);
        if (cols.length <= nameIdx) continue;
        var subj = String(cols[nameIdx]).trim();
        var val = (fcstIdx >= 0 && cols.length > fcstIdx) ? parseFloat(cols[fcstIdx]) : NaN;
        var gval = (goalIdx >= 0 && cols.length > goalIdx) ? parseFloat(cols[goalIdx]) : NaN;
        var effective = !isNaN(val) ? val : (!isNaN(gval) ? gval : NaN);
        if (subj && !isNaN(effective)) {
            var known = allData.some(function(d) { return d.Subject === subj; });
            rows.push({ subject: subj, forecast: effective, known: known, cleared: false });
        }
    }
    return { rows: rows, error: null };
}

function mergeAdjustmentsWithPreviousFile(uploadRows, previousText) {
    var map = {};
    uploadRows.forEach(function(r) {
        map[r.subject] = { subject: r.subject, forecast: r.forecast, known: r.known, cleared: false };
    });
    var clearedCount = 0;
    if (previousText) {
        var prev = parseAdjustmentsUploadText(previousText);
        if (!prev.error && prev.rows.length) {
            var had = {};
            prev.rows.forEach(function(r) { had[r.subject] = true; });
            Object.keys(had).forEach(function(subj) {
                if (map[subj] === undefined) {
                    map[subj] = {
                        subject: subj,
                        forecast: 0,
                        known: allData.some(function(d) { return d.Subject === subj; }),
                        cleared: true
                    };
                    clearedCount++;
                }
            });
        }
    }
    var merged = Object.keys(map).map(function(k) { return map[k]; });
    merged.sort(function(a, b) { return a.subject.localeCompare(b.subject); });
    return { rows: merged, clearedCount: clearedCount };
}

function runAdjustmentsPipeline(text) {
    var parsed = parseAdjustmentsUploadText(text);
    if (parsed.error) {
        showStatus('adjustments-status', parsed.error, 'error');
        return;
    }
    if (parsed.rows.length === 0) {
        showStatus('adjustments-status', 'No data rows found.', 'error');
        return;
    }
    var month = document.getElementById('adjustments-month').value;
    var path = 'data/adjustments/' + month + '.csv';
    showStatus('adjustments-status', 'Merging with prior ' + month + ' file on GitHub (if any)…', 'info');

    fetchRepoTextFile(path).then(function(prevText) {
        var result = mergeAdjustmentsWithPreviousFile(parsed.rows, prevText);
        finalizeAdjustmentsPreview(result.rows, result.clearedCount, month, prevText !== null);
    }).catch(function() {
        var result = mergeAdjustmentsWithPreviousFile(parsed.rows, null);
        finalizeAdjustmentsPreview(result.rows, result.clearedCount, month, false);
    });
}

function finalizeAdjustmentsPreview(rows, clearedCount, month, hadPriorFile) {
    var csvLines = ['Subject Name,Final Forecast'];
    rows.forEach(function(r) {
        csvLines.push(csvEscapeField(r.subject) + ',' + csvEscapeField(String(r.forecast)));
    });
    pendingAdjustmentsCSV = csvLines.join('\n');
    var preview = document.getElementById('adjustments-preview');
    var tbody = document.getElementById('adjustments-preview-body');
    tbody.innerHTML = '';
    rows.forEach(function(r) {
        var tr = document.createElement('tr');
        var statusHtml;
        if (r.cleared) {
            statusHtml = '<span style="color:#e67e22" title="Was in the repo file for this month but omitted from your upload — set to 0 for this month only">Cleared</span>';
        } else {
            statusHtml = r.known ? '<span style="color:#27ae60">Matched</span>' : '<span style="color:#3498db" title="Not in the current subject list; pipeline adds as a new subject">New</span>';
        }
            tr.innerHTML = '<td>' + escapeHtml(r.subject) + '</td><td>' + r.forecast + '</td><td>' + statusHtml + '</td>';
        tbody.appendChild(tr);
    });
    preview.style.display = 'block';
    document.getElementById('btn-publish-adjustments').disabled = false;
    document.getElementById('btn-download-adjustments').disabled = false;
    var msg = rows.length + ' row(s) ready to commit or download.';
    if (clearedCount > 0) {
        msg += ' ' + clearedCount + ' subject(s) omitted from your file were added as 0 for ' + month + ' (still in repo from before).';
    } else if (!getPAT()) {
        msg += ' Save a GitHub token above to compare with the repo and auto-zero subjects you removed from the list.';
    } else if (!hadPriorFile && clearedCount === 0) {
        msg += ' No prior file for ' + month + ' on the repo — this upload defines the full month.';
    }
    showStatus('adjustments-status', msg, 'info');
}

/* ── Upload: Actuals ── */
document.getElementById('actuals-file').addEventListener('change', function(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
        var text = ev.target.result;
        var lines = text.trim().split('\n');
        if (lines.length < 2) { showStatus('actuals-status', 'File appears empty', 'error'); return; }

        var header = parseCsvLine(lines[0]).map(function(h) { return h.replace(/^"|"$/g, '').trim(); });
        var subjectIdx = header.indexOf('Subject');
        var actualIdx = header.indexOf('Actual_Contracted');
        if (subjectIdx === -1 || actualIdx === -1) {
            showStatus('actuals-status', 'CSV must have Subject and Actual_Contracted columns', 'error');
            return;
        }

        var rows = [];
        var csvLines = ['Subject,Actual_Contracted'];
        for (var i = 1; i < lines.length; i++) {
            var cols = parseCsvLine(lines[i]);
            if (cols.length > Math.max(subjectIdx, actualIdx)) {
                var subj = cols[subjectIdx];
                var val = parseInt(cols[actualIdx], 10);
                if (subj && !isNaN(val)) {
                    var known = allData.some(function(d) { return d.Subject === subj; });
                    rows.push({ subject: subj, actual: val, known: known });
                    csvLines.push(csvEscapeField(subj) + ',' + val);
                }
            }
        }

        pendingActualsCSV = csvLines.join('\n');
        var preview = document.getElementById('actuals-preview');
        var tbody = document.getElementById('actuals-preview-body');
        tbody.innerHTML = '';
        rows.forEach(function(r) {
            var tr = document.createElement('tr');
                tr.innerHTML = '<td>' + escapeHtml(r.subject) + '</td><td>' + r.actual + '</td><td>' + (r.known ? '<span style="color:#27ae60">Matched</span>' : '<span style="color:#e74c3c">Unknown subject</span>') + '</td>';
            tbody.appendChild(tr);
        });
        preview.style.display = 'block';
        document.getElementById('btn-publish-actuals').disabled = false;
        document.getElementById('btn-download-actuals').disabled = false;
        showStatus('actuals-status', rows.length + ' subjects parsed. Review preview below, then commit or download.', 'info');
    };
    reader.readAsText(file);
});

document.getElementById('forecast-file').addEventListener('change', function(e) {
    var file = e.target.files[0];
    if (!file) return;
    pendingForecastFile = file;
    document.getElementById('btn-publish-forecast').disabled = false;
    document.getElementById('btn-download-forecast').disabled = false;
    showStatus('forecast-status', 'File selected: ' + file.name + '. Commit or download to update.', 'info');
});

document.getElementById('runrates-file').addEventListener('change', function(e) {
    var file = e.target.files[0];
    if (!file) return;
    pendingRunRatesFile = file;
    document.getElementById('btn-publish-runrates').disabled = false;
    document.getElementById('btn-download-runrates').disabled = false;
    showStatus('runrates-status', 'File selected: ' + file.name + '. Commit or download to update.', 'info');
});

document.getElementById('utilization-file').addEventListener('change', function(e) {
    var file = e.target.files[0];
    if (!file) return;
    pendingUtilizationFile = file;
    document.getElementById('btn-publish-utilization').disabled = false;
    document.getElementById('btn-download-utilization').disabled = false;
    showStatus('utilization-status', 'File selected: ' + file.name + '. Commit or download to update.', 'info');
});

document.getElementById('adjustments-file').addEventListener('change', function(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
        lastAdjustmentsRawText = ev.target.result;
        runAdjustmentsPipeline(lastAdjustmentsRawText);
    };
    reader.readAsText(file);
});

document.getElementById('adjustments-month').addEventListener('change', function() {
    if (lastAdjustmentsRawText) runAdjustmentsPipeline(lastAdjustmentsRawText);
});

function downloadActualsTemplate() {
    var lines = ['Subject,Actual_Contracted'];
    allData.forEach(function(r) { lines.push(csvEscapeField(r.Subject) + ','); });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    var month = document.getElementById('actuals-month').value;
    a.download = month + '_template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function downloadActualsFile() {
    if (!pendingActualsCSV) return;
    var blob = new Blob([pendingActualsCSV], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = document.getElementById('actuals-month').value + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showStatus('actuals-status', 'File downloaded. Upload it to data/actuals/ in the GitHub repo to trigger the pipeline.', 'success');
}

function downloadForecastFile() {
    if (!pendingForecastFile) return;
    var url = URL.createObjectURL(pendingForecastFile);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'monitoring_table.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showStatus('forecast-status', 'File downloaded. Upload it to data/ in the GitHub repo to trigger the pipeline.', 'success');
}

/* ── GitHub API ── */
function getPAT() {
    return document.getElementById('github-pat').value.trim() || sessionStorage.getItem('bts_github_pat') || '';
}

function savePAT() {
    var pat = document.getElementById('github-pat').value.trim();
    if (pat) {
        sessionStorage.setItem('bts_github_pat', pat);
        showStatus('pat-status', 'Token saved to browser storage.', 'success');
    }
}

function testPAT() {
    var pat = getPAT();
    if (!pat) { showStatus('pat-status', 'Enter a token first.', 'error'); return; }
    fetch('https://api.github.com/repos/' + REPO_OWNER + '/' + REPO_NAME, {
        headers: { 'Authorization': 'token ' + pat }
    }).then(function(r) {
        if (r.ok) showStatus('pat-status', 'Token works! Connected to ' + REPO_OWNER + '/' + REPO_NAME, 'success');
        else showStatus('pat-status', 'Token rejected (HTTP ' + r.status + '). Check permissions.', 'error');
    }).catch(function() { showStatus('pat-status', 'Network error. Check your connection.', 'error'); });
}

function commitFile(path, content, message) {
    var pat = getPAT();
    if (!pat) return Promise.reject('No GitHub token configured. Use the GitHub Connection section below.');
    var apiUrl = 'https://api.github.com/repos/' + REPO_OWNER + '/' + REPO_NAME + '/contents/' + path;
    var headers = { 'Authorization': 'token ' + pat, 'Content-Type': 'application/json' };
    var b64 = btoa(unescape(encodeURIComponent(content)));

    return fetch(apiUrl, { headers: headers })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(existing) {
            var body = { message: message, content: b64, branch: 'main' };
            if (existing && existing.sha) body.sha = existing.sha;
            return fetch(apiUrl, { method: 'PUT', headers: headers, body: JSON.stringify(body) });
        })
        .then(function(r) {
            if (!r.ok) throw new Error('GitHub API error: ' + r.status);
            return r.json();
        });
}

function publishActuals() {
    if (!pendingActualsCSV) return;
    var month = document.getElementById('actuals-month').value;
    var isFinal = document.getElementById('actuals-final').checked;
    var path = 'data/actuals/' + month + '.csv';
    var statusPath = 'data/actuals/status.json';
    document.getElementById('btn-publish-actuals').disabled = true;
    var statusLabel = isFinal ? 'final' : 'in progress';
    showStatus('actuals-status', 'Committing actuals (' + statusLabel + ')...', 'info');

    commitFile(path, pendingActualsCSV, (isFinal ? 'Final' : 'Update') + ' actuals for ' + month)
        .then(function() {
            return updateStatusJson(month, isFinal ? 'final' : 'in_progress');
        })
        .then(function() {
            showStatus('actuals-status', 'Committed ' + month + ' actuals (' + statusLabel + '). Dashboard will update in ~2 minutes.', 'success');
        })
        .catch(function(err) {
            showStatus('actuals-status', 'Error: ' + err + '. Use the Download button and upload manually instead.', 'error');
            document.getElementById('btn-publish-actuals').disabled = false;
        });
}

function updateStatusJson(month, status) {
    var pat = getPAT();
    if (!pat) return Promise.resolve();
    var statusPath = 'data/actuals/status.json';
    var apiUrl = 'https://api.github.com/repos/' + REPO_OWNER + '/' + REPO_NAME + '/contents/' + statusPath;
    var headers = { 'Authorization': 'token ' + pat, 'Content-Type': 'application/json' };

    return fetch(apiUrl, { headers: headers })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(existing) {
            var current = {};
            if (existing && existing.content) {
                try { current = JSON.parse(atob(existing.content.replace(/\n/g, ''))); } catch(e) {}
            }
            current[month] = status;
            var content = btoa(unescape(encodeURIComponent(JSON.stringify(current, null, 2))));
            var body = { message: 'Update status: ' + month + ' → ' + status, content: content, branch: 'main' };
            if (existing && existing.sha) body.sha = existing.sha;
            return fetch(apiUrl, { method: 'PUT', headers: headers, body: JSON.stringify(body) });
        })
        .then(function(r) {
            if (!r.ok) throw new Error('status.json update failed: ' + r.status);
            return r.json();
        });
}

function publishForecast() {
    if (!pendingForecastFile) return;
    document.getElementById('btn-publish-forecast').disabled = true;
    showStatus('forecast-status', 'Reading file...', 'info');
    var reader = new FileReader();
    reader.onload = function(ev) {
        var b64 = btoa(new Uint8Array(ev.target.result).reduce(function(data, byte) { return data + String.fromCharCode(byte); }, ''));
        var pat = getPAT();
        if (!pat) { showStatus('forecast-status', 'No GitHub token configured.', 'error'); document.getElementById('btn-publish-forecast').disabled = false; return; }
        var apiUrl = 'https://api.github.com/repos/' + REPO_OWNER + '/' + REPO_NAME + '/contents/data/monitoring_table.xlsx';
        var headers = { 'Authorization': 'token ' + pat, 'Content-Type': 'application/json' };
        fetch(apiUrl, { headers: headers })
            .then(function(r) { return r.ok ? r.json() : null; })
            .then(function(existing) {
                var body = { message: 'Update forecast - ' + new Date().toISOString().slice(0, 10), content: b64, branch: 'main' };
                if (existing && existing.sha) body.sha = existing.sha;
                return fetch(apiUrl, { method: 'PUT', headers: headers, body: JSON.stringify(body) });
            })
            .then(function(r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                showStatus('forecast-status', 'Forecast committed. Workflow will run and update dashboard in ~2 minutes.', 'success');
            })
            .catch(function(err) {
                showStatus('forecast-status', 'Error: ' + err + '. Use the Download button instead.', 'error');
                document.getElementById('btn-publish-forecast').disabled = false;
            });
    };
    reader.readAsArrayBuffer(pendingForecastFile);
}

function downloadRunRatesFile() {
    if (!pendingRunRatesFile) return;
    var url = URL.createObjectURL(pendingRunRatesFile);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'run_rates.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function publishRunRates() {
    if (!pendingRunRatesFile) return;
    document.getElementById('btn-publish-runrates').disabled = true;
    showStatus('runrates-status', 'Reading file...', 'info');
    var reader = new FileReader();
    reader.onload = function(ev) {
        var content = ev.target.result;
        commitFile('data/run_rates.csv', content, 'Update run rates - ' + new Date().toISOString().slice(0, 10))
            .then(function() {
                showStatus('runrates-status', 'Run rates committed. Dashboard will update in ~2 minutes.', 'success');
            })
            .catch(function(err) {
                showStatus('runrates-status', 'Error: ' + err + '. Use the Download button instead.', 'error');
                document.getElementById('btn-publish-runrates').disabled = false;
            });
    };
    reader.readAsText(pendingRunRatesFile);
}

function downloadUtilizationFile() {
    if (!pendingUtilizationFile) return;
    var url = URL.createObjectURL(pendingUtilizationFile);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'utilization.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function publishUtilization() {
    if (!pendingUtilizationFile) return;
    document.getElementById('btn-publish-utilization').disabled = true;
    showStatus('utilization-status', 'Reading file...', 'info');
    var reader = new FileReader();
    reader.onload = function(ev) {
        var content = ev.target.result;
        commitFile('data/utilization.csv', content, 'Update utilization data - ' + new Date().toISOString().slice(0, 10))
            .then(function() {
                showStatus('utilization-status', 'Utilization data committed. Dashboard will update in ~2 minutes.', 'success');
            })
            .catch(function(err) {
                showStatus('utilization-status', 'Error: ' + err + '. Use the Download button instead.', 'error');
                document.getElementById('btn-publish-utilization').disabled = false;
            });
    };
    reader.readAsText(pendingUtilizationFile);
}

function downloadAdjustmentsFile() {
    if (!pendingAdjustmentsCSV) return;
    var month = document.getElementById('adjustments-month').value;
    var blob = new Blob([pendingAdjustmentsCSV], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = month + '_adjustments.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showStatus('adjustments-status', 'File downloaded. Upload to data/adjustments/ in the GitHub repo as ' + month + '.csv', 'success');
}

function publishAdjustments() {
    if (!pendingAdjustmentsCSV) return;
    var month = document.getElementById('adjustments-month').value;
    document.getElementById('btn-publish-adjustments').disabled = true;
    showStatus('adjustments-status', 'Committing adjustments for ' + month + '...', 'info');
    commitFile('data/adjustments/' + month + '.csv', pendingAdjustmentsCSV, 'Manual adjustments for ' + month + ' - ' + new Date().toISOString().slice(0, 10))
        .then(function() {
            showStatus('adjustments-status', 'Adjustments for ' + month + ' committed. Dashboard will update in ~2 minutes.', 'success');
        })
        .catch(function(err) {
            showStatus('adjustments-status', 'Error: ' + err + '. Use the Download button instead.', 'error');
            document.getElementById('btn-publish-adjustments').disabled = false;
        });
}

function showStatus(id, msg, type) {
    var el = document.getElementById(id);
    el.textContent = msg;
    el.className = 'status-msg ' + type;
}

/* ── Actions Tab ── */

var ACTION_TYPE_LABELS = {
    'investigate_placement': 'Investigate Placement',
    'increase_recruiting': 'Increase Recruiting',
    'reduce_forecast': 'Reduce Forecast',
    'review_performance': 'Review Performance',
    'no_action': 'No Action'
};

var _sharedDecisions = {};

function getDecisionKey(rec) {
    return 'decision_' + rec.subject + '_' + rec.action_type + '_' + (rec.data_points && rec.data_points.month || 'all');
}

function getDecision(rec) {
    var key = getDecisionKey(rec);
    if (_sharedDecisions[key]) return _sharedDecisions[key];
    try {
        var raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
}

function _getAuthToken() {
    if (typeof netlifyIdentity === 'undefined') return Promise.resolve(null);
    var user = netlifyIdentity.currentUser();
    if (!user) return Promise.resolve(null);
    if (typeof user.jwt === 'function') {
        return user.jwt().then(function(token) { return token || null; });
    }
    if (user.token && user.token.access_token) {
        return Promise.resolve(user.token.access_token);
    }
    return Promise.resolve(null);
}

function saveDecision(rec, decision, note, who) {
    var obj = {
        decision: decision,
        note: note || '',
        date: new Date().toISOString(),
        who: who || localStorage.getItem('bts_active_user') || '',
        subject: rec.subject,
        action_type: rec.action_type,
        reason: rec.reason
    };
    var key = getDecisionKey(rec);
    localStorage.setItem(key, JSON.stringify(obj));
    _sharedDecisions[key] = obj;

    _getAuthToken().then(function(token) {
        if (!token) return;
        fetch('/.netlify/functions/decisions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ key: key, decision: obj })
        }).catch(function(e) { console.warn('Failed to sync decision to server:', e); });
    });
}

function removeDecision(rec) {
    var key = getDecisionKey(rec);
    try { localStorage.removeItem(key); } catch (e) {}
    delete _sharedDecisions[key];

    _getAuthToken().then(function(token) {
        if (!token) return;
        fetch('/.netlify/functions/decisions', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ key: key })
        }).catch(function(e) { console.warn('Failed to delete decision on server:', e); });
    });
}

function loadSharedDecisions() {
    _getAuthToken().then(function(token) {
        if (!token) return;
        fetch('/.netlify/functions/decisions', {
            headers: { 'Authorization': 'Bearer ' + token }
        })
        .then(function(r) { return r.ok ? r.json() : {}; })
        .then(function(decisions) {
            _sharedDecisions = decisions || {};
            Object.keys(_sharedDecisions).forEach(function(key) {
                localStorage.setItem(key, JSON.stringify(_sharedDecisions[key]));
            });
            if (typeof renderSubjectsAndActions === 'function') {
                try { renderSubjectsAndActions(); } catch (e) {}
            }
            if (typeof renderDecisionHistory === 'function') {
                try { renderDecisionHistory(); } catch (e) {}
            }
            if (typeof refreshOverviewLive === 'function') {
                try { refreshOverviewLive(); } catch (e) {}
            }
        })
        .catch(function(e) { console.warn('Failed to load shared decisions:', e); });
    });
}


// Decision History tab (replaces the old Actions tab). Renders every saved
// Will Act / Won't Act / Defer as a filterable, sortable table.
var _dh_sort = { col: 0, asc: false }; // Default: date descending (newest first)

function _dh_entries() {
    var entries = [];
    for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && key.indexOf('decision_') === 0) {
            try {
                var d = JSON.parse(localStorage.getItem(key));
                if (d && d.subject) { d._storageKey = key; entries.push(d); }
            } catch (e) {}
        }
    }
    return entries;
}

function renderDecisionHistory() {
    var body = document.getElementById('dh-body');
    if (!body) return; // Decision History tab not in DOM (shouldn't happen, but safe)

    var decisionFilter = document.getElementById('dh-filter-decision');
    var searchEl       = document.getElementById('dh-search');
    var decisionValue  = decisionFilter ? decisionFilter.value : 'all';
    var searchValue    = (searchEl && searchEl.value || '').toLowerCase();

    var all = _dh_entries();

    // Top-of-tab counts (use all, not filtered)
    var willAct = 0, wontAct = 0, defer = 0;
    all.forEach(function(d) {
        if (d.decision === 'Action' || d.decision === 'Will Act') willAct++;
        else if (d.decision === 'No Action' || d.decision === "Won't Act" || d.decision === 'Defer') wontAct++;
    });
    var totalEl = document.getElementById('dh-total');
    if (totalEl) totalEl.textContent = all.length;
    var willEl  = document.getElementById('dh-will-act');   if (willEl)  willEl.textContent  = willAct;
    var wontEl  = document.getElementById('dh-wont-act');   if (wontEl)  wontEl.textContent  = wontAct;
    var deferEl = document.getElementById('dh-defer');      if (deferEl) deferEl.textContent = defer;

    // Tab count badge in nav
    var tabCount = document.getElementById('tab-count-dh');
    if (tabCount) tabCount.textContent = all.length;

    // Apply filters
    var rows = all.filter(function(d) {
        if (decisionValue !== 'all') {
            if (decisionValue === 'Action' && d.decision !== 'Action' && d.decision !== 'Will Act') return false;
            if (decisionValue === 'No Action' && d.decision !== 'No Action' && d.decision !== "Won't Act" && d.decision !== 'Defer') return false;
            if (decisionValue !== 'Action' && decisionValue !== 'No Action' && d.decision !== decisionValue) return false;
        }
        if (searchValue && (d.subject || '').toLowerCase().indexOf(searchValue) === -1) return false;
        return true;
    });

    // Sort
    var col = _dh_sort.col, asc = _dh_sort.asc;
    rows.sort(function(a, b) {
        var av, bv;
        switch (col) {
            case 0: av = a.date || ''; bv = b.date || ''; break;
            case 1: av = a.subject || ''; bv = b.subject || ''; break;
            case 2: av = a.action_type || ''; bv = b.action_type || ''; break;
            case 3: av = a.decision || ''; bv = b.decision || ''; break;
            default: av = a.date || ''; bv = b.date || '';
        }
        if (av < bv) return asc ? -1 : 1;
        if (av > bv) return asc ? 1 : -1;
        return 0;
    });

    if (rows.length === 0) {
        body.innerHTML = '<tr><td colspan="7" class="dh-empty">'
            + (all.length === 0
                ? 'No decisions recorded yet. Use the Subjects &amp; Actions tab to review action items and save Action / No Action decisions.'
                : 'No decisions match the current filters.')
            + '</td></tr>';
        return;
    }

    body.innerHTML = rows.map(function(d) {
        var dateStr = d.date ? new Date(d.date).toLocaleString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
            hour: 'numeric', minute: '2-digit', hour12: true
        }) : '';
        var typeLabel = (ACTION_TYPE_LABELS && ACTION_TYPE_LABELS[d.action_type]) || d.action_type || '—';
        var statusCls = (d.decision === 'Action' || d.decision === 'Will Act') ? 'will-act'
                      : (d.decision === 'No Action' || d.decision === "Won't Act") ? 'no-action'
                      : d.decision === 'Defer' ? 'defer'
                      : 'pending';
        var statusLabel = d.decision === 'Will Act' ? 'Action'
                        : d.decision === "Won't Act" ? 'No Action'
                        : d.decision;
        var keyAttr = d._storageKey.replace(/'/g, '&#39;');
        return '<tr>'
            + '<td>' + dateStr + '</td>'
            + '<td><strong>' + escapeHtml(d.subject) + '</strong></td>'
            + '<td style="color:#7f8c8d;font-size:12px;">' + escapeHtml(typeLabel) + '</td>'
            + '<td><span class="badge-status ' + statusCls + '">' + escapeHtml(statusLabel) + '</span></td>'
            + '<td style="color:#7f8c8d;font-size:12px;">' + escapeHtml(d.who || '—') + '</td>'
            + '<td style="color:#555;font-size:13px;">' + (d.note ? escapeHtml(d.note) : '<span style="color:#bdc3c7;">—</span>') + '</td>'
            + '<td><button class="btn btn-sm btn-outline" onclick="dhRevoke(\'' + keyAttr + '\')">Revoke</button></td>'
        + '</tr>';
    }).join('');
}

function sortDH(colIndex) {
    if (_dh_sort.col === colIndex) _dh_sort.asc = !_dh_sort.asc;
    else { _dh_sort.col = colIndex; _dh_sort.asc = colIndex === 0 ? false : true; } // date defaults to desc, others asc
    renderDecisionHistory();
}

function dhRevoke(storageKey) {
    if (!confirm('Remove this decision from the history? The underlying recommendation will return to pending.')) return;
    try { localStorage.removeItem(storageKey); } catch (e) {}
    renderDecisionHistory();
    if (typeof renderSubjectsAndActions === 'function') {
        try { renderSubjectsAndActions(); } catch (e) {}
    }
    if (typeof refreshOverviewLive === 'function') {
        try { refreshOverviewLive(); } catch (e) {}
    }
}

function generateWeeklySummary() {
    var block = document.getElementById('sa-weekly-summary-output');
    if (!block) return;
    var ws = weeklySummaryData;

    if (!ws || !ws.total_subjects) {
        block.style.display = 'block';
        block.innerHTML = '<div style="padding:20px;color:#7f8c8d;">No summary data available. Run the analysis pipeline first.</div>';
        return;
    }

    // Build WBR-styled HTML. Inline styles on every element so the
    // clipboard-paste path into Google Docs / Gmail / Word preserves
    // the formatting (external CSS does not travel via clipboard).
    var sty = {
        section:   'background:#202344;color:#ffffff;padding:14px 24px;text-align:center;font-size:16px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif;',
        sub:       'background:#596087;color:#ffffff;padding:10px 24px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;margin:0;font-family:Arial,Helvetica,sans-serif;',
        body:      'padding:18px 24px;color:#2c3e50;font-size:14px;line-height:1.65;font-family:Arial,Helvetica,sans-serif;background:#ffffff;',
        meta:      'padding:12px 24px;background:#F9FAFB;border-left:3px solid #202344;font-size:12px;color:#7f8c8d;font-family:Arial,Helvetica,sans-serif;',
        p:         'margin:0 0 12px 0;',
        lead:      'color:#202344;font-weight:700;',
        good:      'color:#27ae60;font-weight:600;',
        watch:     'color:#f39c12;font-weight:600;',
        alert:     'color:#c0392b;font-weight:600;'
    };
    var generated = ws.generated_at || new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    // Compose prose with bold lead-ins, no bullets. Conditional colour
    // on "behind pace" and "on track" aligns with WBR red/yellow/green.
    var progressCls = ws.progress_pct >= 95 ? sty.good : ws.progress_pct >= 85 ? sty.watch : sty.alert;
    var behindCls   = (ws.behind_pace_count || 0) > 5 ? sty.alert : (ws.behind_pace_count || 0) > 0 ? sty.watch : sty.good;

    var behindExamples = '';
    if ((ws.behind_pace_subjects || []).length) {
        var ex = ws.behind_pace_subjects.slice(0, 5).map(function(s) {
            return escapeHtml(s.subject) + ' (' + s.pace + '% of target in ' + s.month + ')';
        }).join(', ');
        behindExamples = ' <span style="color:#7f8c8d;">Examples: ' + ex + '.</span>';
    }

    var gapsBody = '';
    if ((ws.biggest_gaps || []).length) {
        var gapRows = ws.biggest_gaps.map(function(g) {
            return '<p style="' + sty.p + '"><span style="' + sty.lead + '">' + escapeHtml(g.subject) + ':</span> ' + g.remaining + ' tutor-subject combos remaining.</p>';
        }).join('');
        gapsBody = '<div style="' + sty.sub + '">Biggest Gaps</div><div style="' + sty.body + '">' + gapRows + '</div>';
    }

    var html =
        '<div class="wbr-summary-content">'
        + '<div style="' + sty.section + '">BTS Tutor Supply &mdash; Weekly Summary</div>'
        + '<div style="' + sty.meta + '">Generated: ' + escapeHtml(generated) + '</div>'

        + '<div style="' + sty.sub + '">Overview</div>'
        + '<div style="' + sty.body + '">'
            + '<p style="' + sty.p + '"><span style="' + sty.lead + '">Portfolio health:</span> '
            + ws.total_subjects + ' subjects tracked. '
            + ws.on_track + ' on track, '
            + ws.under_used + ' under-used, '
            + ws.over_supplied + ' over-supplied.</p>'
            + '<p style="' + sty.p + '"><span style="' + sty.lead + '">Contracting progress:</span> '
            + ws.total_actual + ' of ' + ws.total_target + ' tutor-subject combos to date '
            + '(<span style="' + progressCls + '">' + ws.progress_pct + '%</span>).</p>'
        + '</div>'

        + '<div style="' + sty.sub + '">Actions</div>'
        + '<div style="' + sty.body + '">'
            + '<p style="' + sty.p + '"><span style="' + sty.lead + '">Open recommendations:</span> '
            + ws.total_actions + ' total &mdash; '
            + ws.high_priority_actions + ' high priority, '
            + ws.medium_priority_actions + ' medium priority.</p>'
            + ((ws.behind_pace_count || 0) > 0
                ? '<p style="' + sty.p + '"><span style="' + sty.lead + '">Behind pace:</span> '
                    + '<span style="' + behindCls + '">' + ws.behind_pace_count + ' subjects</span> behind pace in current month.'
                    + behindExamples + '</p>'
                : '<p style="' + sty.p + '"><span style="' + sty.lead + '">Pace:</span> '
                    + '<span style="' + sty.good + '">All subjects on or ahead of pace</span> in current month.</p>')
        + '</div>'

        + gapsBody
        + '</div>';

    // Toolbar with Copy button (the toolbar is stripped when we copy — only the content HTML is copied)
    block.innerHTML =
        '<div class="wbr-summary-toolbar">'
            + '<button class="btn btn-sm btn-outline" onclick="copyWeeklySummary(\'html\')">Copy (styled)</button>'
            + '<button class="btn btn-sm btn-outline" onclick="copyWeeklySummary(\'text\')">Copy (plain text)</button>'
        + '</div>'
        + html;
    block.dataset.htmlContent = html;
    block.dataset.textContent = weeklySummaryPlainText(ws, generated);
    block.style.display = 'block';

    // Scroll into view for UX continuity
    setTimeout(function() { block.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 50);
}

// Plain-text fallback for clipboard targets that don't support HTML (Slack, etc.)
function weeklySummaryPlainText(ws, generated) {
    var lines = [];
    lines.push('BTS TUTOR SUPPLY \u2014 WEEKLY SUMMARY');
    lines.push('Generated: ' + generated);
    lines.push('');
    lines.push('OVERVIEW');
    lines.push('Portfolio health: ' + ws.total_subjects + ' subjects tracked. ' + ws.on_track + ' on track, ' + ws.under_used + ' under-used, ' + ws.over_supplied + ' over-supplied.');
    lines.push('Contracting progress: ' + ws.total_actual + ' of ' + ws.total_target + ' tutor-subject combos to date (' + ws.progress_pct + '%).');
    lines.push('');
    lines.push('ACTIONS');
    lines.push('Open recommendations: ' + ws.total_actions + ' total \u2014 ' + ws.high_priority_actions + ' high priority, ' + ws.medium_priority_actions + ' medium priority.');
    if ((ws.behind_pace_count || 0) > 0) {
        var ex = (ws.behind_pace_subjects || []).slice(0, 5).map(function(s) {
            return s.subject + ' (' + s.pace + '% of target in ' + s.month + ')';
        }).join(', ');
        lines.push('Behind pace: ' + ws.behind_pace_count + ' subjects behind pace in current month.' + (ex ? ' Examples: ' + ex + '.' : ''));
    } else {
        lines.push('Pace: All subjects on or ahead of pace in current month.');
    }
    if ((ws.biggest_gaps || []).length) {
        lines.push('');
        lines.push('BIGGEST GAPS');
        ws.biggest_gaps.forEach(function(g) {
            lines.push(g.subject + ': ' + g.remaining + ' tutor-subject combos remaining.');
        });
    }
    return lines.join('\n');
}

function copyWeeklySummary(mode) {
    var block = document.getElementById('sa-weekly-summary-output');
    if (!block) return;
    var htmlContent = block.dataset.htmlContent || '';
    var textContent = block.dataset.textContent || '';
    var btns = block.querySelectorAll('.wbr-summary-toolbar .btn');
    var btn = mode === 'text' ? btns[1] : btns[0];

    function feedback(msg) {
        if (!btn) return;
        var orig = btn.textContent;
        btn.textContent = msg;
        setTimeout(function() { btn.textContent = orig; }, 1500);
    }

    if (mode === 'text') {
        navigator.clipboard.writeText(textContent).then(function() { feedback('Copied!'); });
        return;
    }

    // Rich HTML copy: pastes into Docs/Gmail/Word with formatting intact.
    // Fall back to plain text if ClipboardItem isn't supported.
    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        var item = new ClipboardItem({
            'text/html': new Blob([htmlContent], { type: 'text/html' }),
            'text/plain': new Blob([textContent], { type: 'text/plain' })
        });
        navigator.clipboard.write([item])
            .then(function() { feedback('Copied!'); })
            .catch(function() {
                navigator.clipboard.writeText(textContent).then(function() { feedback('Copied (plain)'); });
            });
    } else {
        navigator.clipboard.writeText(textContent).then(function() { feedback('Copied (plain)'); });
    }
}

/* ─────────────────────────────────────────────────────────────
   Subjects & Actions tab (merged view — Pass 1)
   One row per subject, inline row-expansion shows action detail +
   decision buttons. Reuses existing getDecision/saveDecision storage
   so history stays continuous across old Actions tab and this tab.
   ───────────────────────────────────────────────────────────── */

var currentSorts_sa = { col: 6, asc: true }; // Default: Gap ascending (biggest problems first)
var _sa_expanded = {}; // which subjects are expanded
var _sa_pending_note = null; // { subject: string, ridx: number, type: 'action'|'noaction' }

var REC_META = {
    'investigate': { label: 'Investigate', cls: 'investigate' },
    'recruit':     { label: 'Recruit',     cls: 'recruit' },
    'reduce':      { label: 'Reduce Fcst', cls: 'reduce' },
    'review':      { label: 'Review',      cls: 'review' },
    'none':        { label: 'No action',   cls: 'none' }
};

// Map a subject row to its recs from recommendationsData (keyed by Subject)
function saGetRecsForSubject(subject) {
    return recsBySubject[subject] || [];
}

// Compute highest priority and aggregate status for a subject
function saAggregate(row) {
    var recs = saGetRecsForSubject(row.Subject);
    var rec = recommendationFor(row);
    // Priority: take max(high > medium > low) across recs
    var priority = 'none';
    var prioOrder = { 'high': 3, 'medium': 2, 'low': 1 };
    recs.forEach(function(r) {
        if ((prioOrder[r.priority] || 0) > (prioOrder[priority] || 0)) priority = r.priority;
    });
    // Status: if any rec is pending → pending; if all reviewed → take the one-or-any decision
    var statuses = recs.map(function(r) { var d = getDecision(r); return d ? d.decision : 'pending'; });
    var status;
    if (recs.length === 0) status = 'no-action';
    else if (statuses.indexOf('pending') !== -1) status = 'pending';
    else if (statuses.every(function(s) { return s === statuses[0]; })) status = statuses[0];
    else status = 'mixed';
    return { recs: recs, priority: priority, status: status, rec: rec };
}

function saStatusBadge(status) {
    var cls, label;
    switch (status) {
        case 'pending':    cls = 'pending';   label = 'Pending';    break;
        case 'Action':     cls = 'will-act';  label = 'Action';     break;
        case 'No Action':  cls = 'no-action'; label = 'No Action';  break;
        case 'Will Act':   cls = 'will-act';  label = 'Action';     break;
        case "Won't Act":  cls = 'no-action'; label = 'No Action';  break;
        case 'Defer':      cls = 'defer';     label = 'Deferred';   break;
        case 'no-action':  cls = 'no-action'; label = 'No Action';  break;
        default:           cls = 'no-action'; label = status || '—';
    }
    return '<span class="badge-status ' + cls + '">' + label + '</span>';
}

function saPriorityBadge(priority, recs) {
    var p = priority || 'none';
    var label = p === 'none' ? '—' : p.charAt(0).toUpperCase() + p.slice(1);
    var tip;
    switch (p) {
        case 'high':
            tip = 'HIGH priority — needs immediate attention. Big gap vs capacity, CORE/HIGH tier subject, or both.'; break;
        case 'medium':
            tip = 'MEDIUM priority — address this week. Moderate gap, or under-used signal requiring investigation.'; break;
        case 'low':
            tip = 'LOW priority — monitor. Small gap or lower-volume subject; not urgent.'; break;
        case 'none':
        default:
            tip = 'No recommended action for this subject. On track, or no flagged problem.'; break;
    }
    if (recs && recs.length) {
        var types = recs.map(function(r) { return (ACTION_TYPE_LABELS && ACTION_TYPE_LABELS[r.action_type]) || r.action_type; })
                        .filter(Boolean);
        if (types.length) {
            tip += ' ' + recs.length + ' action' + (recs.length === 1 ? '' : 's') + ' on this subject: ' + types.slice(0, 3).join(', ') + '.';
        }
    }
    return '<span class="badge-priority ' + p + '" data-tip="' + escapeHtml(tip) + '">' + label + '</span>';
}

function saRecBadge(rec) {
    var meta = REC_META[rec] || REC_META['none'];
    return '<span class="badge-rec ' + meta.cls + '">' + meta.label + '</span>';
}

function saProblemTypeBadge(type) {
    if (type === 'placement')      return '<span class="badge util">Under-Used</span>';
    if (type === 'true-supply')    return '<span class="badge supply">True Supply</span>';
    if (type === 'no-util-data')   return '<span class="badge nodata">No Util Data</span>';
    if (type === 'over-supplied')  return '<span class="badge lowutil">Over-Supplied</span>';
    if (type === 'on-track')       return '<span class="badge ontrack">On Track</span>';
    if (type === 'on-track-highwait') return '<span class="badge highwait">On Track — High Wait</span>';
    return '<span class="badge">—</span>';
}

// Current in-progress month detection. Uses the real calendar via new Date()
// instead of the pipeline-set `status: 'in_progress'` flag, so the column is
// always correct regardless of pipeline-run freshness. Returns:
//   { state: 'in-bts',  label: 'Apr', month: '2026-04' }     — current month is in BTS range
//   { state: 'pre-bts', firstLabel: 'Apr', firstMonth: '2026-04' }  — today before BTS starts
//   { state: 'post-bts', lastLabel: 'Oct', lastMonth: '2026-10' }   — today after BTS ends
//   null                                                      — no BTS data loaded
function saGetCurrentMonth() {
    if (!btsMonths || !btsMonths.length) return null;

    var now = new Date();
    var currentYm = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    var idx = btsMonths.indexOf(currentYm);

    if (idx >= 0) {
        return { state: 'in-bts', label: btsMonthLabels[idx] || currentYm, month: currentYm };
    }
    if (currentYm < btsMonths[0]) {
        return { state: 'pre-bts', firstMonth: btsMonths[0], firstLabel: btsMonthLabels[0] };
    }
    return { state: 'post-bts', lastMonth: btsMonths[btsMonths.length - 1], lastLabel: btsMonthLabels[btsMonthLabels.length - 1] };
}

// Build an index: subject → current-month data, so per-row lookup is O(1).
// Target uses manual_override if set, else smoothed_target.
//
// KEY: when the pipeline has already fetched actuals for this month,
// null actual = 0 contracted — NOT "data pending." This is confirmed by
// fetch_status showing actuals fetched (sources.actuals === true) within the
// current BTS month. 192 of 382 subjects came back null in April 2026 because
// they had zero contracting rows, not because data is missing.
// If the pipeline hasn't run for this month yet, null stays as null → renders
// as "Awaiting {month} data."
function saBuildCurrentMonthIndex(currentMonth) {
    var idx = {};
    if (!currentMonth || currentMonth.state !== 'in-bts' || !trackerData || !trackerData.length) return idx;

    // Decide whether null actual means 0 or "unknown"
    var actualsLoaded = false;
    if (fetchStatus && fetchStatus.sources && fetchStatus.sources.actuals === true && fetchStatus.fetched_at) {
        var fetchedYm = fetchStatus.fetched_at.slice(0, 7); // "2026-04"
        actualsLoaded = (fetchedYm === currentMonth.month);
    }

    trackerData.forEach(function(ts) {
        var m = (ts.months || []).find(function(x) { return x.month === currentMonth.month; });
        if (!m) { idx[ts.subject] = null; return; }
        var target = (m.manual_override != null) ? m.manual_override : m.smoothed_target;
        var raw = m.actual;
        // If pipeline has confirmed actuals for this month, null → 0
        var actual = (raw == null && actualsLoaded) ? 0 : raw;
        var pace = (target != null && target > 0 && actual != null) ? Math.round((actual / target) * 100) : null;
        var variance = (target != null && actual != null) ? (actual - target) : null;
        idx[ts.subject] = { target: target, actual: actual, pace: pace, variance: variance, actualsLoaded: actualsLoaded };
    });
    return idx;
}

// Render the Current Month cell. States:
//   - Has actual + target:  "9 / 25" + colored variance ("-16 vs target")
//                           Color is PACE-AWARE — accounts for how far into
//                           the month we are, so Day 1 with 0 isn't red.
//   - Zero contracted:      Same as above but with "0 contracted" callout,
//                           always colored red once past day 2.
//   - Target but no actual: "Target 25 / Awaiting Apr data" (italic gray).
//                           True "pipeline hasn't populated" state.
//   - No target (or 0):     "Not in Apr" (subject has BTS footprint but
//                           no target this specific month).
//   - Pre-BTS / Post-BTS:   Column-wide state.
function saRenderCurrentMonthCell(cmd, currentMonth) {
    // Column-wide states override per-cell rendering
    if (!currentMonth) {
        return '<td style="color:#bdc3c7;text-align:center;font-style:italic;font-size:12px;">No BTS data</td>';
    }
    if (currentMonth.state === 'pre-bts') {
        return '<td style="color:#7f8c8d;text-align:center;font-size:12px;">BTS starts ' + currentMonth.firstLabel + '</td>';
    }
    if (currentMonth.state === 'post-bts') {
        return '<td style="color:#7f8c8d;text-align:center;font-size:12px;">BTS closed</td>';
    }

    // No target for this month — subject may be active other months
    // Treating target == 0 the same way because in the model a zero target
    // means "subject skips this month" (vs null which means "missing data").
    if (!cmd || cmd.target == null || cmd.target === 0) {
        return '<td style="color:#95a5a6;text-align:center;font-size:12px;font-style:italic;" data-tip="No target for this subject in ' + currentMonth.label + '. It may have targets in other months.">Not in ' + currentMonth.label + '</td>';
    }

    var target = cmd.target;
    var actual = cmd.actual;

    // After null-as-zero normalization in saBuildCurrentMonthIndex, this branch
    // only fires when the pipeline genuinely has NOT yet fetched actuals for this
    // month (fetched_at is in a prior month). Rare, but handled gracefully.
    if (actual == null) {
        return '<td data-tip="Pipeline has not yet loaded ' + currentMonth.label + ' actuals. Check Upload Data tab.">'
            + '<div style="font-size:12px;color:#7f8c8d;">Target ' + target + '</div>'
            + '<div style="font-size:11px;color:#bdc3c7;font-style:italic;">Awaiting ' + currentMonth.label + ' data</div>'
            + '</td>';
    }

    // We have a number. Compute pace-aware color — don't panic on day 1 if
    // actual is 0 or below target; expect that. But by day 7+, below-pace is
    // a real signal.
    var now = new Date();
    var dayOfMonth = now.getDate();
    var lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    var fractionThroughMonth = dayOfMonth / lastDay;
    var variance = actual - target;

    // Projection-based pace: if we keep contracting at today's daily rate,
    // where do we end up by month-end? Answers "will we make it?" rather
    // than just "are we behind right now?".
    //
    // Examples (target = 50):
    //   Day  7 (23%), actual 25 → projected 107 → likely to make it → green
    //   Day 15 (50%), actual 25 → projected  50 → just on pace       → green
    //   Day 24 (80%), actual 25 → projected  31 → won't make it      → red
    //   Day 28 (93%), actual 45 → projected  48 → close but at risk  → yellow
    var projectedEOM = fractionThroughMonth > 0 ? Math.round(actual / fractionThroughMonth) : actual;
    var projectionRatio = target > 0 ? projectedEOM / target : 1;

    // Thresholds:
    //   ≥ 100% projected  → green  (on pace or ahead)
    //   ≥  85% projected  → yellow (at risk — likely to miss by <15%)
    //   <  85% projected  → red    (off pace — significant miss expected)
    var cls, subLabel;

    if (dayOfMonth <= 2 && actual < target) {
        // Days 1-2: too early for projection to mean much, don't alarm
        cls = '';
        subLabel = variance + ' vs target';
    } else if (actual === 0 && dayOfMonth >= 3) {
        // Zero contracted with time elapsed — always red, zero projected
        cls = 'wbr-status-alert';
        subLabel = '0 projected \u00b7 zero contracted';
    } else if (actual >= target) {
        // Already hit the monthly target
        cls = 'wbr-status-good';
        subLabel = variance === 0 ? 'On target' : '+' + variance + ' ahead of target';
    } else if (projectionRatio >= 1.0) {
        // On pace to hit or beat target
        cls = 'wbr-status-good';
        subLabel = 'On pace \u00b7 ~' + projectedEOM + ' projected';
    } else if (projectionRatio >= 0.85) {
        // At risk — close but current pace falls short
        cls = 'wbr-status-watch';
        subLabel = 'At risk \u00b7 ~' + projectedEOM + ' projected';
    } else {
        // Off pace — meaningful miss expected at current rate
        cls = 'wbr-status-alert';
        subLabel = 'Off pace \u00b7 ~' + projectedEOM + ' projected';
    }

    var tooltip = currentMonth.label + ' \u2014 day ' + dayOfMonth + ' of ' + lastDay + ' (' + Math.round(fractionThroughMonth * 100) + '% through month)\n'
                + 'Target: ' + target + '\n'
                + 'Actual: ' + actual + '\n'
                + 'Daily rate: ' + (fractionThroughMonth > 0 ? (actual / fractionThroughMonth / lastDay).toFixed(1) : '0') + '/day\n'
                + 'Projected by month-end: ~' + projectedEOM + '\n'
                + 'Projection vs target: ' + Math.round(projectionRatio * 100) + '%';

    var isZeroAlert = (actual === 0 && target > 0 && dayOfMonth >= 3);
    var numColor = isZeroAlert ? '#c0392b' : '#1a1a2e';
    return '<td data-tip="' + escapeHtml(tooltip) + '">'
        + '<div style="font-size:13px;font-weight:700;color:' + numColor + ';">' + actual + ' / ' + target + '</div>'
        + '<div class="' + cls + '" style="font-size:11px;' + (cls ? '' : 'color:#5a6c7d;') + '">' + subLabel + '</div>'
        + '</td>';
}

function renderSubjectsAndActions() {
    if (!allData || !allData.length) return;

    // Populate category dropdown (once)
    var catSelect = document.getElementById('sa-filter-category');
    if (catSelect && catSelect.options.length <= 1) {
        var cats = {};
        allData.forEach(function(r) { if (r.Category) cats[r.Category] = true; });
        Object.keys(cats).sort().forEach(function(c) {
            var opt = document.createElement('option');
            opt.value = c; opt.textContent = c;
            catSelect.appendChild(opt);
        });
    }

    // Current-month context (shared across all rows this render)
    var currentMonth = saGetCurrentMonth();
    var cmIdx = saBuildCurrentMonthIndex(currentMonth);
    var cmLabelEl = document.getElementById('sa-current-month-label');
    if (cmLabelEl) {
        var lbl, color;
        if (!currentMonth) { lbl = '(—)'; color = '#bdc3c7'; }
        else if (currentMonth.state === 'in-bts')   { lbl = '(' + currentMonth.label + ')'; color = '#ffffff'; }
        else if (currentMonth.state === 'pre-bts')  { lbl = '(pre-BTS)'; color = '#7f8c8d'; }
        else if (currentMonth.state === 'post-bts') { lbl = '(closed)'; color = '#7f8c8d'; }
        else { lbl = '(—)'; color = '#bdc3c7'; }
        cmLabelEl.textContent = lbl;
        cmLabelEl.style.color = color;
        cmLabelEl.style.fontWeight = '500';
    }

    var typeFilter   = document.getElementById('sa-filter-type').value;
    var recFilter    = document.getElementById('sa-filter-rec').value;
    var prioFilter   = document.getElementById('sa-filter-priority').value;
    var statusFilter = document.getElementById('sa-filter-status').value;
    var tierFilter   = document.getElementById('sa-filter-tier').value;
    var catFilter    = document.getElementById('sa-filter-category').value;
    var searchTerm   = (document.getElementById('sa-search').value || '').toLowerCase();
    var gapFilter    = parseInt(document.getElementById('sa-filter-gap').value, 10) || 0;

    // Build augmented rows (subject + aggregate info)
    var rows = allData.map(function(row) {
        var agg = saAggregate(row);
        return {
            row: row,
            recs: agg.recs,
            priority: agg.priority,
            status: agg.status,
            rec: agg.rec,
            _type: classifyType(row.Problem_Type)
        };
    });

    // Apply filters
    rows = rows.filter(function(x) {
        var r = x.row;
        if (!matchesFilter(r.Problem_Type, typeFilter)) return false;
        if (recFilter !== 'all' && x.rec !== recFilter) return false;
        if (prioFilter !== 'all' && x.priority !== prioFilter) return false;
        if (statusFilter !== 'all') {
            if (statusFilter === 'Action' && x.status !== 'Action' && x.status !== 'Will Act') return false;
            else if (statusFilter === 'No Action' && x.status !== 'No Action' && x.status !== "Won't Act" && x.status !== 'Defer') return false;
            else if (statusFilter !== 'Action' && statusFilter !== 'No Action' && x.status !== statusFilter) return false;
        }
        if (tierFilter === 'hide-niche' && r.Tier === 'NICHE') return false;
        else if (tierFilter !== 'all' && tierFilter !== 'hide-niche' && r.Tier !== tierFilter) return false;
        if (catFilter !== 'all' && r.Category !== catFilter) return false;
        if (searchTerm && r.Subject.toLowerCase().indexOf(searchTerm) === -1) return false;
        if (gapFilter > 0 && Math.abs(r.Raw_Gap || 0) < gapFilter) return false;
        return true;
    });

    // Sort
    var col = currentSorts_sa.col, asc = currentSorts_sa.asc;
    var PRIO_ORDER = { 'high': 3, 'medium': 2, 'low': 1, 'none': 0 };
    var STATUS_ORDER = {
        'pending': 1,
        'Action': 2, 'Will Act': 2,
        'No Action': 3, "Won't Act": 3,
        'Defer': 4,
        'mixed': 5,
        'no-action': 6
    };
    rows.sort(function(a, b) {
        var av, bv;
        switch (col) {
            case 0: av = a.row.Subject; bv = b.row.Subject; break;
            case 1: av = TIER_ORDER[a.row.Tier] || 99; bv = TIER_ORDER[b.row.Tier] || 99; break;
            case 2: av = PRIO_ORDER[a.priority] || 0; bv = PRIO_ORDER[b.priority] || 0; break;
            case 3: av = a.row.Run_Rate; bv = b.row.Run_Rate; break;
            case 4: av = a.row.Smoothed_Target; bv = b.row.Smoothed_Target; break;
            case 5: av = a.row.Util_Rate; bv = b.row.Util_Rate; break;
            case 6: av = a.row.Raw_Gap; bv = b.row.Raw_Gap; break;
            case 7: // Current month: sort by variance, most-behind first when asc (counter-intuitive but useful)
                var acm = cmIdx[a.row.Subject], bcm = cmIdx[b.row.Subject];
                av = (acm && acm.variance != null) ? acm.variance : null;
                bv = (bcm && bcm.variance != null) ? bcm.variance : null;
                break;
            case 8: av = a.row.Problem_Type; bv = b.row.Problem_Type; break;
            case 9: av = a.rec; bv = b.rec; break;
            case 10: av = STATUS_ORDER[a.status] || 99; bv = STATUS_ORDER[b.status] || 99; break;
            default: av = a.row.Subject; bv = b.row.Subject;
        }
        var aNull = av === null || av === undefined;
        var bNull = bv === null || bv === undefined;
        if (aNull && bNull) return 0;
        if (aNull) return 1;
        if (bNull) return -1;
        if (av < bv) return asc ? -1 : 1;
        if (av > bv) return asc ? 1 : -1;
        return 0;
    });

    // Top-bar summary counts
    var totalSubjects = allData.length;
    var totalActions = recommendationsData.length;
    var pendingCount = 0, reviewedCount = 0;
    recommendationsData.forEach(function(r) {
        if (getDecision(r)) reviewedCount++; else pendingCount++;
    });
    document.getElementById('sa-stat-total').textContent = totalSubjects;
    document.getElementById('sa-stat-actions').textContent = totalActions;
    document.getElementById('sa-stat-pending').textContent = pendingCount;
    document.getElementById('sa-stat-reviewed').textContent = reviewedCount;
    document.getElementById('sa-row-count').textContent = 'Showing ' + rows.length + ' of ' + totalSubjects + ' subjects';

    // Render table body
    var tbody = document.getElementById('sa-body');
    tbody.innerHTML = '';
    rows.forEach(function(x, idx) {
        var r = x.row;
        var type = classifyType(r.Problem_Type);
        var isExpanded = _sa_expanded[r.Subject];
        var actionCount = x.recs.length;
        var expandIndicator = actionCount > 0
            ? '<span class="sa-expand-toggle">\u25B6</span>'
            : '<span class="sa-expand-toggle" style="opacity:0.3">\u00B7</span>';

        var utilText = (r.Util_Rate != null) ? Math.round(r.Util_Rate) + '%' : '—';
        var gapClass = (r.Gap_Pct || 0) > 200 ? 'gap-critical'
                     : (r.Gap_Pct || 0) > 100 ? 'gap-high'
                     : (r.Gap_Pct || 0) > 50  ? 'gap-medium' : 'gap-low';

        var tr = document.createElement('tr');
        tr.className = 'sa-row' + (isExpanded ? ' expanded' : '');
        tr.onclick = function(e) {
            // Ignore clicks on buttons/links inside the row
            if (e.target.closest('button, a, select, input')) return;
            toggleSARow(r.Subject);
        };
        tr.innerHTML =
              '<td>' + expandIndicator + '</td>'
            + '<td><strong>' + escapeHtml(r.Subject) + '</strong>'
                + (actionCount > 1 ? ' <small style="color:#7f8c8d;">(' + actionCount + ' actions)</small>' : '')
            + '</td>'
            + '<td>' + renderTierBadge(r.Tier, r.BTS_Total) + '</td>'
            + '<td>' + saPriorityBadge(x.priority, x.recs) + '</td>'
            + '<td>' + (r.Run_Rate != null ? r.Run_Rate : '—') + '</td>'
            + '<td>' + (r.Smoothed_Target != null ? r.Smoothed_Target : '—') + '</td>'
            + '<td>' + utilText + '</td>'
            + '<td class="' + gapClass + '">' + (r.Raw_Gap != null ? r.Raw_Gap : '—') + '</td>'
            + saRenderCurrentMonthCell(cmIdx[r.Subject], currentMonth)
            + '<td>' + saProblemTypeBadge(type) + '</td>'
            + '<td>' + saRecBadge(x.rec) + '</td>'
            + '<td>' + saStatusBadge(x.status) + '</td>';
        tbody.appendChild(tr);

        if (isExpanded && actionCount > 0) {
            var detailTr = document.createElement('tr');
            detailTr.className = 'sa-detail-row';
            var inner = '<div class="sa-detail-inner">';
            x.recs.forEach(function(rec, ridx) {
                var decision = getDecision(rec);
                var cardCls = 'sa-action-card' + (decision ? ' reviewed' : '');
                var priorityBadge = '<span class="badge-priority ' + (rec.priority || 'low') + '">' + (rec.priority || 'low') + '</span>';
                var typeLabel = (ACTION_TYPE_LABELS && ACTION_TYPE_LABELS[rec.action_type]) || rec.action_type || '';

                var dataHtml = '';
                if (rec.data_points) {
                    var pts = [];
                    if (rec.data_points.util_rate != null) pts.push('Util: ' + Math.round(rec.data_points.util_rate) + '%');
                    if (rec.data_points.gap != null) pts.push('Gap: ' + rec.data_points.gap);
                    if (rec.data_points.run_rate != null) pts.push('Run Rate: ' + rec.data_points.run_rate);
                    if (rec.data_points.pace != null) pts.push('Pace: ' + rec.data_points.pace + '%');
                    if (rec.data_points.actual != null) pts.push('Actual: ' + rec.data_points.actual);
                    if (rec.data_points.target != null) pts.push('Target: ' + rec.data_points.target);
                    if (pts.length) dataHtml = '<div class="sa-action-data">' + pts.join(' \u2022 ') + '</div>';
                }

                var footer;
                if (decision) {
                    var decisionCls = decision.decision === 'Action' ? 'will-act' : 'no-action';
                    var decisionLabel = decision.decision === 'Action' ? '\u2713 Action taken' : '\u2715 No action';
                    var whoInfo = decision.who ? ' <small style="color:#888;font-size:11px;">by ' + escapeHtml(decision.who) + '</small>' : '';
                    footer = '<div class="sa-action-footer">'
                        + '<span class="badge-status ' + decisionCls + '">' + decisionLabel + '</span>'
                        + whoInfo
                        + (decision.note ? ' <small style="color:#555;font-style:italic;">\u2014 ' + escapeHtml(decision.note) + '</small>' : '')
                        + ' <button class="btn btn-sm btn-outline" onclick="saReopenDecision(\'' + escapeHtml(r.Subject).replace(/'/g, "\\'") + '\',' + ridx + ')">Change</button>'
                        + '</div>';
                } else if (_sa_pending_note && _sa_pending_note.subject === r.Subject && _sa_pending_note.ridx === ridx) {
                    var safeSubj = escapeHtml(r.Subject).replace(/'/g, "\\'");
                    var loggedInUser = localStorage.getItem('bts_active_user') || 'Unknown';
                    var whoDisplay = '<div class="sa-note-who-row" style="margin-bottom:8px;">'
                        + '<span style="color:#555; font-size:13px;">Logged in as: <strong>' + escapeHtml(loggedInUser) + '</strong></span>'
                        + '</div>';
                    var isNoAction = _sa_pending_note.type === 'noaction';
                    if (isNoAction) {
                        footer = '<div class="sa-note-form">'
                            + whoDisplay
                            + '<label class="sa-note-label">Reason for no action</label>'
                            + '<select id="sa-noaction-reason" class="sa-note-who" style="margin-bottom:8px;">'
                                + '<option value="">Select a reason (optional)...</option>'
                                + '<option value="Not enough budget">Not enough budget</option>'
                                + '<option value="Low priority right now">Low priority right now</option>'
                                + '<option value="Already being handled">Already being handled</option>'
                                + '<option value="Expecting natural resolution">Expecting natural resolution</option>'
                                + '<option value="Need more data">Need more data</option>'
                                + '<option value="Other">Other</option>'
                            + '</select>'
                            + '<label class="sa-note-label">Additional notes</label>'
                            + '<textarea id="sa-note-textarea" class="sa-note-textarea" placeholder="Optional — add context for your team..."></textarea>'
                            + '<div id="sa-note-error" class="sa-note-error" style="display:none;"></div>'
                            + '<div class="sa-note-buttons">'
                                + '<button class="btn btn-primary btn-sm" onclick="saSubmitNoAction(\'' + safeSubj + '\',' + ridx + ')">Submit</button>'
                                + '<button class="btn btn-outline btn-sm" onclick="saCancelNote()">Cancel</button>'
                            + '</div>'
                            + '</div>';
                    } else {
                        footer = '<div class="sa-note-form">'
                            + whoDisplay
                            + '<label class="sa-note-label">What action are you taking? <span style="color:#c0392b;">*</span></label>'
                            + '<textarea id="sa-note-textarea" class="sa-note-textarea" placeholder="e.g. LinkedIn campaign with Cindy, InMail push this week, escalating to Kevin..."></textarea>'
                            + '<div id="sa-note-error" class="sa-note-error" style="display:none;"></div>'
                            + '<div class="sa-note-buttons">'
                                + '<button class="btn btn-primary btn-sm" onclick="saSubmitNote(\'' + safeSubj + '\',' + ridx + ')">Submit</button>'
                                + '<button class="btn btn-outline btn-sm" onclick="saCancelNote()">Cancel</button>'
                            + '</div>'
                            + '</div>';
                    }
                } else {
                    var safeSubj = escapeHtml(r.Subject).replace(/'/g, "\\'");
                    footer = '<div class="sa-action-footer">'
                        + '<button class="btn btn-sm btn-primary" onclick="saShowNoteForm(\'' + safeSubj + '\',' + ridx + ',\'action\')">Action</button>'
                        + '<button class="btn btn-sm btn-outline" onclick="saSetNoAction(\'' + safeSubj + '\',' + ridx + ')">No Action</button>'
                        + '</div>';
                }

                inner += '<div class="' + cardCls + '">'
                    + '<div class="sa-action-header">' + priorityBadge
                    + '<span style="color:#7f8c8d;font-size:12px;">' + escapeHtml(typeLabel) + '</span></div>'
                    + '<div class="sa-action-reason">' + escapeHtml(rec.reason || '') + '</div>'
                    + dataHtml + footer + '</div>';
            });
            inner += '</div>';
            detailTr.innerHTML = '<td colspan="12">' + inner + '</td>';
            tbody.appendChild(detailTr);
        }
    });
}

function sortSA(colIndex) {
    if (currentSorts_sa.col === colIndex) currentSorts_sa.asc = !currentSorts_sa.asc;
    else { currentSorts_sa.col = colIndex; currentSorts_sa.asc = true; }
    renderSubjectsAndActions();
}

function toggleSARow(subject) {
    _sa_expanded[subject] = !_sa_expanded[subject];
    renderSubjectsAndActions();
}

function saSetDecision(subject, ridx, decision) {
    _sa_pending_note = null;
    var recs = saGetRecsForSubject(subject);
    var rec = recs[ridx];
    if (!rec) return;
    saveDecision(rec, decision, '');
    renderSubjectsAndActions();
    if (typeof renderDecisionHistory === 'function') {
        try { renderDecisionHistory(); } catch (e) {}
    }
    if (typeof refreshOverviewLive === 'function') {
        try { refreshOverviewLive(); } catch (e) {}
    }
}

function saReopenDecision(subject, ridx) {
    var recs = saGetRecsForSubject(subject);
    var rec = recs[ridx];
    if (!rec) return;
    removeDecision(rec);
    renderSubjectsAndActions();
    if (typeof renderDecisionHistory === 'function') {
        try { renderDecisionHistory(); } catch (e) {}
    }
    if (typeof refreshOverviewLive === 'function') {
        try { refreshOverviewLive(); } catch (e) {}
    }
}

function saShowNoteForm(subject, ridx, type) {
    _sa_pending_note = { subject: subject, ridx: ridx, type: type || 'action' };
    renderSubjectsAndActions();
    setTimeout(function() {
        var ta = document.getElementById('sa-note-textarea');
        if (ta) ta.focus();
    }, 50);
}

function saSubmitNote(subject, ridx) {
    var ta    = document.getElementById('sa-note-textarea');
    var who   = localStorage.getItem('bts_active_user') || 'Unknown';
    var note  = ta    ? ta.value.trim()    : '';
    var errEl = document.getElementById('sa-note-error');
    if (!note) {
        if (errEl) { errEl.textContent = 'Please describe the action being taken before submitting.'; errEl.style.display = 'block'; }
        if (ta) ta.focus();
        return;
    }
    _sa_pending_note = null;
    var recs = saGetRecsForSubject(subject);
    var rec = recs[ridx];
    if (!rec) return;
    saveDecision(rec, 'Action', note, who);
    renderSubjectsAndActions();
    if (typeof renderDecisionHistory === 'function') {
        try { renderDecisionHistory(); } catch (e) {}
    }
    if (typeof refreshOverviewLive === 'function') {
        try { refreshOverviewLive(); } catch (e) {}
    }
}

function saCancelNote() {
    _sa_pending_note = null;
    renderSubjectsAndActions();
}

function saSetNoAction(subject, ridx) {
    saShowNoteForm(subject, ridx, 'noaction');
}

function saSubmitNoAction(subject, ridx) {
    var reasonEl = document.getElementById('sa-noaction-reason');
    var ta    = document.getElementById('sa-note-textarea');
    var who   = localStorage.getItem('bts_active_user') || 'Unknown';
    var reason = reasonEl ? reasonEl.value.trim() : '';
    var note  = ta ? ta.value.trim() : '';
    var fullNote = reason && note ? reason + ' — ' + note
                 : reason ? reason
                 : note ? note : '';
    _sa_pending_note = null;
    var recs = saGetRecsForSubject(subject);
    var rec = recs[ridx];
    if (!rec) return;
    saveDecision(rec, 'No Action', fullNote, who);
    renderSubjectsAndActions();
    if (typeof renderDecisionHistory === 'function') {
        try { renderDecisionHistory(); } catch (e) {}
    }
    if (typeof refreshOverviewLive === 'function') {
        try { refreshOverviewLive(); } catch (e) {}
    }
}

function openSubjectsActionsWeeklySummary() {
    generateWeeklySummary();
}

/* ── Event listeners ── */
document.getElementById('tracker-filter').addEventListener('change', renderMonthlyTracker);
document.getElementById('tracker-search').addEventListener('input', debounce(renderMonthlyTracker, 200));
document.getElementById('filter-category-tracker').addEventListener('change', renderMonthlyTracker);

/* ── Subjects & Actions tab filters ── */
['sa-filter-type','sa-filter-rec','sa-filter-priority','sa-filter-status',
 'sa-filter-tier','sa-filter-category','sa-filter-gap'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('change', renderSubjectsAndActions);
});
var _saSearch = document.getElementById('sa-search');
if (_saSearch) _saSearch.addEventListener('input', debounce(renderSubjectsAndActions, 200));

/* ── Decision History tab filters ── */
var _dhFilterDecision = document.getElementById('dh-filter-decision');
if (_dhFilterDecision) _dhFilterDecision.addEventListener('change', renderDecisionHistory);
var _dhSearch = document.getElementById('dh-search');
if (_dhSearch) _dhSearch.addEventListener('input', debounce(renderDecisionHistory, 200));

/* ── Fast JS tooltip — triggered by any element with data-tip attribute ── */
(function() {
    var tip = document.getElementById('dash-tooltip');
    if (!tip) return;

    document.addEventListener('mouseover', function(e) {
        var el = e.target.closest('[data-tip]');
        if (!el) { tip.style.display = 'none'; return; }
        var text = el.getAttribute('data-tip');
        if (!text) { tip.style.display = 'none'; return; }
        tip.innerHTML = text;
        tip.style.display = 'block';
        positionTip(e);
    });

    document.addEventListener('mousemove', function(e) {
        if (tip.style.display === 'block') positionTip(e);
    });

    document.addEventListener('mouseout', function(e) {
        var el = e.target.closest('[data-tip]');
        if (el && !el.contains(e.relatedTarget)) {
            tip.style.display = 'none';
        }
    });

    function positionTip(e) {
        var x = e.clientX + 14;
        var y = e.clientY + 14;
        // Prevent clipping at right/bottom edges
        var w = tip.offsetWidth || 220;
        var h = tip.offsetHeight || 60;
        if (x + w > window.innerWidth  - 8) x = e.clientX - w - 8;
        if (y + h > window.innerHeight - 8) y = e.clientY - h - 8;
        tip.style.left = x + 'px';
        tip.style.top  = y + 'px';
    }
})();

/* ── Keyboard navigation for tabs ── */
document.getElementById('main-tabs').addEventListener('keydown', function(e) {
    var tabs = Array.from(this.querySelectorAll('.tab'));
    var idx = tabs.indexOf(document.activeElement);
    if (idx === -1) return;
    var next = -1;
    if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length;
    if (next !== -1) {
        e.preventDefault();
        tabs[next].focus();
        tabs[next].click();
    }
});

document.querySelectorAll('.tooltip-wrap').forEach(function(el) {
    var tip = el.querySelector('.tooltip-text');
    if (!tip) return;
    el.addEventListener('mouseenter', function(e) {
        var rect = el.getBoundingClientRect();
        tip.style.top = (rect.top - tip.offsetHeight - 8) + 'px';
        var left = rect.left + rect.width / 2 - 140;
        if (left < 8) left = 8;
        if (left + 280 > window.innerWidth - 8) left = window.innerWidth - 288;
        tip.style.left = left + 'px';
    });
});
