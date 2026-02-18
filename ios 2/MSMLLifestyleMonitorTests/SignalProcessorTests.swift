import XCTest
@testable import MSMLLifestyleMonitor

final class SignalProcessorTests: XCTestCase {
    func testProcessReturnsSampleWithMetadata() throws {
        let processor = SignalProcessor()
        let payload = Data([0xAA])
        let metadata = ["peripheral": "test"]

        let sample = try processor.process(payload, metadata: metadata)

        XCTAssertEqual(sample.payload, payload)
        XCTAssertEqual(sample.metadata["peripheral"], "test")
        XCTAssertEqual(sample.metadata["processed"], "true")
    }

    func testProcessThrowsForEmptyPayload() {
        let processor = SignalProcessor()

        XCTAssertThrowsError(try processor.process(Data(), metadata: [:])) { error in
            XCTAssertTrue(error is SignalProcessingError)
        }
    }
}
