// Mock Health Sensor for Arduino Uno + HM-10 BLE Module
//
// Wiring:
//   HM-10 VCC  -> Arduino 3.3V or 5V (check your module)
//   HM-10 GND  -> Arduino GND
//   HM-10 TX   -> Arduino pin 3  (SoftwareSerial RX)
//   HM-10 RX   -> Arduino pin 4  (SoftwareSerial TX)
//
// Default HM-10 UUIDs:
//   Service        FFE0
//   Characteristic FFE1
//
// In the mobile app  : select the "Arduino + HM-10" device profile.
// On the web bridge  : select parser "JSON text (Arduino / HM-10)".
//
// USB Serial Monitor (9600 baud) shows startup diagnostics:
//   [HM10] AT ... OK / FAIL / TIMEOUT  – module reachability
//   [HM10] BAUD <n> OK                 – detected baud rate
//   [SEND] ...                         – every outgoing JSON line
//   [WARN] ...                         – soft warnings (buffer, range)
//   [ERR]  ...                         – hard faults
//
// Transmission schedule
// ---------------------
//  Every 2 s  : vitals.heart_rate  (primary – keeps live chart active)
//  Every 10 s : one secondary metric in rotation
//               vitals.spo2 | vitals.hrv | phone.steps |
//               vitals.glucose | body.weight_kg
//
// Server-side mirrors (streams.js)
// ---------------------------------
//  vitals.heart_rate -> health_markers.resting_hr
//  vitals.spo2       -> health_markers.spo2
//  vitals.hrv        -> health_markers.hrv_score
//  vitals.glucose    -> health_markers.glucose_mg_dl
//  body.weight_kg    -> weight_logs
//  phone.steps       -> daily_metrics.steps

#include <SoftwareSerial.h>
#include <avr/wdt.h>

SoftwareSerial BT(3, 4);   // RX = pin 3, TX = pin 4
#define DBG Serial         // USB serial for diagnostics

// -----------------------------------------------------------------------
// Hardware
// -----------------------------------------------------------------------

static const uint8_t LED_PIN  = LED_BUILTIN;   // pin 13 on Uno
static const uint8_t LED_SEND = LED_BUILTIN;   // blink on each successful send

// -----------------------------------------------------------------------
// Physiological range table
// Values outside [min, max] are clamped before transmission.
// -----------------------------------------------------------------------

struct MetricRange {
  const char *metric;
  float       minVal;
  float       maxVal;
};

static const MetricRange RANGES[] = {
  { "vitals.heart_rate", 40.0f, 220.0f },
  { "vitals.spo2",       70.0f, 100.0f },
  { "vitals.hrv",         5.0f, 200.0f },
  { "vitals.glucose",     2.0f,  30.0f },
  { "body.weight_kg",    20.0f, 300.0f },
  { "phone.steps",        0.0f, 100000.0f },
};

static const uint8_t RANGE_COUNT =
  static_cast<uint8_t>(sizeof(RANGES) / sizeof(RANGES[0]));

// -----------------------------------------------------------------------
// Secondary metric table
// -----------------------------------------------------------------------

struct SensorDef {
  const char *metric;
  float       baseValue;
  float       variance;
  uint8_t     decimals;
};

static const SensorDef SECONDARY[] = {
  { "vitals.spo2",    97.5f,  1.5f,  1 },
  { "vitals.hrv",     45.0f, 10.0f,  0 },
  { "phone.steps",     0.0f,  0.0f,  0 },   // special-cased below
  { "vitals.glucose",  5.2f,  0.4f,  1 },
  { "body.weight_kg", 70.5f,  0.1f,  1 },
};

static const uint8_t SECONDARY_COUNT =
  static_cast<uint8_t>(sizeof(SECONDARY) / sizeof(SECONDARY[0]));

// -----------------------------------------------------------------------
// Timing constants
// -----------------------------------------------------------------------

static const uint32_t HR_INTERVAL_MS    = 2000UL;
static const uint8_t  SECONDARY_EVERY_N = 5;       // every 5th HR send = 10 s

// Maximum wait for a full HM-10 AT response
static const uint32_t AT_TIMEOUT_MS     = 1500UL;

// Max JSON line length we'll ever need (includes '\n').
// Longest line: {"metric":"vitals.heart_rate","value":220}\n = 45 chars
static const uint8_t  MAX_LINE_BYTES    = 56;

// -----------------------------------------------------------------------
// State
// -----------------------------------------------------------------------

static uint32_t lastHrMs       = 0;
static uint8_t  hrSendCount    = 0;
static uint8_t  secondaryIndex = 0;
static uint32_t cumulSteps     = 8000UL;
static uint16_t rngState       = 0;
static bool     hmOk           = false;   // true once AT handshake passes

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

// Pulse LED briefly to acknowledge a successful send.
static void ledAckSend() {
  digitalWrite(LED_PIN, HIGH);
  delay(30);
  digitalWrite(LED_PIN, LOW);
}

// -----------------------------------------------------------------------
// Range clamping
// Returns the value clamped to its registered physiological range.
// Logs a warning over USB Serial if clamping was needed.
// -----------------------------------------------------------------------

static float clampRange(const char *metric, float value) {
  for (uint8_t i = 0; i < RANGE_COUNT; i++) {
    if (strcmp(metric, RANGES[i].metric) == 0) {
      if (value < RANGES[i].minVal) {
        DBG.print(F("[WARN] "));
        DBG.print(metric);
        DBG.print(F(" clamped "));
        DBG.print(value);
        DBG.print(F(" -> "));
        DBG.println(RANGES[i].minVal);
        return RANGES[i].minVal;
      }
      if (value > RANGES[i].maxVal) {
        DBG.print(F("[WARN] "));
        DBG.print(metric);
        DBG.print(F(" clamped "));
        DBG.print(value);
        DBG.print(F(" -> "));
        DBG.println(RANGES[i].maxVal);
        return RANGES[i].maxVal;
      }
      return value;
    }
  }
  return value;  // no range registered – pass through
}

// -----------------------------------------------------------------------
// Safe BT send
// Checks the SoftwareSerial overflow flag and ensures the line fits
// within the HM-10's UART buffer before writing.
// Returns false if the send was skipped due to a buffer problem.
// -----------------------------------------------------------------------

static bool btSendLine(const char *metric, float value, uint8_t decimals) {
  // Build the JSON line into a local buffer first so we can measure it.
  char buf[MAX_LINE_BYTES + 1];
  int len;

  if (decimals == 0) {
    len = snprintf(buf, sizeof(buf),
                   "{\"metric\":\"%s\",\"value\":%ld}\n",
                   metric, static_cast<long>(value));
  } else if (decimals == 1) {
    // Manual 1-decimal formatting to avoid printf float on AVR.
    long whole = static_cast<long>(value);
    int  frac  = static_cast<int>((value - static_cast<float>(whole)) * 10.0f + 0.5f);
    if (frac >= 10) { whole++; frac = 0; }
    len = snprintf(buf, sizeof(buf),
                   "{\"metric\":\"%s\",\"value\":%ld.%d}\n",
                   metric, whole, frac);
  } else {
    // Fallback: round to 2 dp
    long whole = static_cast<long>(value);
    int  frac  = static_cast<int>((value - static_cast<float>(whole)) * 100.0f + 0.5f);
    if (frac >= 100) { whole++; frac = 0; }
    len = snprintf(buf, sizeof(buf),
                   "{\"metric\":\"%s\",\"value\":%ld.%02d}\n",
                   metric, whole, frac);
  }

  // Guard: snprintf returns the number of chars it *would* write; if it
  // exceeds our buffer the line was silently truncated – skip it.
  if (len <= 0 || len >= static_cast<int>(sizeof(buf))) {
    DBG.print(F("[ERR] JSON line too long for metric: "));
    DBG.println(metric);
    return false;
  }

  // Check for SoftwareSerial receive overflow (indicates baud mismatch or
  // excessive noise from the HM-10 side).
  if (BT.overflow()) {
    DBG.println(F("[WARN] BT RX overflow detected (baud mismatch?)"));
  }

  // Write to HM-10.  SoftwareSerial::write() is blocking; a small inter-
  // packet delay lets the HM-10 finish transmitting before the next send.
  BT.print(buf);

  // Echo to USB Serial for easy verification without a BLE terminal.
  DBG.print(F("[SEND] "));
  DBG.print(buf);   // buf already has '\n'

  ledAckSend();
  return true;
}

// -----------------------------------------------------------------------
// AT command handshake
// Tries multiple baud rates in case the module was previously reconfigured.
// Returns true when the HM-10 replies "OK" within AT_TIMEOUT_MS.
// -----------------------------------------------------------------------

static bool tryAtHandshake(uint32_t baud) {
  BT.begin(baud);
  delay(200);

  // Flush any power-on noise
  while (BT.available()) BT.read();

  BT.print(F("AT"));

  uint32_t start = millis();
  String   resp  = "";
  while (millis() - start < AT_TIMEOUT_MS) {
    while (BT.available()) {
      char c = static_cast<char>(BT.read());
      resp += c;
    }
    if (resp.indexOf("OK") >= 0) return true;
  }
  return false;
}

static bool hmHandshake() {
  // Common HM-10 baud rates to probe.
  static const uint32_t BAUDS[] = { 9600UL, 115200UL, 57600UL, 38400UL };
  static const uint8_t  BAUD_COUNT = sizeof(BAUDS) / sizeof(BAUDS[0]);

  DBG.println(F("[HM10] Running AT handshake..."));

  for (uint8_t i = 0; i < BAUD_COUNT; i++) {
    DBG.print(F("[HM10] Trying "));
    DBG.print(BAUDS[i]);
    DBG.print(F(" baud ... "));

    if (tryAtHandshake(BAUDS[i])) {
      DBG.println(F("OK"));
      DBG.print(F("[HM10] BAUD "));
      DBG.print(BAUDS[i]);
      DBG.println(F(" OK – module confirmed"));

      if (BAUDS[i] != 9600UL) {
        // Normalise to 9600 so the rest of the sketch works.
        DBG.println(F("[HM10] Re-setting baud to 9600..."));
        BT.print(F("AT+BAUD0"));   // HM-10 command: set 9600
        delay(200);
        BT.begin(9600);
        delay(200);
      }
      return true;
    }

    DBG.println(F("no response"));
    ledBlink(1, 80, 80);   // short visual tick per attempt
  }

  DBG.println(F("[ERR] HM-10 not responding on any baud rate."));
  DBG.println(F("[ERR] Check wiring: TX->pin3, RX->pin4, power, GND."));
  return false;
}

// -----------------------------------------------------------------------
// setup()
// -----------------------------------------------------------------------

void setup() {
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  DBG.begin(9600);
  delay(100);

  DBG.println(F(""));
  DBG.println(F("=== Mock Health Sensor boot ==="));

  // Seed RNG from floating analogue inputs
  rngState = static_cast<uint16_t>(
    (static_cast<uint16_t>(analogRead(A0)) << 8) ^
     static_cast<uint16_t>(analogRead(A1))
  );
  DBG.print(F("[RNG] seed = "));
  DBG.println(rngState);

  // Fast-blink LED while probing HM-10
  ledBlink(4, 80, 80);

  hmOk = hmHandshake();

  if (hmOk) {
    // Three slow blinks = ready
    ledBlink(3, 200, 150);
    DBG.println(F("[HM10] Ready. Advertising as 'HMSoft' or 'BT05'."));
    DBG.println(F("[HM10] Connect via app profile 'Arduino + HM-10'"));
    DBG.println(F("       (Service FFE0 / Characteristic FFE1)"));
  } else {
    // Solid LED = hardware error
    digitalWrite(LED_PIN, HIGH);
    DBG.println(F("[ERR] Continuing without confirmed HM-10 link."));
    DBG.println(F("[ERR] Data will still be sent – check BLE terminal"));
    DBG.println(F("[ERR] to see if packets arrive despite AT failure."));
  }

  DBG.println(F("[INFO] HR every 2s  /  secondary metrics every 10s"));
  DBG.println(F("[INFO] Open Serial Monitor at 9600 baud to watch sends."));
  DBG.println(F("==========================="));

  // Enable watchdog: reset Arduino if loop() stalls > 4 s
  wdt_enable(WDTO_4S);
}

// -----------------------------------------------------------------------
// loop()
// -----------------------------------------------------------------------

void loop() {
  wdt_reset();   // pet the watchdog every iteration

  const uint32_t now = millis();

  if (now - lastHrMs >= HR_INTERVAL_MS) {
    lastHrMs = now;

    // --- Heart rate (primary, every 2 s) ---
    float hr = clampRange("vitals.heart_rate",
                          randVal(75.0f, 13.0f));
    btSendLine("vitals.heart_rate", hr, 0);

    // --- Secondary metric (every SECONDARY_EVERY_N HR sends = 10 s) ---
    hrSendCount++;
    if (hrSendCount >= SECONDARY_EVERY_N) {
      hrSendCount = 0;

      // Small gap so HM-10 doesn't receive two back-to-back packets
      // before the first is fully transmitted over BLE.
      delay(60);
      wdt_reset();

      const SensorDef &s = SECONDARY[secondaryIndex];
      float secVal;

      if (secondaryIndex == 2) {
        // phone.steps: increment 8-20 steps per 10 s window
        uint16_t inc = static_cast<uint16_t>(randVal(14.0f, 6.0f) + 0.5f);
        cumulSteps  += inc;
        secVal = clampRange("phone.steps",
                            static_cast<float>(cumulSteps));
      } else {
        secVal = clampRange(s.metric,
                            randVal(s.baseValue, s.variance));
      }

      btSendLine(s.metric, secVal, s.decimals);
      secondaryIndex =
        static_cast<uint8_t>((secondaryIndex + 1) % SECONDARY_COUNT);
    }
  }

  // Discard any incoming bytes from the app (commands not used here).
  while (BT.available()) {
    BT.read();
  }
}
