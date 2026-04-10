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
            'Subject': 'SAT ',  # trailing space — should still match after normalization
            'Total_Contracted': 29, 'Utilized_30d': 18, 'Util_Rate': 62.0
        }])
        result = classify_problems(analysis, util)
        # Should match and classify as True Supply Problem (util 62% >= 50)
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
        # Group 1 (Aug/Sep/Oct): 15+12+18=45 -> 15, 15, 15
        self.assertEqual(result[4], 15)
        self.assertEqual(result[5], 15)
        self.assertEqual(result[6], 15)
        self.assertEqual(sum(result[4:7]), 45)

    def test_group2_smoothing(self):
        targets = [5, 15, 12, 18, 5, 5, 5]
        floors = [None] * 7
        adjusted = list(targets)
        result = apply_group_smoothing(targets, 10, floors, adjusted)
        # Group 2 (May/Jun/Jul): 15+12+18=45 -> 15, 15, 15
        self.assertEqual(result[1], 15)
        self.assertEqual(result[2], 15)
        self.assertEqual(result[3], 15)
        self.assertEqual(sum(result[1:4]), 45)

    def test_manual_floor_enforced(self):
        targets = [5, 5, 5, 5, 20, 10, 20]
        floors = [None, None, None, None, 18, None, None]
        adjusted = list(targets)
        result = apply_group_smoothing(targets, 10, floors, adjusted)
        # Group 1 total = 50, base = 16, middle gets remainder
        # But floor for Aug is 18, so it should be at least 18
        self.assertGreaterEqual(result[4], 18)

    def test_april_cascade_to_may(self):
        targets = [15, 5, 5, 5, 5, 5, 5]
        floors = [None] * 7
        adjusted = list(targets)
        result = apply_group_smoothing(targets, 10, floors, adjusted)
        # Group 2 not corrected (all <= 10), Apr > 10
        # Excess = 15-10=5, room in May = 10-5=5, absorb all 5
        self.assertEqual(result[0], 10)
        self.assertEqual(result[1], 10)

    def test_april_no_cascade_when_group2_corrected(self):
        targets = [15, 15, 15, 15, 5, 5, 5]
        floors = [None] * 7
        adjusted = list(targets)
        result = apply_group_smoothing(targets, 10, floors, adjusted)
        # Group 2 was corrected, so April is left alone
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


class TestClassifyProblems(unittest.TestCase):
    """Tests for the utilization-based problem classification."""

    def _make_analysis_df(self, rows):
        return pd.DataFrame(rows)

    def _make_util_df(self, rows):
        return pd.DataFrame(rows)

    def test_true_supply_problem(self):
        analysis = self._make_analysis_df([{
            'Subject': 'SAT', 'Run_Rate': 10, 'Smoothed_Target': 30,
            'Max_Capacity': 12, 'Gap_Pct': 200, 'Raw_Gap': -140,
            'Coverage_Pct': 33, 'Needs_External_Levers': True,
            'BTS_Total': 210, 'Is_Adjusted': False, 'Adjusted_Months': None,
            'Original_Model_Total': 210,
            'Apr_Original': 30, 'May_Original': 30, 'Jun_Original': 30,
            'Jul_Original': 30, 'Aug_Original': 30, 'Sep_Original': 30, 'Oct_Original': 30,
            'Apr_Smoothed': 30, 'May_Smoothed': 30, 'Jun_Smoothed': 30,
            'Jul_Smoothed': 30, 'Aug_Smoothed': 30, 'Sep_Smoothed': 30, 'Oct_Smoothed': 30,
            'Mar_Actual': None, 'Mar_Forecast': None,
        }])
        util = self._make_util_df([{
            'Subject': 'SAT', 'Total_Contracted': 29,
            'Utilized_30d': 18, 'Util_Rate': 62.0
        }])
        result = classify_problems(analysis, util)
        self.assertEqual(result.iloc[0]['Problem_Type'], 'True Supply Problem')

    def test_placement_issue(self):
        analysis = self._make_analysis_df([{
            'Subject': 'Chemistry', 'Run_Rate': 14, 'Smoothed_Target': 30,
            'Max_Capacity': 16.8, 'Gap_Pct': 114, 'Raw_Gap': -112,
            'Coverage_Pct': 47, 'Needs_External_Levers': True,
            'BTS_Total': 210, 'Is_Adjusted': False, 'Adjusted_Months': None,
            'Original_Model_Total': 210,
            'Apr_Original': 30, 'May_Original': 30, 'Jun_Original': 30,
            'Jul_Original': 30, 'Aug_Original': 30, 'Sep_Original': 30, 'Oct_Original': 30,
            'Apr_Smoothed': 30, 'May_Smoothed': 30, 'Jun_Smoothed': 30,
            'Jul_Smoothed': 30, 'Aug_Smoothed': 30, 'Sep_Smoothed': 30, 'Oct_Smoothed': 30,
            'Mar_Actual': None, 'Mar_Forecast': None,
        }])
        util = self._make_util_df([{
            'Subject': 'Chemistry', 'Total_Contracted': 21,
            'Utilized_30d': 9, 'Util_Rate': 43.0
        }])
        result = classify_problems(analysis, util)
        self.assertEqual(result.iloc[0]['Problem_Type'], 'Possible Placement Issue')

    def test_on_track(self):
        analysis = self._make_analysis_df([{
            'Subject': 'Algebra', 'Run_Rate': 20, 'Smoothed_Target': 15,
            'Max_Capacity': 24, 'Gap_Pct': -25, 'Raw_Gap': 35,
            'Coverage_Pct': 133, 'Needs_External_Levers': False,
            'BTS_Total': 105, 'Is_Adjusted': False, 'Adjusted_Months': None,
            'Original_Model_Total': 105,
            'Apr_Original': 15, 'May_Original': 15, 'Jun_Original': 15,
            'Jul_Original': 15, 'Aug_Original': 15, 'Sep_Original': 15, 'Oct_Original': 15,
            'Apr_Smoothed': 15, 'May_Smoothed': 15, 'Jun_Smoothed': 15,
            'Jul_Smoothed': 15, 'Aug_Smoothed': 15, 'Sep_Smoothed': 15, 'Oct_Smoothed': 15,
            'Mar_Actual': None, 'Mar_Forecast': None,
        }])
        util = self._make_util_df([{
            'Subject': 'Algebra', 'Total_Contracted': 40,
            'Utilized_30d': 30, 'Util_Rate': 75.0
        }])
        result = classify_problems(analysis, util)
        self.assertEqual(result.iloc[0]['Problem_Type'], 'On Track')

    def test_low_util_on_track(self):
        analysis = self._make_analysis_df([{
            'Subject': 'Physics', 'Run_Rate': 20, 'Smoothed_Target': 15,
            'Max_Capacity': 24, 'Gap_Pct': -25, 'Raw_Gap': 35,
            'Coverage_Pct': 133, 'Needs_External_Levers': False,
            'BTS_Total': 105, 'Is_Adjusted': False, 'Adjusted_Months': None,
            'Original_Model_Total': 105,
            'Apr_Original': 15, 'May_Original': 15, 'Jun_Original': 15,
            'Jul_Original': 15, 'Aug_Original': 15, 'Sep_Original': 15, 'Oct_Original': 15,
            'Apr_Smoothed': 15, 'May_Smoothed': 15, 'Jun_Smoothed': 15,
            'Jul_Smoothed': 15, 'Aug_Smoothed': 15, 'Sep_Smoothed': 15, 'Oct_Smoothed': 15,
            'Mar_Actual': None, 'Mar_Forecast': None,
        }])
        util = self._make_util_df([{
            'Subject': 'Physics', 'Total_Contracted': 20,
            'Utilized_30d': 8, 'Util_Rate': 40.0
        }])
        result = classify_problems(analysis, util)
        self.assertEqual(result.iloc[0]['Problem_Type'], 'On Track (Low Util)')

    def test_no_util_data(self):
        analysis = self._make_analysis_df([{
            'Subject': 'NewSubject', 'Run_Rate': 5, 'Smoothed_Target': 20,
            'Max_Capacity': 6, 'Gap_Pct': 300, 'Raw_Gap': -105,
            'Coverage_Pct': 25, 'Needs_External_Levers': True,
            'BTS_Total': 140, 'Is_Adjusted': False, 'Adjusted_Months': None,
            'Original_Model_Total': 140,
            'Apr_Original': 20, 'May_Original': 20, 'Jun_Original': 20,
            'Jul_Original': 20, 'Aug_Original': 20, 'Sep_Original': 20, 'Oct_Original': 20,
            'Apr_Smoothed': 20, 'May_Smoothed': 20, 'Jun_Smoothed': 20,
            'Jul_Smoothed': 20, 'Aug_Smoothed': 20, 'Sep_Smoothed': 20, 'Oct_Smoothed': 20,
            'Mar_Actual': None, 'Mar_Forecast': None,
        }])
        util = pd.DataFrame({
            'Subject': pd.Series(dtype='str'),
            'Total_Contracted': pd.Series(dtype='float'),
            'Utilized_30d': pd.Series(dtype='float'),
            'Util_Rate': pd.Series(dtype='float'),
        })
        result = classify_problems(analysis, util)
        self.assertEqual(result.iloc[0]['Problem_Type'], 'Supply Problem (No Util Data)')


if __name__ == '__main__':
    unittest.main()
