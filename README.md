# Multi-sensor Machine Learning Lifestyle Monitor (MSML-Lifestyle-Monitor)

<p align="center">
  <a href="https://github.com/amaanmujawar/msml-lifestyle-monitor/pulls">
    <img src="https://img.shields.io/github/issues-pr/amaanmujawar/msml-lifestyle-monitor" alt="PRs">
  </a>
  <a href="https://github.com/amaanmujawar/msml-lifestyle-monitor/issues">
    <img src="https://img.shields.io/github/issues/amaanmujawar/msml-lifestyle-monitor" alt="Issues">
  </a>
</p>

A final-year MEng group project focused on developing an integrated, low-cost prototype that uses multiple sensors and machine learning techniques to monitor lifestyle metrics — including physical activity, nutritional intake, and vital health parameters.

---

## Table of Contents

- [About](#about)
- [Features](#features)
- [Stack](#stack)
- [ML Model Files](#ml-model-files)
- [Deployment](#deployment)
- [Deploy to the Cloud](#deploy-to-the-cloud)
- [Development Setup](#development-setup)
- [Mobile App](#mobile-app)
- [Contributing](#contributing)
- [Contributors](#contributors)
- [License](#license)

---

## About

Lifestyle monitoring is an essential aspect of managing chronic health conditions and maintaining overall well-being. This project aims to design and implement a multi-modal sensor and machine learning-based system that collects and processes data from a wide array of sources, such as:

- RGB cameras
- Depth sensors
- Event cameras
- Inertial Measurement Units (IMUs)
- Mobile phone sensors
- Healthcare sensors

The system uses this data to identify and quantify physical activities, nutritional intake, and vital health parameters. Machine learning and computer vision techniques are employed to provide meaningful insights, with the end goal of building a prototype that can assist in healthcare-related lifestyle tracking.

This is a project by a team of MEng Electronic & Electrical Engineering students, supervised by Dr. Charith Abhayaratne and Dr. Kennedy Offor.

---

## Features (some features will not exist in entirety)

- **Multi-Modal Sensor Fusion**
  Integration of visual and non-visual sensors for enhanced context-awareness and accuracy.

- **Physical Activity Monitoring**  
  Real-time recognition and classification of daily activities using IMU and camera data.
  Activity quantification through machine learning-based analysis.

- **Nutritional Intake Estimation**  
  Food plate analysis using RGB and depth images/video.
  Food segmentation and classification.
  Portion size estimation for nutritional analysis.

- **Health Parameter Monitoring**  
  Optional support for healthcare sensors (e.g., heart rate, SpO₂, temperature).
  Basic signal processing for vital health metric extraction.

- **Data Logging & Reporting**  
  Timestamped data storage for all monitored parameters.
  Basic report generation for long-term 

- **Modular Software Architecture**  
  Scalable and extendable for future research or clinical application

- **Testing & Validation Tools**  
  Includes test scripts and datasets for validating model accuracy and system reliability.

---

## Stack

### Software

- **Python** – Core programming language for data processing, ML modeling, and system logic.
- **OpenCV** – Image processing and computer vision.
- **NumPy** – Numerical operations and signal analysis.
- **VHDL** - Hardware Design Language.
- **PyTorch** – NUT meal-photo segmentation and nutrition inference.
- **CatBoost** – PPG blood-glucose zone classification.
- **Node.js / Express** – Web API, dashboard backend, and model orchestration.
- **React Native / Expo** – Mobile companion app.
- **Matplotlib** – Data visualization and debugging.

### Hardware

- **Raspberry Pi / Arduino / Nexys4 Artix-7** – Embedded hardware for image capture and processing control.
- **Additional Sensors** - TBA

### Tools & Utilities

- **Git** – Version control and collaboration.
- **PyCharm** - Development IDE for python
- **VS Code** – Development environment.

---

## ML Model Files

The project currently has two server-side ML areas. Start here when looking for model code, model artifacts, or setup scripts:

| Model area | Main files | Notes |
|---|---|---|
| Nutrition / food photo model | [`lifestyle-web/server/NUT_model`](lifestyle-web/server/NUT_model) | Inference code lives in `nut_estimator.py` and `nut_server.py`; model architecture lives in `models/`. The expected local checkpoint path is `lifestyle-web/server/NUT_model/checkpoint/canet_NUT.pth`. That `.pth` file is intentionally not committed. |
| PPG / blood-glucose zone model | [`lifestyle-web/server/ppg_glucose`](lifestyle-web/server/ppg_glucose) | The active deployment bundle is `models/bgl_catboost_current_ppg_demo_no_preop/` and contains `catboost_model.cbm`, `final_features.txt`, `model_metadata.json`, and `training_schema.json`. |
| Model setup scripts | [`lifestyle-web/server/scripts`](lifestyle-web/server/scripts) | Use `check-nut-model.sh`, `setup-nut-model.sh`, `setup-ppg-model.sh`, and `check-ppg-model.sh` from `lifestyle-web/server`. |
| FoodSeg test/data files | [`lifestyle-web/server/data/FoodSeg103`](lifestyle-web/server/data/FoodSeg103) | Label map and example images used by the nutrition workflow. These are data files, not the trained `.pth` checkpoint. |

For the full web/API setup notes, see [`lifestyle-web/README.md`](lifestyle-web/README.md).

---

## Deployment

The web dashboard ships as a self-contained Docker image.

### Prerequisites (all options)

- [Docker](https://docs.docker.com/get-docker/) installed on the machine
- On Linux/Raspberry Pi, also install Docker Compose:
  ```bash
  sudo apt-get install -y docker-compose
  ```
- [Git](https://git-scm.com/)

### Step 1 — Clone the repository

```bash
git clone https://github.com/amaanmujawar/msml-lifestyle-monitor.git
cd msml-lifestyle-monitor/lifestyle-web
```

### Step 2 — Configure & deploy

Pick whichever option suits you:

---

#### Option A — Desktop GUI (recommended for non-coders)

A graphical window with a form for every setting and a single Deploy button. No terminal needed after this step.

```bash
bash install-shortcut.sh
```

This places an **MSML Setup** icon on your Desktop. Double-click it to open the wizard, fill in your settings, and click **Deploy**.

To launch the GUI without the shortcut:
```bash
python3 setup_gui.py
```

---

#### Option B — Terminal wizard

An interactive prompt that asks each question in turn and launches Docker automatically.

```bash
bash setup.sh
```

---

#### Option C — Manual

```bash
cp server/.env.example server/.env
```

Open `server/.env` and set at minimum:

| Variable | What to set |
|---|---|
| `SESSION_SECRET` | Any long random string |
| `PASSWORD_ENCRYPTION_KEY` | A second long random string |
| `APP_ORIGIN` | The URL(s) you'll open the dashboard from, comma-separated |
| `HEAD_COACH_SEED_PASSWORD` | Password for the Head Coach demo account |
| `COACH_SEED_PASSWORD` | Password for the Coach demo account |
| `ATHLETE_SEED_PASSWORD` | Password for the Athlete demo account |

Then start the containers:
```bash
docker-compose up -d --build
```

---

### Accessing the services

Once running, open these in a browser:

| Service | URL |
|---|---|
| **Dashboard** | http://localhost:4000 |
| **Portainer** (container management) | http://localhost:9000 |

Portainer lets you view logs, restart containers, and manage the deployment from a browser — no terminal needed.

Data is persisted in a Docker volume so it survives restarts and upgrades.

### Upgrading

```bash
git pull
docker-compose up -d --build
```

### Stopping

```bash
docker-compose down        # stop, keep data
docker-compose down -v     # stop and wipe all data
```

---

## Deploy to the Cloud

One-click deploy options — no local Docker required:

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/amaanmujawar/msml-lifestyle-monitor)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/amaanmujawar/msml-lifestyle-monitor)

[![Deploy to DigitalOcean](https://www.deploytodo.com/do-btn-blue.svg)](https://cloud.digitalocean.com/apps/new?repo=https://github.com/amaanmujawar/msml-lifestyle-monitor/tree/main)

After deploying on any platform you will need to set the environment variables listed above (`SESSION_SECRET`, `PASSWORD_ENCRYPTION_KEY`, `APP_ORIGIN`, and the three seed passwords) in the platform's dashboard.

Config files used by each platform:

| Platform | Config file |
|---|---|
| Railway | [`railway.json`](railway.json) |
| Render | [`render.yaml`](render.yaml) |
| DigitalOcean App Platform | [`.do/app.yaml`](.do/app.yaml) |

---

## Development Setup

Follow these steps to set up the project locally for development:

### 1. Fork the repository and clone your fork

```bash
# Clone your forked repository
git clone https://github.com/your-username/msml-lifestyle-monitor.git
cd msml-lifestyle-monitor
```

### 2. Create and Checkout a Feature Branch

Create a new branch for your feature or bugfix following the naming convention:

```bash
git checkout -b feature/your-feature-name
```

### 3. Install Dependencies & Build

Install all required software dependencies, such as Python packages or hardware drivers, using the appropriate package manager or setup scripts provided in the project.

Build or compile the project according to the instructions in the documentation or build scripts included.

## Mobile App

React Native + Expo sources for the cross-platform companion app live in [`lifestyle-mobile`](lifestyle-mobile). The app mirrors the browser dashboard (auth, overview, activity, vitals, nutrition, weight, roster, profile/admin) and talks to the same Express API.

1. Copy the sample env file and point it to your running web server:
   ```bash
   cd lifestyle-mobile
   cp .env.example .env   # update EXPO_PUBLIC_API_BASE_URL
   ```
2. Install dependencies and start Expo:
   ```bash
   npm install
   npm run start
   ```

See [`lifestyle-mobile/README.md`](lifestyle-mobile/README.md) for detailed architecture, feature parity, and offline-sync notes.

## Contributing

Please read the [Contributing Guidelines](CONTRIBUTING.md) before submitting a pull request.

## Contributors

- Amaan Mujawar [@AmaanMujawar](https://github.com/AmaanMujawar)
- Ben Meadows [@benmeds1](https://github.com/benmeds1)
- Cian Thomson [@cianthomson](https://github.com/cianthomson)
- David Cracknell [@dcracknell](https://github.com/dcracknell)
- Pranav Beeharry Panray [@prnvbp0007](https://github.com/prnvbp0007)

## License

This project is licensed under the [MIT License](LICENSE).
