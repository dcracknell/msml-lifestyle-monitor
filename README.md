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
- [Tech Stack](#tech-stack)
- [Installation](#installation)
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
- **TensorFlow** – Machine learning / deep learning model development and inference.
- **Matplotlib** – Data visualization and debugging.

### Hardware

- **Raspberry Pi / Arduino / Nexys4 Artix-7** – Embedded hardware for image capture and processing control.
- **Additional Sensors** - TBA

### Tools & Utilities

- **Git** – Version control and collaboration.
- **PyCharm** - Development IDE for python
- **VS Code** – Development environment.

---

## Installation

Follow these steps to set up the project locally and start development:

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
