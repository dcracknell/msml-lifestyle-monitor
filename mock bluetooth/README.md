# Mock Bluetooth – Arduino Uno + HM-10

Streams six realistic but synthetic health metrics to the MSML app over
Bluetooth Low Energy (BLE).  No real sensor is required – the Arduino
generates plausible values and cycles through them every 2 seconds.

---

## Hardware

| Part | Notes |
|------|-------|
| Arduino Uno (or Nano) | Any 5 V AVR board works |
| HM-10 BLE module | CC2541/CC2640 based; very common on eBay/Amazon |

### Wiring

```
Arduino         HM-10
-------         -----
3.3 V  ──────►  VCC   (or 5 V if your module has a regulator)
GND    ──────►  GND
Pin 3  ◄──────  TX
Pin 4  ──────►  RX
```

> **Voltage note** – most HM-10 breakout boards tolerate 5 V logic on RX
> but check your specific module's datasheet to be safe.

---

## Uploading the sketch

1. Open `arduino/mock_health_sensor.ino` in the Arduino IDE.
2. Select **Board → Arduino Uno** and the correct COM port.
3. Click **Upload**.
4. Open the **Serial Monitor** at 9600 baud – you will NOT see output there
   because the sketch uses SoftwareSerial (pins 3/4) for the HM-10, not the
   USB serial.  Use a BLE terminal app to verify output.

---

## Metrics transmitted

Heart rate is sent every **2 seconds** to keep the live chart active.
Every **10 seconds** one secondary metric is also sent (rotating through the five below).

```
{"metric":"vitals.heart_rate","value":74}   ← every 2 s (primary)
{"metric":"vitals.spo2","value":97.8}       ← every 10 s (secondary, in rotation)
```

| Metric name | Interval | Typical range | Unit | DB mirror |
|-------------|----------|--------------|------|-----------|
| `vitals.heart_rate` | 2 s | 62 – 88 | bpm | `health_markers.resting_hr` |
| `vitals.spo2` | 10 s | 96.0 – 99.0 | % | `health_markers.spo2` |
| `vitals.hrv` | 10 s | 35 – 55 | ms | `health_markers.hrv_score` |
| `phone.steps` | 10 s | cumulative ~8 000+ | steps | `daily_metrics.steps` |
| `vitals.glucose` | 10 s | 4.8 – 5.6 | mmol/L | `health_markers.glucose_mg_dl` |
| `body.weight_kg` | 10 s | 70.4 – 70.6 | kg | `weight_logs` |

Each metric maps directly to a server-side mirror column — no extra
configuration needed.

---

## Connecting via the mobile app

1. Power on the Arduino (the HM-10 LED should blink slowly).
2. Open the **MSML app → Devices → Bluetooth bridge**.
3. Tap the **Arduino + HM-10** device profile.
   - Service UUID is pre-filled as `FFE0`
   - Characteristic UUID is pre-filled as `FFE1`
4. Pair the HM-10 in your phone's system Bluetooth settings (it usually
   appears as `HMSoft` or `BT05`).
5. Return to the app and tap **Confirm connection**.
6. The live data card updates every 2 seconds as each metric arrives.

> **If your HM-10 uses different UUIDs** – some modules ship with `FFF0`/`FFF1`
> instead of `FFE0`/`FFE1`.  Just change the UUID fields in the app manually.

---

## Connecting via the web dashboard

1. Open the web dashboard and sign in.
2. Navigate to **Devices → Bluetooth bridge** (`/bluetooth.html`).
3. Enter the **metric name** you want to watch first (e.g. `vitals.heart_rate`).
4. Enter **Service UUID** `FFE0` and **Characteristic UUID** `FFE1`.
5. Set the **Data parser** to **JSON text (Arduino / HM-10)**.
6. Click **Connect device** and select the HM-10 from the browser picker.
7. The app automatically updates the displayed metric name as the Arduino
   cycles through all six metrics.

> Web Bluetooth requires Chrome or Edge on desktop or Android.  iOS Safari
> does not support Web Bluetooth – use the mobile app on iPhone.

---

## How packet reassembly works

The HM-10 transmits BLE notifications in 20-byte chunks.  A 40-character
JSON line therefore arrives in 2–3 separate BLE notification events.

Both the mobile app and the web bridge accumulate these chunks in a line
buffer and only attempt JSON parsing once a `\n` newline is received,
ensuring no partial parse errors.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| HM-10 LED blinks fast (not connecting) | It is advertising – open your phone Bluetooth settings and pair it |
| HM-10 LED stays solid | A device is already connected – disconnect it first |
| App shows "No device connected" | Make sure the HM-10 is paired in system Bluetooth settings *before* tapping Confirm |
| UUID mismatch error | Try `FFF0` / `FFF1` instead of `FFE0` / `FFE1` |
| Values look flat / no variation | Normal – the mock uses a simple LCG PRNG; restart the Arduino for a fresh seed |
