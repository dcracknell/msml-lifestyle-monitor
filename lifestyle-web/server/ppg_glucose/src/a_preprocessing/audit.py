"""
Dataset quality audit module.

Will hold the core audit logic currently in scripts/dataset_quality_audit.py.
The script becomes a thin CLI wrapper around this module.

Outputs: per-segment SQI, spike fraction, quiet fraction, sub-window
clean fraction. Used by filter.py to gate the master table.
"""
