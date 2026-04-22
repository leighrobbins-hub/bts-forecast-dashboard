"""Tests for core analysis logic in run_analysis.py."""

import sys
import os
import unittest

import pandas as pd
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))
from run_analysis import (
    apply_group_smoothing,
    classify_category,
    classify_problems,
    _norm_subject,
    get_p90_goal,
    NAT_P90_GOAL_BY_TIER,
)


class TestNormSubject(unittest.TestCase):
    """Tests for subject name normalization."""

    def test_strips_leading_trailing_whitespace(self):
        self.assertEqual(_norm_subject('  SAT  '), 'SAT')

    def test_collapses_internal_spaces(self):
        self.assertEqual(_norm_subject('High  School  Math'), 'High School Math')

    def test_handles_nan(self):
        self.assertEqual(_norm_subject(float('nan')), '')

    def test_no_change_on_clean_name(self):
        self.assertEqual(_norm_subject('AP Chemistry'), 'AP Chemistry')


class TestClassifyProblemsWithMismatchedCase(unittest.TestCase):
    """Verify that subject name normalization allows case/whitespace mismatches to merge."""

    def _subject_row(self, name):
        return {
            'Subject': name, 'Run_Rate': 10, 'Smoothed_Target': 30,
            'Max_Capacity': 12, 'Gap_Pct': 200, 'Raw_Gap': -140,
            'Coverage_Pct': 33, 'Needs_External_Levers': True,
            'BTS_Total': 210, 'Is_Adjusted': False, 'Adjusted_Months': None,
            'Original_Model_Total': 210,
            'Apr_Original': 30, 'May_Original': 30, 'Jun_Original': 30,
            'Jul_Original': 30, 'Aug_Original': 30, 'Sep_Original': 30, 'Oct_Original': 30,
            'Apr_Smoothed': 30, 'May_Smoothed': 30, 'Jun_Smoothed': 30,
            'Jul_Smoothed': 30, 'Aug_Smoothed': 30, 'Sep_Smoothed': 30, 'Oct_Smoothed': 30,
            'Mar_Actual': None, 'Mar_Forecast': None,
        }

    def test_trailing_space_in_util_subject_still_matches(self):
        analysis = pd.DataFrame([self._subject_row('SAT')])
        util = pd.DataFrame([{
            'Subject': 'SAT ',
            'Total_Contracted': 29, 'Utilized_30d': 18, 'Util_Rate': 62.0
        }])
        result = classify_problems(analysis, util)
        self.assertEqual(result.iloc[0]['Problem_Type'], 'True Supply Problem')
        self.assertAlmostEqual(result.iloc[0]['Util_Rate'], 62.0)

    def test_extra_internal_space_in_analysis_subject_still_matches(self):
        analysis = pd.DataFrame([self._subject_row('High  School  Math')])
        util = pd.DataFrame([{
            'Subject': 'High School Math',
            'Total_Contracted': 20, 'Utilized_30d': 15, 'Util_Rate': 75.0
        }])
        result = classify_problems(analysis, util)
        self.assertAlmostEqual(result.iloc[0]['Util_Rate'], 75.0)


class TestApplyGroupSmoothing(unittest.TestCase):
    """Tests for the 3-month group smoothing algorithm."""

    def test_no_smoothing_when_all_below_cap(self):
        targets = [5, 5, 5, 5, 5, 5, 5]
        floors = [None] * 7
        adjusted = list(targets)
        result = apply_group_smoothing(targets, 10, floors, adjusted)
        self.assertEqual(result, [5, 5, 5, 5, 5, 5, 5])

    def test_group1_smoothing(self):
        targets = [5, 5, 5, 5, 15, 12, 18]
        floors = [None] * 7
        adjusted = list(targets)
        result = apply_group_smoothing(targets, 10, floors, adjusted)
        self.assertEqual(result[4], 15)
        self.assertEqual(result[5], 15)
        self.assertEqual(result[6], 15)
        self.assertEqual(sum(result[4:7]), 45)

    def test_group2_smoothing(self):
        targets = [5, 15, 12, 18, 5, 5, 5]
        floors = [None] * 7
        adjusted = list(targets)
        result = apply_group_smoothing(targets, 10, floors, adjusted)
        self.assertEqual(result[1], 15)
        self.assertEqual(result[2], 15)
        self.assertEqual(result[3], 15)
        self.assertEqual(sum(result[1:4]), 45)

    def test_manual_floor_enforced(self):
        targets = [5, 5, 5, 5, 20, 10, 20]
        floors = [None, None, None, None, 18, None, None]
        adjusted = list(targets)
        result = apply_group_smoothing(targets, 10, floors, adjusted)
        self.assertGreaterEqual(result[4], 18)

    def test_april_cascade_to_may(self):
        targets = [15, 5, 5, 5, 5, 5, 5]
        floors = [None] * 7
        adjusted = list(targets)
        result = apply_group_smoothing(targets, 10, floors, adjusted)
        self.assertEqual(result[0], 10)
        self.assertEqual(result[1], 10)

    def test_april_no_cascade_when_group2_corrected(self):
        targets = [15, 15, 15, 15, 5, 5, 5]
        floors = [None] * 7
        adjusted = list(targets)
        result = apply_group_smoothing(targets, 10, floors, adjusted)
        self.assertEqual(result[0], 15)

    def test_zero_run_rate_no_change(self):
        targets = [5, 10, 15, 20, 25, 30, 35]
        floors = [None] * 7
        adjusted = list(targets)
        original = list(targets)
        result = apply_group_smoothing(targets, 0, floors, adjusted)
        self.assertEqual(result, original)

    def test_total_demand_preserved_in_groups(self):
        targets = [10, 20, 30, 25, 40, 35, 45]
        floors = [None] * 7
        adjusted = list(targets)
        g1_before = sum(targets[4:7])
        g2_before = sum(targets[1:4])
        apply_group_smoothing(targets, 15, floors, adjusted)
        self.assertEqual(sum(targets[4:7]), g1_before)
        self.assertEqual(sum(targets[1:4]), g2_before)


class TestClassifyCategory(unittest.TestCase):
    """Tests for subject category classification."""

    def test_ap_subjects(self):
        self.assertEqual(classify_category('AP Chemistry'), 'AP')
        self.assertEqual(classify_category('AP Pre-Calculus'), 'AP')

    def test_ib_subjects(self):
        self.assertEqual(classify_category('IB Mathematics'), 'IB')

    def test_test_prep(self):
        self.assertEqual(classify_category('SAT'), 'Test Prep')
        self.assertEqual(classify_category('LSAT'), 'Test Prep')
        self.assertEqual(classify_category('ACT Reading'), 'Test Prep')

    def test_elementary(self):
        self.assertEqual(classify_category('Elementary Math'), 'Elementary')
        self.assertEqual(classify_category('Phonics'), 'Elementary')

    def test_high_school(self):
        self.assertEqual(classify_category('High School Chemistry'), 'High School')
        self.assertEqual(classify_category('Algebra'), 'High School')

    def test_college(self):
        self.assertEqual(classify_category('Calculus 2'), 'College')
        self.assertEqual(classify_category('Organic Chemistry'), 'College')

    def test_professional(self):
        self.assertEqual(classify_category('CPA Exam'), 'Professional/Cert')
        self.assertEqual(classify_category('NCLEX Prep'), 'Professional/Cert')

    def test_arts(self):
        self.assertEqual(classify_category('Piano'), 'Arts & Music')
        self.assertEqual(classify_category('Drawing'), 'Arts & Music')

    def test_technology(self):
        self.assertEqual(classify_category('Robotics'), 'Technology')
        self.assertEqual(classify_category('Minecraft'), 'Technology')

    def test_language(self):
        self.assertEqual(classify_category('Spanish 1'), 'Language')
        self.assertEqual(classify_category('ESL/ELL'), 'Language')

    def test_other_fallback(self):
        self.assertEqual(classify_category('Underwater Basket Weaving'), 'Other')


# ── Helpers for new classification tests ─────────────────────────

def _base_row(**overrides):
    """Build a minimal analysis row with sensible defaults."""
    row = {
        'Subject': 'Test Subject', 'Run_Rate': 10, 'Smoothed_Target': 30,
        'Max_Capacity': 12, 'Gap_Pct': 200, 'Raw_Gap': -140,
        'Coverage_Pct': 33, 'Needs_External_Levers': True,
        'BTS_Total': 210, 'Is_Adjusted': False, 'Adjusted_Months': None,
        'Original_Model_Total': 210,
        'Apr_Original': 30, 'May_Original': 30, 'Jun_Original': 30,
        'Jul_Original': 30, 'Aug_Original': 30, 'Sep_Original': 30, 'Oct_Original': 30,
        'Apr_Smoothed': 30, 'May_Smoothed': 30, 'Jun_Smoothed': 30,
        'Jul_Smoothed': 30, 'Aug_Smoothed': 30, 'Sep_Smoothed': 30, 'Oct_Smoothed': 30,
        'Mar_Actual': None, 'Mar_Forecast': None,
    }
    row.update(overrides)
    return row


def _util_row(subject, util_rate):
    return {'Subject': subject, 'Total_Contracted': 20, 'Utilized_30d': int(20 * util_rate / 100), 'Util_Rate': util_rate}


def _run_classify(analysis_overrides, util_rate=None, thu_pct=None, p90=None):
    """Run classify_problems and return the single result row as a dict."""
    row = _base_row(**analysis_overrides)
    analysis = pd.DataFrame([row])
    if util_rate is not None:
        util = pd.DataFrame([_util_row(row['Subject'], util_rate)])
    else:
        util = pd.DataFrame({'Subject': pd.Series(dtype='str'), 'Total_Contracted': pd.Series(dtype='float'),
                             'Utilized_30d': pd.Series(dtype='float'), 'Util_Rate': pd.Series(dtype='float')})

    # Write temp CSVs for P90 and THU if provided
    import tempfile, shutil
    tmpdir = tempfile.mkdtemp()
    orig_cwd = os.getcwd()
    os.chdir(tmpdir)
    os.makedirs('data', exist_ok=True)
    try:
        if p90 is not None:
            pd.DataFrame([{'Subject': row['Subject'], 'P90_NAT_Hours': p90}]).to_csv('data/nat_p90.csv', index=False)
        if thu_pct is not None:
            pd.DataFrame([{'Subject': row['Subject'], 'Tutor_Hours_Util_Pct': thu_pct}]).to_csv('data/tutor_hours_util.csv', index=False)
        result = classify_problems(analysis, util)
    finally:
        os.chdir(orig_cwd)
        shutil.rmtree(tmpdir)
    return result.iloc[0].to_dict()


class TestTieredP90Goals(unittest.TestCase):
    """Tests for get_p90_goal and NAT_P90_GOAL_BY_TIER."""

    def test_core_tier_goal(self):
        self.assertEqual(NAT_P90_GOAL_BY_TIER['CORE'], 24)

    def test_high_tier_goal(self):
        self.assertEqual(NAT_P90_GOAL_BY_TIER['HIGH'], 36)

    def test_medium_tier_goal(self):
        self.assertEqual(NAT_P90_GOAL_BY_TIER['MEDIUM'], 48)

    def test_low_tier_goal(self):
        self.assertEqual(NAT_P90_GOAL_BY_TIER['LOW'], 60)

    def test_niche_tier_goal(self):
        self.assertEqual(NAT_P90_GOAL_BY_TIER['NICHE'], 72)

    def test_get_p90_goal_uses_tier(self):
        row = {'Tier': 'CORE', 'Healthy_P90_Hours': None}
        self.assertEqual(get_p90_goal(row), 24)

    def test_get_p90_goal_defaults_to_48(self):
        row = {'Tier': 'UNKNOWN', 'Healthy_P90_Hours': None}
        self.assertEqual(get_p90_goal(row), 48)

    def test_get_p90_goal_override_wins(self):
        row = {'Tier': 'CORE', 'Healthy_P90_Hours': 12}
        self.assertEqual(get_p90_goal(row), 12.0)

    def test_get_p90_goal_ignores_nan_override(self):
        row = {'Tier': 'HIGH', 'Healthy_P90_Hours': float('nan')}
        self.assertEqual(get_p90_goal(row), 36)

    def test_get_p90_goal_ignores_zero_override(self):
        row = {'Tier': 'LOW', 'Healthy_P90_Hours': 0}
        self.assertEqual(get_p90_goal(row), 60)


class TestPrimaryAction(unittest.TestCase):
    """Tests for each Primary_Action classification branch."""

    def test_insufficient_data(self):
        r = _run_classify({'Subject': 'NoData', 'Needs_External_Levers': True}, util_rate=None, thu_pct=None)
        self.assertEqual(r['Primary_Action'], 'Insufficient Data')
        self.assertEqual(r['Problem_Type'], 'Supply Problem (No Util Data)')

    def test_hidden_supply(self):
        r = _run_classify({'Subject': 'Hidden', 'Needs_External_Levers': False, 'BTS_Total': 200},
                          util_rate=25, thu_pct=120)
        self.assertEqual(r['Primary_Action'], 'Investigate \u2014 Hidden Supply')
        self.assertEqual(r['Problem_Type'], 'Under-Used')

    def test_recruit_more_urgent(self):
        r = _run_classify({'Subject': 'Urgent', 'Needs_External_Levers': True, 'BTS_Total': 200},
                          util_rate=60, thu_pct=120)
        self.assertEqual(r['Primary_Action'], 'Recruit More \u2014 Urgent')
        self.assertEqual(r['Problem_Type'], 'True Supply Problem')

    def test_investigate_capacity_available(self):
        r = _run_classify({'Subject': 'Capacity', 'Needs_External_Levers': True, 'BTS_Total': 200},
                          util_rate=60, thu_pct=55)
        self.assertEqual(r['Primary_Action'], 'Investigate \u2014 Capacity Available')
        self.assertEqual(r['Problem_Type'], 'Under-Used')

    def test_recruit_more_standard(self):
        r = _run_classify({'Subject': 'Recruit', 'Needs_External_Levers': True, 'BTS_Total': 200},
                          util_rate=60, thu_pct=80)
        self.assertEqual(r['Primary_Action'], 'Recruit More')
        self.assertEqual(r['Problem_Type'], 'True Supply Problem')

    def test_reduce_forecast(self):
        r = _run_classify({
            'Subject': 'Reduce', 'Run_Rate': 35, 'Smoothed_Target': 30,
            'Needs_External_Levers': False, 'BTS_Total': 200,
        }, util_rate=25, thu_pct=45, p90=10)
        self.assertEqual(r['Primary_Action'], 'Reduce Forecast')
        self.assertEqual(r['Problem_Type'], 'Over-Supplied')

    def test_investigate_wait_times(self):
        r = _run_classify({
            'Subject': 'Waits', 'Run_Rate': 20, 'Smoothed_Target': 15,
            'Needs_External_Levers': False, 'BTS_Total': 200,
        }, util_rate=60, thu_pct=80, p90=100)
        self.assertEqual(r['Primary_Action'], 'Investigate \u2014 Wait Times')
        self.assertEqual(r['Problem_Type'], 'On Track \u2014 High Wait')

    def test_on_track(self):
        r = _run_classify({
            'Subject': 'Good', 'Run_Rate': 20, 'Smoothed_Target': 15,
            'Needs_External_Levers': False, 'BTS_Total': 200,
        }, util_rate=60, thu_pct=80, p90=10)
        self.assertEqual(r['Primary_Action'], 'On Track')
        self.assertEqual(r['Problem_Type'], 'On Track')

    def test_on_track_when_no_p90_data(self):
        r = _run_classify({
            'Subject': 'NOP90', 'Run_Rate': 20, 'Smoothed_Target': 15,
            'Needs_External_Levers': False, 'BTS_Total': 200,
        }, util_rate=60, thu_pct=80, p90=None)
        self.assertEqual(r['Primary_Action'], 'On Track')

    def test_needs_external_no_thu_recruits(self):
        r = _run_classify({'Subject': 'NoTHU', 'Needs_External_Levers': True, 'BTS_Total': 200},
                          util_rate=60, thu_pct=None)
        self.assertEqual(r['Primary_Action'], 'Recruit More')


class TestStressFlags(unittest.TestCase):
    """Tests for Stress_Flags assignment."""

    def test_burnout_risk(self):
        r = _run_classify({'Subject': 'Burn', 'Needs_External_Levers': True, 'BTS_Total': 200},
                          util_rate=60, thu_pct=125)
        self.assertIn('burnout_risk', r['Stress_Flags'])

    def test_idle_pool(self):
        r = _run_classify({'Subject': 'Idle', 'Needs_External_Levers': False, 'BTS_Total': 200,
                           'Run_Rate': 20, 'Smoothed_Target': 15},
                          util_rate=60, thu_pct=40)
        self.assertIn('idle_pool', r['Stress_Flags'])

    def test_new_tutor_stuck(self):
        r = _run_classify({'Subject': 'Stuck', 'Needs_External_Levers': False, 'BTS_Total': 200},
                          util_rate=25, thu_pct=120)
        self.assertIn('new_tutor_stuck', r['Stress_Flags'])

    def test_critical_wait(self):
        r = _run_classify({'Subject': 'CritW', 'Needs_External_Levers': False, 'BTS_Total': 200,
                           'Run_Rate': 20, 'Smoothed_Target': 15},
                          util_rate=60, thu_pct=80, p90=200)
        self.assertIn('critical_wait', r['Stress_Flags'])
        self.assertNotIn('high_wait', r['Stress_Flags'])

    def test_high_wait_but_not_critical(self):
        # BTS_Total=200 → CORE tier → P90 goal=24. P90=40 > 24*1.5=36 but < 24*2=48.
        r = _run_classify({'Subject': 'HiW', 'Needs_External_Levers': False, 'BTS_Total': 200,
                           'Run_Rate': 20, 'Smoothed_Target': 15},
                          util_rate=60, thu_pct=80, p90=40)
        self.assertIn('high_wait', r['Stress_Flags'])
        self.assertNotIn('critical_wait', r['Stress_Flags'])

    def test_no_flags_when_healthy(self):
        r = _run_classify({
            'Subject': 'Healthy', 'Run_Rate': 20, 'Smoothed_Target': 15,
            'Needs_External_Levers': False, 'BTS_Total': 200,
        }, util_rate=60, thu_pct=80, p90=10)
        self.assertEqual(r['Stress_Flags'], [])

    def test_multiple_flags_can_stack(self):
        r = _run_classify({'Subject': 'Multi', 'Needs_External_Levers': True, 'BTS_Total': 200},
                          util_rate=25, thu_pct=125, p90=200)
        self.assertIn('burnout_risk', r['Stress_Flags'])
        self.assertIn('new_tutor_stuck', r['Stress_Flags'])
        self.assertIn('critical_wait', r['Stress_Flags'])


class TestClassifyProblemsLegacy(unittest.TestCase):
    """Legacy tests: verify backward-compat Problem_Type mapping."""

    def _make_analysis_df(self, rows):
        return pd.DataFrame(rows)

    def _make_util_df(self, rows):
        return pd.DataFrame(rows)

    def test_true_supply_problem(self):
        analysis = self._make_analysis_df([_base_row(Subject='SAT')])
        util = self._make_util_df([_util_row('SAT', 62.0)])
        result = classify_problems(analysis, util)
        self.assertEqual(result.iloc[0]['Problem_Type'], 'True Supply Problem')

    def test_on_track(self):
        analysis = self._make_analysis_df([_base_row(
            Subject='Algebra', Run_Rate=20, Smoothed_Target=15, Raw_Gap=35,
            Coverage_Pct=133, Needs_External_Levers=False, BTS_Total=105,
        )])
        util = self._make_util_df([_util_row('Algebra', 75.0)])
        result = classify_problems(analysis, util)
        self.assertEqual(result.iloc[0]['Problem_Type'], 'On Track')

    def test_no_util_data(self):
        analysis = self._make_analysis_df([_base_row(Subject='NewSubject', BTS_Total=140)])
        util = pd.DataFrame({'Subject': pd.Series(dtype='str'), 'Total_Contracted': pd.Series(dtype='float'),
                             'Utilized_30d': pd.Series(dtype='float'), 'Util_Rate': pd.Series(dtype='float')})
        result = classify_problems(analysis, util)
        self.assertEqual(result.iloc[0]['Problem_Type'], 'Supply Problem (No Util Data)')

    def test_p90_goal_column_present(self):
        analysis = self._make_analysis_df([_base_row(Subject='PGoal', BTS_Total=200)])
        util = self._make_util_df([_util_row('PGoal', 60.0)])
        result = classify_problems(analysis, util)
        self.assertIn('P90_Goal', result.columns)


if __name__ == '__main__':
    unittest.main()
