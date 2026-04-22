"""
Tests that every pipeline module can be imported without errors.

If any of these fail it means a missing dependency or a syntax error
in the source code — fix it before deploying to the server.

Run with:  pytest tests/test_imports.py -v
"""

import importlib
import pytest


MODULES = [
    # Stage A
    "src.a_preprocessing.load_vitaldb",
    "src.a_preprocessing.preprocess",
    # Stage B
    "src.b_features.summary_stats",
    "src.b_features.morphology_prv",
    "src.b_features.emd_imf",
    "src.b_features.build_master",
    # Stage C
    "src.c_selection.select_features",
    # Stage D
    "src.d_training.split",
    "src.d_training.train",
    "src.d_training.evaluate",
    # Integration layer
    "db.connector",
    "run_pipeline",
]


@pytest.mark.parametrize("module", MODULES)
def test_module_importable(module):
    """Every src and db module must import without raising."""
    importlib.import_module(module)


def test_db_connector_classes_accessible():
    from db.connector import PipelineDB, PipelineRun, FeaturesMaster, FeatureRanking, ModelResult, _safe_float
    assert callable(PipelineDB)
    assert callable(_safe_float)


def test_run_pipeline_parse_args_importable():
    from run_pipeline import parse_args
    assert callable(parse_args)


def test_load_config_importable():
    from src.a_preprocessing.load_vitaldb import load_config, load_all_subjects
    assert callable(load_config)
    assert callable(load_all_subjects)


def test_preprocess_functions_importable():
    from src.a_preprocessing.preprocess import (
        bandpass_filter, preprocess_subject, preprocess_all,
    )
    assert callable(bandpass_filter)
    assert callable(preprocess_all)


def test_feature_functions_importable():
    from src.b_features.summary_stats import extract_summary_features
    from src.b_features.morphology_prv import extract_morphology_prv_features
    from src.b_features.emd_imf import extract_emd_features
    from src.b_features.build_master import build_master_table
    for fn in [extract_summary_features, extract_morphology_prv_features,
               extract_emd_features, build_master_table]:
        assert callable(fn)


def test_selection_functions_importable():
    from src.c_selection.select_features import run_feature_selection, load_master_table
    assert callable(run_feature_selection)
    assert callable(load_master_table)


def test_training_functions_importable():
    from src.d_training.train import run_training, get_regression_models, get_classification_models
    from src.d_training.evaluate import run_evaluation, clarke_error_grid
    from src.d_training.split import get_cv_splits
    for fn in [run_training, get_regression_models, get_classification_models,
               run_evaluation, clarke_error_grid, get_cv_splits]:
        assert callable(fn)
