// Bluetooth manager: scans, connects, subscribes to notifications.
// Forwards updates and raw data to a delegate for processing.
import CoreBluetooth
import os

protocol BluetoothManagerDelegate: AnyObject {
    // Pass only the peripheral identifier to keep tests simple and decoupled from CoreBluetooth types.
    func bluetoothManager(_ manager: BluetoothManager, didReceive data: Data, from peripheralId: UUID)
    func bluetoothManager(_ manager: BluetoothManager, didUpdateState state: CBManagerState)
    func bluetoothManager(_ manager: BluetoothManager, didEncounter error: Error)
}

protocol BluetoothControlling: AnyObject {
    var delegate: BluetoothManagerDelegate? { get set }
    func startScanning()
    func stopScanning()
    func disconnectAllPeripherals()
}

final class BluetoothManager: NSObject, BluetoothControlling {
    weak var delegate: BluetoothManagerDelegate?

    private let centralQueue = DispatchQueue(label: "com.msml.bluetooth", qos: .userInitiated)
    private lazy var centralManager = CBCentralManager(delegate: self, queue: centralQueue)
    private var discoveredPeripherals: [UUID: CBPeripheral] = [:]
    private let logger = Logger(subsystem: "com.msml.app", category: "Bluetooth")

    private let targetServiceUUIDs: [CBUUID]
    private let targetCharacteristicUUIDs: [CBUUID]

    init(targetServiceUUIDs: [CBUUID], targetCharacteristicUUIDs: [CBUUID]) {
        self.targetServiceUUIDs = targetServiceUUIDs
        self.targetCharacteristicUUIDs = targetCharacteristicUUIDs
        super.init()
    }

    func startScanning() {
        guard centralManager.state == .poweredOn else {
            logger.info("Central manager not ready, cannot start scanning")
            return
        }
        logger.info("Starting scan for peripherals")
        centralManager.scanForPeripherals(withServices: targetServiceUUIDs, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
    }

    func stopScanning() {
        logger.info("Stopping scan for peripherals")
        centralManager.stopScan()
    }

    func disconnectAllPeripherals() {
        for peripheral in discoveredPeripherals.values {
            centralManager.cancelPeripheralConnection(peripheral)
        }
    }
}

// MARK: - CBCentralManagerDelegate

extension BluetoothManager: CBCentralManagerDelegate {
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        delegate?.bluetoothManager(self, didUpdateState: central.state)
        if central.state == .poweredOn {
            startScanning()
        } else {
            stopScanning()
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        logger.debug("Discovered peripheral: \(peripheral.identifier)")
        discoveredPeripherals[peripheral.identifier] = peripheral
        peripheral.delegate = self
        centralManager.connect(peripheral, options: nil)
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        logger.info("Connected to peripheral: \(peripheral.identifier)")
        peripheral.discoverServices(targetServiceUUIDs)
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        if let error {
            logger.error("Failed to connect to peripheral: \(error.localizedDescription)")
            delegate?.bluetoothManager(self, didEncounter: error)
        }
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        if let error {
            logger.error("Disconnected from peripheral with error: \(error.localizedDescription)")
            delegate?.bluetoothManager(self, didEncounter: error)
        }
        discoveredPeripherals.removeValue(forKey: peripheral.identifier)
    }
}

// MARK: - CBPeripheralDelegate

extension BluetoothManager: CBPeripheralDelegate {
    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        if let error {
            logger.error("Service discovery failed: \(error.localizedDescription)")
            delegate?.bluetoothManager(self, didEncounter: error)
            return
        }
        guard let services = peripheral.services else { return }
        for service in services where targetServiceUUIDs.contains(service.uuid) {
            peripheral.discoverCharacteristics(targetCharacteristicUUIDs, for: service)
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        if let error {
            logger.error("Characteristic discovery failed: \(error.localizedDescription)")
            delegate?.bluetoothManager(self, didEncounter: error)
            return
        }
        guard let characteristics = service.characteristics else { return }
        for characteristic in characteristics where targetCharacteristicUUIDs.contains(characteristic.uuid) {
            peripheral.setNotifyValue(true, for: characteristic)
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        if let error {
            logger.error("Failed to update value: \(error.localizedDescription)")
            delegate?.bluetoothManager(self, didEncounter: error)
            return
        }
        guard let value = characteristic.value else { return }
        delegate?.bluetoothManager(self, didReceive: value, from: peripheral.identifier)
    }
}
