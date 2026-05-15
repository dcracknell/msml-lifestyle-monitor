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

#include <SoftwareSerial.h>
#include <avr/wdt.h>
#include <string.h>

static const uint8_t BT_RX_PIN = 7;
static const uint8_t BT_TX_PIN = 8;

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
static const char METRIC_AHT20_TEMPERATURE_C[]    = "sensor.aht20_temperature_c";
static const char METRIC_AHT20_HUMIDITY_PERCENT[] = "sensor.aht20_humidity_percent";
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

// -----------------------------------------------------------------------
// Hardware
// -----------------------------------------------------------------------

static const uint8_t LED_PIN = LED_BUILTIN;

// -----------------------------------------------------------------------
// Timing constants
// -----------------------------------------------------------------------

static const uint32_t SENSOR_FRAME_INTERVAL_MS = 1000UL;
static const uint16_t INTER_METRIC_DELAY_MS    = 12;
static const uint8_t  LED_ACK_MS               = 8;

// Maximum wait for a full HM-10 AT response.
static const uint32_t AT_TIMEOUT_MS = 1500UL;
static const uint32_t AT_CONFIG_TIMEOUT_MS = 900UL;

// Enough for the longest metric name plus a signed fixed-point value.
static const uint8_t MAX_LINE_BYTES = 96;
static const uint8_t MAX_AT_REPLY_BYTES = 96;

// -----------------------------------------------------------------------
// State
// -----------------------------------------------------------------------

static uint32_t lastFrameMs = 0;
static uint32_t frameCount  = 0;
static uint16_t rngState    = 0;
static bool     hmOk        = false;

static const float EARTH_GRAVITY_MS2 = 9.80665f;

struct TelemetryFrame {
  uint32_t timeMs;
  float    ahtTemperatureC;
  float    ahtHumidityPercent;
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
};

static TelemetryFrame buildTelemetryFrame(uint32_t now);
static void sendTelemetryFrame(const TelemetryFrame &frame);
static bool hmApplyPeripheralProfile(void);

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

static float ppgPulse(uint32_t now, uint16_t periodMs) {
  if (periodMs == 0) return 0.0f;

  const float phase = static_cast<float>(now % periodMs) /
                      static_cast<float>(periodMs);

  if (phase < 0.12f) {
    return phase / 0.12f;
  }
  if (phase < 0.28f) {
    return 1.0f - ((phase - 0.12f) / 0.16f) * 0.25f;
  }
  if (phase < 0.38f) {
    return 0.55f + ((phase - 0.28f) / 0.10f) * 0.15f;
  }

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
  frame.ahtHumidityPercent = boundedFloat(
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
      (frame.ahtHumidityPercent - 50.0f) * 95.0f +
      vocEvent,
    5000UL,
    65000UL
  );

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

  btSendUint32(METRIC_TIME_MS, frame.timeMs);
  paceMetricSend();

  btSendFloat(METRIC_AHT20_TEMPERATURE_C, frame.ahtTemperatureC, 2);
  paceMetricSend();

  btSendFloat(METRIC_AHT20_HUMIDITY_PERCENT, frame.ahtHumidityPercent, 2);
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
}

// -----------------------------------------------------------------------
// AT command handshake
// Tries multiple baud rates in case the module was previously reconfigured.
// Returns true when the HM-10 replies "OK" within AT_TIMEOUT_MS.
// -----------------------------------------------------------------------

static bool tryAtHandshake(uint32_t baud) {
  BT.begin(baud);
  delay(200);
  return hmSendCommandExpect("AT", "OK", AT_TIMEOUT_MS);
}

static bool hmHandshake() {
  static const uint32_t BAUDS[] = { 9600UL, 115200UL, 57600UL, 38400UL };
  static const uint8_t BAUD_COUNT = sizeof(BAUDS) / sizeof(BAUDS[0]);

  DBG.println(F("[HM10] Running AT handshake..."));

  for (uint8_t i = 0; i < BAUD_COUNT; i++) {
    DBG.print(F("[HM10] Trying "));
    DBG.print(BAUDS[i]);
    DBG.print(F(" baud ... "));

    if (tryAtHandshake(BAUDS[i])) {
      DBG.println(F("OK"));
      DBG.print(F("[HM10] BAUD "));
      DBG.print(BAUDS[i]);
      DBG.println(F(" OK - module confirmed"));

      if (BAUDS[i] != 9600UL) {
        DBG.println(F("[HM10] Re-setting baud to 9600..."));
        hmSendCommandExpect("AT+BAUD0", "OK", AT_CONFIG_TIMEOUT_MS);
        delay(200);
        BT.begin(9600);
        delay(200);
      }
      return true;
    }

    DBG.println(F("no response"));
    ledBlink(1, 80, 80);
  }

  DBG.println(F("[ERR] HM-10 not responding on any baud rate."));
  DBG.println(F("[ERR] Check wiring: TX->pin7, RX->pin8, power, GND."));
  DBG.println(F("[HM10] Falling back to 9600 baud for streaming."));
  BT.begin(9600);
  delay(200);
  return false;
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
  BT.begin(9600);
  delay(200);

  if (!hmSendCommandExpect("AT", "OK", AT_TIMEOUT_MS)) {
    DBG.println(F("[HM10] Module did not answer after reset."));
    return false;
  }

  if (!ok) {
    DBG.println(F("[HM10] One or more setup commands failed; using partial config."));
    return false;
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

  ledBlink(4, 80, 80);
  hmOk = hmHandshake();
  if (hmOk) {
    hmOk = hmApplyPeripheralProfile();
  }

  if (hmOk) {
    ledBlink(3, 200, 150);
    DBG.println(F("[HM10] Ready. Advertising as 'HMSoft' or 'BT05'."));
    DBG.print(F("[HM10] Connect via app profile '"));
    DBG.print(APP_DEVICE_PROFILE_LABEL);
    DBG.println(F("'"));
    DBG.println(F("       (Service FFE0 / Characteristic FFE1)"));
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

  const uint32_t now = millis();

  if (now - lastFrameMs >= SENSOR_FRAME_INTERVAL_MS) {
    lastFrameMs = now;
    frameCount++;

    const TelemetryFrame frame = buildTelemetryFrame(now);
    sendTelemetryFrame(frame);
  }

  while (BT.available()) {
    BT.read();
  }
}
