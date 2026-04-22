"""
Tests for run_pipeline.py CLI argument parsing.

Run with:  pytest tests/test_cli.py -v
"""

import sys
import pytest
from unittest.mock import patch

from run_pipeline import parse_args


def args_from(argv):
    """Helper: parse a list of strings as if passed on the command line."""
    with patch("sys.argv", ["run_pipeline.py"] + argv):
        return parse_args()


class TestParseArgsDefaults:
    def test_default_config(self):
        args = args_from([])
        assert args.config == "configs/vitaldb.yaml"

    def test_default_demo_is_false(self):
        args = args_from([])
        assert args.demo is False

    def test_default_db_url_is_none(self):
        args = args_from([])
        assert args.db_url is None

    def test_default_stages_are_all(self):
        args = args_from([])
        assert sorted(args.stages) == ["A", "B", "C", "D"]

    def test_default_protocol(self):
        args = args_from([])
        assert args.protocol == "group_kfold_5"


class TestParseArgsDemo:
    def test_demo_flag_sets_true(self):
        args = args_from(["--demo"])
        assert args.demo is True

    def test_demo_combined_with_db_url(self):
        args = args_from(["--demo", "--db-url", "sqlite:///test.db"])
        assert args.demo is True
        assert args.db_url == "sqlite:///test.db"


class TestParseArgsDbUrl:
    def test_sqlite_url(self):
        args = args_from(["--db-url", "sqlite:///results.db"])
        assert args.db_url == "sqlite:///results.db"

    def test_postgresql_url(self):
        url = "postgresql://user:pass@localhost:5432/ppg_db"
        args = args_from(["--db-url", url])
        assert args.db_url == url

    def test_mysql_url(self):
        url = "mysql+pymysql://user:pass@localhost:3306/ppg_db"
        args = args_from(["--db-url", url])
        assert args.db_url == url


class TestParseArgsStages:
    def test_single_stage_a(self):
        args = args_from(["--stages", "A"])
        assert args.stages == ["A"]

    def test_stages_c_and_d(self):
        args = args_from(["--stages", "C", "D"])
        assert "C" in args.stages
        assert "D" in args.stages
        assert len(args.stages) == 2

    def test_invalid_stage_raises(self):
        with pytest.raises(SystemExit):
            args_from(["--stages", "X"])

    def test_all_stages_explicit(self):
        args = args_from(["--stages", "A", "B", "C", "D"])
        assert sorted(args.stages) == ["A", "B", "C", "D"]


class TestParseArgsProtocol:
    def test_loso_protocol(self):
        args = args_from(["--protocol", "loso"])
        assert args.protocol == "loso"

    def test_group_kfold_5_protocol(self):
        args = args_from(["--protocol", "group_kfold_5"])
        assert args.protocol == "group_kfold_5"

    def test_invalid_protocol_raises(self):
        with pytest.raises(SystemExit):
            args_from(["--protocol", "leave_one_out"])


class TestParseArgsCustomConfig:
    def test_custom_config_path(self):
        args = args_from(["--config", "configs/custom.yaml"])
        assert args.config == "configs/custom.yaml"
