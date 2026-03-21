#!/usr/bin/env python3
"""
MSML Lifestyle Monitor — graphical setup wizard.
Double-click, fill in the form, hit Deploy.
"""

import os
import re
import secrets
import subprocess
import threading
import tkinter as tk
from tkinter import font as tkfont
from tkinter import messagebox, ttk

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_EXAMPLE = os.path.join(SCRIPT_DIR, "server", ".env.example")
ENV_OUT = os.path.join(SCRIPT_DIR, "server", ".env")

# ── colours ────────────────────────────────────────────────────────────────────
BG       = "#0a1628"
PANEL    = "#0f2035"
ACCENT   = "#00e5cc"
MUTED    = "#8a9bb0"
TEXT     = "#ffffff"
DANGER   = "#ff6b81"
SUCCESS  = "#2dd4bf"
BORDER   = "#1c3454"
ENTRY_BG = "#0c1934"

# ── helpers ────────────────────────────────────────────────────────────────────

def gen_secret():
    return secrets.token_hex(32)


def find_compose():
    """Return the docker compose command available on this machine."""
    try:
        subprocess.run(["docker", "compose", "version"],
                       capture_output=True, check=True)
        return ["docker", "compose"]
    except Exception:
        pass
    try:
        subprocess.run(["docker-compose", "version"],
                       capture_output=True, check=True)
        return ["docker-compose"]
    except Exception:
        return None


def write_env(values: dict):
    """Read .env.example, substitute known keys, write to .env."""
    if not os.path.exists(ENV_EXAMPLE):
        raise FileNotFoundError(f"Template not found: {ENV_EXAMPLE}")

    with open(ENV_EXAMPLE) as f:
        lines = f.readlines()

    seen = set()
    out = []
    for line in lines:
        m = re.match(r'^([A-Z_][A-Z0-9_]*)=', line)
        if m:
            key = m.group(1)
            seen.add(key)
            if key in values:
                out.append(f"{key}={values[key]}\n")
                continue
        out.append(line)

    # Append any keys not already in the template
    for key, val in values.items():
        if key not in seen:
            out.append(f"{key}={val}\n")

    with open(ENV_OUT, "w") as f:
        f.writelines(out)


# ── styled widget helpers ──────────────────────────────────────────────────────

def label(parent, text, size=10, bold=False, color=TEXT, **kw):
    f = tkfont.Font(family="Helvetica", size=size,
                    weight="bold" if bold else "normal")
    return tk.Label(parent, text=text, font=f, fg=color, bg=PANEL, **kw)


def section_label(parent, text):
    f = tkfont.Font(family="Helvetica", size=9, weight="bold")
    frm = tk.Frame(parent, bg=PANEL)
    tk.Label(frm, text=text.upper(), font=f, fg=ACCENT, bg=PANEL).pack(side="left")
    tk.Frame(frm, height=1, bg=BORDER).pack(side="left", fill="x", expand=True, padx=(8, 0))
    return frm


def entry(parent, show=None, width=32):
    e = tk.Entry(parent, show=show, width=width,
                 bg=ENTRY_BG, fg=TEXT, insertbackground=TEXT,
                 relief="flat", bd=0,
                 highlightthickness=1, highlightbackground=BORDER,
                 highlightcolor=ACCENT)
    return e


def button(parent, text, command, color=ACCENT, fg=BG, width=None):
    kw = dict(width=width) if width else {}
    b = tk.Button(parent, text=text, command=command,
                  bg=color, fg=fg, activebackground=color, activeforeground=fg,
                  relief="flat", bd=0, padx=10, pady=6,
                  cursor="hand2", font=tkfont.Font(family="Helvetica", size=10, weight="bold"),
                  **kw)
    return b


# ── main window ────────────────────────────────────────────────────────────────

class SetupWizard(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("MSML Lifestyle Monitor — Setup")
        self.configure(bg=BG)
        self.resizable(False, False)
        self._compose_cmd = find_compose()
        self._build_ui()
        self._centre()

    # ── layout ─────────────────────────────────────────────────────────────────

    def _build_ui(self):
        # ── header ──────────────────────────────────────────────────────────────
        hdr = tk.Frame(self, bg=BG, pady=16)
        hdr.pack(fill="x", padx=24)
        tk.Label(hdr, text="MSML Lifestyle Monitor",
                 font=tkfont.Font(family="Helvetica", size=16, weight="bold"),
                 fg=TEXT, bg=BG).pack()
        tk.Label(hdr, text="Deployment Setup Wizard",
                 font=tkfont.Font(family="Helvetica", size=10),
                 fg=MUTED, bg=BG).pack()

        # ── form card ────────────────────────────────────────────────────────────
        card = tk.Frame(self, bg=PANEL, padx=24, pady=20)
        card.pack(fill="both", expand=True, padx=16, pady=(0, 8))

        self._build_network(card)
        tk.Frame(card, height=12, bg=PANEL).pack()
        self._build_secrets(card)
        tk.Frame(card, height=12, bg=PANEL).pack()
        self._build_passwords(card)
        tk.Frame(card, height=12, bg=PANEL).pack()
        self._build_options(card)

        # ── deploy button ────────────────────────────────────────────────────────
        btn_frame = tk.Frame(self, bg=BG, pady=12)
        btn_frame.pack(fill="x", padx=16)
        self._deploy_btn = button(btn_frame, "  Deploy  ", self._on_deploy,
                                  color=ACCENT, fg=BG, width=20)
        self._deploy_btn.pack()

        # ── log area ─────────────────────────────────────────────────────────────
        log_frame = tk.Frame(self, bg=BG, padx=16, pady=(0, 16))
        log_frame.pack(fill="both", expand=True)
        self._log = tk.Text(log_frame, height=10, bg="#050e1f", fg=SUCCESS,
                            font=tkfont.Font(family="Courier", size=9),
                            relief="flat", bd=0,
                            highlightthickness=1, highlightbackground=BORDER,
                            state="disabled", wrap="word")
        self._log.pack(fill="both", expand=True)
        sb = ttk.Scrollbar(log_frame, command=self._log.yview)
        sb.pack(side="right", fill="y")
        self._log.configure(yscrollcommand=sb.set)

    def _build_network(self, parent):
        section_label(parent, "Network").pack(fill="x", pady=(0, 8))
        row = tk.Frame(parent, bg=PANEL)
        row.pack(fill="x")

        label(row, "Port", color=MUTED).grid(row=0, column=0, sticky="w", pady=4, padx=(0, 12))
        self._port = entry(row, width=8)
        self._port.insert(0, "4000")
        self._port.grid(row=0, column=1, sticky="w")

        label(row, "Access URL(s)", color=MUTED).grid(row=1, column=0, sticky="w", pady=4, padx=(0, 12))
        self._origin = entry(row, width=38)
        self._origin.insert(0, "http://localhost:4000")
        self._origin.grid(row=1, column=1, sticky="w")

        label(row, "Separate multiple URLs with commas",
              size=8, color=BORDER).grid(row=2, column=1, sticky="w")

    def _build_secrets(self, parent):
        section_label(parent, "Security Keys").pack(fill="x", pady=(0, 8))

        row = tk.Frame(parent, bg=PANEL)
        row.pack(fill="x")

        label(row, "Session secret", color=MUTED).grid(row=0, column=0, sticky="w", pady=4, padx=(0, 12))
        self._session_secret = entry(row, show="•", width=28)
        self._session_secret.insert(0, gen_secret())
        self._session_secret.grid(row=0, column=1, sticky="w")
        button(row, "New", lambda: self._regen(self._session_secret),
               color=BORDER, fg=MUTED).grid(row=0, column=2, padx=(8, 0))

        label(row, "Encryption key", color=MUTED).grid(row=1, column=0, sticky="w", pady=4, padx=(0, 12))
        self._enc_key = entry(row, show="•", width=28)
        self._enc_key.insert(0, gen_secret())
        self._enc_key.grid(row=1, column=1, sticky="w")
        button(row, "New", lambda: self._regen(self._enc_key),
               color=BORDER, fg=MUTED).grid(row=1, column=2, padx=(8, 0))

        label(row, "Secrets are auto-generated — only change if you need a specific value",
              size=8, color=BORDER).grid(row=2, column=0, columnspan=3, sticky="w")

    def _build_passwords(self, parent):
        section_label(parent, "Default Account Passwords").pack(fill="x", pady=(0, 8))

        row = tk.Frame(parent, bg=PANEL)
        row.pack(fill="x")

        for i, (lbl, attr) in enumerate([
            ("Head Coach", "_hc_pass"),
            ("Coach",      "_co_pass"),
            ("Athlete",    "_at_pass"),
        ]):
            label(row, lbl, color=MUTED).grid(row=i, column=0, sticky="w", pady=4, padx=(0, 12))
            e = entry(row, show="•", width=24)
            e.insert(0, "changeme")
            e.grid(row=i, column=1, sticky="w")
            setattr(self, attr, e)

        label(row, "These are the passwords for the three demo accounts seeded into the database",
              size=8, color=BORDER).grid(row=3, column=0, columnspan=2, sticky="w")

    def _build_options(self, parent):
        section_label(parent, "Options").pack(fill="x", pady=(0, 8))
        row = tk.Frame(parent, bg=PANEL)
        row.pack(fill="x")

        self._nut_express = tk.BooleanVar(value=True)
        cb = tk.Checkbutton(row, text="Fast nutrition mode  (keeps model in memory, ~3–8 s)",
                            variable=self._nut_express,
                            bg=PANEL, fg=TEXT, selectcolor=ENTRY_BG,
                            activebackground=PANEL, activeforeground=TEXT,
                            font=tkfont.Font(family="Helvetica", size=10))
        cb.pack(anchor="w")
        label(row, "Disable for highest accuracy (~30–45 s per scan)",
              size=8, color=BORDER).pack(anchor="w")

    # ── helpers ─────────────────────────────────────────────────────────────────

    def _regen(self, widget):
        widget.delete(0, "end")
        widget.insert(0, gen_secret())

    def _log_write(self, text, tag="normal"):
        self._log.configure(state="normal")
        self._log.insert("end", text)
        self._log.see("end")
        self._log.configure(state="disabled")

    def _centre(self):
        self.update_idletasks()
        w, h = self.winfo_width(), self.winfo_height()
        sw, sh = self.winfo_screenwidth(), self.winfo_screenheight()
        self.geometry(f"+{(sw - w) // 2}+{(sh - h) // 2}")

    # ── deploy ──────────────────────────────────────────────────────────────────

    def _on_deploy(self):
        if not self._validate():
            return
        self._deploy_btn.configure(state="disabled", text="Deploying…")
        threading.Thread(target=self._deploy, daemon=True).start()

    def _validate(self):
        if not self._port.get().strip().isdigit():
            messagebox.showerror("Invalid port", "Port must be a number.")
            return False
        if not self._origin.get().strip():
            messagebox.showerror("Missing URL", "Please enter the access URL.")
            return False
        for attr, name in [("_hc_pass", "Head Coach"), ("_co_pass", "Coach"), ("_at_pass", "Athlete")]:
            if not getattr(self, attr).get().strip():
                messagebox.showerror("Missing password", f"{name} password cannot be empty.")
                return False
        if self._compose_cmd is None:
            messagebox.showerror(
                "Docker Compose not found",
                "Install Docker and Docker Compose, then try again.\n"
                "https://docs.docker.com/get-docker/"
            )
            return False
        return True

    def _deploy(self):
        try:
            self._write_env()
            self._run_compose()
        except Exception as exc:
            self.after(0, self._deploy_failed, str(exc))

    def _write_env(self):
        self._log_write("Writing server/.env…\n")
        port = self._port.get().strip()
        values = {
            "PORT":                     port,
            "APP_ORIGIN":               self._origin.get().strip(),
            "SESSION_SECRET":           self._session_secret.get().strip(),
            "PASSWORD_ENCRYPTION_KEY":  self._enc_key.get().strip(),
            "HEAD_COACH_SEED_PASSWORD": self._hc_pass.get().strip(),
            "COACH_SEED_PASSWORD":      self._co_pass.get().strip(),
            "ATHLETE_SEED_PASSWORD":    self._at_pass.get().strip(),
            "NUT_EXPRESS_MODE":         "true" if self._nut_express.get() else "false",
        }
        write_env(values)
        self._log_write("✔ server/.env written\n\n")

    def _run_compose(self):
        self._log_write(f"Running: {' '.join(self._compose_cmd)} up -d --build\n\n")
        cmd = self._compose_cmd + ["up", "-d", "--build"]
        proc = subprocess.Popen(
            cmd,
            cwd=SCRIPT_DIR,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        for line in proc.stdout:
            self._log_write(line)
        proc.wait()
        if proc.returncode == 0:
            self.after(0, self._deploy_success)
        else:
            self.after(0, self._deploy_failed, "docker compose exited with an error — see log above.")

    def _deploy_success(self):
        port = self._port.get().strip()
        self._log_write(f"\n✔ Done!  Dashboard → http://localhost:{port}\n")
        self._log_write("✔ Portainer →  http://localhost:9000\n")
        self._deploy_btn.configure(state="normal", text="  Deploy  ")
        messagebox.showinfo(
            "Deployed!",
            f"Your dashboard is running at:\n\nhttp://localhost:{port}\n\n"
            "Container management (Portainer):\nhttp://localhost:9000"
        )

    def _deploy_failed(self, reason):
        self._log_write(f"\n✘ Error: {reason}\n")
        self._deploy_btn.configure(state="normal", text="  Deploy  ",
                                   bg=DANGER, fg=TEXT)
        messagebox.showerror("Deploy failed", reason)


# ── entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    app = SetupWizard()
    app.mainloop()
