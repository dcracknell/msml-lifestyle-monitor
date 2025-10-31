// App entry point: builds dependencies and injects the coordinator.
// Adjust MQTT host/topic and BLE UUIDs as appropriate.
import SwiftUI
import CoreBluetooth

@main
struct MSMLLifestyleMonitorApp: App {
    @StateObject private var coordinator: DataPipelineCoordinator

    init() {
        let bluetoothManager = BluetoothManager(targetServiceUUIDs: [CBUUID(string: "FFF0")],
                                                targetCharacteristicUUIDs: [CBUUID(string: "FFF1")])
        let processor = SignalProcessor()
        let storage = TemporaryStorage()
        // Configure MQTT publish topic for outbound samples
        // and a subscription topic for inbound graph data.
        let mqttClient = MQTTClient(host: URL(string: "mqtt://broker.example.com")!,
                                    pubTopic: "msml/signals",
                                    subTopics: ["msml/graphs/#"]) 
        _coordinator = StateObject(wrappedValue: DataPipelineCoordinator(bluetoothManager: bluetoothManager,
                                                                        processor: processor,
                                                                        storage: storage,
                                                                        mqttClient: mqttClient))
    }

    var body: some Scene {
        WindowGroup {
            ContentView(coordinator: coordinator)
        }
    }
}
