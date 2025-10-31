// Tests for basic MQTTClient behaviors (no real broker).
// Ensures empty publishes are no-ops and calls do not throw.
import XCTest
@testable import MSMLLifestyleMonitor

final class MQTTClientTests: XCTestCase {
    func testPublishIgnoresEmptySamples() async throws {
        let client = MQTTClient(host: URL(string: "mqtt://localhost")!, pubTopic: "test")

        await XCTAssertNoThrowAsync {
            try await client.publish(samples: [])
        }
    }

    func testPublishWithSamplesDoesNotThrow() async throws {
        let client = MQTTClient(host: URL(string: "mqtt://localhost")!, pubTopic: "test")
        let sample = SignalSample(payload: Data([0x01]))

        await XCTAssertNoThrowAsync {
            try await client.publish(samples: [sample])
        }
    }

    private func XCTAssertNoThrowAsync(_ operation: () async throws -> Void,
                                       file: StaticString = #filePath,
                                       line: UInt = #line) async {
        do {
            try await operation()
        } catch {
            XCTFail("Unexpected error thrown: \(error)", file: file, line: line)
        }
    }
}
