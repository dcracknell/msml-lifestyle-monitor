import XCTest
import CoreBluetooth
@testable import MSMLLifestyleMonitor

private final class PeripheralDouble: CBPeripheral {
    private let backingIdentifier: UUID

    init(identifier: UUID = UUID()) {
        self.backingIdentifier = identifier
        super.init()
    }

    override var identifier: UUID {
        backingIdentifier
    }
}

final class DataPipelineCoordinatorTests: XCTestCase {
    private var bluetoothManager: MockBluetoothManager!
    private var processor: MockSignalProcessor!
    private var storage: MockSignalStorage!
    private var mqttClient: MockMQTTClient!
    private var coordinator: DataPipelineCoordinator!

    override func setUp() {
        super.setUp()
        bluetoothManager = MockBluetoothManager()
        processor = MockSignalProcessor()
        storage = MockSignalStorage()
        mqttClient = MockMQTTClient()
        coordinator = DataPipelineCoordinator(bluetoothManager: bluetoothManager,
                                              processor: processor,
                                              storage: storage,
                                              mqttClient: mqttClient,
                                              autoFlush: false)
    }

    override func tearDown() {
        coordinator = nil
        mqttClient = nil
        storage = nil
        processor = nil
        bluetoothManager = nil
        super.tearDown()
    }

    func testStartBeginsScanningAndConnectsMQTT() {
        let expectation = expectation(description: "connect called")
        mqttClient.connectExpectation = expectation

        coordinator.start()

        XCTAssertTrue(bluetoothManager.startScanningCalled)
        wait(for: [expectation], timeout: 1.0)
        XCTAssertEqual(mqttClient.connectCallCount, 1)
    }

    func testStopStopsScanningAndDisconnectsMQTT() {
        let expectation = expectation(description: "disconnect called")
        mqttClient.disconnectExpectation = expectation

        coordinator.stop()

        XCTAssertTrue(bluetoothManager.stopScanningCalled)
        XCTAssertTrue(bluetoothManager.disconnectAllCalled)
        wait(for: [expectation], timeout: 1.0)
        XCTAssertEqual(mqttClient.disconnectCallCount, 1)
    }

    func testReceivingDataProcessesAndStoresSample() throws {
        let payload = Data([0x01, 0x02])
        let metadata = ["peripheral": UUID().uuidString]
        let expectedSample = SignalSample(payload: payload, metadata: metadata)
        processor.processHandler = { data, metadata in
            return SignalSample(id: expectedSample.id,
                                timestamp: expectedSample.timestamp,
                                payload: data,
                                metadata: metadata)
        }
        let peripheral = PeripheralDouble()
        let latestSampleExpectation = expectation(description: "latest sample updated")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            latestSampleExpectation.fulfill()
        }

        coordinator.bluetoothManager(bluetoothManager,
                                     didReceive: payload,
                                     from: peripheral)

        XCTAssertEqual(storage.storedSamples.count, 1)
        let storedSample = try XCTUnwrap(storage.storedSamples.first)
        XCTAssertEqual(storedSample.payload, payload)
        wait(for: [latestSampleExpectation], timeout: 1.0)
        XCTAssertEqual(coordinator.latestSample?.payload, payload)
    }

    func testProcessingErrorUpdatesLastError() {
        enum MockError: Error { case failure }
        processor.processHandler = { _, _ in
            throw MockError.failure
        }
        let peripheral = PeripheralDouble()
        let errorExpectation = expectation(description: "last error updated")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            errorExpectation.fulfill()
        }

        coordinator.bluetoothManager(bluetoothManager,
                                     didReceive: Data([0x00]),
                                     from: peripheral)

        wait(for: [errorExpectation], timeout: 1.0)
        XCTAssertNotNil(coordinator.lastError)
    }

    func testFlushPublishesStoredSamples() {
        let sample = SignalSample(payload: Data([0x09]))
        storage.drainHandler = { [sample] }
        let expectation = expectation(description: "publish called")
        mqttClient.publishExpectation = expectation

        coordinator.flushSamples()

        wait(for: [expectation], timeout: 1.0)
        XCTAssertEqual(mqttClient.publishCallCount, 1)
        XCTAssertEqual(mqttClient.publishedSamples.first?.first?.id, sample.id)
    }
}
