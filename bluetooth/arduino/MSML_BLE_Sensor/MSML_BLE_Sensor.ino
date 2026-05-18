// MSML_BLE_Sensor.ino  ─  Unified real-sensor BLE streaming sketch
// MSML Lifestyle Monitor  ·  github.com/dcracknell/msml-lifestyle-monitor
//
// ── Hardware ─────────────────────────────────────────────────────────────
//   Arduino Uno / Nano
//   HM-10 BLE UART  (SoftwareSerial)   TX→pin7 (RX), RX→pin8 (TX)
//   AHT20            temperature + humidity               I2C
//   SGP40            VOC air quality index                I2C  (optional)
//   LSM6DSOX         accelerometer + gyroscope            I2C  (optional)
//   TMP117           precision skin temperature           I2C  (optional)
//   MAX30102         PPG / heart-rate / SpO₂              I2C
//
// ── Stream format ────────────────────────────────────────────────────────
//   Each metric is sent as one newline-terminated JSON line:
//     {"metric":"<name>","value":<number>}\n
//   The app's bluetooth.js parses these and POSTs them to /api/streams.
//
// ── Metric schedule ──────────────────────────────────────────────────────
//   Every  100 ms  (10 Hz): ppg.raw
//   Every 2000 ms         : sensor.aht20_temperature_c, sensor.aht20_humidity_pct,
//                           sensor.tmp117_temperature_c, sensor.voc_raw,
//                           sensor.accel_x/y/z, sensor.gyro_x/y/z
//   Every 10 000 ms       : vitals.heart_rate, vitals.spo2, vitals.hrv
//
// ── App configuration ────────────────────────────────────────────────────
//   Web bridge  : select profile "Arduino + HM-10 (0xFFE0)"  → parser "JSON text"
//   Service UUID  FFE0  ·  Characteristic UUID  FFE1
//   For BGL inference: Vitals page → Arduino Signal → metric "ppg.raw", Hz 10

#include <EEPROM.h>
#include <SoftwareSerial.h>
#include <avr/wdt.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

#include <Wire.h>
#include <Adafruit_AHTX0.h>
#include <Adafruit_SGP40.h>
#include <Adafruit_LSM6DSOX.h>
#include <Adafruit_TMP117.h>
#include "MAX30105.h"

// ── HM-10 pins & baud ────────────────────────────────────────────────────

static const uint8_t  BT_RX_PIN  = 7;
static const uint8_t  BT_TX_PIN  = 8;
static const uint32_t HM10_DEFAULT_UART_BAUD              = 9600UL;
static const uint32_t HM10_MAX_SAFE_SOFTWARESERIAL_BAUD   = 38400UL;
static const bool     HM10_PROBE_BAUD_ON_BOOT             = true;
static const bool     HM10_APPLY_BOOT_PROFILE             = true;
static const bool     HM10_BLIND_NORMALIZE_TO_PREFERRED_BAUD_ON_BOOT = true;
static const uint16_t HM10_BAUD_APPLY_DELAY_MS            = 1800U;
static const uint8_t  HM10_BAUD_PREF_EEPROM_SIGNATURE     = 0xB5;
static const uint8_t  HM10_BAUD_PREF_EEPROM_SIGNATURE_V1  = 0xB4;

SoftwareSerial BT(BT_RX_PIN, BT_TX_PIN);
#define DBG Serial

// ── Metric name constants (PROGMEM saves ~200 B RAM) ─────────────────────

static const char METRIC_LINK_PROBE[]    PROGMEM = "sensor.hm10_link_probe";
static const char METRIC_LINK_ACK[]      PROGMEM = "sensor.hm10_link_ack";
static const char METRIC_AHT_TEMP[]      PROGMEM = "sensor.aht20_temperature_c";
static const char METRIC_AHT_HUM[]       PROGMEM = "sensor.aht20_humidity_pct";
static const char METRIC_TMP_TEMP[]      PROGMEM = "sensor.tmp117_temperature_c";
static const char METRIC_VOC[]           PROGMEM = "sensor.voc_raw";
static const char METRIC_ACCEL_X[]       PROGMEM = "sensor.accel_x";
static const char METRIC_ACCEL_Y[]       PROGMEM = "sensor.accel_y";
static const char METRIC_ACCEL_Z[]       PROGMEM = "sensor.accel_z";
static const char METRIC_GYRO_X[]        PROGMEM = "sensor.gyro_x";
static const char METRIC_GYRO_Y[]        PROGMEM = "sensor.gyro_y";
static const char METRIC_GYRO_Z[]        PROGMEM = "sensor.gyro_z";
static const char METRIC_PPG_RAW[]       PROGMEM = "ppg.raw";
static const char METRIC_HEART_RATE[]    PROGMEM = "vitals.heart_rate";
static const char METRIC_SPO2[]          PROGMEM = "vitals.spo2";
static const char METRIC_HRV[]           PROGMEM = "vitals.hrv";

// ── Timing constants ─────────────────────────────────────────────────────

static const uint32_t PPG_INTERVAL_MS        = 100UL;    // 10 Hz
static const uint32_t TELEMETRY_INTERVAL_MS  = 2000UL;
static const uint32_t VITALS_INTERVAL_MS     = 10000UL;
static const uint16_t INTER_METRIC_DELAY_MS  = 30;

static const uint32_t AT_TIMEOUT_MS          = 1500UL;
static const uint32_t AT_CONFIG_TIMEOUT_MS   = 900UL;
static const uint8_t  MAX_LINE_BYTES         = 96;
static const uint8_t  MAX_AT_REPLY_BYTES     = 96;
static const uint8_t  MAX_COMMAND_BYTES      = 48;

static const uint32_t HM10_SUPPORTED_UART_BAUDS[] = {
  1200UL, 2400UL, 4800UL, 9600UL, 19200UL, 38400UL, 57600UL, 115200UL
};
static const uint8_t HM10_SUPPORTED_UART_BAUD_COUNT =
  sizeof(HM10_SUPPORTED_UART_BAUDS) / sizeof(HM10_SUPPORTED_UART_BAUDS[0]);

// ── PPG / HR / SpO₂ state ────────────────────────────────────────────────

#define PPG_HIST_SIZE  50    // 5 s at 10 Hz — for dynamic threshold
#define RR_BUF_SIZE    12    // last 12 RR intervals

static uint32_t ppgHist[PPG_HIST_SIZE];
static uint8_t  ppgHistIdx     = 0;
static bool     ppgHistFull    = false;

static uint16_t rrBuf[RR_BUF_SIZE];     // ms
static uint8_t  rrBufIdx       = 0;
static uint8_t  rrBufCount     = 0;

static bool     ppgAboveHigh   = false;
static uint32_t lastPeakMs     = 0;

// Exponential moving averages for SpO₂ AC/DC estimation
// alpha_dc = 0.98 → slow average tracks DC
// alpha_ac = 0.85 → faster average tracks short-term AC envelope

static float    dcIr    = 0;
static float    dcRed   = 0;
static float    acIr    = 0;
static float    acRed   = 0;

// Published vitals (updated after enough RR intervals)
static float    pubHrBpm    = 0;
static float    pubSpo2Pct  = 98.0f;
static float    pubHrvRmssd = 0;

// ── Sensor objects ────────────────────────────────────────────────────────

static Adafruit_AHTX0   aht;
static Adafruit_SGP40   sgp;
static Adafruit_LSM6DSOX imu;
static Adafruit_TMP117  tmp117;
static MAX30105         ppg;

static bool hasSGP40   = false;
static bool hasLSM6    = false;
static bool hasTMP117  = false;
static bool hasMAX30102 = false;

// ── Scheduling timestamps ─────────────────────────────────────────────────

static uint32_t lastPpgMs        = 0;
static uint32_t lastTelemetryMs  = 0;
static uint32_t lastVitalsMs     = 0;
static uint32_t frameCount       = 0;

// ── HM-10 state ───────────────────────────────────────────────────────────

static uint32_t hmActiveBaud          = HM10_DEFAULT_UART_BAUD;
static uint32_t hmPreferredBaud       = HM10_DEFAULT_UART_BAUD;
static uint32_t hmPendingBaud         = HM10_DEFAULT_UART_BAUD;
static uint32_t hmBaudApplyAtMs       = 0;
static bool     hmHasPendingBaudApply = false;
static bool     hmNeedsBootNormalize  = false;
static bool     hmOk                  = false;
static char     hmCmdBuf[MAX_COMMAND_BYTES + 1];
static uint8_t  hmCmdLen              = 0;

struct Hm10BaudPreference {
  uint8_t  signature;
  uint32_t baud;
  uint8_t  pendingNormalize;
};
struct Hm10BaudPreferenceV1 {
  uint8_t  signature;
  uint32_t baud;
};

// ── Forward declarations ──────────────────────────────────────────────────

static bool btSendMetricPgm(const char *metricPgm, const char *valueText);
static bool btSendFloat(const char *metricPgm, float value, uint8_t decimals);
static bool btSendUint32(const char *metricPgm, uint32_t value);
static bool hmApplyPeripheralProfile(void);
static bool hmEnsurePreferredStreamingBaud(void);
static void hmBlindNormalizeToPreferredBaud(void);
static void hmLoadPreferredBaud(void);
static void hmStorePreferredBaud(uint32_t baud, bool pendingNormalize);
static void hmPollIncomingCommands(void);
static void hmMaybeApplyPendingBaud(void);

// ── HM-10 AT helpers ─────────────────────────────────────────────────────

static bool hmIsSupportedBaud(uint32_t baud) {
  for (uint8_t i = 0; i < HM10_SUPPORTED_UART_BAUD_COUNT; i++)
    if (HM10_SUPPORTED_UART_BAUDS[i] == baud) return true;
  return false;
}

static const char *hmBaudCommandFor(uint32_t baud) {
  switch (baud) {
    case 1200UL:   return "AT+BAUD7";
    case 2400UL:   return "AT+BAUD6";
    case 4800UL:   return "AT+BAUD5";
    case 9600UL:   return "AT+BAUD0";
    case 19200UL:  return "AT+BAUD1";
    case 38400UL:  return "AT+BAUD2";
    case 57600UL:  return "AT+BAUD3";
    case 115200UL: return "AT+BAUD4";
    default: return NULL;
  }
}

static void hmDrainRx() { while (BT.available()) BT.read(); }

static bool hmReadReply(char *out, size_t outSize, uint32_t timeoutMs) {
  if (!out || outSize == 0) return false;
  out[0] = '\0';
  size_t len = 0; bool sawByte = false;
  uint32_t start = millis(), lastByteAt = start;
  while (millis() - start < timeoutMs) {
    while (BT.available()) {
      char c = (char)BT.read();
      sawByte = true; lastByteAt = millis();
      if (len + 1 < outSize) { out[len++] = c; out[len] = '\0'; }
    }
    if (sawByte && millis() - lastByteAt >= 40UL) break;
  }
  out[len] = '\0'; return sawByte;
}

static bool hmSendCommandExpect(const char *command, const char *expected, uint32_t timeoutMs) {
  char reply[MAX_AT_REPLY_BYTES + 1];
  hmDrainRx(); BT.print(command);
  if (!hmReadReply(reply, sizeof(reply), timeoutMs)) {
    DBG.print(F("[HM10] No reply: ")); DBG.println(command); return false;
  }
  DBG.print(F("[HM10] ")); DBG.print(command); DBG.print(F(" -> ")); DBG.println(reply);
  if (!expected || expected[0] == '\0') return true;
  return strstr(reply, expected) != NULL;
}

static void hmLoadPreferredBaud() {
  Hm10BaudPreference pref = { 0, HM10_DEFAULT_UART_BAUD, 0 };
  EEPROM.get(0, pref);
  if (pref.signature == HM10_BAUD_PREF_EEPROM_SIGNATURE && hmIsSupportedBaud(pref.baud)) {
    hmPreferredBaud = pref.baud; hmNeedsBootNormalize = (pref.pendingNormalize == 1); return;
  }
  Hm10BaudPreferenceV1 legacy = { 0, HM10_DEFAULT_UART_BAUD };
  EEPROM.get(0, legacy);
  if (legacy.signature == HM10_BAUD_PREF_EEPROM_SIGNATURE_V1 && hmIsSupportedBaud(legacy.baud)) {
    hmPreferredBaud = legacy.baud; hmNeedsBootNormalize = false;
    hmStorePreferredBaud(hmPreferredBaud, false); return;
  }
  hmPreferredBaud = HM10_DEFAULT_UART_BAUD; hmNeedsBootNormalize = false;
}

static void hmStorePreferredBaud(uint32_t baud, bool pendingNormalize) {
  if (!hmIsSupportedBaud(baud)) return;
  Hm10BaudPreference pref = { HM10_BAUD_PREF_EEPROM_SIGNATURE, baud,
                               pendingNormalize ? (uint8_t)1 : (uint8_t)0 };
  EEPROM.put(0, pref);
}

static bool hmApplyBaudChange(uint32_t targetBaud) {
  const char *cmd = hmBaudCommandFor(targetBaud);
  if (!cmd) return false;
  if (targetBaud > HM10_MAX_SAFE_SOFTWARESERIAL_BAUD)
    DBG.println(F("[HM10] WARN: baud above Uno SoftwareSerial comfort range."));
  if (hmActiveBaud == targetBaud) { BT.begin(hmActiveBaud); BT.listen(); delay(200); return true; }
  DBG.print(F("[HM10] Switch to ")); DBG.print(targetBaud); DBG.println(F("..."));
  if (!hmSendCommandExpect(cmd, "OK", AT_CONFIG_TIMEOUT_MS)) return false;
  hmActiveBaud = targetBaud; BT.begin(hmActiveBaud); BT.listen(); delay(250);
  return hmSendCommandExpect("AT", "OK", AT_TIMEOUT_MS);
}

static void hmScheduleBaudApply(uint32_t targetBaud) {
  hmPendingBaud = targetBaud;
  hmBaudApplyAtMs = millis() + HM10_BAUD_APPLY_DELAY_MS;
  hmHasPendingBaudApply = true;
}

static void hmHandleCommandLine(const char *line) {
  if (!line || line[0] == '\0') return;
  if (strncmp(line, "HM10:PING=", 10) == 0) {
    char *end = NULL;
    uint32_t token = (uint32_t)strtoul(line + 10, &end, 10);
    if (end == line + 10 || (end && *end != '\0')) return;
    btSendUint32(METRIC_LINK_ACK, token); return;
  }
  if (strncmp(line, "HM10:BAUD=", 10) == 0) {
    char *end = NULL;
    uint32_t baud = (uint32_t)strtoul(line + 10, &end, 10);
    if (end == line + 10 || (end && *end != '\0') || !hmIsSupportedBaud(baud)) return;
    hmPreferredBaud = baud; hmNeedsBootNormalize = true;
    hmStorePreferredBaud(hmPreferredBaud, true);
    if (hmActiveBaud != hmPreferredBaud) hmScheduleBaudApply(hmPreferredBaud);
  }
}

static void hmPollIncomingCommands() {
  while (BT.available()) {
    char c = (char)BT.read();
    if (c == '\r' || c == '\n') {
      if (hmCmdLen == 0) continue;
      hmCmdBuf[hmCmdLen] = '\0';
      hmHandleCommandLine(hmCmdBuf);
      hmCmdLen = 0; hmCmdBuf[0] = '\0'; continue;
    }
    if (hmCmdLen + 1 >= sizeof(hmCmdBuf)) { hmCmdLen = 0; hmCmdBuf[0] = '\0'; continue; }
    hmCmdBuf[hmCmdLen++] = c;
  }
}

static void hmMaybeApplyPendingBaud() {
  if (!hmHasPendingBaudApply) return;
  if ((int32_t)(millis() - hmBaudApplyAtMs) < 0) return;
  hmHasPendingBaudApply = false;
  if (hmPendingBaud == hmActiveBaud) return;
  if (!hmApplyBaudChange(hmPendingBaud)) return;
  hmNeedsBootNormalize = false;
  hmStorePreferredBaud(hmPreferredBaud, false);
}

static bool tryAtHandshake(uint32_t baud) {
  BT.begin(baud); BT.listen(); delay(200);
  return hmSendCommandExpect("AT", "OK", AT_TIMEOUT_MS);
}

static bool hmHandshake() {
  DBG.println(F("[HM10] Probing baud rates..."));
  for (uint8_t i = 0; i < HM10_SUPPORTED_UART_BAUD_COUNT; i++) {
    DBG.print(HM10_SUPPORTED_UART_BAUDS[i]); DBG.print(F("... "));
    if (tryAtHandshake(HM10_SUPPORTED_UART_BAUDS[i])) {
      DBG.println(F("OK")); hmActiveBaud = HM10_SUPPORTED_UART_BAUDS[i]; return true;
    }
    DBG.println(F("no"));
  }
  DBG.println(F("[ERR] HM-10 not responding on any baud."));
  hmActiveBaud = hmPreferredBaud; BT.begin(hmActiveBaud); BT.listen(); delay(200); return false;
}

static bool hmEnsurePreferredStreamingBaud() {
  if (hmActiveBaud == hmPreferredBaud) { BT.begin(hmActiveBaud); BT.listen(); delay(200); return true; }
  return hmApplyBaudChange(hmPreferredBaud);
}

static void hmBlindNormalizeToPreferredBaud() {
  const char *cmd = hmBaudCommandFor(hmPreferredBaud);
  if (!cmd) { hmPreferredBaud = HM10_DEFAULT_UART_BAUD; cmd = hmBaudCommandFor(hmPreferredBaud); }
  for (uint8_t i = 0; i < HM10_SUPPORTED_UART_BAUD_COUNT; i++) {
    BT.begin(HM10_SUPPORTED_UART_BAUDS[i]); BT.listen(); delay(180); hmDrainRx();
    BT.print("AT"); delay(80); BT.print(cmd); delay(140); BT.print(cmd); delay(140);
  }
  hmActiveBaud = hmPreferredBaud; BT.begin(hmActiveBaud); BT.listen(); delay(250);
}

static bool hmApplyPeripheralProfile() {
  bool ok = true;
  ok &= hmSendCommandExpect("AT+MODE0",       "OK", AT_CONFIG_TIMEOUT_MS);
  ok &= hmSendCommandExpect("AT+ROLE0",       "OK", AT_CONFIG_TIMEOUT_MS);
  ok &= hmSendCommandExpect("AT+IMME0",       "OK", AT_CONFIG_TIMEOUT_MS);
  ok &= hmSendCommandExpect("AT+NOTI1",       "OK", AT_CONFIG_TIMEOUT_MS);
  ok &= hmSendCommandExpect("AT+PWRM1",       "OK", AT_CONFIG_TIMEOUT_MS);
  ok &= hmSendCommandExpect("AT+PCTL1",       "OK", AT_CONFIG_TIMEOUT_MS);
  ok &= hmSendCommandExpect("AT+FFE20",       "OK", AT_CONFIG_TIMEOUT_MS);
  ok &= hmSendCommandExpect("AT+UUID0xFFE0",  "OK", AT_CONFIG_TIMEOUT_MS);
  ok &= hmSendCommandExpect("AT+CHAR0xFFE1",  "OK", AT_CONFIG_TIMEOUT_MS);
  ok &= hmSendCommandExpect("AT+RESET",       "OK", AT_CONFIG_TIMEOUT_MS);
  delay(300); BT.begin(hmActiveBaud); BT.listen(); delay(200);
  if (!hmSendCommandExpect("AT", "OK", AT_TIMEOUT_MS)) { DBG.println(F("[HM10] No reply after reset.")); return false; }
  if (!ok) DBG.println(F("[HM10] Partial config; continuing anyway."));
  else     DBG.println(F("[HM10] BLE UART peripheral profile confirmed."));
  return true;
}

// ── JSON send helpers ─────────────────────────────────────────────────────

// Reads metric name from PROGMEM, sends {"metric":"<name>","value":<valueText>}\n
static bool btSendMetricPgm(const char *metricPgm, const char *valueText) {
  char metricRam[40];
  strncpy_P(metricRam, metricPgm, sizeof(metricRam) - 1);
  metricRam[sizeof(metricRam) - 1] = '\0';

  char buf[MAX_LINE_BYTES + 1];
  int len = snprintf(buf, sizeof(buf), "{\"metric\":\"%s\",\"value\":%s}\n", metricRam, valueText);
  if (len <= 0 || len >= (int)sizeof(buf)) {
    DBG.print(F("[ERR] JSON too long: ")); DBG.println(metricRam); return false;
  }
  BT.listen(); BT.print(buf);
  DBG.print(F("[TX] ")); DBG.print(buf);
  return true;
}

// Fixed-point float formatter (avoids printf %f which is disabled by default on AVR)
static bool formatFixed(char *out, size_t outSize, float value, uint8_t decimals) {
  if (!out || outSize == 0) return false;
  if (decimals > 3) decimals = 3;
  uint32_t scale = 1;
  for (uint8_t i = 0; i < decimals; i++) scale *= 10UL;
  bool neg = (value < 0.0f);
  float absv = neg ? -value : value;
  uint32_t scaled = (uint32_t)(absv * (float)scale + 0.5f);
  uint32_t whole = scaled / scale;
  uint32_t frac  = scaled % scale;
  int n;
  if (decimals == 0) n = snprintf(out, outSize, "%s%lu", neg ? "-" : "", (unsigned long)whole);
  else if (decimals == 1) n = snprintf(out, outSize, "%s%lu.%01lu", neg ? "-" : "", (unsigned long)whole, (unsigned long)frac);
  else if (decimals == 2) n = snprintf(out, outSize, "%s%lu.%02lu", neg ? "-" : "", (unsigned long)whole, (unsigned long)frac);
  else                    n = snprintf(out, outSize, "%s%lu.%03lu", neg ? "-" : "", (unsigned long)whole, (unsigned long)frac);
  return n > 0 && n < (int)outSize;
}

static bool btSendFloat(const char *metricPgm, float value, uint8_t decimals) {
  char vt[20];
  if (!formatFixed(vt, sizeof(vt), value, decimals)) return false;
  return btSendMetricPgm(metricPgm, vt);
}

static bool btSendUint32(const char *metricPgm, uint32_t value) {
  char vt[12];
  snprintf(vt, sizeof(vt), "%lu", (unsigned long)value);
  return btSendMetricPgm(metricPgm, vt);
}

// ── Sensor setup ──────────────────────────────────────────────────────────

static void setupSensors() {
  Wire.begin();

  // AHT20 — required
  if (!aht.begin()) {
    DBG.println(F("[SENSOR] FATAL: AHT20 not found. Check wiring."));
    while (1) delay(100);
  }
  DBG.println(F("[SENSOR] AHT20 OK"));

  // SGP40 — optional
  hasSGP40 = sgp.begin();
  DBG.println(hasSGP40 ? F("[SENSOR] SGP40 OK") : F("[SENSOR] SGP40 not found (optional)"));

  // LSM6DSOX — optional
  hasLSM6 = imu.begin_I2C();
  if (hasLSM6) {
    imu.setAccelRange(LSM6DS_ACCEL_RANGE_4_G);
    imu.setGyroRange(LSM6DS_GYRO_RANGE_500_DPS);
    imu.setAccelDataRate(LSM6DS_RATE_104_HZ);
    imu.setGyroDataRate(LSM6DS_RATE_104_HZ);
    DBG.println(F("[SENSOR] LSM6DSOX OK"));
  } else {
    DBG.println(F("[SENSOR] LSM6DSOX not found (optional)"));
  }

  // TMP117 — optional
  hasTMP117 = tmp117.begin();
  DBG.println(hasTMP117 ? F("[SENSOR] TMP117 OK") : F("[SENSOR] TMP117 not found (optional)"));

  // MAX30102 — required for PPG/HR, graceful fallback
  hasMAX30102 = ppg.begin(Wire, I2C_SPEED_STANDARD);
  if (hasMAX30102) {
    // 50 Hz sample rate, 4-sample average → ~12.5 effective samples/sec
    // We read at 10 Hz so each call gets the latest FIFO sample.
    ppg.setup(
      /*powerLevel*/   0x1F,
      /*sampleAverage*/4,
      /*ledMode*/      2,    // red + IR
      /*sampleRate*/   100,
      /*pulseWidth*/   411,
      /*adcRange*/     4096
    );
    DBG.println(F("[SENSOR] MAX30102 OK (50 Hz, 4x avg)"));
  } else {
    DBG.println(F("[SENSOR] MAX30102 not found (PPG/HR unavailable)"));
  }
}

// ── HR / SpO₂ / HRV computation ──────────────────────────────────────────
//
// Algorithm:
//   DC baseline tracked with slow EMA (alpha=0.98)
//   AC envelope tracked with faster EMA (alpha=0.85) on |sample - DC|
//   Peak detection: state machine with dynamic threshold from ppgHist buffer
//   RR intervals → BPM, RMSSD
//   SpO₂: Simplified ratio-of-ratios  SpO₂ = 104 − 17 × (AC_red/DC_red) / (AC_ir/DC_ir)

static float ema(float prev, float sample, float alpha) {
  return alpha * prev + (1.0f - alpha) * sample;
}

static void updatePpgAlgorithm(uint32_t irRaw, uint32_t redRaw, uint32_t nowMs) {
  float ir  = (float)irRaw;
  float red = (float)redRaw;

  // Update DC/AC estimates
  if (dcIr == 0) { dcIr = ir; dcRed = red; }   // first sample init
  dcIr  = ema(dcIr,  ir,  0.98f);
  dcRed = ema(dcRed, red, 0.98f);
  float absAcIr  = ir  > dcIr  ? ir  - dcIr  : dcIr  - ir;
  float absAcRed = red > dcRed ? red - dcRed : dcRed - red;
  acIr  = ema(acIr,  absAcIr,  0.85f);
  acRed = ema(acRed, absAcRed, 0.85f);

  // Dynamic threshold from recent history
  ppgHist[ppgHistIdx] = irRaw;
  ppgHistIdx = (ppgHistIdx + 1) % PPG_HIST_SIZE;
  if (ppgHistIdx == 0) ppgHistFull = true;

  uint8_t histCount = ppgHistFull ? PPG_HIST_SIZE : ppgHistIdx;
  if (histCount < 5) return;   // not enough data yet

  uint32_t hmin = 0xFFFFFFFFUL, hmax = 0;
  for (uint8_t i = 0; i < histCount; i++) {
    if (ppgHist[i] < hmin) hmin = ppgHist[i];
    if (ppgHist[i] > hmax) hmax = ppgHist[i];
  }

  uint32_t range = hmax - hmin;
  if (range < 300) return;     // signal too flat → sensor not in contact

  uint32_t highThresh = hmin + (range * 7UL) / 10UL;
  uint32_t lowThresh  = hmin + (range * 3UL) / 10UL;

  // Hysteresis peak detector
  if (!ppgAboveHigh && irRaw > highThresh) {
    ppgAboveHigh = true;
    if (lastPeakMs > 0) {
      uint32_t rrMs = nowMs - lastPeakMs;
      if (rrMs >= 300UL && rrMs <= 1500UL) {    // valid: 40 – 200 bpm
        rrBuf[rrBufIdx] = (uint16_t)rrMs;
        rrBufIdx = (rrBufIdx + 1) % RR_BUF_SIZE;
        if (rrBufCount < RR_BUF_SIZE) rrBufCount++;
      }
    }
    lastPeakMs = nowMs;
  } else if (ppgAboveHigh && irRaw < lowThresh) {
    ppgAboveHigh = false;
  }

  // Update published HR/HRV when we have enough RR intervals
  if (rrBufCount >= 3) {
    uint32_t rrSum = 0;
    for (uint8_t i = 0; i < rrBufCount; i++) rrSum += rrBuf[i];
    float avgRr = (float)rrSum / (float)rrBufCount;
    pubHrBpm = 60000.0f / avgRr;
    pubHrBpm = pubHrBpm < 30.0f ? 30.0f : (pubHrBpm > 220.0f ? 220.0f : pubHrBpm);
  }

  if (rrBufCount >= 4) {
    float ssq = 0; uint8_t n = 0;
    for (uint8_t i = 1; i < rrBufCount; i++) {
      float d = (float)rrBuf[i] - (float)rrBuf[(i == 0 ? RR_BUF_SIZE - 1 : i - 1)];
      ssq += d * d; n++;
    }
    pubHrvRmssd = n > 0 ? sqrt(ssq / (float)n) : 0;
  }

  // SpO₂ estimate — requires stable signal (acIr > 100)
  if (dcIr > 1000 && acIr > 100 && dcRed > 500 && acRed > 50) {
    float R = (acRed / dcRed) / (acIr / dcIr);
    float spo2 = 104.0f - 17.0f * R;
    spo2 = spo2 < 80.0f ? 80.0f : (spo2 > 100.0f ? 100.0f : spo2);
    pubSpo2Pct = ema(pubSpo2Pct, spo2, 0.90f);   // slow update to avoid jitter
  }
}

// ── Per-task send functions ───────────────────────────────────────────────

static void sendPpgTick(uint32_t nowMs) {
  if (!hasMAX30102) return;
  if (!ppg.safeCheck(20)) return;   // wait up to 20 ms for a fresh FIFO sample
  uint32_t irVal  = ppg.getIR();
  uint32_t redVal = ppg.getRed();
  updatePpgAlgorithm(irVal, redVal, nowMs);
  btSendUint32(METRIC_PPG_RAW, irVal);
  // No inter-metric delay — single metric, 100 ms natural interval
}

static void sendTelemetry() {
  // AHT20
  sensors_event_t humEv, tempEv;
  aht.getEvent(&humEv, &tempEv);
  btSendFloat(METRIC_AHT_TEMP, tempEv.temperature, 2); delay(INTER_METRIC_DELAY_MS); wdt_reset();
  btSendFloat(METRIC_AHT_HUM,  humEv.relative_humidity, 2); delay(INTER_METRIC_DELAY_MS); wdt_reset();

  // SGP40
  if (hasSGP40) {
    uint16_t voc = sgp.measureRaw(tempEv.temperature, humEv.relative_humidity);
    btSendUint32(METRIC_VOC, voc); delay(INTER_METRIC_DELAY_MS); wdt_reset();
  }

  // TMP117
  if (hasTMP117) {
    sensors_event_t tmpEv;
    tmp117.getEvent(&tmpEv);
    btSendFloat(METRIC_TMP_TEMP, tmpEv.temperature, 2); delay(INTER_METRIC_DELAY_MS); wdt_reset();
  }

  // LSM6DSOX
  if (hasLSM6) {
    sensors_event_t aEv, gEv, tEv;
    imu.getEvent(&aEv, &gEv, &tEv);
    btSendFloat(METRIC_ACCEL_X, aEv.acceleration.x, 3); delay(INTER_METRIC_DELAY_MS); wdt_reset();
    btSendFloat(METRIC_ACCEL_Y, aEv.acceleration.y, 3); delay(INTER_METRIC_DELAY_MS); wdt_reset();
    btSendFloat(METRIC_ACCEL_Z, aEv.acceleration.z, 3); delay(INTER_METRIC_DELAY_MS); wdt_reset();
    btSendFloat(METRIC_GYRO_X,  gEv.gyro.x, 3);         delay(INTER_METRIC_DELAY_MS); wdt_reset();
    btSendFloat(METRIC_GYRO_Y,  gEv.gyro.y, 3);         delay(INTER_METRIC_DELAY_MS); wdt_reset();
    btSendFloat(METRIC_GYRO_Z,  gEv.gyro.z, 3);         delay(INTER_METRIC_DELAY_MS); wdt_reset();
  }
}

static void sendVitals() {
  btSendUint32(METRIC_LINK_PROBE, frameCount);
  delay(INTER_METRIC_DELAY_MS); wdt_reset();

  if (pubHrBpm > 0) {
    btSendFloat(METRIC_HEART_RATE, pubHrBpm,    1); delay(INTER_METRIC_DELAY_MS); wdt_reset();
    btSendFloat(METRIC_SPO2,       pubSpo2Pct,  1); delay(INTER_METRIC_DELAY_MS); wdt_reset();
    if (pubHrvRmssd > 0) {
      btSendFloat(METRIC_HRV, pubHrvRmssd, 1); delay(INTER_METRIC_DELAY_MS); wdt_reset();
    }
  }
}

// ── setup() ──────────────────────────────────────────────────────────────

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LOW);

  DBG.begin(115200);
  delay(100);
  DBG.println(F(""));
  DBG.println(F("=== MSML Unified BLE Sensor ==="));
  DBG.println(F("[INFO] Sensors: AHT20 + SGP40 + LSM6DSOX + TMP117 + MAX30102"));
  DBG.println(F("[INFO] BLE: HM-10 FFE0/FFE1, JSON metric lines"));
  DBG.println(F("[INFO] PPG 10 Hz  |  Telemetry 0.5 Hz  |  Vitals 0.1 Hz"));

  setupSensors();

  hmLoadPreferredBaud();
  DBG.print(F("[HM10] Preferred baud = ")); DBG.println(hmPreferredBaud);

  const bool shouldNorm = HM10_BLIND_NORMALIZE_TO_PREFERRED_BAUD_ON_BOOT && hmNeedsBootNormalize;
  if (shouldNorm) hmBlindNormalizeToPreferredBaud();

  const bool useAt = HM10_PROBE_BAUD_ON_BOOT || HM10_APPLY_BOOT_PROFILE;
  if (useAt) {
    hmOk = hmHandshake();
    if (hmOk) hmOk = hmEnsurePreferredStreamingBaud();
    if (hmOk && HM10_APPLY_BOOT_PROFILE) hmOk = hmApplyPeripheralProfile();
  } else {
    hmActiveBaud = hmPreferredBaud; BT.begin(hmActiveBaud); BT.listen(); delay(200); hmOk = true;
  }

  if (hmOk) {
    for (uint8_t i = 0; i < 3; i++) {
      digitalWrite(LED_BUILTIN, HIGH); delay(200);
      digitalWrite(LED_BUILTIN, LOW);  delay(150);
    }
    if (hmNeedsBootNormalize && (shouldNorm || useAt)) {
      hmNeedsBootNormalize = false; hmStorePreferredBaud(hmPreferredBaud, false);
    }
    DBG.println(F("[HM10] Ready. Connect via 'Arduino + HM-10' profile (FFE0/FFE1)."));
  } else {
    digitalWrite(LED_BUILTIN, HIGH);
    DBG.println(F("[WARN] HM-10 not confirmed. Streaming anyway for diagnostics."));
  }

  DBG.println(F("[INFO] Serial monitor at 115200 baud to observe TX."));
  DBG.println(F("==========================="));

  wdt_enable(WDTO_4S);
}

// ── loop() ───────────────────────────────────────────────────────────────

void loop() {
  wdt_reset();
  hmPollIncomingCommands();
  hmMaybeApplyPendingBaud();

  const uint32_t now = millis();

  if (now - lastPpgMs >= PPG_INTERVAL_MS) {
    lastPpgMs = now;
    sendPpgTick(now);
  }

  if (now - lastTelemetryMs >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryMs = now;
    sendTelemetry();
    wdt_reset();
  }

  if (now - lastVitalsMs >= VITALS_INTERVAL_MS) {
    lastVitalsMs = now;
    frameCount++;
    sendVitals();
    wdt_reset();
  }
}
