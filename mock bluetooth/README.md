# Mock Bluetooth Sensor Stream - Arduino Uno + HM-10

Streams realistic synthetic readings that match the multi-sensor Arduino
health logger over Bluetooth Low Energy (BLE). No real sensors are required:
the Arduino generates plausible AHT20, SGP40, LSM6DSOX, TMP117, and MAX30102
values and sends a full sensor frame about once per second.

## Labels at a Glance

| Thing | Label to look for |
|-------|-------------------|
| Arduino sketch | `mock_health_sensor.ino` |
| App device profile | `Arduino + HM-10` |
| Web dashboard device preset | `Arduino + HM-10 (0xFFE0)` |
| Web/app parser | `JSON text (Arduino / HM-10)` |
| Common BLE advertising names | `HMSoft`, `BT05`, or a custom HM-10 name |
| Stream namespace | `sensor.*` |
| Stored API endpoint | `/api/streams` |

---

## Hardware

| Part | Notes |
|------|-------|
| Arduino Uno (or Nano) | Any 5 V AVR board works |
| HM-10 BLE module | CC2541/CC2640 based; common on eBay/Amazon |

### Wiring

```
Arduino         HM-10
-------         -----
3.3 V  ------>  VCC   (or 5 V if your module has a regulator)
GND    ------>  GND
Pin 7  <------  TX
Pin 8  ------>  RX
```

> Voltage note: most HM-10 breakout boards tolerate 5 V logic on RX, but check
> your module's datasheet to be safe.

---

## Uploading the Sketch

1. Open `arduino/mock_health_sensor/mock_health_sensor.ino` in the Arduino IDE.
2. Select **Board -> Arduino Uno** and the correct COM port.
3. Click **Upload**.
4. Open the **Serial Monitor** at 115200 baud to watch startup diagnostics and
   outgoing `[SEND]` lines.

No Library Manager installs are required for this mock sketch. It only uses
`EEPROM.h`, `SoftwareSerial`, `avr/wdt.h`, `stdlib.h`, and `string.h`, which
are part of the standard Arduino AVR toolchain. You do still need the usual
**Arduino AVR Boards** core installed in the IDE for Uno/Nano targets.

By default the sketch now leaves the HM-10's existing BLE UART profile alone.
That is deliberate: many HM-10 / BT05 clones stop forwarding UART data if they
are force-reconfigured on every boot.

The sketch uses `HM10_DEFAULT_UART_BAUD = 9600` as its fallback and stores any
app-selected HM-10 baud in EEPROM. Normal boots now start directly at the saved
baud without rewriting the module. If a baud-change request still needs to be
finalized, the sketch performs a one-time blind normalize on the next boot, and
you can still enable the read-only `AT` handshake path if you want extra
diagnostics. Check the Serial Monitor for the preferred or detected baud, then
watch for the lightweight `sensor.hm10_link_probe` metric in the app before
worrying about the full sensor frame.

If you need to repair a module's BLE role or UUIDs, enable
`HM10_APPLY_BOOT_PROFILE` near the top of the sketch and re-upload. Start with
`FFE0` / `FFE1`; some clones still use `FFF0` / `FFF1`.

---

## Metrics Transmitted

The real sensor sketch logs this CSV row:

```csv
time_ms,aht20_temperature_c,aht20_humidity_percent,tmp117_temperature_c,voc_raw,accel_x,accel_y,accel_z,gyro_x,gyro_y,gyro_z,max_red,max_ir
```

The mock sends the same fields as newline-delimited JSON metric packets so the
mobile app and web dashboard can ingest them through their existing JSON text
parser:

```json
{"metric":"sensor.aht20_temperature_c","value":22.41}
{"metric":"sensor.max_ir","value":69480}
```

| Metric label | Source being mocked | Unit | Typical range |
|--------------|---------------------|------|---------------|
| `sensor.time_ms` | Arduino `millis()` | ms | increasing |
| `sensor.aht20_temperature_c` | AHT20 ambient temperature | deg C | about 21-23 |
| `sensor.aht20_humidity_percent` | AHT20 relative humidity | % RH | about 42.5-53.5 |
| `sensor.tmp117_temperature_c` | TMP117 contact temperature | deg C | warms from about 30.3 to 34.8 |
| `sensor.voc_raw` | SGP40 compensated SRAW ticks | raw ticks | about 21,000-33,500 |
| `sensor.accel_x` | LSM6DSOX acceleration X | m/s^2 | near 0 at rest |
| `sensor.accel_y` | LSM6DSOX acceleration Y | m/s^2 | near 0 at rest |
| `sensor.accel_z` | LSM6DSOX acceleration Z | m/s^2 | around 9.81 at rest |
| `sensor.gyro_x` | LSM6DSOX gyroscope X | rad/s | near 0 at rest |
| `sensor.gyro_y` | LSM6DSOX gyroscope Y | rad/s | near 0 at rest |
| `sensor.gyro_z` | LSM6DSOX gyroscope Z | rad/s | near 0 at rest |
| `sensor.max_red` | MAX30102 red PPG channel | raw ADC count | about 51,500-53,500 plus motion |
| `sensor.max_ir` | MAX30102 IR PPG channel | raw ADC count | about 67,000-70,500 plus motion |

Each metric is stored in `/api/streams` under its metric name. These sensor
metrics do not mirror into daily vitals columns unless the server is extended
with new mirror mappings.

---

## Connecting via the Mobile App

1. Power on the Arduino.
2. Open the **MSML app -> Devices -> Bluetooth bridge**.
3. Tap the **Arduino + HM-10** device profile.
   - Service UUID is pre-filled as `FFE0`
   - Characteristic UUID is pre-filled as `FFE1`
   - Fallback metric is `sensor.aht20_temperature_c`
4. Pair the HM-10 in your phone's system Bluetooth settings. It usually
   appears as `HMSoft` or `BT05`.
5. Return to the app and tap **Confirm paired device** or connect from the scan list.
6. If the link is noisy, use **HM-10 UART baud** in the setup card to switch
   between `9600`, `19200`, and `38400`.
   - The app disconnects automatically after sending the baud change.
   - Wait about 2 seconds, then reconnect.
7. The live data card updates as the metric packets arrive.

> If your HM-10 uses different UUIDs, some modules ship with `FFF0` / `FFF1`
> instead of `FFE0` / `FFE1`. Change the UUID fields in the app manually.

---

## Connecting via the Web Dashboard

1. Open the web dashboard and sign in.
2. Navigate to **Devices -> Bluetooth bridge** (`/bluetooth.html`).
3. Choose **Arduino + HM-10 (0xFFE0)**.
4. Confirm **Service UUID** `FFE0` and **Characteristic UUID** `FFE1`.
5. Set the **Data parser** to **JSON text (Arduino / HM-10)**.
6. Click **Connect device** and select the HM-10 from the browser picker.
7. The displayed metric name updates automatically as each packet arrives.

> Web Bluetooth requires Chrome or Edge on desktop or Android. iOS Safari does
> not support Web Bluetooth; use the mobile app on iPhone.

---

## How Packet Reassembly Works

The HM-10 transmits BLE notifications in small chunks. A JSON line may arrive
split across several notification events.

Both the mobile app and the web bridge accumulate chunks in a line buffer and
only parse once a `\n` newline is received. The mock sends one metric per line
to keep every line comfortably below the parser overflow limit.

---

## Related ML Model Files

This sketch only mocks BLE sensor streams. The server-side ML model files live
under the web dashboard:

| Model area | Path |
|------------|------|
| Nutrition photo model code | `../lifestyle-web/server/NUT_model/` |
| Expected NUT checkpoint | `../lifestyle-web/server/NUT_model/checkpoint/canet_NUT.pth` |
| BGL/PPG CatBoost bundle | `../lifestyle-web/server/ppg_glucose/models/bgl_catboost_current_ppg_demo_no_preop/` |
| BGL/PPG inference CLI | `../lifestyle-web/server/ppg_glucose/src/inference/predict.py` |

For BGL inference, the backend expects a `ppg.raw` stream at 500 Hz for a
15-minute window. This mock currently emits `sensor.max_red` and
`sensor.max_ir` values for BLE parser testing, not a full `ppg.raw` inference
window.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| HM-10 LED blinks fast | It is advertising; open Bluetooth settings and pair it |
| HM-10 LED stays solid | A device may already be connected; disconnect it first |
| App shows "No device connected" | Pair the HM-10 in system Bluetooth settings before tapping Confirm |
| UUID mismatch error | Try `FFF0` / `FFF1` instead of `FFE0` / `FFE1` |
| BLE connects but no values arrive | Check Serial Monitor for the detected UART baud and look for `sensor.hm10_link_probe` first |
| Values look flat | Normal at rest; the mock adds periodic motion and PPG variation |
