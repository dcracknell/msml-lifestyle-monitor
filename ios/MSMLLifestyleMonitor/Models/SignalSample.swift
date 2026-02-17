import Foundation

/// Represents a unit of sensor data captured from a Bluetooth peripheral.
struct SignalSample: Identifiable, Codable {
    let id: UUID
    let timestamp: Date
    let payload: Data
    let metadata: [String: String]

    init(id: UUID = UUID(), timestamp: Date = Date(), payload: Data, metadata: [String: String] = [:]) {
        self.id = id
        self.timestamp = timestamp
        self.payload = payload
        self.metadata = metadata
    }
}
