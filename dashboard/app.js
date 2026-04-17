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
var weeklySummaryData = {};
var pendingActualsCSV = null;
var pendingForecastFile = null;
var pendingRunRatesFile = null;
var pendingUtilizationFile = null;
var pendingAdjustmentsCSV = null;
var lastAdjustmentsRawText = null;
var REPO_OWNER = 'leighrobbins-hub';
var REPO_NAME = 'bts-forecast-dashboard';

var currentSorts = {
    all: { col: 4, asc: false },
    problems: { col: 4, asc: false }
};
var trackerSort = { key: 'subject', asc: true };

var PROBLEM_TIPS = {
    'placement': 'Demand exceeds supply, but less than half of contracted tutors are being utilized. Investigate placement algorithm, geographic mismatch, or scheduling before recruiting more.',
    'over-supplied': 'Supply meets or exceeds demand, but utilization is below 50%. Consider reducing forecast for this subject — we may be over-forecasting.',
    'true-supply': 'Genuine supply shortage — existing tutors are well-utilized but we need more. Deploy recruiting levers.',
    'no-util-data': 'Supply gap detected but no utilization data available to classify root cause.',
    'on-track': 'Supply meets demand and utilization is healthy. No action needed.'
};

function classifyType(problemType) {
    if (!problemType) return 'on-track';
    var pt = problemType.toLowerCase();
    if (pt.includes('placement bottleneck')) return 'placement';
    if (pt.includes('possible placement')) return 'placement';
    if (pt.includes('over-supplied')) return 'over-supplied';
    if (pt.includes('true supply')) return 'true-supply';
    if (pt.includes('no util data')) return 'no-util-data';
    if (pt.includes('low util')) return 'over-supplied';
    return 'on-track';
}

function isSupplyRelated(problemType) {
    if (!problemType) return false;
    return problemType.includes('True Supply') || problemType.includes('No Util Data');
}

function buildUtilDisplay(row) {
    if (row.Util_Rate === null || row.Util_Rate === undefined) return 'N/A';
    var html = Math.round(row.Util_Rate) + '%';
    if (row.Util_Trend && row.Util_Trend_Delta != null) {
        var arrow = row.Util_Trend === 'up' ? '↑' : row.Util_Trend === 'down' ? '↓' : '→';
        var color = row.Util_Trend === 'up' ? '#27ae60' : row.Util_Trend === 'down' ? '#e74c3c' : '#7f8c8d';
        var delta = row.Util_Trend_Delta > 0 ? '+' + row.Util_Trend_Delta : '' + row.Util_Trend_Delta;
        html += ' <span style="color:' + color + ';font-weight:600" title="' + delta + '% vs trailing avg">' + arrow + '</span>';
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
        weeklySummaryData = data.weekly_summary || {};
        updateSummary(summaryData);
        updateTabCounts();
        populateCategoryDropdowns();
        renderCriticalFindings();
        renderAllTables();
        renderMonthlyTracker();
        renderMarchBaseline(summaryData);
        renderProgressBar(summaryData);
        renderHistoryTab();
        renderRecommendations();
        lockFinalizedMonths();
        showFetchStatusBanner(data.fetch_status);
        populateLookerSyncBanner(data.fetch_status);
        initTrackerKey();
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
function updateSummary(summary) {
    var clientTotal = allData.length;
    var clientPlacement = allData.filter(function(r) { return classifyType(r.Problem_Type) === 'placement'; }).length;
    var clientSupply = allData.filter(function(r) { return classifyType(r.Problem_Type) === 'true-supply'; }).length;
    var clientNoUtil = allData.filter(function(r) { return classifyType(r.Problem_Type) === 'no-util-data'; }).length;
    var clientOnTrack = allData.filter(function(r) { var t = classifyType(r.Problem_Type); return t === 'on-track'; }).length;
    var overSuppliedCount = allData.filter(function(r) { return classifyType(r.Problem_Type) === 'over-supplied'; }).length;

    document.getElementById('total-subjects').textContent = clientTotal;
    document.getElementById('util-problems').textContent = clientPlacement;
    document.getElementById('stat-supply-problems').textContent = clientSupply + clientNoUtil;
    document.getElementById('ontrack-subjects').textContent = clientOnTrack;
    document.getElementById('lowutil-subjects').textContent = overSuppliedCount;
    document.getElementById('lowutil-count-callout').textContent = overSuppliedCount;

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

    var discrepancies = [];
    if (clientTotal !== (summary.total_subjects || 0)) discrepancies.push('Total: card=' + clientTotal + ' vs data=' + summary.total_subjects);
    if (clientPlacement !== (summary.placement_bottlenecks || 0)) discrepancies.push('Placement bottlenecks: card=' + clientPlacement + ' vs data=' + summary.placement_bottlenecks);
    var serverSupply = (summary.supply_problems || 0);
    if ((clientSupply + clientNoUtil) !== serverSupply) discrepancies.push('Supply: card=' + (clientSupply + clientNoUtil) + ' vs data=' + serverSupply);
    if (discrepancies.length > 0) {
        console.warn('Reconciliation differences (expected from reclassification):', discrepancies);
    }

    var topOverSupplied = allData
        .filter(function(r) { return classifyType(r.Problem_Type) === 'over-supplied'; })
        .sort(function(a, b) { return (b.Run_Rate || 0) - (a.Run_Rate || 0); })
        .slice(0, 5)
        .map(function(r) { return r.Subject + ' (' + (r.Util_Rate || 0) + '% util, run rate ' + r.Run_Rate + '/mo)'; });
    document.getElementById('lowutil-examples').textContent = topOverSupplied.join('; ');
}

function updateTabCounts() {
    document.getElementById('tab-count-all').textContent = allData.length;
    var problemCount = allData.filter(function(r) {
        var t = classifyType(r.Problem_Type);
        return t === 'placement' || t === 'true-supply' || t === 'no-util-data';
    }).length;
    document.getElementById('tab-count-problems').textContent = problemCount;
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
    var flagged = allData.filter(function(r) {
        var t = classifyType(r.Problem_Type);
        return t === 'placement' || t === 'true-supply' || t === 'no-util-data';
    });
    var placementCount = allData.filter(function(r) { return classifyType(r.Problem_Type) === 'placement'; }).length;
    var supplyCount = allData.filter(function(r) { return classifyType(r.Problem_Type) === 'true-supply'; }).length;
    var noUtilCount = allData.filter(function(r) { return classifyType(r.Problem_Type) === 'no-util-data'; }).length;
    var placementPct = flagged.length > 0 ? Math.round(placementCount / flagged.length * 100) : 0;
    var trueSupplyTotal = supplyCount + noUtilCount;

    var topSupply = allData
        .filter(function(r) { return classifyType(r.Problem_Type) === 'true-supply'; })
        .sort(function(a, b) { return (a.Raw_Gap || 0) - (b.Raw_Gap || 0); })
        .slice(0, 2);
    var topExamples = topSupply.map(function(r) {
        var covPct = r.Coverage_Pct !== null && r.Coverage_Pct !== undefined ? r.Coverage_Pct : 0;
        return escapeHtml(r.Subject) + ' (' + Math.abs(Math.round(r.Gap_Pct || 0)) + '% gap)';
    }).join(', ');

    var findings = [
        {
            finding: placementPct + '% of flagged subjects are placement bottlenecks',
            impact: placementCount + ' subjects have demand but contracted tutors aren\'t being matched — investigate placement algorithm, geography, or scheduling',
            action: 'Fix matching for these subjects before recruiting more tutors.'
        },
        {
            finding: 'Only ' + trueSupplyTotal + ' subjects are true supply shortages',
            impact: topExamples ? topExamples + ' have good utilization but insufficient organic pipeline' : 'These subjects have confirmed supply gaps',
            action: 'Deploy external recruitment levers for these ' + trueSupplyTotal + ' only (paid spend, InMail, opt-in)'
        }
    ];

    var tbody = document.getElementById('critical-findings-body');
    tbody.innerHTML = '';
    findings.forEach(function(f) {
        var tr = document.createElement('tr');
        tr.innerHTML = '<td><strong>' + f.finding + '</strong></td><td>' + f.impact + '</td><td>' + f.action + '</td>';
        tbody.appendChild(tr);
    });
}

function showTab(tabName, el) {
    document.querySelectorAll('.tab-content').forEach(function(tc) { tc.classList.remove('active'); });
    document.querySelectorAll('.tab').forEach(function(t) {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
    });
    document.getElementById(tabName).classList.add('active');
    el.classList.add('active');
    el.setAttribute('aria-selected', 'true');
}

/* ── Original table renderers ── */
function renderAllTables() {
    renderBarChart();
    renderPriorityTable();
    renderAllSubjects();
    renderProblemSubjects();
}

function renderBarChart() {
    var problems = allData
        .filter(function(r) { return r.Problem_Type && r.Problem_Type.includes('Problem') && r.Raw_Gap != null && r.Raw_Gap < 0; })
        .sort(function(a, b) { return a.Raw_Gap - b.Raw_Gap; })
        .slice(0, 12);
    var maxGap = problems.length > 0 ? Math.abs(problems[0].Raw_Gap) : 100;
    var container = document.getElementById('gap-chart');
    container.innerHTML = '';
    problems.forEach(function(row) {
        var absGap = Math.abs(row.Raw_Gap);
        var pct = Math.min(100, (absGap / maxGap) * 100);
        var type = classifyType(row.Problem_Type);
        var barClass = type === 'placement' ? 'util-bar' : type === 'no-util-data' ? 'nodata-bar' : 'supply-bar';
        var covPct = row.Coverage_Pct != null ? row.Coverage_Pct : 0;
        var div = document.createElement('div');
        div.className = 'bar-row';
        div.innerHTML = '<div class="bar-label" title="' + escapeHtml(row.Subject) + '">' + escapeHtml(row.Subject) + '</div>' +
                '<div class="bar-track"><div class="bar-fill ' + barClass + '" style="width: ' + pct + '%"></div></div>' +
                '<div class="bar-value">' + row.Raw_Gap + ' gap <span class="bar-coverage">(' + covPct + '%)</span></div>';
        container.appendChild(div);
    });
}

function renderPriorityTable() {
    var priority = allData.filter(function(r) {
        var t = classifyType(r.Problem_Type);
        return t === 'true-supply' || t === 'placement' || t === 'no-util-data';
    }).sort(function(a, b) { return (a.Raw_Gap || 0) - (b.Raw_Gap || 0); }).slice(0, 15);
    var tbody = document.getElementById('priority-body');
    tbody.innerHTML = '';
    document.getElementById('priority-count').textContent = 'Showing top ' + priority.length + ' problem subjects';
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
        if (type === 'placement') { action = 'Fix matching before recruiting — tutors contracted but not placed'; badgeClass = 'util'; badgeText = 'Placement Bottleneck'; }
        else if (type === 'no-util-data') { action = 'Gather utilization data'; badgeClass = 'nodata'; badgeText = 'No Util Data'; }
        else if (covPct < 50) { action = 'CRITICAL: External levers now'; badgeClass = 'supply'; badgeText = 'Supply'; }
        else { action = 'Targeted campaigns'; badgeClass = 'supply'; badgeText = 'Supply'; }
        var rawGap = row.Raw_Gap !== null && row.Raw_Gap !== undefined ? row.Raw_Gap : 0;
        var gapDisplay = '<div>' + rawGap + ' gap</div><div style="font-size:11px;color:#7f8c8d">(' + covPct + '% coverage)</div>';
            tr.innerHTML = '<td><strong>' + escapeHtml(row.Subject) + '</strong></td><td>' + row.Run_Rate + '</td><td>' + row.Smoothed_Target + '</td><td>' + utilDisplay + '</td><td class="' + gapClass + '">' + gapDisplay + '</td><td><span class="badge ' + badgeClass + '" title="' + (PROBLEM_TIPS[type] || '') + '">' + badgeText + '</span></td><td><small>' + action + '</small></td>';
            tbody.appendChild(tr);
        });
    }

    function renderAllSubjects() { filterAllSubjects(); }

function matchesFilter(problemType, filter) {
    var type = classifyType(problemType);
    if (filter === 'all') return true;
    if (filter === 'all-problems') return type === 'utilization' || type === 'true-supply' || type === 'no-util-data';
    if (filter === 'utilization') return type === 'utilization';
    if (filter === 'true-supply') return type === 'true-supply';
    if (filter === 'no-util-data') return type === 'no-util-data';
    if (filter === 'on-track') return type === 'on-track';
    if (filter === 'low-util') return type === 'low-util';
    return false;
}

function filterAllSubjects() {
    var typeFilter = document.getElementById('filter-type-all').value;
    var searchTerm = document.getElementById('search-all').value.toLowerCase();
    var gapFilter = parseInt(document.getElementById('filter-gap').value);
    var catFilter = document.getElementById('filter-category-all').value;
    var filtered = allData.filter(function(row) {
        var gapOk = gapFilter === 0 || (row.Gap_Pct || 0) >= gapFilter;
        var catOk = catFilter === 'all' || row.Category === catFilter;
        return matchesFilter(row.Problem_Type, typeFilter) && (!searchTerm || row.Subject.toLowerCase().indexOf(searchTerm) !== -1) && gapOk && catOk;
    });
    filtered = sortData(filtered, currentSorts.all.col, currentSorts.all.asc);
    document.getElementById('all-subjects-count').textContent = 'Showing ' + filtered.length + ' of ' + allData.length + ' subjects';
    var tbody = document.getElementById('all-subjects-body');
    tbody.innerHTML = '';
    filtered.forEach(function(row) {
        var tr = document.createElement('tr');
        var type = classifyType(row.Problem_Type);
        if (type === 'placement') tr.className = 'util-problem';
        else if (type === 'true-supply') tr.className = 'supply-problem';
        else if (type === 'no-util-data') tr.className = 'nodata-problem';
        var utilDisplay = buildUtilDisplay(row);
        var gapClass = row.Gap_Pct > 200 ? 'gap-critical' : row.Gap_Pct > 100 ? 'gap-high' : row.Gap_Pct > 50 ? 'gap-medium' : 'gap-low';
        var badgeClass = 'ontrack', badgeText = 'On Track';
        if (type === 'placement') { badgeClass = 'util'; badgeText = 'Placement Bottleneck'; }
        else if (type === 'true-supply') { badgeClass = 'supply'; badgeText = 'Supply'; }
        else if (type === 'no-util-data') { badgeClass = 'nodata'; badgeText = 'No Util Data'; }
        else if (type === 'over-supplied') { badgeClass = 'lowutil'; badgeText = 'Over-Supplied'; }
        var rec = 'No action needed';
        if (type === 'placement') rec = 'Fix matching before recruiting — tutors contracted but not placed';
        else if (type === 'true-supply') rec = 'External recruitment levers';
        else if (type === 'no-util-data') rec = 'Gather utilization data';
        else if (type === 'over-supplied') rec = 'Consider reducing forecast — supply exceeds demand';
        var adjMonths = row.Adjusted_Months ? row.Adjusted_Months.join(', ') : '';
        var adjMark = row.Is_Adjusted ? '<span class="badge adjusted" title="Adjusted months: ' + escapeHtml(adjMonths) + ' | Model total: ' + row.Original_Model_Total + '">ADJ</span>' : '';
        var adjNote = row.Is_Adjusted ? '<span class="adj-note">Adj: ' + escapeHtml(adjMonths) + ' (model: ' + row.Original_Model_Total + ')</span>' : '';
        var rawGap = row.Raw_Gap !== null && row.Raw_Gap !== undefined ? row.Raw_Gap : 0;
        var covPct = row.Coverage_Pct !== null && row.Coverage_Pct !== undefined ? row.Coverage_Pct : 100;
        var gapDisplay = '<div>' + rawGap + ' gap</div><div style="font-size:11px;color:#7f8c8d">(' + covPct + '% coverage)</div>';
        tr.innerHTML = '<td><strong>' + escapeHtml(row.Subject) + '</strong>' + adjMark + adjNote + '</td><td>' + (row.Run_Rate || '-') + '</td><td>' + (row.Smoothed_Target || '-') + '</td><td>' + utilDisplay + '</td><td class="' + gapClass + '">' + gapDisplay + '</td><td><span class="badge ' + badgeClass + '" title="' + (PROBLEM_TIPS[type] || '') + '">' + badgeText + '</span></td><td>' + escapeHtml(row.Category || 'Other') + '</td><td><small>' + rec + '</small></td>';
        tbody.appendChild(tr);
    });
}

function renderProblemSubjects() {
    var typeFilter = document.getElementById('filter-problem-type').value;
    var catFilter = document.getElementById('filter-category-problems').value;
    var searchTerm = document.getElementById('search-problems').value.toLowerCase();
    var monthFilter = document.getElementById('filter-problem-month').value;

    var problems;
    if (monthFilter !== 'all') {
        var mi = parseInt(monthFilter);
        problems = allData.filter(function(r) {
            var ts = trackerData.find(function(t) { return t.subject === r.Subject; });
            if (!ts || !ts.months || !ts.months[mi]) return false;
            return ts.months[mi].smoothed_target > ts.run_rate;
        });
    } else {
        problems = allData.filter(function(r) {
            var t = classifyType(r.Problem_Type);
            return t === 'placement' || t === 'true-supply' || t === 'no-util-data';
        });
    }
    var totalProblems = problems.length;

    if (typeFilter !== 'all') problems = problems.filter(function(r) { return classifyType(r.Problem_Type) === typeFilter; });
    if (catFilter !== 'all') problems = problems.filter(function(r) { return r.Category === catFilter; });
    if (searchTerm) problems = problems.filter(function(r) { return r.Subject.toLowerCase().indexOf(searchTerm) !== -1; });

    problems = sortData(problems, currentSorts.problems.col, currentSorts.problems.asc);
    document.getElementById('problems-count').textContent = 'Showing ' + problems.length + ' of ' + totalProblems + ' problem subjects';

    var tbody = document.getElementById('problems-body');
    tbody.innerHTML = '';
    problems.forEach(function(row) {
        var type = classifyType(row.Problem_Type);
        var utilDisplay = buildUtilDisplay(row);
        var gapClass = row.Gap_Pct > 200 ? 'gap-critical' : row.Gap_Pct > 100 ? 'gap-high' : row.Gap_Pct > 50 ? 'gap-medium' : 'gap-low';

        var badgeClass = 'util', badgeText = 'Placement Bottleneck';
        if (type === 'true-supply') { badgeClass = 'supply'; badgeText = 'True Supply'; }
        else if (type === 'no-util-data') { badgeClass = 'nodata'; badgeText = 'No Util Data'; }

        var assessment = '';
        if (type === 'placement') {
            var utilPct = row.Util_Rate || 0;
            if (utilPct === 0) assessment = 'Zero assignment rate — demand exists but tutors aren\'t being matched';
            else if (utilPct < 25) assessment = 'Very low placement — investigate matching algorithm, geography, or scheduling';
            else assessment = 'Low placement rate — fix matching before recruiting more tutors';
        } else if (type === 'true-supply') {
            if (row.Gap_Pct > 200) assessment = 'CRITICAL: External recruitment levers needed immediately';
            else if (row.Gap_Pct > 100) assessment = 'Moderate gap — InMail + opt-in campaigns';
            else assessment = 'Manageable gap — targeted outreach';
        } else {
            assessment = 'No utilization data — could be supply or algorithm issue, gather data';
        }

        var tr = document.createElement('tr');
        if (type === 'utilization') tr.className = 'util-problem';
        else if (type === 'true-supply') tr.className = 'supply-problem';
        else tr.className = 'nodata-problem';

        var adjMonthsP = row.Adjusted_Months ? row.Adjusted_Months.join(', ') : '';
        var adjMark = row.Is_Adjusted ? '<span class="badge adjusted" title="Adjusted months: ' + escapeHtml(adjMonthsP) + ' | Model total: ' + row.Original_Model_Total + '">ADJ</span>' : '';
        var rawGap = row.Raw_Gap !== null && row.Raw_Gap !== undefined ? row.Raw_Gap : 0;
        var covPct = row.Coverage_Pct !== null && row.Coverage_Pct !== undefined ? row.Coverage_Pct : 100;
        var gapDisplay = '<div>' + rawGap + ' gap</div><div style="font-size:11px;color:#7f8c8d">(' + covPct + '% coverage)</div>';
        tr.innerHTML = '<td><strong>' + escapeHtml(row.Subject) + '</strong>' + adjMark + '</td><td>' + row.Run_Rate + '</td><td>' + row.Smoothed_Target + '</td><td>' + utilDisplay + '</td><td class="' + gapClass + '">' + gapDisplay + '</td><td><span class="badge ' + badgeClass + '" title="' + (PROBLEM_TIPS[type] || '') + '">' + badgeText + '</span></td><td>' + escapeHtml(row.Category || 'Other') + '</td><td><small>' + assessment + '</small></td>';
        tbody.appendChild(tr);
    });
}

function sortTracker(key) {
    if (trackerSort.key === key) { trackerSort.asc = !trackerSort.asc; }
    else { trackerSort.key = key; trackerSort.asc = (key === 'subject'); }
    renderMonthlyTracker();
}

function sortTable(tableType, colIndex) {
    var sort = currentSorts[tableType];
    if (sort.col === colIndex) { sort.asc = !sort.asc; } else { sort.col = colIndex; sort.asc = false; }
    if (tableType === 'all') filterAllSubjects();
    else if (tableType === 'problems') renderProblemSubjects();
}

function sortData(data, colIndex, asc) {
    var keysAll = ['Subject', 'Run_Rate', 'Smoothed_Target', 'Util_Rate', 'Util_Trend', 'Util_Trend_Delta', 'Raw_Gap', 'Problem_Type', 'Category'];
    var key = keysAll[colIndex] || keysAll[0];
    return data.slice().sort(function(a, b) {
        var aVal = a[key], bVal = b[key];
        if (aVal === null || aVal === undefined) return 1;
        if (bVal === null || bVal === undefined) return -1;
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
    if (ts.is_adjusted && ts.adjusted_months) {
        html += '<div class="detail-stat"><div class="detail-stat-val">' + escapeHtml(ts.adjusted_months.join(', ')) + '</div><div class="detail-stat-lbl">Manually Adjusted</div></div>';
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
    headerRow += '<th class="col-month col-month-baseline">Mar</th>';
    visibleMonths.forEach(function(idx) {
        var m = trackerData[0].months[idx];
        headerRow += '<th class="col-month">' + m.label + '</th>';
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
        if (filter === 'problems') return classifyType(ts.problem_type) !== 'on-track' && classifyType(ts.problem_type) !== 'low-util';
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
    filtered.sort(function(a, b) {
        var av = a[sk], bv = b[sk];
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

        var cells = '<td class="col-left"><strong>' + escapeHtml(ts.subject) + '</strong></td>';
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

    initCellTooltips();
}

function initCellTooltips() {
    var tip = document.getElementById('cell-tooltip');
    if (!tip) {
        tip = document.createElement('div');
        tip.id = 'cell-tooltip';
        tip.className = 'cell-tooltip';
        document.body.appendChild(tip);
    }
    var cells = document.querySelectorAll('.cell-tip');
    cells.forEach(function(cell) {
        cell.addEventListener('mouseenter', function(e) {
            var html = cell.getAttribute('data-tip');
            if (!html) return;
            tip.innerHTML = html;
            tip.style.display = 'block';
            var rect = cell.getBoundingClientRect();
            tip.style.left = (rect.left + rect.width / 2) + 'px';
            tip.style.top = (rect.bottom + 6) + 'px';
        });
        cell.addEventListener('mouseleave', function() {
            tip.style.display = 'none';
        });
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
        ? 'March contracted ' + pct + '% above forecast — strong baseline heading into BTS.'
        : 'March contracted ' + Math.abs(pct) + '% below forecast — gap to watch entering BTS.';
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

    document.getElementById('progress-label').textContent = actual + ' of ' + Math.round(total) + ' contracted';
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
    allData.forEach(function(r) { lines.push(r.Subject + ','); });
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

function getDecisionKey(rec) {
    return 'decision_' + rec.subject + '_' + rec.action_type + '_' + (rec.data_points && rec.data_points.month || 'all');
}

function getDecision(rec) {
    try {
        var raw = localStorage.getItem(getDecisionKey(rec));
        return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
}

function saveDecision(rec, decision, note) {
    var obj = { decision: decision, note: note || '', date: new Date().toISOString(), subject: rec.subject, action_type: rec.action_type, reason: rec.reason };
    localStorage.setItem(getDecisionKey(rec), JSON.stringify(obj));
}

function renderRecommendations() {
    var priorityFilter = document.getElementById('filter-action-priority').value;
    var typeFilter = document.getElementById('filter-action-type').value;
    var searchTerm = (document.getElementById('search-actions').value || '').toLowerCase();

    var filtered = recommendationsData.filter(function(r) {
        if (priorityFilter !== 'all' && r.priority !== priorityFilter) return false;
        if (typeFilter !== 'all' && r.action_type !== typeFilter) return false;
        if (searchTerm && r.subject.toLowerCase().indexOf(searchTerm) === -1) return false;
        return true;
    });

    var high = recommendationsData.filter(function(r) { return r.priority === 'high'; }).length;
    var med = recommendationsData.filter(function(r) { return r.priority === 'medium'; }).length;
    document.getElementById('actions-total').textContent = recommendationsData.length;
    document.getElementById('actions-high').textContent = high;
    document.getElementById('actions-med').textContent = med;
    var countEl = document.getElementById('tab-count-actions');
    if (countEl) countEl.textContent = recommendationsData.length;

    var container = document.getElementById('actions-cards');
    container.innerHTML = '';

    if (filtered.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#95a5a6;">No actions match the current filters.</div>';
        renderDecisionHistory();
        return;
    }

    filtered.forEach(function(rec, idx) {
        var decision = getDecision(rec);
        var card = document.createElement('div');
        card.className = 'action-card' + (decision ? ' reviewed' : '');

        var dataHtml = '';
        if (rec.data_points) {
            var pts = [];
            if (rec.data_points.util_rate != null) pts.push('Util: ' + Math.round(rec.data_points.util_rate) + '%');
            if (rec.data_points.gap != null) pts.push('Gap: ' + rec.data_points.gap);
            if (rec.data_points.run_rate != null) pts.push('Run Rate: ' + rec.data_points.run_rate);
            if (rec.data_points.pace != null) pts.push('Pace: ' + rec.data_points.pace + '%');
            if (rec.data_points.actual != null) pts.push('Actual: ' + rec.data_points.actual);
            if (rec.data_points.target != null) pts.push('Target: ' + rec.data_points.target);
            dataHtml = '<div class="action-card-data">' + pts.join(' &bull; ') + '</div>';
        }

        var reviewBtn = decision
            ? '<span class="btn btn-sm btn-reviewed">\u2713 Reviewed: ' + escapeHtml(decision.decision) + '</span>'
            : '<button class="btn btn-sm btn-outline" onclick="openReviewModal(' + idx + ')">Mark as Reviewed</button>';

        card.innerHTML =
            '<div class="action-card-header">' +
                '<span class="action-card-subject">' + escapeHtml(rec.subject) + '</span>' +
                '<span class="badge-priority ' + rec.priority + '">' + rec.priority + '</span>' +
                '<span class="badge-action-type">' + (ACTION_TYPE_LABELS[rec.action_type] || rec.action_type) + '</span>' +
            '</div>' +
            '<div class="action-card-reason">' + escapeHtml(rec.reason) + '</div>' +
            dataHtml +
            '<div class="action-card-footer">' + reviewBtn + '</div>';

        container.appendChild(card);
    });

    renderDecisionHistory();
}

var _currentReviewIdx = null;

function openReviewModal(idx) {
    _currentReviewIdx = idx;
    var overlay = document.createElement('div');
    overlay.className = 'review-modal-overlay';
    overlay.id = 'review-modal-overlay';
    overlay.onclick = function(e) { if (e.target === overlay) closeReviewModal(); };
    overlay.innerHTML =
        '<div class="review-modal">' +
            '<h4>Mark as Reviewed</h4>' +
            '<label style="font-size:13px;font-weight:600;">Decision</label>' +
            '<select id="review-decision"><option value="Will Act">Will Act</option><option value="Won\'t Act">Won\'t Act</option><option value="Defer">Defer</option></select>' +
            '<label style="font-size:13px;font-weight:600;">Note (optional)</label>' +
            '<textarea id="review-note" placeholder="Any context for this decision..."></textarea>' +
            '<div class="review-modal-buttons">' +
                '<button class="btn btn-outline" onclick="closeReviewModal()">Cancel</button>' +
                '<button class="btn btn-primary" onclick="submitReview()">Save</button>' +
            '</div>' +
        '</div>';
    document.body.appendChild(overlay);
}

function closeReviewModal() {
    var el = document.getElementById('review-modal-overlay');
    if (el) el.remove();
    _currentReviewIdx = null;
}

function submitReview() {
    if (_currentReviewIdx == null) return;
    var priorityFilter = document.getElementById('filter-action-priority').value;
    var typeFilter = document.getElementById('filter-action-type').value;
    var searchTerm = (document.getElementById('search-actions').value || '').toLowerCase();
    var filtered = recommendationsData.filter(function(r) {
        if (priorityFilter !== 'all' && r.priority !== priorityFilter) return false;
        if (typeFilter !== 'all' && r.action_type !== typeFilter) return false;
        if (searchTerm && r.subject.toLowerCase().indexOf(searchTerm) === -1) return false;
        return true;
    });
    var rec = filtered[_currentReviewIdx];
    if (!rec) { closeReviewModal(); return; }
    var decision = document.getElementById('review-decision').value;
    var note = document.getElementById('review-note').value;
    saveDecision(rec, decision, note);
    closeReviewModal();
    renderRecommendations();
}

function renderDecisionHistory() {
    var container = document.getElementById('decision-history-list');
    if (!container) return;
    var entries = [];
    for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && key.indexOf('decision_') === 0) {
            try {
                var d = JSON.parse(localStorage.getItem(key));
                if (d && d.subject) entries.push(d);
            } catch (e) {}
        }
    }
    entries.sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); });

    if (entries.length === 0) {
        container.innerHTML = '<div style="color:#95a5a6;font-size:13px;padding:8px;">No decisions recorded yet.</div>';
        return;
    }

    container.innerHTML = entries.map(function(d) {
        var dateStr = d.date ? new Date(d.date).toLocaleDateString() : '';
        return '<div class="decision-entry">' +
            '<span class="de-subject">' + escapeHtml(d.subject) + '</span>' +
            '<span class="de-decision"><strong>' + escapeHtml(d.decision) + '</strong></span>' +
            '<span class="de-note">' + (d.note ? escapeHtml(d.note) : '\u2014') + '</span>' +
            '<span class="de-date">' + dateStr + '</span>' +
        '</div>';
    }).join('');
}

function generateWeeklySummary() {
    var ws = weeklySummaryData;
    if (!ws || !ws.total_subjects) {
        document.getElementById('weekly-summary-output').style.display = 'block';
        document.getElementById('weekly-summary-output').textContent = 'No summary data available. Run the analysis pipeline first.';
        return;
    }

    var lines = [];
    lines.push('BTS Tutor Supply \u2014 Weekly Summary');
    lines.push('Generated: ' + (ws.generated_at || new Date().toLocaleDateString()));
    lines.push('');
    lines.push('OVERVIEW');
    lines.push(ws.total_subjects + ' subjects tracked | ' + ws.on_track + ' on track | ' + ws.bottlenecks + ' placement bottlenecks | ' + ws.over_supplied + ' over-supplied');
    lines.push('Progress: ' + ws.total_actual + ' of ' + ws.total_target + ' tutors contracted (' + ws.progress_pct + '%)');
    lines.push('');
    lines.push('ACTIONS');
    lines.push(ws.total_actions + ' recommended actions: ' + ws.high_priority_actions + ' high priority, ' + ws.medium_priority_actions + ' medium priority');
    if (ws.behind_pace_count > 0) {
        lines.push(ws.behind_pace_count + ' subjects behind pace in current month');
        var examples = (ws.behind_pace_subjects || []).slice(0, 5).map(function(s) {
            return s.subject + ' (' + s.pace + '% of target in ' + s.month + ')';
        });
        if (examples.length) lines.push('  Examples: ' + examples.join(', '));
    }
    lines.push('');
    if (ws.biggest_gaps && ws.biggest_gaps.length > 0) {
        lines.push('BIGGEST GAPS');
        ws.biggest_gaps.forEach(function(g) {
            lines.push('  ' + g.subject + ': ' + g.remaining + ' tutors remaining');
        });
    }

    var output = lines.join('\n');
    var block = document.getElementById('weekly-summary-output');
    block.style.display = 'block';
    block.innerHTML = '<button class="copy-btn" onclick="copyWeeklySummary()">Copy</button>' + escapeHtml(output);
    block.dataset.rawText = output;
}

function copyWeeklySummary() {
    var block = document.getElementById('weekly-summary-output');
    var text = block.dataset.rawText || block.textContent;
    navigator.clipboard.writeText(text).then(function() {
        var btn = block.querySelector('.copy-btn');
        if (btn) { btn.textContent = 'Copied!'; setTimeout(function() { btn.textContent = 'Copy'; }, 1500); }
    });
}

/* ── Event listeners ── */
document.getElementById('filter-type-all').addEventListener('change', filterAllSubjects);
document.getElementById('search-all').addEventListener('input', debounce(filterAllSubjects, 200));
document.getElementById('filter-gap').addEventListener('change', filterAllSubjects);
document.getElementById('filter-category-all').addEventListener('change', filterAllSubjects);
document.getElementById('filter-problem-type').addEventListener('change', renderProblemSubjects);
document.getElementById('filter-category-problems').addEventListener('change', renderProblemSubjects);
document.getElementById('search-problems').addEventListener('input', debounce(renderProblemSubjects, 200));
document.getElementById('filter-problem-month').addEventListener('change', renderProblemSubjects);
document.getElementById('tracker-filter').addEventListener('change', renderMonthlyTracker);
document.getElementById('tracker-search').addEventListener('input', debounce(renderMonthlyTracker, 200));
document.getElementById('filter-category-tracker').addEventListener('change', renderMonthlyTracker);

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
