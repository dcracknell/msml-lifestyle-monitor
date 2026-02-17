import SwiftUI
import CoreBluetooth

struct ContentView: View {
    @ObservedObject var coordinator: DataPipelineCoordinator

    var body: some View {
        NavigationView {
            VStack(spacing: 16) {
                statusSection
                latestSampleSection
                errorSection
                Spacer()
                controlButtons
            }
            .padding()
            .navigationTitle("MSML Monitor")
        }
    }

    private var statusSection: some View {
        HStack {
            Circle()
                .fill(coordinator.bluetoothState == .poweredOn ? Color.green : Color.red)
                .frame(width: 12, height: 12)
            Text("Bluetooth: \(coordinator.bluetoothState.description)")
                .font(.headline)
            Spacer()
        }
    }

    private var latestSampleSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Latest Sample")
                .font(.headline)
            if let sample = coordinator.latestSample {
                Text("ID: \(sample.id.uuidString)")
                    .font(.subheadline)
                Text("Timestamp: \(sample.timestamp.formatted(date: .omitted, time: .standard))")
                    .font(.footnote)
                Text("Payload Size: \(sample.payload.count) bytes")
                    .font(.footnote)
            } else {
                Text("No samples received yet.")
                    .foregroundColor(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var errorSection: some View {
        Group {
            if let error = coordinator.lastError {
                Text("Error: \(error.localizedDescription)")
                    .foregroundColor(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private var controlButtons: some View {
        HStack {
            Button("Start") {
                coordinator.start()
            }
            .buttonStyle(.borderedProminent)

            Button("Stop") {
                coordinator.stop()
            }
            .buttonStyle(.bordered)
        }
    }
}

private extension CBManagerState {
    var description: String {
        switch self {
        case .unknown: return "Unknown"
        case .resetting: return "Resetting"
        case .unsupported: return "Unsupported"
        case .unauthorized: return "Unauthorized"
        case .poweredOff: return "Powered Off"
        case .poweredOn: return "Powered On"
        @unknown default: return "Unknown"
        }
    }
}

struct ContentView_Previews: PreviewProvider {
    static var previews: some View {
        ContentView(coordinator: PreviewFactory.makeCoordinator())
    }
}

enum PreviewFactory {
    static func makeCoordinator() -> DataPipelineCoordinator {
        let bluetoothManager = BluetoothManager(targetServiceUUIDs: [], targetCharacteristicUUIDs: [])
        let processor = SignalProcessor()
        let storage = TemporaryStorage()
        let mqttClient = MQTTClient(host: URL(string: "mqtt://localhost")!, topic: "preview")
        return DataPipelineCoordinator(bluetoothManager: bluetoothManager,
                                       processor: processor,
                                       storage: storage,
                                       mqttClient: mqttClient)
    }
}
