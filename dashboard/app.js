function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

var allData = [];
var trackerData = [];
var historyData = [];
var uploadsData = [];
var summaryData = {};
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

function classifyType(problemType) {
    if (!problemType) return 'on-track';
    var pt = problemType.toLowerCase();
    if (pt.includes('possible placement')) return 'utilization';
    if (pt.includes('utilization problem')) return 'utilization';
    if (pt.includes('true supply')) return 'true-supply';
    if (pt.includes('no util data')) return 'no-util-data';
    if (pt.includes('low util')) return 'low-util';
    return 'on-track';
}

function isSupplyRelated(problemType) {
    if (!problemType) return false;
    return problemType.includes('True Supply') || problemType.includes('No Util Data');
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
        updateSummary(summaryData);
        updateTabCounts();
        renderCriticalFindings();
        renderAllTables();
        renderMonthlyTracker();
        renderMarchBaseline(summaryData);
        renderProgressBar(summaryData);
        renderHistoryTab();
        lockFinalizedMonths();
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
    var clientUtil = allData.filter(function(r) { return classifyType(r.Problem_Type) === 'utilization'; }).length;
    var clientSupply = allData.filter(function(r) { return classifyType(r.Problem_Type) === 'true-supply'; }).length;
    var clientNoUtil = allData.filter(function(r) { return classifyType(r.Problem_Type) === 'no-util-data'; }).length;
    var clientOnTrack = allData.filter(function(r) { var t = classifyType(r.Problem_Type); return t === 'on-track' || t === 'low-util'; }).length;
    var lowUtilCount = allData.filter(function(r) { return classifyType(r.Problem_Type) === 'low-util'; }).length;

    document.getElementById('total-subjects').textContent = clientTotal;
    document.getElementById('util-problems').textContent = clientUtil;
    document.getElementById('stat-supply-problems').textContent = clientSupply + clientNoUtil;
    document.getElementById('ontrack-subjects').textContent = clientOnTrack;
    document.getElementById('lowutil-subjects').textContent = lowUtilCount;
    document.getElementById('lowutil-count-callout').textContent = lowUtilCount;

    document.getElementById('footer-time').textContent = 'Last updated: ' + summary.last_updated;
    document.getElementById('method-updated').textContent = summary.last_updated;

    var discrepancies = [];
    if (clientTotal !== (summary.total_subjects || 0)) discrepancies.push('Total: card=' + clientTotal + ' vs data=' + summary.total_subjects);
    if (clientUtil !== (summary.utilization_problems || 0)) discrepancies.push('Placement issues: card=' + clientUtil + ' vs data=' + summary.utilization_problems);
    var serverSupply = (summary.supply_problems || 0);
    if ((clientSupply + clientNoUtil) !== serverSupply) discrepancies.push('Supply: card=' + (clientSupply + clientNoUtil) + ' vs data=' + serverSupply);
    if (discrepancies.length > 0) {
        console.warn('Reconciliation differences (expected from reclassification):', discrepancies);
    }

    var topLowUtil = allData
        .filter(function(r) { return classifyType(r.Problem_Type) === 'low-util'; })
        .sort(function(a, b) { return (b.Run_Rate || 0) - (a.Run_Rate || 0); })
        .slice(0, 5)
        .map(function(r) { return r.Subject + ' (' + (r.Util_Rate || 0) + '% util, run rate ' + r.Run_Rate + '/mo)'; });
    document.getElementById('lowutil-examples').textContent = topLowUtil.join('; ');
}

function updateTabCounts() {
    document.getElementById('tab-count-all').textContent = allData.length;
    var problemCount = allData.filter(function(r) {
        var t = classifyType(r.Problem_Type);
        return t === 'utilization' || t === 'true-supply' || t === 'no-util-data';
    }).length;
    document.getElementById('tab-count-problems').textContent = problemCount;
}

function renderCriticalFindings() {
    var flagged = allData.filter(function(r) {
        var t = classifyType(r.Problem_Type);
        return t === 'utilization' || t === 'true-supply' || t === 'no-util-data';
    });
    var utilCount = allData.filter(function(r) { return classifyType(r.Problem_Type) === 'utilization'; }).length;
    var supplyCount = allData.filter(function(r) { return classifyType(r.Problem_Type) === 'true-supply'; }).length;
    var noUtilCount = allData.filter(function(r) { return classifyType(r.Problem_Type) === 'no-util-data'; }).length;
    var utilPct = flagged.length > 0 ? Math.round(utilCount / flagged.length * 100) : 0;
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
            finding: utilPct + '% of flagged subjects are utilization problems',
            impact: utilCount + ' subjects exhibit low utilization — enough tutors contracted, but algorithmic barriers may prevent assignments',
            action: 'Investigate placement/assignment barriers before recruiting more tutors.'
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
        var barClass = type === 'utilization' ? 'util-bar' : type === 'no-util-data' ? 'nodata-bar' : 'supply-bar';
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
    var priority = allData.filter(function(r) { return r.Problem_Type && r.Problem_Type.includes('Problem'); }).sort(function(a, b) { return (a.Raw_Gap || 0) - (b.Raw_Gap || 0); }).slice(0, 15);
    var tbody = document.getElementById('priority-body');
    tbody.innerHTML = '';
    document.getElementById('priority-count').textContent = 'Showing top ' + priority.length + ' problem subjects';
    priority.forEach(function(row) {
        var tr = document.createElement('tr');
        var type = classifyType(row.Problem_Type);
        if (type === 'utilization') tr.className = 'util-problem';
        else if (type === 'true-supply') tr.className = 'supply-problem';
        else if (type === 'no-util-data') tr.className = 'nodata-problem';
        var utilDisplay = row.Util_Rate !== null && row.Util_Rate !== undefined ? row.Util_Rate + '%' : 'N/A';
        if (row.Total_Contracted != null && row.Utilized_30d != null) utilDisplay += '<div style="font-size:11px;color:#7f8c8d">(' + Math.round(row.Utilized_30d) + ' of ' + Math.round(row.Total_Contracted) + ')</div>';
        var covPct = row.Coverage_Pct !== null && row.Coverage_Pct !== undefined ? row.Coverage_Pct : 100;
        var gapClass = covPct < 50 ? 'gap-critical' : covPct < 80 ? 'gap-high' : 'gap-medium';
        var action = '', badgeClass = '', badgeText = '';
        if (type === 'utilization') { action = 'Possible supply gap masked by placement issues'; badgeClass = 'util'; badgeText = 'Placement Issue'; }
        else if (type === 'no-util-data') { action = 'Gather utilization data'; badgeClass = 'nodata'; badgeText = 'No Util Data'; }
        else if (covPct < 50) { action = 'CRITICAL: External levers now'; badgeClass = 'supply'; badgeText = 'Supply'; }
        else { action = 'Targeted campaigns'; badgeClass = 'supply'; badgeText = 'Supply'; }
        var rawGap = row.Raw_Gap !== null && row.Raw_Gap !== undefined ? row.Raw_Gap : 0;
        var gapDisplay = '<div>' + rawGap + ' gap</div><div style="font-size:11px;color:#7f8c8d">(' + covPct + '% coverage)</div>';
            tr.innerHTML = '<td><strong>' + escapeHtml(row.Subject) + '</strong></td><td>' + row.Run_Rate + '</td><td>' + row.Smoothed_Target + '</td><td>' + utilDisplay + '</td><td class="' + gapClass + '">' + gapDisplay + '</td><td><span class="badge ' + badgeClass + '">' + badgeText + '</span></td><td><small>' + action + '</small></td>';
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
        if (type === 'utilization') tr.className = 'util-problem';
        else if (type === 'true-supply') tr.className = 'supply-problem';
        else if (type === 'no-util-data') tr.className = 'nodata-problem';
        var utilDisplay = row.Util_Rate !== null && row.Util_Rate !== undefined ? row.Util_Rate + '%' : 'N/A';
        if (row.Total_Contracted != null && row.Utilized_30d != null) utilDisplay += '<div style="font-size:11px;color:#7f8c8d">(' + Math.round(row.Utilized_30d) + ' of ' + Math.round(row.Total_Contracted) + ')</div>';
        var gapClass = row.Gap_Pct > 200 ? 'gap-critical' : row.Gap_Pct > 100 ? 'gap-high' : row.Gap_Pct > 50 ? 'gap-medium' : 'gap-low';
        var badgeClass = 'ontrack', badgeText = 'On Track';
        if (type === 'utilization') { badgeClass = 'util'; badgeText = 'Placement Issue'; }
        else if (type === 'true-supply') { badgeClass = 'supply'; badgeText = 'Supply'; }
        else if (type === 'no-util-data') { badgeClass = 'nodata'; badgeText = 'No Util Data'; }
        else if (type === 'low-util') { badgeClass = 'lowutil'; badgeText = 'Low Util'; }
        var rec = 'No action needed';
        if (type === 'utilization') rec = 'Possible placement issue — tutors contracted but not assigned';
        else if (type === 'true-supply') rec = 'External recruitment levers';
        else if (type === 'no-util-data') rec = 'Gather utilization data';
        else if (type === 'low-util') rec = 'Monitor utilization';
        var adjMonths = row.Adjusted_Months ? row.Adjusted_Months.join(', ') : '';
        var adjMark = row.Is_Adjusted ? '<span class="badge adjusted" title="Adjusted months: ' + escapeHtml(adjMonths) + ' | Model total: ' + row.Original_Model_Total + '">ADJ</span>' : '';
        var adjNote = row.Is_Adjusted ? '<span class="adj-note">Adj: ' + escapeHtml(adjMonths) + ' (model: ' + row.Original_Model_Total + ')</span>' : '';
        var rawGap = row.Raw_Gap !== null && row.Raw_Gap !== undefined ? row.Raw_Gap : 0;
        var covPct = row.Coverage_Pct !== null && row.Coverage_Pct !== undefined ? row.Coverage_Pct : 100;
        var gapDisplay = '<div>' + rawGap + ' gap</div><div style="font-size:11px;color:#7f8c8d">(' + covPct + '% coverage)</div>';
        tr.innerHTML = '<td><strong>' + escapeHtml(row.Subject) + '</strong>' + adjMark + adjNote + '</td><td>' + (row.Run_Rate || '-') + '</td><td>' + (row.Smoothed_Target || '-') + '</td><td>' + utilDisplay + '</td><td class="' + gapClass + '">' + gapDisplay + '</td><td><span class="badge ' + badgeClass + '">' + badgeText + '</span></td><td>' + escapeHtml(row.Category || 'Other') + '</td><td><small>' + rec + '</small></td>';
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
            return t === 'utilization' || t === 'true-supply' || t === 'no-util-data';
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
        var utilDisplay = row.Util_Rate !== null && row.Util_Rate !== undefined ? row.Util_Rate + '%' : 'N/A';
        if (row.Total_Contracted != null && row.Utilized_30d != null) utilDisplay += '<div style="font-size:11px;color:#7f8c8d">(' + Math.round(row.Utilized_30d) + ' of ' + Math.round(row.Total_Contracted) + ')</div>';
        var gapClass = row.Gap_Pct > 200 ? 'gap-critical' : row.Gap_Pct > 100 ? 'gap-high' : row.Gap_Pct > 50 ? 'gap-medium' : 'gap-low';

        var badgeClass = 'util', badgeText = 'Placement Issue';
        if (type === 'true-supply') { badgeClass = 'supply'; badgeText = 'True Supply'; }
        else if (type === 'no-util-data') { badgeClass = 'nodata'; badgeText = 'No Util Data'; }

        var assessment = '';
        if (type === 'utilization') {
            var utilPct = row.Util_Rate || 0;
            if (utilPct === 0) assessment = 'Zero assignment rate — possible placement issue or supply gap';
            else if (utilPct < 25) assessment = 'Very low assignment rate — placement issue likely masking true supply need';
            else assessment = 'Low assignment rate — possible placement issue, investigate before recruiting';
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
        tr.innerHTML = '<td><strong>' + escapeHtml(row.Subject) + '</strong>' + adjMark + '</td><td>' + row.Run_Rate + '</td><td>' + row.Smoothed_Target + '</td><td>' + utilDisplay + '</td><td class="' + gapClass + '">' + gapDisplay + '</td><td><span class="badge ' + badgeClass + '">' + badgeText + '</span></td><td>' + escapeHtml(row.Category || 'Other') + '</td><td><small>' + assessment + '</small></td>';
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
    var keysAll = ['Subject', 'Run_Rate', 'Smoothed_Target', 'Util_Rate', 'Raw_Gap', 'Problem_Type', 'Category'];
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

    var view = document.getElementById('tracker-view').value;

    filtered.forEach(function(ts) {
        var tr = document.createElement('tr');
        var pace = ts._pace;
        if (pace < 80) tr.className = 'row-miss';
        else if (pace < 100) tr.className = 'row-risk';
        var cells = '<td><strong>' + escapeHtml(ts.subject) + '</strong></td>';
        cells += '<td>' + Math.round(ts.run_rate) + '</td>';

        var mb = ts.march_baseline || {};
        var marContent = '<div class="month-cell">';
        if (mb.actual !== null && mb.actual !== undefined) {
            marContent += '<div class="mc-actual">' + mb.actual + '</div>';
            if (mb.forecast !== null && mb.forecast !== undefined) {
                marContent += '<div class="mc-target">fcst: ' + mb.forecast + '</div>';
                var marVar = mb.variance || 0;
                var marCls = marVar > 0 ? 'positive' : marVar < 0 ? 'negative' : 'zero';
                marContent += '<div class="mc-var ' + marCls + '">' + (marVar > 0 ? '+' : '') + marVar + '</div>';
            }
        } else {
            marContent += '<div class="mc-actual" style="color:#bdc3c7">—</div>';
        }
        marContent += '</div>';
        cells += '<td style="background:#f8f9fa;">' + marContent + '</td>';

        ts.months.forEach(function(m) {
            var isInProgress = m.status === 'in_progress';
            var isFinal = m.status === 'final';
            var cls = isFinal ? 'month-past' : (isInProgress ? 'month-in-progress' : '');
            var content = '<div class="month-cell">';
            var fcst = m.original_forecast !== null && m.original_forecast !== undefined ? Math.round(m.original_forecast) : null;
            var smth = m.smoothed_target !== null && m.smoothed_target !== undefined ? Math.round(m.smoothed_target) : null;
            var adj = m.adjusted_target !== null && m.adjusted_target !== undefined ? Math.round(m.adjusted_target) : null;

            if (m.actual !== null && (isFinal || isInProgress)) {
                content += '<div class="mc-actual">' + m.actual + '</div>';
                if (view === 'both') {
                    content += '<div class="mc-forecast">fcst: ' + (fcst !== null ? fcst : '—') + '</div>';
                    content += '<div class="mc-smoothed">target: ' + (smth !== null ? smth : '—') + '</div>';
                } else if (view === 'forecast') {
                    content += '<div class="mc-forecast">fcst: ' + (fcst !== null ? fcst : '—') + '</div>';
                } else {
                    content += '<div class="mc-smoothed">target: ' + (smth !== null ? smth : '—') + '</div>';
                }
                if (isFinal) {
                    var varCls = m.variance > 0 ? 'positive' : m.variance < 0 ? 'negative' : 'zero';
                    var varSign = m.variance > 0 ? '+' : '';
                    content += '<div class="mc-var ' + varCls + '">' + varSign + Math.round(m.variance) + '</div>';
                }
                if (isInProgress) {
                    var target = smth || 1;
                    var pct = Math.min(Math.round(m.actual / target * 100), 100);
                    content += '<div class="ip-progress-outer"><div class="ip-progress-fill" style="width:' + pct + '%"></div></div>';
                    content += '<div class="ip-badge">in progress</div>';
                }
            } else {
                if (view === 'both') {
                    content += '<div class="mc-forecast">fcst: ' + (fcst !== null ? fcst : '—') + '</div>';
                    content += '<div class="mc-actual">' + (smth !== null ? smth : '—') + '</div>';
                    content += '<div class="mc-target">target</div>';
                } else if (view === 'forecast') {
                    content += '<div class="mc-actual">' + (fcst !== null ? fcst : '—') + '</div>';
                    content += '<div class="mc-target">forecast</div>';
                } else {
                    content += '<div class="mc-actual">' + (smth !== null ? smth : '—') + '</div>';
                    content += '<div class="mc-target">target</div>';
                }
            }
            content += '</div>';
            cells += '<td class="' + cls + '">' + content + '</td>';
        });

        cells += '<td><strong>' + Math.round(ts.bts_total) + '</strong></td>';
        cells += '<td>' + Math.round(ts.remaining_need) + '</td>';

        var pace = ts._pace;
        var paceCls = pace >= 100 ? 'pace-ok' : pace >= 80 ? 'pace-risk' : 'pace-miss';
        var paceWidth = Math.min(pace, 100);
        var paceLabel = pace >= 999 ? '✓' : pace + '%';
        cells += '<td><div class="pace-bar-wrap"><div class="pace-bar-outer"><div class="pace-bar-fill ' + paceCls + '" style="width:' + paceWidth + '%"></div></div><div class="pace-label ' + paceCls + '">' + paceLabel + '</div></div></td>';

        tr.innerHTML = cells;
        tbody.appendChild(tr);
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
    var grid = document.getElementById('history-grid');
    if (!historyData.length) {
        grid.innerHTML = '<div style="padding: 40px; text-align: center; color: #95a5a6; grid-column: 1/-1;">No actuals uploaded yet. Use the Upload Data tab to add monthly results.</div>';
        return;
    }
    grid.innerHTML = '';
    historyData.forEach(function(h) {
        var headerClass = h.variance >= 0 ? 'met' : (h.variance_pct > -10 ? 'partial' : 'missed');
        var card = document.createElement('div');
        card.className = 'history-card';
        var html = '<div class="history-card-header ' + headerClass + '">' + h.label + ' 2026</div>';
        html += '<div class="history-card-body">';
        html += '<div class="history-stat"><span>Target</span><span>' + Math.round(h.total_target) + '</span></div>';
        html += '<div class="history-stat"><span>Actual</span><span><strong>' + Math.round(h.total_actual) + '</strong></span></div>';
        html += '<div class="history-stat"><span>Variance</span><span style="color:' + (h.variance >= 0 ? '#27ae60' : '#e74c3c') + '; font-weight:700;">' + (h.variance >= 0 ? '+' : '') + Math.round(h.variance) + ' (' + (h.variance_pct >= 0 ? '+' : '') + h.variance_pct + '%)</span></div>';
        html += '<div class="history-stat"><span>Cumulative</span><span>' + Math.round(h.cumulative_actual) + ' / ' + Math.round(h.cumulative_target) + '</span></div>';

        if (h.under_performers && h.under_performers.length) {
            html += '<div class="history-performers"><strong>Biggest gaps:</strong>';
            h.under_performers.slice(0, 3).forEach(function(p) {
                html += escapeHtml(p.subject) + ' (' + Math.round(p.variance) + '), ';
            });
            html = html.slice(0, -2) + '</div>';
        }
        if (h.over_performers && h.over_performers.length) {
            html += '<div class="history-performers"><strong>Over-performed:</strong>';
            h.over_performers.slice(0, 3).forEach(function(p) {
                html += escapeHtml(p.subject) + ' (+' + Math.round(p.variance) + '), ';
            });
            html = html.slice(0, -2) + '</div>';
        }
        html += '</div>';
        card.innerHTML = html;
        grid.appendChild(card);
    });
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

/* ── Event listeners ── */
document.getElementById('filter-type-all').addEventListener('change', filterAllSubjects);
document.getElementById('search-all').addEventListener('input', filterAllSubjects);
document.getElementById('filter-gap').addEventListener('change', filterAllSubjects);
document.getElementById('filter-category-all').addEventListener('change', filterAllSubjects);
document.getElementById('filter-problem-type').addEventListener('change', renderProblemSubjects);
document.getElementById('filter-category-problems').addEventListener('change', renderProblemSubjects);
document.getElementById('search-problems').addEventListener('input', renderProblemSubjects);
document.getElementById('filter-problem-month').addEventListener('change', renderProblemSubjects);
document.getElementById('tracker-filter').addEventListener('change', renderMonthlyTracker);
document.getElementById('tracker-search').addEventListener('input', renderMonthlyTracker);
document.getElementById('filter-category-tracker').addEventListener('change', renderMonthlyTracker);
document.getElementById('tracker-view').addEventListener('change', renderMonthlyTracker);

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
