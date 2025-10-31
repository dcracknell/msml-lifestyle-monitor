# MQTT Integration Wiring Checklist (iOS)

Use this checklist to wire the app to your MQTT broker. It calls out exactly where to put values (host, port, credentials, topics), what capabilities to enable, and which files are typically involved in this project.

---

## 0) Gather Inputs

- Broker host/IP: e.g., `mqtt.example.com`
- Port: `8883` (TLS) or `1883` (plain)
- TLS: CA/chain/cert requirements; self‑signed vs public CA
- Credentials: username, password, optional client certificate
- Client ID strategy: static per device vs generated UUID
- Topics: subscribe topics, publish topics, QoS (0/1/2), retain flags
- Keepalive seconds, clean session, will message (topic, payload, qos, retain)

---

## 1) Dependencies (choose one MQTT client)

- CocoaMQTT (SPM): `https://github.com/emqx/CocoaMQTT`
  - Add via Xcode: File > Add Packages… > paste URL > add to iOS target.
- MQTTNIO (SPM): `https://github.com/adam-fowler/mqtt-nio`
  - Uses Network.framework + SwiftNIO; good for async/structured concurrency.

Note: Pick one library and keep usage consistent across the app.

---

## 2) Configuration: where to put your values

Option A — xcconfig (recommended for env separation):
- Create environment configs (if not already present):
  - `ios/MSMLLifestyleMonitor/Config/Debug.xcconfig`
  - `ios/MSMLLifestyleMonitor/Config/Release.xcconfig`
  - Add keys:
    - `MQTT_HOST = your-broker-host`
    - `MQTT_PORT = 8883`
    - `MQTT_TLS_ENABLED = YES` (or NO)
    - `MQTT_USERNAME = your-username`
    - `MQTT_PASSWORD = your-password`
    - `MQTT_CLIENT_ID_PREFIX = msml-ios-`
    - `MQTT_KEEPALIVE = 60`
    - `MQTT_CLEAN_SESSION = YES`
    - `MQTT_SUB_TOPICS = sensors/+/state,commands/#` (comma-separated)
    - `MQTT_PUB_TOPIC = sensors/{deviceId}/telemetry`
- In Build Settings for the iOS target, set the appropriate `.xcconfig` for each configuration.
- In code, load these keys with `Bundle.main.object(forInfoDictionaryKey:)` if bridged, or with a small `Config` helper that reads from Info.plist or a generated file.

Option B — Info.plist:
- Add the same keys to your iOS target’s `Info.plist` (string/number/boolean), e.g.:
  - `MQTT_HOST`, `MQTT_PORT`, `MQTT_TLS_ENABLED`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `MQTT_CLIENT_ID_PREFIX`, `MQTT_KEEPALIVE`, `MQTT_CLEAN_SESSION`, `MQTT_SUB_TOPICS`, `MQTT_PUB_TOPIC`.

Option C — Hardcoded dev defaults (not for production):
- Create `ios/MSMLLifestyleMonitor/Config/MQTTConfig.swift` with constants and a TODO to move secrets to xcconfig/Keychain for production.

Secrets: Do NOT commit real passwords. Prefer `xcconfig` + CI secret injection or Keychain at runtime.

---

## 3) App wiring: where to hook up the client

- Coordinator: `ios/MSMLLifestyleMonitor/Coordinators/DataPipelineCoordinator.swift`
  - Inject an `MqttClient` (CocoaMQTT or MQTTNIO wrapper) into this coordinator.
  - Use config values above to build the connection URI and options.
  - Connect on pipeline start; subscribe to required topics; publish initial presence if needed.
  - Handle delegate/callbacks for message received, connection state, and errors.

- App lifecycle:
  - `AppDelegate.swift` (project iOS target): start your `DataPipelineCoordinator` and call `connect()` when the app becomes active; call `disconnect()` on termination.
  - `SceneDelegate.swift` (if present): pause/resume or reconnect on `sceneWillEnterForeground` / `sceneDidEnterBackground`.

Search in the project for these files and add the calls where your app’s composition root lives. If a dedicated composition/bootstrap file exists, inject the MQTT client and pass it down to `DataPipelineCoordinator`.

---

## 4) Network security and Info.plist

- Prefer TLS: use `mqtts://` on port `8883`.
- App Transport Security (ATS):
  - If using TLS with public CA, no ATS change is needed.
  - If using self‑signed/internal CA, either:
    - Pin certificates in code (recommended), or
    - Add ATS exception domain for your broker host (development only).
- Where: iOS target `Info.plist`.
- Keys to consider:
  - `NSAppTransportSecurity` > `NSAllowsArbitraryLoads = false` (keep secure by default)
  - `NSAppTransportSecurity` > `NSExceptionDomains` > `<your-broker-host>` with `NSExceptionAllowsInsecureHTTPLoads=true` only if absolutely necessary for dev using plain MQTT.

Certificate pinning (if applicable):
- Bundle a CA or server cert: `ios/MSMLLifestyleMonitor/Resources/certs/your-ca.pem`.
- Configure the MQTT client TLS layer to trust this CA or pin server cert. CocoaMQTT supports cert files; MQTTNIO uses `NIOSSL` with `TLSConfiguration`.

---

## 5) Background behavior and reconnects

- iOS limits long‑lived sockets in background. Do not rely on endless background MQTT.
- Enable Background Modes only if justified:
  - In Capabilities, consider `Background fetch` to schedule periodic work; avoid VoIP unless you are a VoIP app.
- Implement reconnect strategy:
  - Exponential backoff with jitter
  - Resume subscriptions after reconnect
  - Re‑publish retained presence if used

---

## 6) Topics and payloads

- Define topic constants and keep them in one place (e.g., `MQTTTopics.swift`).
- Document topic patterns and placeholder parts (e.g., `{deviceId}`).
- Specify QoS/retain per topic.
- Define payload schema (JSON keys/units) for telemetry and commands.

---

## 7) Logging and observability

- Use `OSLog` category, e.g., `com.msml.mqtt` for connect/disconnect/errors/messages.
- Optionally add a feature flag to enable verbose MQTT logging in Debug.

---

## 8) Minimal code sketch (where to insert your values)

This snippet shows the typical places your broker info is used. Adapt to CocoaMQTT/MQTTNIO.

```swift
// Example: Config loader (put in ios/MSMLLifestyleMonitor/Config/MQTTConfig.swift)
struct MQTTConfig {
    let host: String
    let port: Int
    let tls: Bool
    let username: String?
    let password: String?
    let clientId: String
    let keepAlive: UInt16
    let cleanSession: Bool
    let subTopics: [String]
    let pubTopic: String
}

// Example usage (wire in DataPipelineCoordinator.swift)
final class DataPipelineCoordinator {
    private let config: MQTTConfig
    // private let mqtt: CocoaMQTT (or wrapper)

    init(config: MQTTConfig /*, mqtt: CocoaMQTT */) {
        self.config = config
        // construct mqtt client with host/port/tls/creds
    }

    func start() {
        // connect, subscribe to config.subTopics
    }

    func stop() {
        // disconnect
    }
}
```

Fill the config values from `.xcconfig` or `Info.plist` and inject into `DataPipelineCoordinator` at app startup.

---

## 9) QA / Smoke test checklist

- Can connect to broker with provided host/port and TLS settings.
- Subscriptions receive retained messages on first connect (if applicable).
- Publishing to `MQTT_PUB_TOPIC` arrives at broker; verify QoS and retain.
- App reconnects after toggling Airplane Mode; subscriptions restored.
- Background/foreground transitions do not crash; reconnect on foreground.
- TLS failure behaves as expected with wrong CA or hostname.

---

## 10) Test broker (for quick sanity checks)

- Public brokers (no auth, use for testing only):
  - `broker.hivemq.com:1883` (no TLS)
  - `test.mosquitto.org:1883/8883`
- Topics: publish/subscribe to a temporary namespace unique to your device ID.

---

## 11) Quick fill‑in list (copy/paste target values)

- MQTT_HOST = __________________________
- MQTT_PORT = __________________________
- MQTT_TLS_ENABLED = YES | NO
- MQTT_USERNAME = ______________________
- MQTT_PASSWORD = ______________________
- MQTT_CLIENT_ID_PREFIX = ______________
- MQTT_KEEPALIVE = _____________________
- MQTT_CLEAN_SESSION = YES | NO
- MQTT_SUB_TOPICS = ____________________
- MQTT_PUB_TOPIC = _____________________
- CERT_PATH (if pinning) = _____________

Add these to your `.xcconfig` or `Info.plist`, then wire them into `DataPipelineCoordinator.swift` as shown.

