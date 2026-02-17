import Foundation

/// Applies domain-specific transformations to raw Bluetooth payloads.
protocol SignalProcessing {
    func process(_ data: Data, metadata: [String: String]) throws -> SignalSample
}

enum SignalProcessingError: Error {
    case invalidPayload
}

final class SignalProcessor: SignalProcessing {
    func process(_ data: Data, metadata: [String: String]) throws -> SignalSample {
        guard !data.isEmpty else {
            throw SignalProcessingError.invalidPayload
        }

        // Placeholder for signal decoding logic.
        // In a full implementation this could parse binary payloads and attach sensor metadata.
        let enrichedMetadata = metadata.merging(["processed": "true"]) { _, new in new }
        return SignalSample(payload: data, metadata: enrichedMetadata)
    }
}
