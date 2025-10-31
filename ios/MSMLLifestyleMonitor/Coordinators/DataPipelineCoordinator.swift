// Coordinates BLE, processing, storage, and MQTT publish.
// Key spots: properties, start/stop, flush, Bluetooth delegate.
// MQTT setup details: ios/MSMLLifestyleMonitor/MQTT_WIRING_CHECKLIST.md

import Foundation
import CoreBluetooth
import os

@MainActor
final class DataPipelineCoordinator: ObservableObject {
    // State exposed to UI/observers
    @Published private(set) var bluetoothState: CBManagerState = .unknown
    @Published private(set) var lastError: Error?
    @Published private(set) var latestSample: SignalSample?
    @Published private(set) var graphData: [GraphDataPoint] = []

    private let bluetoothManager: BluetoothControlling
    private let processor: SignalProcessing
    private let storage: SignalStorage
    // MQTT client (configured elsewhere; see checklist)
    private let mqttClient: MQTTClientType
    private let logger = Logger(subsystem: "com.msml.app", category: "Coordinator")

    private var flushTimer: Timer?
    private let flushInterval: TimeInterval
    private let autoFlush: Bool

    init(bluetoothManager: BluetoothControlling,
         processor: SignalProcessing,
         storage: SignalStorage,
         mqttClient: MQTTClientType,
         flushInterval: TimeInterval = 5.0,
         autoFlush: Bool = true) {
        self.bluetoothManager = bluetoothManager
        self.processor = processor
        self.storage = storage
        self.mqttClient = mqttClient
        self.flushInterval = flushInterval
        self.autoFlush = autoFlush
        self.bluetoothManager.delegate = self
        if autoFlush {
            configureFlushTimer()
        }
    }

    deinit {
        flushTimer?.invalidate()
    }

    // Start BLE and connect MQTT
    func start() {
        bluetoothManager.startScanning()
        Task {
            await mqttClient.connect()
            await mqttClient.subscribe(to: []) // already handled by client initial topics, keep for future use
            mqttClient.onMessage = { [weak self] topic, data in
                guard let self = self else { return }
                // Try to decode a single point or an array of points
                if let point = try? JSONDecoder().decode(GraphDataPoint.self, from: data) {
                    Task { @MainActor in self.graphData.append(point) }
                } else if let points = try? JSONDecoder().decode([GraphDataPoint].self, from: data) {
                    Task { @MainActor in self.graphData.append(contentsOf: points) }
                } else {
                    // Non-graph payload; ignore here
                }
            }
        }
    }

    // Stop BLE and disconnect MQTT
    func stop() {
        bluetoothManager.stopScanning()
        bluetoothManager.disconnectAllPeripherals()
        Task {
            await mqttClient.disconnect()
        }
    }

    // Periodic buffer flush timer
    private func configureFlushTimer() {
        flushTimer = Timer.scheduledTimer(withTimeInterval: flushInterval, repeats: true) { [weak self] _ in
            self?.flushSamples()
        }
    }

    // Drain buffer and publish to MQTT
    func flushSamples() {
        let samples = storage.drain()
        guard !samples.isEmpty else { return }
        Task {
            do {
                try await mqttClient.publish(samples: samples)
            } catch {
                await MainActor.run {
                    self.lastError = error
                }
                logger.error("Failed to publish samples: \(error.localizedDescription)")
                // Requeue samples so they can be retried later
                for s in samples { storage.store(s) }
            }
        }
    }
}

// Bluetooth callbacks -> process, store, update UI
extension DataPipelineCoordinator: BluetoothManagerDelegate {
    nonisolated func bluetoothManager(_ manager: BluetoothManager, didReceive data: Data, from peripheralId: UUID) {
        do {
            let sample = try processor.process(data, metadata: ["peripheral": peripheralId.uuidString])
            storage.store(sample)
            Task { @MainActor in
                self.latestSample = sample
            }
        } catch {
            Task { @MainActor in
                self.lastError = error
            }
            logger.error("Processing failed: \(error.localizedDescription)")
        }
    }

    nonisolated func bluetoothManager(_ manager: BluetoothManager, didUpdateState state: CBManagerState) {
        Task { @MainActor in
            self.bluetoothState = state
        }
    }

    nonisolated func bluetoothManager(_ manager: BluetoothManager, didEncounter error: Error) {
        Task { @MainActor in
            self.lastError = error
        }
        logger.error("Bluetooth error: \(error.localizedDescription)")
    }
}
