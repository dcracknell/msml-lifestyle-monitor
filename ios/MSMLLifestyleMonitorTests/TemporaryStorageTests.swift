// Tests for TemporaryStorage: stores samples and drains in FIFO batches.
import XCTest
@testable import MSMLLifestyleMonitor

final class TemporaryStorageTests: XCTestCase {
    func testStoreAndDrainReturnsSamples() {
        let storage = TemporaryStorage()
        let sample1 = SignalSample(payload: Data([0x01]))
        let sample2 = SignalSample(payload: Data([0x02]))

        storage.store(sample1)
        storage.store(sample2)

        let expectation = expectation(description: "wait for store queue")
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.1) {
            expectation.fulfill()
        }
        wait(for: [expectation], timeout: 1.0)

        let drained = storage.drain()

        XCTAssertEqual(drained.count, 2)
        XCTAssertTrue(drained.contains(where: { $0.id == sample1.id }))
        XCTAssertTrue(drained.contains(where: { $0.id == sample2.id }))
        XCTAssertTrue(storage.drain().isEmpty)
    }
}
