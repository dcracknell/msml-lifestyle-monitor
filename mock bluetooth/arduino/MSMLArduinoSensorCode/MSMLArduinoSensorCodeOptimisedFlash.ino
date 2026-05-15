#define SERIAL_RX_BUFFER_SIZE 16
#define SERIAL_TX_BUFFER_SIZE 16

#include <Wire.h>
#include <SPI.h>
#include <SD.h>

#include <Adafruit_AHTX0.h>
#include <Adafruit_SGP40.h>
#include <Adafruit_LSM6DSOX.h>
#include <Adafruit_TMP117.h>
#include "MAX30105.h"

// ---------- OBJECTS ----------
Adafruit_AHTX0 aht;
Adafruit_SGP40 sgp;
Adafruit_LSM6DSOX imu;
Adafruit_TMP117 tmp117;
MAX30105 max30102;

// ---------- SETTINGS ----------
#define SD_CS_PIN 10
#define LOG_FILE "DATA.CSV"

#define SENSOR_INTERVAL_MS 1000UL
#define BT_SEND_INTERVAL_MS 60000UL

unsigned long lastSensorLog = 0;
unsigned long lastBluetoothSend = 0;

// ---------- SETUP ----------

void setupSerialBluetooth() {
  Serial.begin(9600);
  delay(500);
  Serial.println(F("BOOT"));
}

void setupI2C() {
  Wire.begin();
}

void setupAHT20() {
  if (!aht.begin()) {
    Serial.println(F("AHT20 ERR"));
    while (1);
  }
  Serial.println(F("AHT20 OK"));
}

void setupSGP40() {
  if (!sgp.begin()) {
    Serial.println(F("SGP40 ERR"));
    while (1);
  }
  Serial.println(F("SGP40 OK"));
}

void setupLSM6DSOX() {
  if (!imu.begin_I2C()) {
    Serial.println(F("IMU ERR"));
    while (1);
  }

  imu.setAccelRange(LSM6DS_ACCEL_RANGE_4_G);
  imu.setGyroRange(LSM6DS_GYRO_RANGE_500_DPS);
  imu.setAccelDataRate(LSM6DS_RATE_104_HZ);
  imu.setGyroDataRate(LSM6DS_RATE_104_HZ);

  Serial.println(F("IMU OK"));
}

void setupTMP117() {
  if (!tmp117.begin()) {
    Serial.println(F("TMP117 ERR"));
    while (1);
  }
  Serial.println(F("TMP117 OK"));
}

void setupMAX30102() {
  if (!max30102.begin(Wire, I2C_SPEED_STANDARD)) {
    Serial.println(F("MAX30102 ERR"));
    while (1);
  }

  max30102.setup();
  max30102.setPulseAmplitudeRed(0x1F);
  max30102.setPulseAmplitudeIR(0x1F);
  max30102.setPulseAmplitudeGreen(0);

  Serial.println(F("MAX30102 OK"));
}

void setupSDCard() {
  pinMode(SD_CS_PIN, OUTPUT);
  digitalWrite(SD_CS_PIN, HIGH);

  if (!SD.begin(SD_CS_PIN)) {
    Serial.println(F("SD ERR"));
    while (1);
  }

  Serial.println(F("SD OK"));

  if (!SD.exists(LOG_FILE)) {
    File f = SD.open(LOG_FILE, FILE_WRITE);
    if (f) {
      f.println(F("ms,ahtC,hum,tmpC,voc,ax,ay,az,gx,gy,gz,red,ir"));
      f.close();
    }
  }
}

// ---------- SENSOR READ + LOG ----------

void readAndLogSensors() {
  sensors_event_t humEvent;
  sensors_event_t tempEvent;
  sensors_event_t accelEvent;
  sensors_event_t gyroEvent;
  sensors_event_t imuTempEvent;
  sensors_event_t tmpEvent;

  float ahtTemp;
  float hum;
  float tmpTemp;
  uint16_t voc;

  uint32_t red;
  uint32_t ir;

  aht.getEvent(&humEvent, &tempEvent);
  ahtTemp = tempEvent.temperature;
  hum = humEvent.relative_humidity;

  tmp117.getEvent(&tmpEvent);
  tmpTemp = tmpEvent.temperature;

  voc = sgp.measureRaw(ahtTemp, hum);

  imu.getEvent(&accelEvent, &gyroEvent, &imuTempEvent);

  red = max30102.getRed();
  ir = max30102.getIR();

  File f = SD.open(LOG_FILE, FILE_WRITE);

  if (!f) {
    Serial.println(F("LOG ERR"));
    return;
  }

  f.print(millis());
  f.print(',');
  f.print(ahtTemp, 2);
  f.print(',');
  f.print(hum, 2);
  f.print(',');
  f.print(tmpTemp, 2);
  f.print(',');
  f.print(voc);
  f.print(',');
  f.print(accelEvent.acceleration.x, 3);
  f.print(',');
  f.print(accelEvent.acceleration.y, 3);
  f.print(',');
  f.print(accelEvent.acceleration.z, 3);
  f.print(',');
  f.print(gyroEvent.gyro.x, 3);
  f.print(',');
  f.print(gyroEvent.gyro.y, 3);
  f.print(',');
  f.print(gyroEvent.gyro.z, 3);
  f.print(',');
  f.print(red);
  f.print(',');
  f.println(ir);

  f.close();

  Serial.println(F("LOG OK"));
}

// ---------- BLUETOOTH SD SEND ----------

void sendSDFileOverBluetooth() {
  File f = SD.open(LOG_FILE, FILE_READ);

  if (!f) {
    Serial.println(F("READ ERR"));
    return;
  }

  Serial.println(F("<START>"));

  while (f.available()) {
    Serial.write(f.read());
    delay(2);
  }

  Serial.println();
  Serial.println(F("<END>"));

  f.close();
}

// ---------- MAIN ----------

void setup() {
  setupSerialBluetooth();
  setupI2C();

  setupAHT20();
  setupSGP40();
  setupLSM6DSOX();
  setupTMP117();
  setupMAX30102();
  setupSDCard();

  Serial.println(F("READY"));
}

void loop() {
  unsigned long now = millis();

  if (now - lastSensorLog >= SENSOR_INTERVAL_MS) {
    lastSensorLog = now;
    readAndLogSensors();
  }

  if (now - lastBluetoothSend >= BT_SEND_INTERVAL_MS) {
    lastBluetoothSend = now;
    sendSDFileOverBluetooth();
  }
}