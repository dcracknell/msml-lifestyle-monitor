#!/usr/bin/env python3
"""
PPG-Glucose Pipeline - Main Entry Point
========================================
Runs all 4 pipeline stages in sequence with optional SQL integration.

Usage:
    # Demo (3 subjects, fast ~5-10 min):
    python run_pipeline.py --demo

    # Full run, no SQL:
    python run_pipeline.py

    # Demo + SQLite (easiest way to test SQL locally):
    python run_pipeline.py --demo --db-url "sqlite:///demo_results.db"

    # Full run + PostgreSQL:
    python run_pipeline.py --db-url "postgresql://user:pass@host:5432/ppg_db"

    # Full run + MySQL:
    python run_pipeline.py --db-url "mysql+pymysql://user:pass@host:3306/ppg_db"

    # Run only specific stages (B/C/D require prior stage outputs on disk):
    python run_pipeline.py --stages C D
"""

import argparse
import sys
import time
from datetime import datetime
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(
        description="PPG-Glucose pipeline runner",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--config",
        default="configs/vitaldb.yaml",
        help="Path to config YAML (default: configs/vitaldb.yaml)",
    )
    parser.add_argument(
        "--demo",
        action="store_true",
        help="Run with first 3 subjects only for a quick end-to-end demo",
    )
    parser.add_argument(
        "--db-url",
        default=None,
        metavar="URL",
        help=(
            "SQLAlchemy connection URL to persist results. Examples:\n"
            "  sqlite:///results.db\n"
            "  postgresql://user:pass@host:5432/ppg_db\n"
            "  mysql+pymysql://user:pass@host:3306/ppg_db"
        ),
    )
    parser.add_argument(
        "--stages",
        nargs="+",
        choices=["A", "B", "C", "D"],
        default=["A", "B", "C", "D"],
        metavar="STAGE",
        help=(
            "Stages to run: A=load+preprocess, B=features, "
            "C=selection, D=train+evaluate. Default: all"
        ),
    )
    parser.add_argument(
        "--protocol",
        default="group_kfold_5",
        choices=["group_kfold_5", "loso"],
        help="Cross-validation protocol for Stage D (default: group_kfold_5)",
    )
    return parser.parse_args()


def banner(msg):
    print(f"\n{'─' * 60}")
    print(f"  {msg}")
    print(f"{'─' * 60}")


def main():
    args = parse_args()

    print("=" * 65)
    print("  PPG → Glucose Prediction Pipeline  (VitalDB)")
    print(f"  Started : {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  Mode    : {'DEMO (3 subjects)' if args.demo else 'FULL (20 subjects)'}")
    print(f"  Stages  : {' → '.join(args.stages)}")
    print(f"  Protocol: {args.protocol}")
    if args.db_url:
        display_url = args.db_url.split("@")[-1] if "@" in args.db_url else args.db_url
        print(f"  DB      : {display_url}")
    print("=" * 65)

    t_total = time.time()

    # ── Load config ──────────────────────────────────────────────
    from src.a_preprocessing.load_vitaldb import load_config
    cfg = load_config(args.config)

    if args.demo:
        cfg["subjects"] = cfg["subjects"][:3]
        cfg["output_dir"] = "outputs/demo"
        Path(cfg["output_dir"]).mkdir(parents=True, exist_ok=True)
        print(f"\n[DEMO] Subjects : {cfg['subjects']}")
        print(f"[DEMO] Output   : {cfg['output_dir']}/")

    # ── Initialise database connection ───────────────────────────
    db = None
    run_id = None
    if args.db_url:
        from db.connector import PipelineDB
        db = PipelineDB(args.db_url)
        db.init_schema()
        run_id = (
            f"{'demo' if args.demo else 'full'}_"
            f"{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        )
        db.start_run(run_id, cfg, is_demo=args.demo)
        print(f"\n[DB] Schema ready. Run ID: {run_id}")

    try:
        segments = None

        # ── Stage A: Load + Preprocess ───────────────────────────
        if "A" in args.stages:
            banner("Stage A — Load & Preprocess")
            t0 = time.time()

            from src.a_preprocessing.load_vitaldb import load_all_subjects
            from src.a_preprocessing.preprocess import preprocess_all

            subjects = load_all_subjects(cfg)
            segments = preprocess_all(subjects, cfg)

            print(f"\n[A done] {len(segments)} segments in {time.time()-t0:.0f}s")

        # ── Stage B: Feature Extraction ──────────────────────────
        if "B" in args.stages:
            banner("Stage B — Feature Extraction")

            if segments is None:
                print("[ERROR] Stage B needs Stage A output (no segments in memory).")
                print("        Run with '--stages A B ...' or remove '--stages' to run all.")
                sys.exit(1)

            t0 = time.time()
            from src.b_features.build_master import build_master_table

            df_master = build_master_table(segments, cfg)
            print(f"\n[B done] {df_master.shape[0]}×{df_master.shape[1]} table in {time.time()-t0:.0f}s")

            if db:
                print("[DB] Writing master table rows...")
                db.save_master_table(run_id, df_master)
                print(f"[DB] {len(df_master)} rows saved to features_master")

        # ── Stage C: Feature Selection ───────────────────────────
        if "C" in args.stages:
            banner("Stage C — Feature Selection")
            t0 = time.time()

            from src.c_selection.select_features import run_feature_selection
            ranking, selected = run_feature_selection(cfg)

            print(f"\n[C done] {len(selected)} features selected from {len(ranking)} in {time.time()-t0:.0f}s")

            if db:
                print("[DB] Writing feature rankings...")
                db.save_feature_rankings(run_id, ranking, selected)
                print(f"[DB] {len(ranking)} rankings saved to feature_rankings")

        # ── Stage D: Train + Evaluate ────────────────────────────
        if "D" in args.stages:
            banner("Stage D — Training & Evaluation")
            t0 = time.time()

            from src.d_training.train import run_training
            from src.d_training.evaluate import run_evaluation

            reg_results, cls_results, mc_results, feature_cols, df = run_training(cfg, args.protocol)
            reg_summary, cls_summary, mc_summary = run_evaluation(
                reg_results, cls_results, mc_results, df, cfg
            )

            n_models = len(reg_summary) + len(cls_summary) + len(mc_summary)
            print(f"\n[D done] {n_models} models evaluated in {time.time()-t0:.0f}s")

            if db:
                print("[DB] Writing model results...")
                db.save_model_results(run_id, reg_summary, cls_summary, mc_summary)
                print(f"[DB] {n_models} model results saved to model_results")

        # ── Finished ─────────────────────────────────────────────
        elapsed = time.time() - t_total
        if db:
            db.complete_run(run_id, elapsed)

        print("\n" + "=" * 65)
        print(f"  PIPELINE COMPLETE")
        print(f"  Total time : {elapsed/60:.1f} min")
        print(f"  Outputs    : {Path(cfg['output_dir']).resolve()}/")
        if db:
            print(f"  DB run ID  : {run_id}")
        print("=" * 65)

    except KeyboardInterrupt:
        print("\n[INTERRUPTED] Stopped by user.")
        if db and run_id:
            db.fail_run(run_id, "Interrupted by user")
        sys.exit(1)

    except Exception as exc:
        print(f"\n[ERROR] {exc}")
        if db and run_id:
            db.fail_run(run_id, str(exc)[:500])
        raise


if __name__ == "__main__":
    main()
