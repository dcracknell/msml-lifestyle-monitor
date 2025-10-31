// Temporary in-memory storage for samples.
// Thread-safe via a serial dispatch queue; supports drain semantics.
import Foundation

protocol SignalStorage {
    func store(_ sample: SignalSample)
    func drain() -> [SignalSample]
}

final class TemporaryStorage: SignalStorage {
    private var samples: [SignalSample] = []
    private let queue = DispatchQueue(label: "com.msml.storage", qos: .utility)

    func store(_ sample: SignalSample) {
        queue.async {
            self.samples.append(sample)
        }
    }

    func drain() -> [SignalSample] {
        return queue.sync {
            let currentSamples = samples
            samples.removeAll(keepingCapacity: true)
            return currentSamples
        }
    }
}
