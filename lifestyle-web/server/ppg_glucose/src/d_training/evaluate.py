"""
Step D3: Evaluation
====================
Computes all metrics for regression and classification,
generates plots, and saves results.

Regression metrics:  MAE, RMSE, R², per-subject MAE
Classification:      Accuracy, Precision, Recall, F1, AUROC, Confusion Matrix
Clinical safety:     Clarke Error Grid (Zone A, B, C, D, E percentages)

Usage:
    python -m src.d_training.evaluate
"""

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from pathlib import Path
from sklearn.metrics import (
    mean_absolute_error, mean_squared_error, r2_score,
    accuracy_score, precision_score, recall_score, f1_score,
    roc_auc_score, confusion_matrix, classification_report,
    ConfusionMatrixDisplay,
)


# ── Clarke Error Grid ────────────────────────────────────────

def clarke_error_grid(y_true, y_pred):
    """
    Compute Clarke Error Grid zone assignments.

    Zones:
      A: clinically accurate (within 20% or both <70)
      B: benign errors (would not lead to inappropriate treatment)
      C: unnecessary treatment
      D: failure to detect hypo/hyperglycaemia
      E: erroneous treatment (confuse hypo for hyper or vice versa)

    Returns:
        dict with zone counts and percentages
    """
    zones = []
    for ref, pred in zip(y_true, y_pred):
        if (ref <= 70 and pred <= 70) or abs(ref - pred) <= 20:
            zones.append("A")
        elif ref <= 70 and pred > 70:
            # Could be B, C, D, or E depending on magnitude
            if pred <= 180:
                zones.append("B")
            else:
                zones.append("E")
        elif ref > 70 and ref <= 180:
            if abs(ref - pred) / ref <= 0.20:
                zones.append("A")
            elif pred < 70:
                zones.append("D")
            elif pred > 180:
                zones.append("B") if (pred - ref) / ref <= 0.40 else zones.append("C")
            else:
                zones.append("B")
        elif ref > 180:
            if abs(ref - pred) / ref <= 0.20:
                zones.append("A")
            elif pred < 70:
                zones.append("E")
            elif pred >= 70 and pred <= ref * 0.60:
                zones.append("D")
            else:
                zones.append("B")
        else:
            zones.append("B")

    zones = np.array(zones)
    total = len(zones)
    result = {}
    for z in ["A", "B", "C", "D", "E"]:
        count = np.sum(zones == z)
        result[f"Zone_{z}_count"] = count
        result[f"Zone_{z}_pct"] = count / total * 100

    result["Zone_AB_pct"] = result["Zone_A_pct"] + result["Zone_B_pct"]
    return result, zones


def plot_clarke_error_grid(y_true, y_pred, model_name, save_path):
    """Plot the Clarke Error Grid with zone boundaries."""
    fig, ax = plt.subplots(1, 1, figsize=(8, 8))

    # Plot data points
    ax.scatter(y_true, y_pred, alpha=0.6, s=40, c="#2563EB", edgecolors="white",
               linewidths=0.5, zorder=5)

    # Perfect prediction line
    ax.plot([0, 500], [0, 500], "k--", linewidth=0.8, alpha=0.4)

    # 20% bounds for Zone A
    x_line = np.linspace(70, 500, 100)
    ax.plot(x_line, x_line * 1.2, "g-", linewidth=0.5, alpha=0.3)
    ax.plot(x_line, x_line * 0.8, "g-", linewidth=0.5, alpha=0.3)

    # Zone boundaries (simplified)
    ax.axhline(70, color="gray", linewidth=0.5, linestyle=":")
    ax.axvline(70, color="gray", linewidth=0.5, linestyle=":")
    ax.axhline(180, color="gray", linewidth=0.5, linestyle=":")
    ax.axvline(180, color="gray", linewidth=0.5, linestyle=":")

    # Zone labels
    ax.text(35, 35, "A", fontsize=18, fontweight="bold", alpha=0.2, ha="center")
    ax.text(300, 300, "A", fontsize=18, fontweight="bold", alpha=0.2, ha="center")
    ax.text(400, 250, "B", fontsize=18, fontweight="bold", alpha=0.2, ha="center")
    ax.text(250, 400, "B", fontsize=18, fontweight="bold", alpha=0.2, ha="center")

    # Metrics text
    ceg, _ = clarke_error_grid(y_true, y_pred)
    mae = mean_absolute_error(y_true, y_pred)
    rmse = np.sqrt(mean_squared_error(y_true, y_pred))
    r2 = r2_score(y_true, y_pred)

    info_text = (f"MAE = {mae:.1f} mg/dL\n"
                 f"RMSE = {rmse:.1f} mg/dL\n"
                 f"R² = {r2:.3f}\n"
                 f"Zone A: {ceg['Zone_A_pct']:.1f}%\n"
                 f"Zone A+B: {ceg['Zone_AB_pct']:.1f}%")
    ax.text(0.03, 0.97, info_text, transform=ax.transAxes, fontsize=10,
            verticalalignment="top", fontfamily="monospace",
            bbox=dict(boxstyle="round", facecolor="white", alpha=0.8))

    ax.set_xlabel("Reference glucose (mg/dL)", fontsize=12)
    ax.set_ylabel("Predicted glucose (mg/dL)", fontsize=12)
    ax.set_title(f"Clarke Error Grid — {model_name}", fontsize=13, fontweight="500")
    ax.set_xlim(0, max(y_true.max(), y_pred.max()) + 20)
    ax.set_ylim(0, max(y_true.max(), y_pred.max()) + 20)
    ax.set_aspect("equal")
    ax.grid(alpha=0.15)

    plt.tight_layout()
    plt.savefig(save_path, dpi=150, bbox_inches="tight")
    plt.close()


# ── Evaluation functions ─────────────────────────────────────

def evaluate_regression(reg_results, df, output_dir):
    """Evaluate all regression models and save results."""
    output_dir = Path(output_dir)
    (output_dir / "clarke_grids").mkdir(parents=True, exist_ok=True)

    summary_rows = []

    for name, res in reg_results.items():
        y_true = res["y_true"]
        y_pred = res["oof_preds"]
        sids = res["sids"]

        mask = ~np.isnan(y_pred)
        yt, yp, ss = y_true[mask], y_pred[mask], sids[mask]

        # Overall metrics
        mae = mean_absolute_error(yt, yp)
        rmse = np.sqrt(mean_squared_error(yt, yp))
        r2 = r2_score(yt, yp)

        # Clarke Error Grid
        ceg, _ = clarke_error_grid(yt, yp)

        # Per-subject MAE
        per_subj_mae = []
        for sid in np.unique(ss):
            mask_s = ss == sid
            if mask_s.sum() > 0:
                s_mae = mean_absolute_error(yt[mask_s], yp[mask_s])
                per_subj_mae.append(s_mae)

        summary_rows.append({
            "model": name,
            "MAE": round(mae, 2),
            "RMSE": round(rmse, 2),
            "R2": round(r2, 4),
            "median_subject_MAE": round(np.median(per_subj_mae), 2),
            "Zone_A_pct": round(ceg["Zone_A_pct"], 1),
            "Zone_AB_pct": round(ceg["Zone_AB_pct"], 1),
        })

        # Clarke Error Grid plot
        plot_clarke_error_grid(
            yt, yp, name,
            output_dir / "clarke_grids" / f"clarke_{name}.png"
        )

    # Save summary
    summary_df = pd.DataFrame(summary_rows).sort_values("MAE")
    summary_df.to_csv(output_dir / "regression_results.csv", index=False)

    print("\n  REGRESSION RESULTS:")
    print(f"  {'Model':<15} {'MAE':>7} {'RMSE':>7} {'R²':>7} {'Med.MAE':>8} {'ZoneA':>6} {'ZoneAB':>7}")
    print("  " + "-" * 65)
    for _, row in summary_df.iterrows():
        print(f"  {row['model']:<15} {row['MAE']:>7.1f} {row['RMSE']:>7.1f} {row['R2']:>7.3f} "
              f"{row['median_subject_MAE']:>8.1f} {row['Zone_A_pct']:>5.1f}% {row['Zone_AB_pct']:>6.1f}%")

    return summary_df


def evaluate_classification(cls_results, df, output_dir):
    """Evaluate all classification models and save results."""
    output_dir = Path(output_dir)

    summary_rows = []

    for name, res in cls_results.items():
        y_true = res["y_true"]
        y_pred = res["oof_preds"]
        y_proba = res["oof_proba"]

        mask = y_pred >= 0
        yt, yp = y_true[mask], y_pred[mask]
        ypr = y_proba[mask] if not np.all(np.isnan(y_proba[mask])) else None

        acc = accuracy_score(yt, yp)
        prec = precision_score(yt, yp, zero_division=0)
        rec = recall_score(yt, yp, zero_division=0)
        f1 = f1_score(yt, yp, zero_division=0)

        # AUROC (needs probability scores)
        if ypr is not None and not np.all(np.isnan(ypr)):
            try:
                auroc = roc_auc_score(yt, ypr)
            except ValueError:
                auroc = np.nan
        else:
            auroc = np.nan

        # Confusion matrix
        cm = confusion_matrix(yt, yp)

        summary_rows.append({
            "model": name,
            "accuracy": round(acc, 3),
            "precision_hyper": round(prec, 3),
            "recall_hyper": round(rec, 3),
            "f1_hyper": round(f1, 3),
            "AUROC": round(auroc, 3) if not np.isnan(auroc) else "N/A",
            "TN": cm[0, 0] if cm.shape == (2, 2) else "N/A",
            "FP": cm[0, 1] if cm.shape == (2, 2) else "N/A",
            "FN": cm[1, 0] if cm.shape == (2, 2) else "N/A",
            "TP": cm[1, 1] if cm.shape == (2, 2) else "N/A",
        })

    summary_df = pd.DataFrame(summary_rows).sort_values("f1_hyper", ascending=False)
    summary_df.to_csv(output_dir / "classification_results.csv", index=False)

    print(f"\n  CLASSIFICATION RESULTS (threshold: 180 mg/dL)")
    print(f"  {'Model':<15} {'Acc':>6} {'Prec':>6} {'Recall':>7} {'F1':>6} {'AUROC':>6} {'TP':>4} {'FP':>4} {'FN':>4} {'TN':>4}")
    print("  " + "-" * 75)
    for _, row in summary_df.iterrows():
        print(f"  {row['model']:<15} {row['accuracy']:>6.3f} {row['precision_hyper']:>6.3f} "
              f"{row['recall_hyper']:>7.3f} {row['f1_hyper']:>6.3f} "
              f"{str(row['AUROC']):>6} {str(row['TP']):>4} {str(row['FP']):>4} "
              f"{str(row['FN']):>4} {str(row['TN']):>4}")

    return summary_df


def plot_regression_comparison(reg_summary, output_dir):
    """Bar chart comparing all regression models."""
    fig, axes = plt.subplots(1, 3, figsize=(15, 5))

    models = reg_summary["model"].values
    x = np.arange(len(models))

    for ax, metric, title, color in zip(
        axes,
        ["MAE", "RMSE", "R2"],
        ["MAE (mg/dL) ↓", "RMSE (mg/dL) ↓", "R² ↑"],
        ["#2563EB", "#DC2626", "#059669"],
    ):
        values = reg_summary[metric].values
        bars = ax.bar(x, values, color=color, alpha=0.7, edgecolor="white")
        ax.set_xticks(x)
        ax.set_xticklabels(models, rotation=45, ha="right", fontsize=9)
        ax.set_title(title, fontsize=12, fontweight="500")
        ax.grid(axis="y", alpha=0.2)

        # Add value labels
        for bar, val in zip(bars, values):
            ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height(),
                    f"{val:.1f}" if metric != "R2" else f"{val:.3f}",
                    ha="center", va="bottom", fontsize=8)

    plt.suptitle("Regression model comparison (subject-wise CV)", fontsize=14, fontweight="500")
    plt.tight_layout()
    plt.savefig(Path(output_dir) / "regression_comparison.png", dpi=150, bbox_inches="tight")
    plt.close()


def plot_classification_comparison(cls_summary, output_dir):
    """Bar chart comparing classification models."""
    fig, axes = plt.subplots(1, 3, figsize=(15, 5))

    models = cls_summary["model"].values
    x = np.arange(len(models))

    for ax, metric, title, color in zip(
        axes,
        ["accuracy", "recall_hyper", "f1_hyper"],
        ["Accuracy ↑", "Recall (hyperglycaemia) ↑", "F1 (hyperglycaemia) ↑"],
        ["#2563EB", "#DC2626", "#7C3AED"],
    ):
        values = cls_summary[metric].values.astype(float)
        bars = ax.bar(x, values, color=color, alpha=0.7, edgecolor="white")
        ax.set_xticks(x)
        ax.set_xticklabels(models, rotation=45, ha="right", fontsize=9)
        ax.set_title(title, fontsize=12, fontweight="500")
        ax.set_ylim(0, 1.05)
        ax.grid(axis="y", alpha=0.2)

        for bar, val in zip(bars, values):
            ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height(),
                    f"{val:.3f}", ha="center", va="bottom", fontsize=8)

    plt.suptitle("Classification model comparison — hyperglycaemia detection (>180 mg/dL)",
                 fontsize=14, fontweight="500")
    plt.tight_layout()
    plt.savefig(Path(output_dir) / "classification_comparison.png", dpi=150, bbox_inches="tight")
    plt.close()


def evaluate_multiclass(mc_results, df, output_dir):
    """Evaluate all multiclass glucose-zone models and save results."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    summary_rows = []

    for name, res in mc_results.items():
        y_true      = res["y_true"]
        y_pred      = res["oof_preds"]
        label_names = res["label_names"]
        n_classes   = len(label_names)

        mask = y_pred >= 0
        yt, yp = y_true[mask], y_pred[mask]

        # Overall metrics
        macro_f1    = f1_score(yt, yp, average="macro",    zero_division=0)
        weighted_f1 = f1_score(yt, yp, average="weighted", zero_division=0)
        off_by_one  = np.mean(np.abs(yp.astype(int) - yt.astype(int)) <= 1)

        # Per-class F1 from classification_report
        report = classification_report(
            yt, yp,
            labels=list(range(n_classes)),
            target_names=label_names,
            output_dict=True,
            zero_division=0,
        )

        row = {
            "model":          name,
            "macro_f1":       round(macro_f1,         4),
            "weighted_f1":    round(weighted_f1,       4),
            "off_by_one_acc": round(float(off_by_one), 4),
        }
        for lbl in label_names:
            row[f"f1_{lbl}"] = round(report.get(lbl, {}).get("f1-score", np.nan), 4)
        summary_rows.append(row)

        # Normalised confusion matrix heatmap
        fig, ax = plt.subplots(figsize=(8, 7))
        cm = confusion_matrix(yt, yp, labels=list(range(n_classes)), normalize="true")
        disp = ConfusionMatrixDisplay(confusion_matrix=cm, display_labels=label_names)
        disp.plot(ax=ax, colorbar=True, cmap="Blues", values_format=".2f")
        ax.set_title(f"Confusion matrix — {name} (normalised)", fontsize=13, fontweight="500")
        plt.tight_layout()
        plt.savefig(output_dir / f"confusion_matrix_{name}.png", dpi=150, bbox_inches="tight")
        plt.close()

    summary_df = pd.DataFrame(summary_rows).sort_values("macro_f1", ascending=False)
    summary_df.to_csv(output_dir / "multiclass_results.csv", index=False)

    label_names = list(mc_results.values())[0]["label_names"]
    print(f"\n  MULTICLASS RESULTS ({len(label_names)} zones: {', '.join(label_names)})")
    print(f"  {'Model':<15} {'macro_F1':>9} {'wt_F1':>7} {'OffBy1':>7}")
    print("  " + "-" * 44)
    for _, row in summary_df.iterrows():
        print(f"  {row['model']:<15} {row['macro_f1']:>9.4f} "
              f"{row['weighted_f1']:>7.4f} {row['off_by_one_acc']:>7.4f}")

    return summary_df


def plot_multiclass_comparison(mc_summary, output_dir):
    """Bar chart comparing multiclass glucose-zone models."""
    fig, axes = plt.subplots(1, 2, figsize=(12, 5))

    models = mc_summary["model"].values
    x = np.arange(len(models))

    for ax, metric, title, color in zip(
        axes,
        ["macro_f1", "off_by_one_acc"],
        ["Macro F1 ↑", "Off-by-one accuracy ↑"],
        ["#2563EB", "#059669"],
    ):
        values = mc_summary[metric].values.astype(float)
        bars = ax.bar(x, values, color=color, alpha=0.7, edgecolor="white")
        ax.set_xticks(x)
        ax.set_xticklabels(models, rotation=45, ha="right", fontsize=9)
        ax.set_title(title, fontsize=12, fontweight="500")
        ax.set_ylim(0, 1.05)
        ax.grid(axis="y", alpha=0.2)

        for bar, val in zip(bars, values):
            ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height(),
                    f"{val:.3f}", ha="center", va="bottom", fontsize=8)

    plt.suptitle("Multiclass glucose-zone model comparison (subject-wise CV)",
                 fontsize=14, fontweight="500")
    plt.tight_layout()
    plt.savefig(Path(output_dir) / "multiclass_comparison.png", dpi=150, bbox_inches="tight")
    plt.close()


def run_evaluation(reg_results, cls_results, mc_results, df, cfg):
    """Run the full evaluation pipeline."""
    output_dir = Path(cfg["output_dir"])
    output_dir.mkdir(parents=True, exist_ok=True)

    print("\n[D3] Evaluation")

    reg_summary = evaluate_regression(reg_results, df, output_dir)
    cls_summary = evaluate_classification(cls_results, df, output_dir)
    mc_summary  = evaluate_multiclass(mc_results, df, output_dir)

    # Generate plots
    plot_regression_comparison(reg_summary, output_dir)
    plot_classification_comparison(cls_summary, output_dir)
    plot_multiclass_comparison(mc_summary, output_dir)

    print(f"\n  Saved to {output_dir}/:")
    print(f"    regression_results.csv")
    print(f"    classification_results.csv")
    print(f"    multiclass_results.csv")
    print(f"    regression_comparison.png")
    print(f"    classification_comparison.png")
    print(f"    multiclass_comparison.png")
    print(f"    clarke_grids/ (one per regression model)")
    print(f"    confusion_matrix_{{model}}.png (one per multiclass model)")

    return reg_summary, cls_summary, mc_summary


# ── Standalone run ───────────────────────────────────────────
if __name__ == "__main__":
    from src.a_preprocessing.load_vitaldb import load_config
    from src.d_training.train import run_training

    cfg = load_config()

    # Train
    reg_results, cls_results, mc_results, features, df = run_training(cfg, "group_kfold_5")

    # Evaluate
    reg_summary, cls_summary, mc_summary = run_evaluation(
        reg_results, cls_results, mc_results, df, cfg
    )
