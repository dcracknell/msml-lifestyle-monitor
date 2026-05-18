// Mock Health Sensor for Arduino Uno + HM-10 BLE Module
//
// Simulates the multi-sensor CSV row produced by the real health sensor sketch:
// time_ms, AHT20 temperature/humidity, TMP117 temperature, SGP40 VOC raw,
// LSM6DSOX accel/gyro, and MAX30102 red/IR PPG channels.
//
// Wiring matches the real sensor sketch:
//   HM-10 VCC  -> Arduino 3.3V or 5V (check your module)
//   HM-10 GND  -> Arduino GND
//   HM-10 TX   -> Arduino pin 7  (SoftwareSerial RX)
//   HM-10 RX   -> Arduino pin 8  (SoftwareSerial TX)
//
// Default HM-10 UUIDs:
//   Service        FFE0
//   Characteristic FFE1
//
// In the mobile app  : select the "Arduino + HM-10" device profile.
// On the web bridge  : select parser "JSON text (Arduino / HM-10)".
//
// Each reading is sent as one newline-terminated JSON metric packet:
//   {"metric":"sensor.aht20_temperature_c","value":22.41}
//
// The app line-buffer reassembles BLE notification chunks and uploads every
// metric to /api/streams. Sending one metric per line keeps each packet short
// enough for HM-10 UART/BLE buffering while still streaming a full sensor row.

// No third-party Arduino libraries required for this mock sketch.
// These headers come from the standard Arduino AVR core / toolchain.
#include <EEPROM.h>
#include <SoftwareSerial.h>
#include <avr/wdt.h>
#include <stdlib.h>
#include <string.h>

static const uint8_t BT_RX_PIN = 7;
static const uint8_t BT_TX_PIN = 8;
// Default streaming baud. The app can store a preferred replacement in EEPROM.
static const uint32_t HM10_DEFAULT_UART_BAUD = 9600UL;
// Practical comfort ceiling for sustained Uno SoftwareSerial streaming. Faster
// rates are still allowed for recovery and faster boards, but may be noisy.
static const uint32_t HM10_MAX_SAFE_SOFTWARESERIAL_BAUD = 38400UL;
static const bool HM10_BLIND_NORMALIZE_TO_PREFERRED_BAUD_ON_BOOT = true;
// Default on: detect the module's live UART baud at boot so reused HM-10s do
// not silently stream on the wrong serial speed.
static const bool HM10_PROBE_BAUD_ON_BOOT = true;
static const uint16_t HM10_BAUD_APPLY_DELAY_MS = 1800U;
static const uint8_t HM10_BAUD_PREF_EEPROM_SIGNATURE = 0xB5;
static const uint8_t HM10_BAUD_PREF_EEPROM_SIGNATURE_V1 = 0xB4;
// FIX 1: was true, which caused sendTelemetryFrame() to return after only the
// link-probe metric — no sensor data was ever transmitted.
static const bool HM10_DEBUG_LINK_ONLY = false;
// Default on: push the module back to the common BLE UART profile so reused
// HM-10 / BT05 boards do not stay stranded on stale UUIDs or central mode.
// Disable only if you know your clone rejects these boot-time AT commands.
static const bool HM10_APPLY_BOOT_PROFILE = true;

SoftwareSerial BT(BT_RX_PIN, BT_TX_PIN);
#define DBG Serial

// -----------------------------------------------------------------------
// User-facing labels
// Keep these in sync with mock bluetooth/README.md and the app/web presets.
// -----------------------------------------------------------------------

static const char SKETCH_LABEL[]             = "Mock Multi-Sensor Health Stream";
static const char APP_DEVICE_PROFILE_LABEL[] = "Arduino + HM-10";
static const char WEB_DEVICE_PRESET_LABEL[]  = "Arduino + HM-10 (0xFFE0)";
static const char DATA_PARSER_LABEL[]        = "JSON text (Arduino / HM-10)";
static const char STREAM_NAMESPACE_LABEL[]   = "sensor.*";

// -----------------------------------------------------------------------
// Metric labels uploaded to /api/streams
// -----------------------------------------------------------------------

static const char METRIC_TIME_MS[]                = "sensor.time_ms";
static const char METRIC_HM10_LINK_PROBE[]        = "sensor.hm10_link_probe";
static const char METRIC_HM10_LINK_ACK[]          = "sensor.hm10_link_ack";
static const char METRIC_AHT20_TEMPERATURE_C[]    = "sensor.aht20_temperature_c";
static const char METRIC_AHT20_HUMIDITY_PCT[]     = "sensor.aht20_humidity_pct";
static const char METRIC_TMP117_TEMPERATURE_C[]   = "sensor.tmp117_temperature_c";
static const char METRIC_SGP40_VOC_RAW[]          = "sensor.voc_raw";
static const char METRIC_LSM6DSOX_ACCEL_X[]       = "sensor.accel_x";
static const char METRIC_LSM6DSOX_ACCEL_Y[]       = "sensor.accel_y";
static const char METRIC_LSM6DSOX_ACCEL_Z[]       = "sensor.accel_z";
static const char METRIC_LSM6DSOX_GYRO_X[]        = "sensor.gyro_x";
static const char METRIC_LSM6DSOX_GYRO_Y[]        = "sensor.gyro_y";
static const char METRIC_LSM6DSOX_GYRO_Z[]        = "sensor.gyro_z";
static const char METRIC_MAX30102_RED[]           = "sensor.max_red";
static const char METRIC_MAX30102_IR[]            = "sensor.max_ir";
static const char METRIC_PPG_RAW[]               = "ppg.raw";
static const char METRIC_HEART_RATE[]            = "vitals.heart_rate";

// -----------------------------------------------------------------------
// Hardware
// -----------------------------------------------------------------------

static const uint8_t LED_PIN = LED_BUILTIN;

// -----------------------------------------------------------------------
// Timing constants
// -----------------------------------------------------------------------

static const uint32_t SENSOR_FRAME_INTERVAL_MS = 1000UL;
static const uint16_t INTER_METRIC_DELAY_MS    = 60;
static const uint8_t  LED_ACK_MS               = 8;

// Maximum wait for a full HM-10 AT response.
static const uint32_t AT_TIMEOUT_MS = 1500UL;
static const uint32_t AT_CONFIG_TIMEOUT_MS = 900UL;

// Enough for the longest metric name plus a signed fixed-point value.
static const uint8_t MAX_LINE_BYTES = 96;
static const uint8_t MAX_AT_REPLY_BYTES = 96;
static const uint8_t MAX_COMMAND_BYTES = 48;
static const uint32_t HM10_SUPPORTED_UART_BAUDS[] = {
  1200UL,
  2400UL,
  4800UL,
  9600UL,
  19200UL,
  38400UL,
  57600UL,
  115200UL
};
static const uint8_t HM10_SUPPORTED_UART_BAUD_COUNT =
  sizeof(HM10_SUPPORTED_UART_BAUDS) / sizeof(HM10_SUPPORTED_UART_BAUDS[0]);

// -----------------------------------------------------------------------
// State
// -----------------------------------------------------------------------

static uint32_t lastFrameMs = 0;
static uint32_t frameCount  = 0;
static uint16_t rngState    = 0;
static bool     hmOk        = false;
static uint32_t hmActiveBaud = HM10_DEFAULT_UART_BAUD;
static uint32_t hmPreferredBaud = HM10_DEFAULT_UART_BAUD;
static uint32_t hmPendingBaud = HM10_DEFAULT_UART_BAUD;
static uint32_t hmBaudApplyAtMs = 0;
static bool     hmHasPendingBaudApply = false;
static bool     hmNeedsBootNormalize = false;
static char     hmCommandBuffer[MAX_COMMAND_BYTES + 1];
static uint8_t  hmCommandLength = 0;

static const float EARTH_GRAVITY_MS2 = 9.80665f;

struct Hm10BaudPreference {
  uint8_t signature;
  uint32_t baud;
  uint8_t pendingNormalize;
};

struct Hm10BaudPreferenceV1 {
  uint8_t signature;
  uint32_t baud;
};

struct TelemetryFrame {
  uint32_t timeMs;
  float    ahtTemperatureC;
  float    ahtHumidityPct;
  float    tmp117TemperatureC;
  uint32_t vocRaw;
  float    accelX;
  float    accelY;
  float    accelZ;
  float    gyroX;
  float    gyroY;
  float    gyroZ;
  uint32_t maxRed;
  uint32_t maxIr;
  float    hrBpm;
};

static TelemetryFrame buildTelemetryFrame(uint32_t now);
static void sendTelemetryFrame(const TelemetryFrame &frame);
static bool btSendUint32(const char *metric, uint32_t value);
static bool hmApplyPeripheralProfile(void);
static bool hmEnsurePreferredStreamingBaud(void);
static void hmBlindNormalizeToPreferredBaud(void);
static void hmLoadPreferredBaud(void);
static void hmStorePreferredBaud(uint32_t baud, bool pendingNormalize);
static void hmPollIncomingCommands(void);
static void hmMaybeApplyPendingBaud(void);

// -----------------------------------------------------------------------
// HM-10 AT command helpers
// -----------------------------------------------------------------------

static void hmDrainRx() {
  while (BT.available()) {
    BT.read();
  }
}

static bool hmReadReply(char *out, size_t outSize, uint32_t timeoutMs) {
  if (!out || outSize == 0) return false;

  out[0] = '\0';
  size_t len = 0;
  bool sawByte = false;
  uint32_t start = millis();
  uint32_t lastByteAt = start;

  while (millis() - start < timeoutMs) {
    while (BT.available()) {
      const char c = static_cast<char>(BT.read());
      sawByte = true;
      lastByteAt = millis();
      if (len + 1 < outSize) {
        out[len++] = c;
        out[len] = '\0';
      }
    }

    if (sawByte && millis() - lastByteAt >= 40UL) {
      break;
    }
  }

  out[len] = '\0';
  return sawByte;
}

static bool hmSendCommandExpect(const char *command,
                                const char *expectedSubstring,
                                uint32_t timeoutMs) {
  char reply[MAX_AT_REPLY_BYTES + 1];
  hmDrainRx();
  BT.print(command);

  const bool gotReply = hmReadReply(reply, sizeof(reply), timeoutMs);
  if (!gotReply) {
    DBG.print(F("[HM10] No reply for "));
    DBG.println(command);
    return false;
  }

  DBG.print(F("[HM10] "));
  DBG.print(command);
  DBG.print(F(" -> "));
  DBG.println(reply);

  if (!expectedSubstring || expectedSubstring[0] == '\0') {
    return true;
  }

  return strstr(reply, expectedSubstring) != NULL;
}

static bool hmIsSupportedBaud(uint32_t baud) {
  for (uint8_t i = 0; i < HM10_SUPPORTED_UART_BAUD_COUNT; i++) {
    if (HM10_SUPPORTED_UART_BAUDS[i] == baud) {
      return true;
    }
  }
  return false;
}

static const char *hmBaudCommandFor(uint32_t baud) {
  switch (baud) {
    case 1200UL:
      return "AT+BAUD7";
    case 2400UL:
      return "AT+BAUD6";
    case 4800UL:
      return "AT+BAUD5";
    case 9600UL:
      return "AT+BAUD0";
    case 19200UL:
      return "AT+BAUD1";
    case 38400UL:
      return "AT+BAUD2";
    case 57600UL:
      return "AT+BAUD3";
    case 115200UL:
      return "AT+BAUD4";
    default:
      return NULL;
  }
}

static void hmWarnIfBaudMayBeNoisy(uint32_t baud) {
  if (baud <= HM10_MAX_SAFE_SOFTWARESERIAL_BAUD) {
    return;
  }

  DBG.print(F("[HM10] Warning: "));
  DBG.print(baud);
  DBG.println(F(" baud is above the usual Uno SoftwareSerial comfort range; proceeding anyway."));
}

static void hmLoadPreferredBaud() {
  Hm10BaudPreference preference = { 0, HM10_DEFAULT_UART_BAUD, 0 };
  EEPROM.get(0, preference);

  if (preference.signature == HM10_BAUD_PREF_EEPROM_SIGNATURE &&
      hmIsSupportedBaud(preference.baud)) {
    hmPreferredBaud = preference.baud;
    hmNeedsBootNormalize = preference.pendingNormalize == 1;
    return;
  }

  Hm10BaudPreferenceV1 legacyPreference = { 0, HM10_DEFAULT_UART_BAUD };
  EEPROM.get(0, legacyPreference);
  if (legacyPreference.signature == HM10_BAUD_PREF_EEPROM_SIGNATURE_V1 &&
      hmIsSupportedBaud(legacyPreference.baud)) {
    hmPreferredBaud = legacyPreference.baud;
    hmNeedsBootNormalize = false;
    hmStorePreferredBaud(hmPreferredBaud, false);
    return;
  }

  hmPreferredBaud = HM10_DEFAULT_UART_BAUD;
  hmNeedsBootNormalize = false;
}

static void hmStorePreferredBaud(uint32_t baud, bool pendingNormalize) {
  if (!hmIsSupportedBaud(baud)) {
    return;
  }
  const Hm10BaudPreference preference = {
    HM10_BAUD_PREF_EEPROM_SIGNATURE,
    baud,
    pendingNormalize ? 1 : 0
  };
  EEPROM.put(0, preference);
}

static bool hmApplyBaudChange(uint32_t targetBaud) {
  const char *baudCommand = hmBaudCommandFor(targetBaud);
  if (!baudCommand) {
    DBG.print(F("[HM10] Unsupported requested UART baud "));
    DBG.println(targetBaud);
    return false;
  }

  hmWarnIfBaudMayBeNoisy(targetBaud);

  if (hmActiveBaud == targetBaud) {
    BT.begin(hmActiveBaud);
    BT.listen();
    delay(200);
    return true;
  }

  DBG.print(F("[HM10] Switching module UART to "));
  DBG.print(targetBaud);
  DBG.println(F(" baud..."));

  if (!hmSendCommandExpect(baudCommand, "OK", AT_CONFIG_TIMEOUT_MS)) {
    DBG.println(F("[HM10] Failed to change module UART baud."));
    return false;
  }

  hmActiveBaud = targetBaud;
  BT.begin(hmActiveBaud);
  BT.listen();
  delay(250);

  if (!hmSendCommandExpect("AT", "OK", AT_TIMEOUT_MS)) {
    DBG.println(F("[HM10] Module did not answer after the UART change."));
    return false;
  }

  DBG.print(F("[HM10] Module UART active at "));
  DBG.print(hmActiveBaud);
  DBG.println(F(" baud."));
  return true;
}

static void hmScheduleBaudApply(uint32_t targetBaud) {
  hmPendingBaud = targetBaud;
  hmBaudApplyAtMs = millis() + HM10_BAUD_APPLY_DELAY_MS;
  hmHasPendingBaudApply = true;
}

static void hmHandleCommandLine(const char *line) {
  if (!line || line[0] == '\0') {
    return;
  }

  if (strncmp(line, "HM10:PING=", 10) == 0) {
    char *end = NULL;
    const unsigned long parsedToken = strtoul(line + 10, &end, 10);
    if (end == line + 10 || (end && *end != '\0')) {
      DBG.print(F("[HM10] Could not parse link ping token: "));
      DBG.println(line);
      return;
    }

    const uint32_t token = static_cast<uint32_t>(parsedToken);
    DBG.print(F("[HM10] App link ping "));
    DBG.print(token);
    DBG.println(F(" received; sending ack."));
    btSendUint32(METRIC_HM10_LINK_ACK, token);
    return;
  }

  if (strncmp(line, "HM10:BAUD=", 10) != 0) {
    DBG.print(F("[HM10] Ignoring app command: "));
    DBG.println(line);
    return;
  }

  char *end = NULL;
  const unsigned long parsedBaud = strtoul(line + 10, &end, 10);
  if (end == line + 10 || (end && *end != '\0')) {
    DBG.print(F("[HM10] Could not parse requested UART baud: "));
    DBG.println(line);
    return;
  }

  const uint32_t requestedBaud = static_cast<uint32_t>(parsedBaud);
  if (!hmIsSupportedBaud(requestedBaud)) {
    DBG.print(F("[HM10] App requested unsupported UART baud "));
    DBG.println(requestedBaud);
    DBG.println(F("[HM10] Supported values: 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200."));
    return;
  }

  hmPreferredBaud = requestedBaud;
  hmNeedsBootNormalize = true;
  hmStorePreferredBaud(hmPreferredBaud, true);

  DBG.print(F("[HM10] App saved preferred UART baud "));
  DBG.print(hmPreferredBaud);
  DBG.println(F("."));
  hmWarnIfBaudMayBeNoisy(hmPreferredBaud);

  if (hmActiveBaud == hmPreferredBaud) {
    DBG.println(F("[HM10] Requested baud is already active."));
    return;
  }

  hmScheduleBaudApply(hmPreferredBaud);
  DBG.print(F("[HM10] Will attempt the UART switch in "));
  DBG.print(HM10_BAUD_APPLY_DELAY_MS);
  DBG.println(F(" ms after the BLE app disconnects."));
}

static void hmPollIncomingCommands() {
  while (BT.available()) {
    const char c = static_cast<char>(BT.read());
    if (c == '\r' || c == '\n') {
      if (hmCommandLength == 0) {
        continue;
      }
      hmCommandBuffer[hmCommandLength] = '\0';
      hmHandleCommandLine(hmCommandBuffer);
      hmCommandLength = 0;
      hmCommandBuffer[0] = '\0';
      continue;
    }

    if (hmCommandLength + 1 >= sizeof(hmCommandBuffer)) {
      hmCommandLength = 0;
      hmCommandBuffer[0] = '\0';
      DBG.println(F("[HM10] App command too long; clearing buffer."));
      continue;
    }

    hmCommandBuffer[hmCommandLength++] = c;
  }
}

static void hmMaybeApplyPendingBaud() {
  if (!hmHasPendingBaudApply) {
    return;
  }

  if (static_cast<int32_t>(millis() - hmBaudApplyAtMs) < 0) {
    return;
  }

  hmHasPendingBaudApply = false;
  if (hmPendingBaud == hmActiveBaud) {
    DBG.println(F("[HM10] Pending UART baud already active."));
    return;
  }

  DBG.print(F("[HM10] Running delayed UART switch to "));
  DBG.print(hmPendingBaud);
  DBG.println(F(" baud."));

  if (!hmApplyBaudChange(hmPendingBaud)) {
    DBG.println(F("[HM10] Delayed switch did not complete. Disconnect BLE and power-cycle if needed."));
    return;
  }

  hmNeedsBootNormalize = false;
  hmStorePreferredBaud(hmPreferredBaud, false);
  DBG.print(F("[HM10] Delayed UART switch complete at "));
  DBG.print(hmActiveBaud);
  DBG.println(F(" baud."));
}

// -----------------------------------------------------------------------
// LCG pseudo-random (16-bit, no stdlib)
// -----------------------------------------------------------------------

static uint16_t nextRandom() {
  rngState = static_cast<uint16_t>(rngState * 25173U + 13849U);
  return rngState;
}

static float randVal(float base, float variance) {
  if (variance <= 0.0f) return base;
  float n = static_cast<float>(nextRandom()) / 65535.0f;
  return base + (n * 2.0f - 1.0f) * variance;
}

static float triangleWave(uint32_t now, uint32_t periodMs, float amplitude) {
  if (periodMs == 0) return 0.0f;

  const float phase = static_cast<float>(now % periodMs) /
                      static_cast<float>(periodMs);
  const float shape = phase < 0.5f
    ? (phase * 4.0f - 1.0f)
    : (3.0f - phase * 4.0f);

  return shape * amplitude;
}

static uint32_t boundedUint32(float value, uint32_t minValue, uint32_t maxValue) {
  if (value < static_cast<float>(minValue)) return minValue;
  if (value > static_cast<float>(maxValue)) return maxValue;
  return static_cast<uint32_t>(value + 0.5f);
}

static float boundedFloat(float value, float minValue, float maxValue) {
  if (value < minValue) return minValue;
  if (value > maxValue) return maxValue;
  return value;
}

static float ramp01(uint32_t now, uint32_t durationMs) {
  if (durationMs == 0 || now >= durationMs) return 1.0f;
  return static_cast<float>(now) / static_cast<float>(durationMs);
}

// FIX 2: the original second branch ended at 0.75 (phase 0.28) while the third
// branch started at 0.55 — a hard discontinuity in the PPG waveform.
// The second branch now descends to 0.55 so the dicrotic notch begins cleanly.
//
//   phase 0.00–0.12 : systolic upstroke   (0 → 1.0)
//   phase 0.12–0.28 : systolic downstroke (1.0 → 0.55)   ← fixed
//   phase 0.28–0.38 : dicrotic notch rise (0.55 → 0.70)
//   phase 0.38–1.00 : diastolic decay     (0.70 → 0)
static float ppgPulse(uint32_t now, uint16_t periodMs) {
  if (periodMs == 0) return 0.0f;

  const float phase = static_cast<float>(now % periodMs) /
                      static_cast<float>(periodMs);

  if (phase < 0.12f) {
    // Systolic upstroke: 0 → 1.0
    return phase / 0.12f;
  }
  if (phase < 0.28f) {
    // Systolic downstroke: 1.0 → 0.55 (was: 1.0 → 0.75, causing a jump)
    return 1.0f - ((phase - 0.12f) / 0.16f) * 0.45f;
  }
  if (phase < 0.38f) {
    // Dicrotic notch rise: 0.55 → 0.70
    return 0.55f + ((phase - 0.28f) / 0.10f) * 0.15f;
  }

  // Diastolic decay: 0.70 → 0
  const float decay = 1.0f - ((phase - 0.38f) / 0.62f);
  return boundedFloat(decay * 0.70f, 0.0f, 1.0f);
}

// -----------------------------------------------------------------------
// LED helpers
// -----------------------------------------------------------------------

static void ledBlink(uint8_t count, uint16_t onMs, uint16_t offMs) {
  for (uint8_t i = 0; i < count; i++) {
    digitalWrite(LED_PIN, HIGH);
    delay(onMs);
    digitalWrite(LED_PIN, LOW);
    delay(offMs);
  }
}

static void ledAckSend() {
  digitalWrite(LED_PIN, HIGH);
  delay(LED_ACK_MS);
  digitalWrite(LED_PIN, LOW);
}

// -----------------------------------------------------------------------
// Fixed-point JSON formatting
// AVR printf does not print floats by default, so values are rounded manually.
// -----------------------------------------------------------------------

static uint32_t decimalScale(uint8_t decimals) {
  uint32_t scale = 1;
  for (uint8_t i = 0; i < decimals; i++) {
    scale *= 10UL;
  }
  return scale;
}

static bool formatFixed(char *out, size_t outSize, float value, uint8_t decimals) {
  if (!out || outSize == 0) return false;
  if (decimals > 3) decimals = 3;

  const uint32_t scale = decimalScale(decimals);
  const float absValue = value < 0.0f ? -value : value;
  const uint32_t scaled = static_cast<uint32_t>(
    absValue * static_cast<float>(scale) + 0.5f
  );
  const bool negative = value < 0.0f && scaled > 0;
  const uint32_t whole = scaled / scale;
  const uint32_t frac = scaled % scale;

  int len;
  if (decimals == 0) {
    len = snprintf(out, outSize, "%s%lu",
                   negative ? "-" : "",
                   static_cast<unsigned long>(whole));
  } else if (decimals == 1) {
    len = snprintf(out, outSize, "%s%lu.%01lu",
                   negative ? "-" : "",
                   static_cast<unsigned long>(whole),
                   static_cast<unsigned long>(frac));
  } else if (decimals == 2) {
    len = snprintf(out, outSize, "%s%lu.%02lu",
                   negative ? "-" : "",
                   static_cast<unsigned long>(whole),
                   static_cast<unsigned long>(frac));
  } else {
    len = snprintf(out, outSize, "%s%lu.%03lu",
                   negative ? "-" : "",
                   static_cast<unsigned long>(whole),
                   static_cast<unsigned long>(frac));
  }

  return len > 0 && len < static_cast<int>(outSize);
}

static bool btSendValueText(const char *metric, const char *valueText) {
  char buf[MAX_LINE_BYTES + 1];
  const int len = snprintf(buf, sizeof(buf),
                           "{\"metric\":\"%s\",\"value\":%s}\n",
                           metric,
                           valueText);

  if (len <= 0 || len >= static_cast<int>(sizeof(buf))) {
    DBG.print(F("[ERR] JSON line too long for metric: "));
    DBG.println(metric);
    return false;
  }

  if (BT.overflow()) {
    DBG.println(F("[WARN] BT RX overflow detected (baud mismatch?)"));
  }

  BT.listen();
  BT.print(buf);

  DBG.print(F("[SEND] "));
  DBG.print(buf);

  ledAckSend();
  return true;
}

static bool btSendFloat(const char *metric, float value, uint8_t decimals) {
  char valueText[20];
  if (!formatFixed(valueText, sizeof(valueText), value, decimals)) {
    DBG.print(F("[ERR] Could not format value for metric: "));
    DBG.println(metric);
    return false;
  }
  return btSendValueText(metric, valueText);
}

static bool btSendUint32(const char *metric, uint32_t value) {
  char valueText[12];
  const int len = snprintf(valueText, sizeof(valueText), "%lu",
                           static_cast<unsigned long>(value));
  if (len <= 0 || len >= static_cast<int>(sizeof(valueText))) {
    DBG.print(F("[ERR] Could not format integer for metric: "));
    DBG.println(metric);
    return false;
  }
  return btSendValueText(metric, valueText);
}

static void paceMetricSend() {
  delay(INTER_METRIC_DELAY_MS);
  wdt_reset();
}

// -----------------------------------------------------------------------
// Synthetic sensor model
// -----------------------------------------------------------------------

static TelemetryFrame buildTelemetryFrame(uint32_t now) {
  TelemetryFrame frame;
  const bool moving = (now % 16000UL) >= 8000UL && (now % 16000UL) < 12500UL;
  const float motion = moving ? 1.0f : 0.0f;
  const uint16_t pulsePeriodMs = static_cast<uint16_t>(
    boundedUint32(820.0f + triangleWave(now, 45000UL, 55.0f), 730UL, 910UL)
  );
  const float pulseShape = ppgPulse(now, pulsePeriodMs);
  const float warmup = ramp01(now, 120000UL);
  const float ambientTemperature = randVal(22.2f, 0.05f) +
                                   triangleWave(now, 300000UL, 1.0f);
  const float humidityDrift = triangleWave(now + 7000UL, 240000UL, 4.5f);
  const uint32_t vocCycle = now % 90000UL;
  const float vocEvent = vocCycle < 12000UL
    ? triangleWave(vocCycle, 12000UL, 4200.0f) + 4200.0f
    : 0.0f;

  frame.timeMs = now;
  frame.ahtTemperatureC = boundedFloat(ambientTemperature, 18.0f, 30.0f);
  frame.ahtHumidityPct = boundedFloat(
    randVal(48.0f, 0.45f) +
      humidityDrift -
      (frame.ahtTemperatureC - 22.2f) * 0.8f,
    25.0f,
    85.0f
  );
  frame.tmp117TemperatureC = boundedFloat(
    30.5f + warmup * 4.0f +
      triangleWave(now + 12000UL, 180000UL, 0.25f) +
      randVal(0.0f, 0.03f),
    30.0f,
    36.8f
  );
  frame.vocRaw = boundedUint32(
    randVal(23500.0f, 180.0f) +
      triangleWave(now, 240000UL, 1600.0f) +
      (frame.ahtHumidityPct - 50.0f) * 95.0f +
      vocEvent,
    5000UL,
    65000UL
  );
  frame.hrBpm = 60000.0f / static_cast<float>(pulsePeriodMs);

  frame.accelX = randVal(0.0f, 0.025f) +
                 triangleWave(now, 560UL, 1.10f * motion);
  frame.accelY = randVal(0.0f, 0.025f) +
                 triangleWave(now + 180UL, 780UL, 0.80f * motion);
  frame.accelZ = randVal(EARTH_GRAVITY_MS2, 0.035f) +
                 triangleWave(now + 320UL, 640UL, 1.45f * motion);

  frame.gyroX = randVal(0.0f, 0.006f) +
                triangleWave(now, 620UL, 0.75f * motion);
  frame.gyroY = randVal(0.0f, 0.006f) +
                triangleWave(now + 120UL, 840UL, 0.55f * motion);
  frame.gyroZ = randVal(0.0f, 0.006f) +
                triangleWave(now + 260UL, 710UL, 0.90f * motion);

  frame.maxRed = boundedUint32(
    randVal(52000.0f, 70.0f) +
      (pulseShape * 1050.0f) +
      triangleWave(now + 260UL, 710UL, 380.0f * motion),
    30000UL,
    90000UL
  );
  frame.maxIr = boundedUint32(
    randVal(68000.0f, 90.0f) +
      (pulseShape * 1750.0f) +
      triangleWave(now + 180UL, 620UL, 620.0f * motion),
    40000UL,
    120000UL
  );

  return frame;
}

static void sendTelemetryFrame(const TelemetryFrame &frame) {
  DBG.print(F("[FRAME] "));
  DBG.println(static_cast<unsigned long>(frameCount));

  btSendUint32(METRIC_HM10_LINK_PROBE, frameCount);
  paceMetricSend();

  if (HM10_DEBUG_LINK_ONLY) {
    return;
  }

  btSendUint32(METRIC_TIME_MS, frame.timeMs);
  paceMetricSend();

  btSendFloat(METRIC_AHT20_TEMPERATURE_C, frame.ahtTemperatureC, 2);
  paceMetricSend();

  btSendFloat(METRIC_AHT20_HUMIDITY_PCT, frame.ahtHumidityPct, 2);
  paceMetricSend();

  btSendFloat(METRIC_TMP117_TEMPERATURE_C, frame.tmp117TemperatureC, 2);
  paceMetricSend();

  btSendUint32(METRIC_SGP40_VOC_RAW, frame.vocRaw);
  paceMetricSend();

  btSendFloat(METRIC_LSM6DSOX_ACCEL_X, frame.accelX, 3);
  paceMetricSend();

  btSendFloat(METRIC_LSM6DSOX_ACCEL_Y, frame.accelY, 3);
  paceMetricSend();

  btSendFloat(METRIC_LSM6DSOX_ACCEL_Z, frame.accelZ, 3);
  paceMetricSend();

  btSendFloat(METRIC_LSM6DSOX_GYRO_X, frame.gyroX, 3);
  paceMetricSend();

  btSendFloat(METRIC_LSM6DSOX_GYRO_Y, frame.gyroY, 3);
  paceMetricSend();

  btSendFloat(METRIC_LSM6DSOX_GYRO_Z, frame.gyroZ, 3);
  paceMetricSend();

  btSendUint32(METRIC_MAX30102_RED, frame.maxRed);
  paceMetricSend();

  btSendUint32(METRIC_MAX30102_IR, frame.maxIr);
  paceMetricSend();

  btSendUint32(METRIC_PPG_RAW, frame.maxIr);
  paceMetricSend();

  btSendFloat(METRIC_HEART_RATE, frame.hrBpm, 1);
}

// -----------------------------------------------------------------------
// AT command handshake
// Tries multiple baud rates in case the module was previously reconfigured.
// Returns true when the HM-10 replies "OK" within AT_TIMEOUT_MS.
// -----------------------------------------------------------------------

static bool tryAtHandshake(uint32_t baud) {
  BT.begin(baud);
  BT.listen();
  delay(200);
  return hmSendCommandExpect("AT", "OK", AT_TIMEOUT_MS);
}

static bool hmHandshake() {
  DBG.println(F("[HM10] Running AT handshake..."));

  for (uint8_t i = 0; i < HM10_SUPPORTED_UART_BAUD_COUNT; i++) {
    DBG.print(F("[HM10] Trying "));
    DBG.print(HM10_SUPPORTED_UART_BAUDS[i]);
    DBG.print(F(" baud ... "));

    if (tryAtHandshake(HM10_SUPPORTED_UART_BAUDS[i])) {
      DBG.println(F("OK"));
      hmActiveBaud = HM10_SUPPORTED_UART_BAUDS[i];
      DBG.print(F("[HM10] Detected UART baud "));
      DBG.print(hmActiveBaud);
      DBG.println(F("."));
      return true;
    }

    DBG.println(F("no response"));
    ledBlink(1, 80, 80);
  }

  DBG.println(F("[ERR] HM-10 not responding on any baud rate."));
  DBG.println(F("[ERR] Check wiring: TX->pin7, RX->pin8, power, GND."));
  hmActiveBaud = hmPreferredBaud;
  DBG.print(F("[HM10] Falling back to preferred UART baud "));
  DBG.print(hmActiveBaud);
  DBG.println(F("."));
  BT.begin(hmActiveBaud);
  BT.listen();
  delay(200);
  return false;
}

static bool hmEnsurePreferredStreamingBaud() {
  hmWarnIfBaudMayBeNoisy(hmPreferredBaud);

  if (hmActiveBaud == hmPreferredBaud) {
    BT.begin(hmActiveBaud);
    BT.listen();
    delay(200);
    return true;
  }

  DBG.print(F("[HM10] Reconfiguring module UART from "));
  DBG.print(hmActiveBaud);
  DBG.print(F(" to "));
  DBG.print(hmPreferredBaud);
  DBG.println(F(" baud for streaming..."));

  if (!hmApplyBaudChange(hmPreferredBaud)) {
    DBG.println(F("[HM10] Failed to switch module UART to the preferred streaming baud."));
    return false;
  }

  DBG.print(F("[HM10] Module UART normalized to "));
  DBG.print(hmActiveBaud);
  DBG.println(F(" baud for streaming."));
  return true;
}

static void hmBlindNormalizeToPreferredBaud() {
  const char *targetBaudCommand = hmBaudCommandFor(hmPreferredBaud);
  if (!targetBaudCommand) {
    hmPreferredBaud = HM10_DEFAULT_UART_BAUD;
    targetBaudCommand = hmBaudCommandFor(hmPreferredBaud);
  }

  DBG.print(F("[HM10] Blind-normalizing module UART to "));
  DBG.print(hmPreferredBaud);
  DBG.println(F("..."));

  for (uint8_t i = 0; i < HM10_SUPPORTED_UART_BAUD_COUNT; i++) {
    BT.begin(HM10_SUPPORTED_UART_BAUDS[i]);
    BT.listen();
    delay(180);
    hmDrainRx();

    // Repeat short AT commands to maximize the chance of a clean match on
    // clones whose current UART baud is too fast for reliable reply parsing.
    BT.print("AT");
    delay(80);
    BT.print(targetBaudCommand);
    delay(140);
    BT.print(targetBaudCommand);
    delay(140);
  }

  hmActiveBaud = hmPreferredBaud;
  BT.begin(hmActiveBaud);
  BT.listen();
  delay(250);
}

static bool hmApplyPeripheralProfile() {
  DBG.println(F("[HM10] Applying BLE UART peripheral profile..."));

  bool ok = true;
  ok &= hmSendCommandExpect("AT+MODE0", "OK", AT_CONFIG_TIMEOUT_MS);
  ok &= hmSendCommandExpect("AT+ROLE0", "OK", AT_CONFIG_TIMEOUT_MS);
  ok &= hmSendCommandExpect("AT+IMME0", "OK", AT_CONFIG_TIMEOUT_MS);
  ok &= hmSendCommandExpect("AT+NOTI1", "OK", AT_CONFIG_TIMEOUT_MS);
  ok &= hmSendCommandExpect("AT+PWRM1", "OK", AT_CONFIG_TIMEOUT_MS);
  ok &= hmSendCommandExpect("AT+PCTL1", "OK", AT_CONFIG_TIMEOUT_MS);
  ok &= hmSendCommandExpect("AT+FFE20", "OK", AT_CONFIG_TIMEOUT_MS);
  ok &= hmSendCommandExpect("AT+UUID0xFFE0", "OK", AT_CONFIG_TIMEOUT_MS);
  ok &= hmSendCommandExpect("AT+CHAR0xFFE1", "OK", AT_CONFIG_TIMEOUT_MS);
  ok &= hmSendCommandExpect("AT+RESET", "OK", AT_CONFIG_TIMEOUT_MS);

  delay(300);
  BT.begin(hmActiveBaud);
  BT.listen();
  delay(200);

  if (!hmSendCommandExpect("AT", "OK", AT_TIMEOUT_MS)) {
    DBG.println(F("[HM10] Module did not answer after reset."));
    return false;
  }

  if (!ok) {
    DBG.println(F("[HM10] One or more setup commands failed; continuing with the best partial config."));
    return true;
  }

  DBG.println(F("[HM10] BLE UART profile confirmed."));
  return true;
}

// -----------------------------------------------------------------------
// setup()
// -----------------------------------------------------------------------

void setup() {
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  DBG.begin(115200);
  delay(100);

  DBG.println(F(""));
  DBG.print(F("=== "));
  DBG.print(SKETCH_LABEL);
  DBG.println(F(" boot ==="));
  DBG.print(F("[LABEL] App profile: "));
  DBG.println(APP_DEVICE_PROFILE_LABEL);
  DBG.print(F("[LABEL] Web preset: "));
  DBG.println(WEB_DEVICE_PRESET_LABEL);
  DBG.print(F("[LABEL] Parser: "));
  DBG.println(DATA_PARSER_LABEL);
  DBG.print(F("[LABEL] Stream namespace: "));
  DBG.println(STREAM_NAMESPACE_LABEL);

  rngState = static_cast<uint16_t>(
    (static_cast<uint16_t>(analogRead(A0)) << 8) ^
     static_cast<uint16_t>(analogRead(A1))
  );
  DBG.print(F("[RNG] seed = "));
  DBG.println(rngState);
  hmLoadPreferredBaud();
  DBG.print(F("[HM10] Preferred UART baud = "));
  DBG.println(hmPreferredBaud);
  DBG.print(F("[HM10] Pending boot normalize = "));
  DBG.println(hmNeedsBootNormalize ? F("yes") : F("no"));

  ledBlink(4, 80, 80);
  const bool useAtBoot = HM10_PROBE_BAUD_ON_BOOT || HM10_APPLY_BOOT_PROFILE;
  const bool shouldBootNormalize =
    HM10_BLIND_NORMALIZE_TO_PREFERRED_BAUD_ON_BOOT && hmNeedsBootNormalize;

  if (shouldBootNormalize) {
    hmBlindNormalizeToPreferredBaud();
  }

  if (useAtBoot) {
    hmOk = hmHandshake();
    if (hmOk) {
      hmOk = hmEnsurePreferredStreamingBaud();
    }
    if (hmOk && HM10_APPLY_BOOT_PROFILE) {
      hmOk = hmApplyPeripheralProfile();
    }
  } else {
    hmActiveBaud = hmPreferredBaud;
    BT.begin(hmActiveBaud);
    BT.listen();
    delay(200);
    hmOk = true;

    DBG.print(F("[HM10] UART started at "));
    DBG.print(hmActiveBaud);
    DBG.println(F(" baud without AT probing."));
    DBG.println(F("[HM10] This mode is safest for HM-10 / BT05 clones."));
  }

  if (hmOk) {
    ledBlink(3, 200, 150);
    DBG.println(F("[HM10] Ready. Advertising as 'HMSoft' or 'BT05'."));
    if (useAtBoot && HM10_APPLY_BOOT_PROFILE) {
      DBG.print(F("[HM10] Connect via app profile '"));
      DBG.print(APP_DEVICE_PROFILE_LABEL);
      DBG.println(F("'"));
      DBG.println(F("       (Service FFE0 / Characteristic FFE1)"));
    } else {
      DBG.println(F("[HM10] Using the module's existing BLE UART profile."));
      DBG.print(F("[HM10] Streaming on UART baud "));
      DBG.print(hmActiveBaud);
      DBG.println(F("."));
      DBG.println(F("[HM10] Watch for sensor.hm10_link_probe in the app first."));
      DBG.println(F("[HM10] If data still does not appear, try FFE0/FFE1 first"));
      DBG.println(F("       and then FFF0/FFF1 for HM-10 clones."));
    }
    if (hmActiveBaud == hmPreferredBaud && hmNeedsBootNormalize && (shouldBootNormalize || useAtBoot)) {
      hmNeedsBootNormalize = false;
      hmStorePreferredBaud(hmPreferredBaud, false);
      DBG.println(F("[HM10] Cleared pending boot normalize flag."));
    }
  } else {
    digitalWrite(LED_PIN, HIGH);
    DBG.println(F("[ERR] HM-10 setup was not fully confirmed."));
    DBG.println(F("[ERR] Check role/mode/UUID/baud if the app cannot see data."));
    DBG.println(F("[ERR] The sketch will still stream over UART for diagnostics."));
  }

  DBG.println(F("[INFO] Full synthetic sensor frame every 1s."));
  DBG.println(F("[INFO] JSON metric lines are newline terminated."));
  DBG.println(F("[INFO] Open Serial Monitor at 115200 baud to watch sends."));
  DBG.println(F("==========================="));

  wdt_enable(WDTO_4S);
}

// -----------------------------------------------------------------------
// loop()
// -----------------------------------------------------------------------

void loop() {
  wdt_reset();
  hmPollIncomingCommands();
  hmMaybeApplyPendingBaud();

  const uint32_t now = millis();

  if (now - lastFrameMs >= SENSOR_FRAME_INTERVAL_MS) {
    lastFrameMs = now;
    frameCount++;

    const TelemetryFrame frame = buildTelemetryFrame(now);
    sendTelemetryFrame(frame);
  }
}
