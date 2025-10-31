// Graph payload model received from MQTT (for charts)
import Foundation

struct GraphDataPoint: Identifiable, Codable {
    let id: UUID
    let timestamp: Date
    let value: Double

    init(id: UUID = UUID(), timestamp: Date, value: Double) {
        self.id = id
        self.timestamp = timestamp
        self.value = value
    }
}

