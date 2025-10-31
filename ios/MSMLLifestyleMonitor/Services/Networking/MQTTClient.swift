// MQTT client abstraction: connect, publish, disconnect.
// Uses CocoaMQTT; configure pub/sub topics via app setup.
import Foundation
import os
import CocoaMQTT

protocol MQTTClientType {
    // Outbound
    func connect() async
    func publish(samples: [SignalSample]) async throws
    func disconnect() async
    // Inbound
    var onMessage: ((String, Data) -> Void)? { get set }
    func subscribe(to topics: [String]) async
}

enum MQTTClientError: Error {
    case transportUnavailable
}

/// A placeholder MQTT client that illustrates how a real implementation would be structured.
final class MQTTClient: NSObject, MQTTClientType {
    private let logger = Logger(subsystem: "com.msml.app", category: "MQTT")
    private let host: URL
    private let pubTopic: String
    private var client: CocoaMQTT?
    private var initialSubTopics: [String]
    var onMessage: ((String, Data) -> Void)?

    init(host: URL, pubTopic: String, subTopics: [String] = []) {
        self.host = host
        self.pubTopic = pubTopic
        self.initialSubTopics = subTopics
        self.onMessage = nil
    }

    func connect() async {
        let hostname = host.host ?? host.absoluteString
        let isTLS = (host.scheme == "mqtts")
        let port = UInt16(host.port ?? (isTLS ? 8883 : 1883))
        let clientID = "msml-ios-" + UUID().uuidString

        let mqtt = CocoaMQTT(clientID: clientID, host: hostname, port: port)
        mqtt.enableSSL = isTLS
        mqtt.autoReconnect = true
        mqtt.keepAlive = 60
        mqtt.delegate = self
        client = mqtt

        logger.info("Connecting to MQTT broker at \(hostname):\(port) TLS=\(isTLS ? "on" : "off")")
        _ = mqtt.connect()
    }

    func publish(samples: [SignalSample]) async throws {
        guard !samples.isEmpty else { return }
        // JSON encode the array; Data encodes as base64 string by default.
        let data = try JSONEncoder().encode(samples)
        guard let json = String(data: data, encoding: .utf8) else { return }
        logger.info("Publishing \(samples.count) samples to topic \(self.pubTopic)")
        client?.publish(self.pubTopic, withString: json, qos: .qos1, retained: false)
    }

    func disconnect() async {
        logger.info("Disconnecting from MQTT broker")
        client?.disconnect()
        client = nil
    }

    func subscribe(to topics: [String]) async {
        guard let client else { return }
        for t in topics { client.subscribe(t, qos: .qos1) }
    }
}

extension MQTTClient: CocoaMQTTDelegate {
    func mqtt(_ mqtt: CocoaMQTT, didConnectAck ack: CocoaMQTTConnAck) {
        if ack == .accept {
            logger.info("MQTT connected; subscribing to \(initialSubTopics.count) topic(s)")
            for t in initialSubTopics { mqtt.subscribe(t, qos: .qos1) }
        } else {
            logger.error("MQTT connect NACK: \(ack.rawValue)")
        }
    }

    func mqtt(_ mqtt: CocoaMQTT, didReceiveMessage message: CocoaMQTTMessage, id: UInt16 ) {
        guard let data = message.payload else { return }
        onMessage?(message.topic, Data(data))
    }

    func mqtt(_ mqtt: CocoaMQTT, didStateChangeTo state: CocoaMQTTConnState) {
        logger.debug("MQTT state changed: \(state.description)")
    }

    func mqttDidDisconnect(_ mqtt: CocoaMQTT, withError err: Error?) {
        if let err { logger.error("MQTT disconnected: \(err.localizedDescription)") }
    }
}
