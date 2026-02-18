import Foundation
import CoreBluetooth
import XCTest
@testable import MSMLLifestyleMonitor

final class MockBluetoothManager: BluetoothControlling {
    weak var delegate: BluetoothManagerDelegate?
    private(set) var startScanningCalled = false
    private(set) var stopScanningCalled = false
    private(set) var disconnectAllCalled = false

    func startScanning() {
        startScanningCalled = true
    }

    func stopScanning() {
        stopScanningCalled = true
    }

    func disconnectAllPeripherals() {
        disconnectAllCalled = true
    }
}

final class MockSignalProcessor: SignalProcessing {
    var processHandler: ((Data, [String: String]) throws -> SignalSample)?
    private(set) var receivedMetadata: [String: String]?
    private(set) var receivedPayload: Data?

    func process(_ data: Data, metadata: [String : String]) throws -> SignalSample {
        receivedPayload = data
        receivedMetadata = metadata
        if let handler = processHandler {
            return try handler(data, metadata)
        }
        return SignalSample(payload: data, metadata: metadata)
    }
}

final class MockSignalStorage: SignalStorage {
    private(set) var storedSamples: [SignalSample] = []
    var drainHandler: (() -> [SignalSample])?

    func store(_ sample: SignalSample) {
        storedSamples.append(sample)
    }

    func drain() -> [SignalSample] {
        if let handler = drainHandler {
            return handler()
        }
        let samples = storedSamples
        storedSamples.removeAll()
        return samples
    }
}

final class MockMQTTClient: MQTTClientType {
    private(set) var connectCallCount = 0
    private(set) var publishCallCount = 0
    private(set) var disconnectCallCount = 0
    private(set) var publishedSamples: [[SignalSample]] = []

    var connectExpectation: XCTestExpectation?
    var publishExpectation: XCTestExpectation?
    var disconnectExpectation: XCTestExpectation?

    func connect() async {
        connectCallCount += 1
        connectExpectation?.fulfill()
    }

    func publish(samples: [SignalSample]) async throws {
        publishCallCount += 1
        publishedSamples.append(samples)
        publishExpectation?.fulfill()
    }

    func disconnect() async {
        disconnectCallCount += 1
        disconnectExpectation?.fulfill()
    }
}
