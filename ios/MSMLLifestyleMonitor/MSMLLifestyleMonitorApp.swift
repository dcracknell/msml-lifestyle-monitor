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
        let mqttClient = MQTTClient(host: URL(string: "mqtt://broker.example.com")!, topic: "msml/signals")
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
