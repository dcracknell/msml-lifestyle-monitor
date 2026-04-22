"""
Create a self-contained HTML viewer for outputs/master_table.parquet.

Usage:
    python view_master_table.py
    python view_master_table.py --input outputs/master_table.parquet --output outputs/master_table_view.html
    python view_master_table.py --open
    python view_master_table.py --csv-output outputs/master_table.csv
    python view_master_table.py --excel-output outputs/master_table.xlsx
"""

from __future__ import annotations

import argparse
import base64
import html
import importlib.util
import io
import sys
import webbrowser
from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd


PROJECT_ROOT = Path(__file__).resolve().parent
DEFAULT_INPUT = PROJECT_ROOT / "outputs" / "master_table.parquet"
DEFAULT_OUTPUT = PROJECT_ROOT / "outputs" / "master_table_view.html"

GROUP_ORDER = [
    "metadata",
    "demographics",
    "w15m_summary",
    "w15m_morph_prv",
    "w15m_emd",
    "lag15m_summary",
    "lag15m_morph_prv",
    "lag15m_emd",
    "other",
]

GROUP_LABELS = {
    "metadata": "Metadata",
    "demographics": "Demographics",
    "w15m_summary": "Current Window Summary",
    "w15m_morph_prv": "Current Window Morphology/PRV",
    "w15m_emd": "Current Window EMD/IMF",
    "lag15m_summary": "Lag Window Summary",
    "lag15m_morph_prv": "Lag Window Morphology/PRV",
    "lag15m_emd": "Lag Window EMD/IMF",
    "other": "Other",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build an HTML viewer for the master parquet table.")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT, help="Path to master_table.parquet")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Path to output HTML viewer")
    parser.add_argument("--open", action="store_true", help="Open the generated HTML viewer in the default browser")
    parser.add_argument("--csv-output", type=Path, default=None, help="Optional CSV export path")
    parser.add_argument("--excel-output", type=Path, default=None, help="Optional Excel export path")
    return parser.parse_args()


def classify_column(column: str) -> str:
    if column in {"sid", "glucose_time_sec", "glucose_mgdl"}:
        return "metadata"
    if column.startswith("demo_"):
        return "demographics"
    if column.startswith("w15m_imf"):
        return "w15m_emd"
    if column.startswith("lag15m_imf"):
        return "lag15m_emd"
    if column.startswith(("w15m_prv", "w15m_pulse", "w15m_sys", "w15m_dia", "w15m_rise", "w15m_fall")):
        return "w15m_morph_prv"
    if column.startswith(("lag15m_prv", "lag15m_pulse", "lag15m_sys", "lag15m_dia", "lag15m_rise", "lag15m_fall")):
        return "lag15m_morph_prv"
    if column.startswith("w15m_"):
        return "w15m_summary"
    if column.startswith("lag15m_"):
        return "lag15m_summary"
    return "other"


def slugify(value: str) -> str:
    return "".join(ch if ch.isalnum() else "-" for ch in value.lower()).strip("-")


def format_value(value: object) -> str:
    if pd.isna(value):
        return ""

    if isinstance(value, (np.integer, int)):
        return str(int(value))

    if isinstance(value, (np.floating, float)):
        value = float(value)
        if value.is_integer() and abs(value) < 1_000_000:
            return str(int(value))
        return f"{value:.4g}"

    return str(value)


def fig_to_base64(fig: plt.Figure) -> str:
    buffer = io.BytesIO()
    fig.savefig(buffer, format="png", dpi=170, bbox_inches="tight")
    plt.close(fig)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def build_group_stats(df: pd.DataFrame) -> list[dict[str, object]]:
    stats: list[dict[str, object]] = []

    for group in GROUP_ORDER:
        columns = [col for col in df.columns if classify_column(col) == group]
        if not columns:
            continue

        missing_cells = int(df[columns].isna().sum().sum())
        total_cells = max(len(df) * len(columns), 1)
        stats.append(
            {
                "key": group,
                "label": GROUP_LABELS[group],
                "columns": len(columns),
                "missing_cells": missing_cells,
                "missing_pct": 100.0 * missing_cells / total_cells,
            }
        )

    return stats


def build_column_catalog(df: pd.DataFrame) -> pd.DataFrame:
    records = []
    row_count = len(df)

    for column in df.columns:
        missing_count = int(df[column].isna().sum())
        records.append(
            {
                "column": column,
                "group": GROUP_LABELS[classify_column(column)],
                "dtype": str(df[column].dtype),
                "missing_count": missing_count,
                "missing_pct": 100.0 * missing_count / max(row_count, 1),
            }
        )

    return pd.DataFrame(records).sort_values(["group", "column"]).reset_index(drop=True)


def build_plots(df: pd.DataFrame, group_stats: list[dict[str, object]]) -> list[dict[str, str]]:
    plots: list[dict[str, str]] = []

    if "glucose_mgdl" in df.columns:
        fig, ax = plt.subplots(figsize=(6.2, 3.6))
        ax.hist(df["glucose_mgdl"].dropna(), bins=18, color="#0f766e", edgecolor="white")
        ax.set_title("Glucose Distribution")
        ax.set_xlabel("Glucose (mg/dL)")
        ax.set_ylabel("Count")
        ax.grid(axis="y", alpha=0.2)
        fig.tight_layout()
        plots.append({"title": "Glucose Distribution", "image": fig_to_base64(fig)})

    if group_stats:
        fig, ax = plt.subplots(figsize=(7.2, 3.8))
        labels = [item["label"] for item in group_stats]
        counts = [item["columns"] for item in group_stats]
        ax.barh(labels, counts, color="#2563eb")
        ax.set_title("Columns Per Feature Family")
        ax.set_xlabel("Column Count")
        ax.invert_yaxis()
        ax.grid(axis="x", alpha=0.2)
        fig.tight_layout()
        plots.append({"title": "Columns Per Feature Family", "image": fig_to_base64(fig)})

    missing_pct = df.isna().mean().sort_values(ascending=False)
    missing_pct = missing_pct[missing_pct > 0].head(15)
    if not missing_pct.empty:
        fig, ax = plt.subplots(figsize=(7.2, 4.2))
        ax.barh(missing_pct.index[::-1], (missing_pct.values[::-1] * 100.0), color="#ea580c")
        ax.set_title("Highest Missingness Columns")
        ax.set_xlabel("Missing Values (%)")
        ax.grid(axis="x", alpha=0.2)
        fig.tight_layout()
        plots.append({"title": "Highest Missingness Columns", "image": fig_to_base64(fig)})

    return plots


def build_cards_html(df: pd.DataFrame) -> str:
    missing_cells = int(df.isna().sum().sum())
    total_cells = max(df.shape[0] * df.shape[1], 1)
    unique_sid = int(df["sid"].nunique()) if "sid" in df.columns else 0
    glucose_min = format_value(df["glucose_mgdl"].min()) if "glucose_mgdl" in df.columns else "-"
    glucose_max = format_value(df["glucose_mgdl"].max()) if "glucose_mgdl" in df.columns else "-"

    cards = [
        ("Rows", f"{len(df):,}"),
        ("Columns", f"{df.shape[1]:,}"),
        ("Unique Subjects", f"{unique_sid:,}"),
        ("Missing Cells", f"{missing_cells:,} ({100.0 * missing_cells / total_cells:.1f}%)"),
        ("Glucose Range", f"{glucose_min} to {glucose_max} mg/dL"),
    ]

    parts = []
    for label, value in cards:
        parts.append(
            f"""
            <div class="card">
              <div class="card-label">{html.escape(label)}</div>
              <div class="card-value">{html.escape(value)}</div>
            </div>
            """
        )
    return "".join(parts)


def build_group_cards_html(group_stats: list[dict[str, object]]) -> str:
    parts = []
    for item in group_stats:
        group_key = slugify(str(item["key"]))
        parts.append(
            f"""
            <div class="group-card group-{group_key}">
              <div class="group-title">{html.escape(str(item["label"]))}</div>
              <div class="group-metric">{int(item["columns"]):,} columns</div>
              <div class="group-submetric">{float(item["missing_pct"]):.1f}% missing cells</div>
            </div>
            """
        )
    return "".join(parts)


def build_plot_html(plots: list[dict[str, str]]) -> str:
    parts = []
    for plot in plots:
        parts.append(
            f"""
            <div class="plot-card">
              <div class="section-title">{html.escape(plot["title"])}</div>
              <img alt="{html.escape(plot["title"])}" src="data:image/png;base64,{plot["image"]}">
            </div>
            """
        )
    return "".join(parts)


def build_button_html(group_stats: list[dict[str, object]]) -> str:
    buttons = ['<button class="group-button active" data-group="all" type="button">All Columns</button>']
    for item in group_stats:
        buttons.append(
            f'<button class="group-button" data-group="{html.escape(str(item["key"]))}" type="button">'
            f'{html.escape(str(item["label"]))}</button>'
        )
    return "".join(buttons)


def build_main_table_html(df: pd.DataFrame) -> str:
    columns = list(df.columns)

    header_cells = []
    for idx, column in enumerate(columns):
        group = classify_column(column)
        group_slug = slugify(group)
        classes = [f"group-{group_slug}"]
        if idx < 3:
            classes.append(f"sticky-{idx + 1}")

        header_cells.append(
            f'<th class="{" ".join(classes)}" data-col-group="{html.escape(group)}">{html.escape(column)}</th>'
        )

    body_rows = []
    for _, row in df.iterrows():
        sid_value = format_value(row.get("sid", ""))
        row_cells = []
        for idx, column in enumerate(columns):
            group = classify_column(column)
            group_slug = slugify(group)
            classes = [f"group-{group_slug}"]
            if idx < 3:
                classes.append(f"sticky-{idx + 1}")
            row_cells.append(
                f'<td class="{" ".join(classes)}" data-col-group="{html.escape(group)}">'
                f'{html.escape(format_value(row[column]))}</td>'
            )

        body_rows.append(
            f'<tr data-sid="{html.escape(str(sid_value).lower())}">{"".join(row_cells)}</tr>'
        )

    return (
        "<table id=\"master-table\">"
        f"<thead><tr>{''.join(header_cells)}</tr></thead>"
        f"<tbody id=\"data-body\">{''.join(body_rows)}</tbody>"
        "</table>"
    )


def build_catalog_html(catalog: pd.DataFrame) -> str:
    rows = []
    for _, row in catalog.iterrows():
        rows.append(
            "<tr "
            f"data-column-name=\"{html.escape(str(row['column']).lower())}\" "
            f"data-column-group=\"{html.escape(str(row['group']).lower())}\">"
            f"<td>{html.escape(str(row['column']))}</td>"
            f"<td>{html.escape(str(row['group']))}</td>"
            f"<td>{html.escape(str(row['dtype']))}</td>"
            f"<td>{int(row['missing_count']):,}</td>"
            f"<td>{float(row['missing_pct']):.1f}%</td>"
            "</tr>"
        )

    return (
        "<table id=\"catalog-table\">"
        "<thead><tr><th>Column</th><th>Group</th><th>Dtype</th><th>Missing</th><th>Missing %</th></tr></thead>"
        f"<tbody id=\"catalog-body\">{''.join(rows)}</tbody>"
        "</table>"
    )


def render_html(df: pd.DataFrame, input_path: Path) -> str:
    group_stats = build_group_stats(df)
    plots = build_plots(df, group_stats)
    catalog = build_column_catalog(df)

    html_parts = [
        "<!doctype html>",
        "<html lang=\"en\">",
        "<head>",
        "<meta charset=\"utf-8\">",
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
        "<title>Master Table Viewer</title>",
        """
        <style>
        :root {
          --bg: #f8fafc;
          --panel: #ffffff;
          --line: #dbe4ee;
          --text: #0f172a;
          --muted: #475569;
          --sticky-1-width: 88px;
          --sticky-2-width: 140px;
          --sticky-3-width: 120px;
        }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          background: linear-gradient(180deg, #eef6ff 0%, var(--bg) 28%);
          color: var(--text);
          font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
        }
        .page {
          max-width: 1600px;
          margin: 0 auto;
          padding: 28px 20px 40px;
        }
        .hero {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          align-items: flex-end;
          margin-bottom: 20px;
        }
        h1 {
          margin: 0 0 8px;
          font-size: 2rem;
          letter-spacing: -0.03em;
        }
        .subtitle {
          margin: 0;
          color: var(--muted);
          max-width: 900px;
        }
        .source {
          color: var(--muted);
          font-size: 0.95rem;
          text-align: right;
        }
        .card-grid,
        .group-grid,
        .plot-grid {
          display: grid;
          gap: 14px;
          margin-bottom: 18px;
        }
        .card-grid { grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); }
        .group-grid { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
        .plot-grid { grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
        .card,
        .group-card,
        .plot-card,
        .panel {
          background: var(--panel);
          border: 1px solid var(--line);
          border-radius: 18px;
          box-shadow: 0 10px 26px rgba(15, 23, 42, 0.06);
        }
        .card,
        .group-card {
          padding: 16px 18px;
        }
        .card-label,
        .group-submetric,
        .meta-note {
          color: var(--muted);
          font-size: 0.92rem;
        }
        .card-value,
        .group-metric {
          margin-top: 8px;
          font-size: 1.35rem;
          font-weight: 700;
        }
        .group-title,
        .section-title {
          font-weight: 700;
          font-size: 1rem;
        }
        .plot-card {
          padding: 14px;
        }
        .plot-card img {
          width: 100%;
          display: block;
          border-radius: 12px;
        }
        .panel {
          padding: 16px;
          margin-bottom: 18px;
        }
        .controls {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          align-items: center;
          margin-top: 12px;
          margin-bottom: 14px;
        }
        .controls label {
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-size: 0.92rem;
          color: var(--muted);
        }
        .controls input,
        .controls select {
          min-width: 180px;
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid #c7d2fe;
          background: #ffffff;
        }
        .button-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 12px;
        }
        .group-button {
          border: 1px solid #bfdbfe;
          background: #eff6ff;
          color: #1d4ed8;
          border-radius: 999px;
          padding: 9px 14px;
          cursor: pointer;
          font-weight: 600;
        }
        .group-button.active {
          background: #1d4ed8;
          color: #ffffff;
          border-color: #1d4ed8;
        }
        .table-shell {
          overflow: auto;
          max-height: 70vh;
          border-radius: 16px;
          border: 1px solid var(--line);
        }
        table {
          border-collapse: separate;
          border-spacing: 0;
          width: max-content;
          min-width: 100%;
          font-size: 0.8rem;
        }
        th,
        td {
          padding: 7px 10px;
          border-right: 1px solid #e6eef8;
          border-bottom: 1px solid #e6eef8;
          white-space: nowrap;
          background: #ffffff;
        }
        th {
          position: sticky;
          top: 0;
          z-index: 2;
          text-align: left;
          font-size: 0.76rem;
          text-transform: none;
        }
        tbody tr:nth-child(even) td {
          background: #fafcff;
        }
        .sticky-1, .sticky-2, .sticky-3 {
          position: sticky;
          z-index: 3;
          background: #f8fbff;
          font-weight: 600;
        }
        th.sticky-1, th.sticky-2, th.sticky-3 {
          z-index: 4;
        }
        .sticky-1 {
          left: 0;
          min-width: var(--sticky-1-width);
          max-width: var(--sticky-1-width);
        }
        .sticky-2 {
          left: var(--sticky-1-width);
          min-width: var(--sticky-2-width);
          max-width: var(--sticky-2-width);
        }
        .sticky-3 {
          left: calc(var(--sticky-1-width) + var(--sticky-2-width));
          min-width: var(--sticky-3-width);
          max-width: var(--sticky-3-width);
        }
        .group-metadata { background: #dbeafe; }
        .group-demographics { background: #fee2e2; }
        .group-w15m-summary { background: #dcfce7; }
        .group-w15m-morph-prv { background: #fef3c7; }
        .group-w15m-emd { background: #fae8ff; }
        .group-lag15m-summary { background: #cffafe; }
        .group-lag15m-morph-prv { background: #ffedd5; }
        .group-lag15m-emd { background: #ede9fe; }
        .group-other { background: #e2e8f0; }
        .group-card.group-metadata,
        .group-card.group-demographics,
        .group-card.group-w15m-summary,
        .group-card.group-w15m-morph-prv,
        .group-card.group-w15m-emd,
        .group-card.group-lag15m-summary,
        .group-card.group-lag15m-morph-prv,
        .group-card.group-lag15m-emd,
        .group-card.group-other {
          border-width: 2px;
        }
        .is-hidden-col,
        .is-hidden-row {
          display: none;
        }
        .table-footer {
          margin-top: 10px;
          color: var(--muted);
          font-size: 0.9rem;
        }
        .catalog-shell {
          overflow: auto;
          max-height: 42vh;
          border: 1px solid var(--line);
          border-radius: 16px;
        }
        @media (max-width: 900px) {
          .hero { flex-direction: column; align-items: flex-start; }
          .source { text-align: left; }
          .controls input,
          .controls select { min-width: 140px; }
        }
        </style>
        """,
        "</head>",
        "<body>",
        "<div class=\"page\">",
        "<section class=\"hero\">",
        "<div>",
        "<h1>Master Table Viewer</h1>",
        "<p class=\"subtitle\">"
        "Interactive HTML overview for the merged PPG feature table. "
        "Use the group buttons to focus on one feature family while keeping the key identifier columns pinned."
        "</p>",
        "</div>",
        "<div class=\"source\">",
        f"<div>Source: {html.escape(str(input_path))}</div>",
        f"<div>Generated from {len(df):,} rows and {df.shape[1]:,} columns</div>",
        "</div>",
        "</section>",
        f"<section class=\"card-grid\">{build_cards_html(df)}</section>",
        f"<section class=\"plot-grid\">{build_plot_html(plots)}</section>",
        "<section class=\"panel\">",
        "<div class=\"section-title\">Feature Families</div>",
        "<p class=\"meta-note\">"
        "Missingness is reported as the percentage of empty cells inside each feature family."
        "</p>",
        f"<div class=\"group-grid\">{build_group_cards_html(group_stats)}</div>",
        "</section>",
        "<section class=\"panel\">",
        "<div class=\"section-title\">Row Table</div>",
        "<div class=\"controls\">",
        "<label>Filter by SID<input id=\"sid-filter\" type=\"text\" placeholder=\"e.g. 184\"></label>",
        "<label>Visible rows<select id=\"row-limit\">"
        "<option value=\"25\">25</option>"
        "<option value=\"50\">50</option>"
        "<option value=\"100\">100</option>"
        "<option value=\"all\">All</option>"
        "</select></label>",
        "</div>",
        f"<div class=\"button-row\">{build_button_html(group_stats)}</div>",
        "<div class=\"table-shell\">",
        build_main_table_html(df),
        "</div>",
        "<div class=\"table-footer\" id=\"row-counter\"></div>",
        "</section>",
        "<section class=\"panel\">",
        "<div class=\"section-title\">Column Catalog</div>",
        "<div class=\"controls\">",
        "<label>Search columns<input id=\"catalog-filter\" type=\"text\" placeholder=\"e.g. prv or glucose\"></label>",
        "</div>",
        "<div class=\"catalog-shell\">",
        build_catalog_html(catalog),
        "</div>",
        "<div class=\"table-footer\" id=\"catalog-counter\"></div>",
        "</section>",
        "</div>",
        """
        <script>
        const sidFilter = document.getElementById("sid-filter");
        const rowLimit = document.getElementById("row-limit");
        const rowCounter = document.getElementById("row-counter");
        const groupButtons = Array.from(document.querySelectorAll(".group-button"));
        const groupCells = Array.from(document.querySelectorAll("[data-col-group]"));
        const tableRows = Array.from(document.querySelectorAll("#data-body tr"));
        const catalogFilter = document.getElementById("catalog-filter");
        const catalogRows = Array.from(document.querySelectorAll("#catalog-body tr"));
        const catalogCounter = document.getElementById("catalog-counter");

        let activeGroup = "all";

        function applyGroupFilter() {
          groupCells.forEach((cell) => {
            const group = cell.dataset.colGroup;
            const keep = activeGroup === "all" || group === "metadata" || group === activeGroup;
            cell.classList.toggle("is-hidden-col", !keep);
          });

          groupButtons.forEach((button) => {
            button.classList.toggle("active", button.dataset.group === activeGroup);
          });
        }

        function applyRowFilter() {
          const sidQuery = sidFilter.value.trim().toLowerCase();
          const limitValue = rowLimit.value === "all" ? Number.POSITIVE_INFINITY : Number(rowLimit.value);

          let matched = 0;
          let shown = 0;
          tableRows.forEach((row) => {
            const rowSid = row.dataset.sid || "";
            const matches = !sidQuery || rowSid.includes(sidQuery);
            if (matches) {
              matched += 1;
            }

            const shouldShow = matches && shown < limitValue;
            row.classList.toggle("is-hidden-row", !shouldShow);
            if (shouldShow) {
              shown += 1;
            }
          });

          rowCounter.textContent = `${shown} rows shown of ${matched} matching rows`;
        }

        function applyCatalogFilter() {
          const query = catalogFilter.value.trim().toLowerCase();
          let visible = 0;
          catalogRows.forEach((row) => {
            const haystack = `${row.dataset.columnName} ${row.dataset.columnGroup}`;
            const keep = !query || haystack.includes(query);
            row.classList.toggle("is-hidden-row", !keep);
            if (keep) {
              visible += 1;
            }
          });
          catalogCounter.textContent = `${visible} catalog rows shown`;
        }

        groupButtons.forEach((button) => {
          button.addEventListener("click", () => {
            activeGroup = button.dataset.group;
            applyGroupFilter();
          });
        });

        sidFilter.addEventListener("input", applyRowFilter);
        rowLimit.addEventListener("change", applyRowFilter);
        catalogFilter.addEventListener("input", applyCatalogFilter);

        applyGroupFilter();
        applyRowFilter();
        applyCatalogFilter();
        </script>
        """,
        "</body>",
        "</html>",
    ]

    return "".join(html_parts)


def detect_excel_engine() -> str | None:
    for engine in ("openpyxl", "xlsxwriter"):
        if importlib.util.find_spec(engine) is not None:
            return engine
    return None


def export_csv(df: pd.DataFrame, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(output_path, index=False)
    print(f"CSV export written to: {output_path}")


def export_excel(df: pd.DataFrame, output_path: Path) -> None:
    engine = detect_excel_engine()
    if engine is None:
        print(
            "Excel export skipped: install 'openpyxl' or 'xlsxwriter' in the virtual environment to enable .xlsx output.",
            file=sys.stderr,
        )
        return

    output_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_excel(output_path, index=False, engine=engine)
    print(f"Excel export written to: {output_path}")


def open_in_browser(output_path: Path) -> None:
    opened = webbrowser.open(output_path.resolve().as_uri())
    if opened:
        print(f"Opened viewer in browser: {output_path}")
    else:
        print(f"Browser open request was not acknowledged for: {output_path}", file=sys.stderr)


def main() -> None:
    args = parse_args()
    input_path = args.input.resolve()
    output_path = args.output.resolve()
    csv_output = args.csv_output.resolve() if args.csv_output else None
    excel_output = args.excel_output.resolve() if args.excel_output else None

    if not input_path.exists():
        raise SystemExit(f"Input parquet not found: {input_path}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    df = pd.read_parquet(input_path)
    html_text = render_html(df, input_path)
    output_path.write_text(html_text, encoding="utf-8")

    print(f"HTML viewer written to: {output_path}")
    print(f"Rows: {len(df)}")
    print(f"Columns: {df.shape[1]}")

    if csv_output is not None:
        export_csv(df, csv_output)

    if excel_output is not None:
        export_excel(df, excel_output)

    if args.open:
        open_in_browser(output_path)


if __name__ == "__main__":
    main()
