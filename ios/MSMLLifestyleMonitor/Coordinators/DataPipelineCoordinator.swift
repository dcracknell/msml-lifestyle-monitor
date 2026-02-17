import Foundation
import CoreBluetooth
import os

@MainActor
final class DataPipelineCoordinator: ObservableObject {
    @Published private(set) var bluetoothState: CBManagerState = .unknown
    @Published private(set) var lastError: Error?
    @Published private(set) var latestSample: SignalSample?

    private let bluetoothManager: BluetoothControlling
    private let processor: SignalProcessing
    private let storage: SignalStorage
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
        super.init()
        self.bluetoothManager.delegate = self
        if autoFlush {
            configureFlushTimer()
        }
    }

    deinit {
        flushTimer?.invalidate()
    }

    func start() {
        bluetoothManager.startScanning()
        Task {
            await mqttClient.connect()
        }
    }

    func stop() {
        bluetoothManager.stopScanning()
        bluetoothManager.disconnectAllPeripherals()
        Task {
            await mqttClient.disconnect()
        }
    }

    private func configureFlushTimer() {
        flushTimer = Timer.scheduledTimer(withTimeInterval: flushInterval, repeats: true) { [weak self] _ in
            self?.flushSamples()
        }
    }

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
            }
        }
    }
}

extension DataPipelineCoordinator: BluetoothManagerDelegate {
    nonisolated func bluetoothManager(_ manager: BluetoothManager, didReceive data: Data, from peripheral: CBPeripheral) {
        do {
            let sample = try processor.process(data, metadata: ["peripheral": peripheral.identifier.uuidString])
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
