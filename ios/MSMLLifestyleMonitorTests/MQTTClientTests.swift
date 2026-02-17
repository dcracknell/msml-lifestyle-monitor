import XCTest
@testable import MSMLLifestyleMonitor

final class MQTTClientTests: XCTestCase {
    func testPublishIgnoresEmptySamples() async throws {
        let client = MQTTClient(host: URL(string: "mqtts://localhost")!, topic: "test")

        await XCTAssertNoThrowAsync {
            try await client.publish(samples: [])
        }
    }

    func testPublishWithSamplesDoesNotThrow() async throws {
        let client = MQTTClient(host: URL(string: "mqtts://localhost")!, topic: "test")
        let sample = SignalSample(payload: Data([0x01]))
        await client.connect()

        await XCTAssertNoThrowAsync {
            try await client.publish(samples: [sample])
        }
    }

    func testSecureFlagReflectsScheme() {
        let secureClient = MQTTClient(host: URL(string: "mqtts://broker.example.com")!, topic: "test")
        XCTAssertTrue(secureClient.isSecureConnection)

        let insecureClient = MQTTClient(host: URL(string: "mqtt://broker.example.com")!, topic: "test")
        XCTAssertFalse(insecureClient.isSecureConnection)
    }

    func testConnectionLifecycleTogglesConnectionState() async {
        let client = MQTTClient(host: URL(string: "mqtts://localhost")!, topic: "test")
        XCTAssertFalse(client.isConnected)
        await client.connect()
        XCTAssertTrue(client.isConnected)
        await client.disconnect()
        XCTAssertFalse(client.isConnected)
    }

    func testPublishRequiresSecureTransport() async {
        let client = MQTTClient(host: URL(string: "mqtt://localhost")!, topic: "test")
        await client.connect()
        let sample = SignalSample(payload: Data([0x01]))

        await XCTAssertThrowsAsync(expected: MQTTClientError.insecureTransport) {
            try await client.publish(samples: [sample])
        }
    }

    func testPublishRequiresActiveConnection() async {
        let client = MQTTClient(host: URL(string: "mqtts://localhost")!, topic: "test")
        let sample = SignalSample(payload: Data([0x01]))

        await XCTAssertThrowsAsync(expected: MQTTClientError.transportUnavailable) {
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

    private func XCTAssertThrowsAsync<E: Error & Equatable>(expected: E,
                                                           _ operation: () async throws -> Void,
                                                           file: StaticString = #filePath,
                                                           line: UInt = #line) async {
        do {
            try await operation()
            XCTFail("Expected to throw \(expected) but no error was thrown", file: file, line: line)
        } catch let error as E {
            XCTAssertEqual(error, expected, file: file, line: line)
        } catch {
            XCTFail("Unexpected error type: \(error)", file: file, line: line)
        }
    }
}
