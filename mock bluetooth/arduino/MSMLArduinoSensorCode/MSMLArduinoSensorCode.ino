#include <Wire.h>
#include <SPI.h>
#include <SD.h>
#include <SoftwareSerial.h>

#include <Adafruit_AHTX0.h>
#include <Adafruit_SGP40.h>
#include <Adafruit_LSM6DSOX.h>
#include <Adafruit_TMP117.h>
#include "MAX30105.h"

// ---------- SENSOR OBJECTS ----------
Adafruit_AHTX0 aht;
Adafruit_SGP40 sgp;
Adafruit_LSM6DSOX lsm6ds;
Adafruit_TMP117 tmp117;
MAX30105 max30102;

// ---------- BLUETOOTH ----------
const int BT_RX_PIN = 7; // Arduino RX <- HM-10 TX
const int BT_TX_PIN = 8; // Arduino TX -> HM-10 RX

SoftwareSerial bluetooth(BT_RX_PIN, BT_TX_PIN);

// ---------- SD SETTINGS ----------
const int SD_CS_PIN = 10;
const char *LOG_FILE = "data.csv";

// ---------- TIMING ----------
unsigned long lastSensorLog = 0;
unsigned long lastBluetoothSend = 0;

const unsigned long SENSOR_LOG_INTERVAL = 1000;      // log every 1 second
const unsigned long BLUETOOTH_SEND_INTERVAL = 30000; // send SD data every 30 seconds

// ---------- SETUP BLOCKS ----------

void setupSerial() {
  Serial.begin(115200);
  while (!Serial) delay(10);
  Serial.println("System Boot");
}

void setupBluetooth() {
  bluetooth.begin(9600); // most HM-10 modules default to 9600
  bluetooth.println("HM-10 Bluetooth ready");
  Serial.println("Bluetooth ready");
}

void setupI2C() {
  Wire.begin();
  Serial.println("I2C ready");
}

void setupAHT20() {
  if (!aht.begin()) {
    Serial.println("ERROR: AHT20 not found");
    while (1) delay(10);
  }
  Serial.println("AHT20 ready");
}

void setupSGP40() {
  if (!sgp.begin()) {
    Serial.println("ERROR: SGP40 not found");
    while (1) delay(10);
  }
  Serial.println("SGP40 ready");
}

void setupLSM6DSOX() {
  if (!lsm6ds.begin_I2C()) {
    Serial.println("ERROR: LSM6DSOX not found");
    while (1) delay(10);
  }

  lsm6ds.setAccelRange(LSM6DS_ACCEL_RANGE_4_G);
  lsm6ds.setGyroRange(LSM6DS_GYRO_RANGE_500_DPS);
  lsm6ds.setAccelDataRate(LSM6DS_RATE_104_HZ);
  lsm6ds.setGyroDataRate(LSM6DS_RATE_104_HZ);

  Serial.println("LSM6DSOX ready");
}

void setupMAX30102() {
  if (!max30102.begin(Wire, I2C_SPEED_STANDARD)) {
    Serial.println("ERROR: MAX30102 not found");
    while (1) delay(10);
  }

  max30102.setup();
  max30102.setPulseAmplitudeRed(0x1F);
  max30102.setPulseAmplitudeIR(0x1F);
  max30102.setPulseAmplitudeGreen(0);

  Serial.println("MAX30102 ready");
}

void setupTMP117() {
  if (!tmp117.begin()) {
    Serial.println("ERROR: TMP117 not found");
    while (1) delay(10);
  }

  Serial.println("TMP117 ready");
}

void setupSDCard() {
  pinMode(SD_CS_PIN, OUTPUT);
  digitalWrite(SD_CS_PIN, HIGH);

  if (!SD.begin(SD_CS_PIN)) {
    Serial.println("ERROR: SD card failed");
    while (1) delay(10);
  }

  Serial.println("SD card ready");

  if (!SD.exists(LOG_FILE)) {
    File file = SD.open(LOG_FILE, FILE_WRITE);

    if (file) {
      file.println(
        "time_ms,"
        "aht20_temperature_c,"
        "aht20_humidity_percent,"
        "tmp117_temperature_c,"
        "voc_raw,"
        "accel_x,accel_y,accel_z,"
        "gyro_x,gyro_y,gyro_z,"
        "max_red,max_ir"
      );
      file.close();
    }
  }
}

// ---------- READ BLOCKS ----------

void readAHT20(float &temperature, float &humidity) {
  sensors_event_t hum;
  sensors_event_t temp;

  aht.getEvent(&hum, &temp);

  temperature = temp.temperature;
  humidity = hum.relative_humidity;
}

uint16_t readSGP40(float temperature, float humidity) {
  return sgp.measureRaw(temperature, humidity);
}

void readLSM6DSOX(
  float &accelX,
  float &accelY,
  float &accelZ,
  float &gyroX,
  float &gyroY,
  float &gyroZ
) {
  sensors_event_t accel;
  sensors_event_t gyro;
  sensors_event_t temp;

  lsm6ds.getEvent(&accel, &gyro, &temp);

  accelX = accel.acceleration.x;
  accelY = accel.acceleration.y;
  accelZ = accel.acceleration.z;

  gyroX = gyro.gyro.x;
  gyroY = gyro.gyro.y;
  gyroZ = gyro.gyro.z;
}

void readMAX30102(uint32_t &red, uint32_t &ir) {
  red = max30102.getRed();
  ir = max30102.getIR();
}

float readTMP117() {
  sensors_event_t temp;
  tmp117.getEvent(&temp);
  return temp.temperature;
}

// ---------- SD LOG BLOCK ----------

void logSensorData(
  float ahtTemperature,
  float humidity,
  float tmpTemperature,
  uint16_t vocRaw,
  float accelX,
  float accelY,
  float accelZ,
  float gyroX,
  float gyroY,
  float gyroZ,
  uint32_t red,
  uint32_t ir
) {
  File file = SD.open(LOG_FILE, FILE_WRITE);

  if (!file) {
    Serial.println("ERROR: Could not open log file");
    return;
  }

  file.print(millis());
  file.print(",");
  file.print(ahtTemperature);
  file.print(",");
  file.print(humidity);
  file.print(",");
  file.print(tmpTemperature);
  file.print(",");
  file.print(vocRaw);
  file.print(",");
  file.print(accelX);
  file.print(",");
  file.print(accelY);
  file.print(",");
  file.print(accelZ);
  file.print(",");
  file.print(gyroX);
  file.print(",");
  file.print(gyroY);
  file.print(",");
  file.print(gyroZ);
  file.print(",");
  file.print(red);
  file.print(",");
  file.println(ir);

  file.close();

  Serial.println("Data saved to SD card");
}

// ---------- BLUETOOTH SD SEND BLOCK ----------

void sendSDFileOverBluetooth() {
  File file = SD.open(LOG_FILE, FILE_READ);

  if (!file) {
    Serial.println("ERROR: Could not read SD file");
    bluetooth.println("ERROR: Could not read SD file");
    return;
  }

  Serial.println("Sending SD file over Bluetooth...");
  bluetooth.println("----- START DATA.CSV -----");

  while (file.available()) {
    char c = file.read();
    bluetooth.write(c);

    // Small delay so HM-10 buffer does not overflow
    delay(2);
  }

  bluetooth.println();
  bluetooth.println("----- END DATA.CSV -----");

  file.close();

  Serial.println("Bluetooth send complete");
}

// ---------- MAIN SENSOR TASK ----------

void readAndLogSensors() {
  float ahtTemperature;
  float humidity;
  float tmpTemperature;
  uint16_t vocRaw;

  float accelX, accelY, accelZ;
  float gyroX, gyroY, gyroZ;

  uint32_t red;
  uint32_t ir;

  readAHT20(ahtTemperature, humidity);
  tmpTemperature = readTMP117();
  vocRaw = readSGP40(ahtTemperature, humidity);
  readLSM6DSOX(accelX, accelY, accelZ, gyroX, gyroY, gyroZ);
  readMAX30102(red, ir);

  logSensorData(
    ahtTemperature,
    humidity,
    tmpTemperature,
    vocRaw,
    accelX,
    accelY,
    accelZ,
    gyroX,
    gyroY,
    gyroZ,
    red,
    ir
  );
}

// ---------- MAIN ----------

void setup() {
  setupSerial();
  setupBluetooth();
  setupI2C();

  setupAHT20();
  setupSGP40();
  setupLSM6DSOX();
  setupMAX30102();
  setupTMP117();

  setupSDCard();

  Serial.println("All sensors ready");
  bluetooth.println("All sensors ready");
}

void loop() {
  unsigned long currentTime = millis();

  if (currentTime - lastSensorLog >= SENSOR_LOG_INTERVAL) {
    lastSensorLog = currentTime;
    readAndLogSensors();
  }

  if (currentTime - lastBluetoothSend >= BLUETOOTH_SEND_INTERVAL) {
    lastBluetoothSend = currentTime;
    sendSDFileOverBluetooth();
  }
}