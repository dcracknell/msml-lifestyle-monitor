import SwiftUI
import AppKit

enum LauncherPalette {
  static let background = Color(red: 0.031, green: 0.059, blue: 0.094)
  static let sidebarTop = Color(red: 0.039, green: 0.086, blue: 0.157)
  static let sidebarBottom = Color(red: 0.031, green: 0.059, blue: 0.110)
  static let surface = Color(red: 0.051, green: 0.082, blue: 0.125)
  static let surface2 = Color(red: 0.067, green: 0.118, blue: 0.180)
  static let surfaceOverlay = Color(red: 0.031, green: 0.059, blue: 0.094).opacity(0.42)
  static let text = Color(red: 0.886, green: 0.910, blue: 0.941)
  static let muted = Color(red: 0.392, green: 0.455, blue: 0.545)
  static let label = Color(red: 0.580, green: 0.639, blue: 0.722)
  static let teal = Color(red: 0.176, green: 0.831, blue: 0.749)
  static let amber = Color(red: 0.961, green: 0.620, blue: 0.043)
  static let blue = Color(red: 0.376, green: 0.647, blue: 0.980)
  static let red = Color(red: 0.937, green: 0.267, blue: 0.267)
  static let green = Color(red: 0.133, green: 0.773, blue: 0.369)
  static let brandBlue = Color(red: 0.102, green: 0.290, blue: 0.541)
  static let brandPurple = Color(red: 0.431, green: 0.200, blue: 0.831)
  static let border = Color(red: 0.102, green: 0.145, blue: 0.208)
  static let borderStrong = Color(red: 0.141, green: 0.188, blue: 0.267)

  static func dimmed(_ color: Color, opacity: Double = 0.12) -> Color {
    color.opacity(opacity)
  }
}

enum LauncherTypography {
  static func display(_ size: CGFloat) -> Font {
    .custom("Space Grotesk", size: size)
  }

  static func body(_ size: CGFloat) -> Font {
    .custom("Manrope", size: size)
  }
}

enum LauncherStatusTone {
  case neutral
  case busy
  case success
  case warning
  case error

  var color: Color {
    switch self {
    case .neutral:
      return LauncherPalette.label
    case .busy:
      return LauncherPalette.teal
    case .success:
      return LauncherPalette.green
    case .warning:
      return LauncherPalette.amber
    case .error:
      return LauncherPalette.red
    }
  }

  var symbol: String {
    switch self {
    case .neutral:
      return "circle.dashed"
    case .busy:
      return "bolt.horizontal.circle.fill"
    case .success:
      return "checkmark.seal.fill"
    case .warning:
      return "exclamationmark.triangle.fill"
    case .error:
      return "xmark.octagon.fill"
    }
  }
}

struct LauncherStatusBanner {
  var tone: LauncherStatusTone
  var title: String
  var message: String
}

struct LauncherDevice: Identifiable, Hashable {
  let id: String
  let name: String
  let model: String
  let osVersion: String
  let transport: String
  let developerModeStatus: String
  let bootState: String

  var displayName: String {
    "\(name) · \(model)"
  }

  var subtitle: String {
    "iOS \(osVersion)  •  \(transportLabel)"
  }

  var transportLabel: String {
    transport.isEmpty ? "Unknown transport" : transport.capitalized
  }

  var developerModeEnabled: Bool {
    developerModeStatus.lowercased() == "enabled"
  }

  var bootStateLabel: String {
    bootState.isEmpty ? "Unknown" : bootState.capitalized
  }
}

enum LauncherActionCategory {
  case run
  case utility
}

enum LauncherAction: String, CaseIterable, Identifiable {
  case fastLaunch
  case liveReloadLaunch
  case liveReloadLaunchClear
  case fullRebuild
  case reinstallLastBuild
  case checkConnection
  case revealMetroLog
  case openProjectFolder

  var id: String { rawValue }

  var category: LauncherActionCategory {
    switch self {
    case .fastLaunch, .liveReloadLaunch, .liveReloadLaunchClear, .fullRebuild, .reinstallLastBuild:
      return .run
    case .checkConnection, .revealMetroLog, .openProjectFolder:
      return .utility
    }
  }

  var title: String {
    switch self {
    case .fastLaunch:
      return "Fast Launch"
    case .liveReloadLaunch:
      return "Live Reload Launch"
    case .liveReloadLaunchClear:
      return "Live Reload + Clear Cache"
    case .fullRebuild:
      return "Full Rebuild + Install"
    case .reinstallLastBuild:
      return "Reinstall Last Build"
    case .checkConnection:
      return "Check Connection"
    case .revealMetroLog:
      return "Reveal Metro Log"
    case .openProjectFolder:
      return "Open Project Folder"
    }
  }

  var subtitle: String {
    switch self {
    case .fastLaunch:
      return "Launch the installed app from the embedded bundle. No Metro required."
    case .liveReloadLaunch:
      return "Opt into Metro when you want hot reload without rebuilding native code."
    case .liveReloadLaunchClear:
      return "Same live-reload path, but clears Metro cache before relaunching."
    case .fullRebuild:
      return "Rebuild, reinstall, and launch a fresh embedded-bundle app after native changes."
    case .reinstallLastBuild:
      return "Push the last built `.app` back onto the phone without rebuilding."
    case .checkConnection:
      return "Refresh device detection and confirm that your selected iPhone is ready."
    case .revealMetroLog:
      return "Open the Metro log file in Finder for live-reload troubleshooting."
    case .openProjectFolder:
      return "Jump straight to the mobile project folder in Finder."
    }
  }

  var systemImage: String {
    switch self {
    case .fastLaunch:
      return "play.circle.fill"
    case .liveReloadLaunch:
      return "bolt.circle.fill"
    case .liveReloadLaunchClear:
      return "arrow.clockwise.circle.fill"
    case .fullRebuild:
      return "hammer.circle.fill"
    case .reinstallLastBuild:
      return "square.and.arrow.down.fill"
    case .checkConnection:
      return "iphone.gen3.radiowaves.left.and.right"
    case .revealMetroLog:
      return "doc.text.magnifyingglass"
    case .openProjectFolder:
      return "folder.fill"
    }
  }

  var tint: Color {
    switch self {
    case .fastLaunch:
      return LauncherPalette.teal
    case .liveReloadLaunch:
      return LauncherPalette.blue
    case .liveReloadLaunchClear:
      return LauncherPalette.amber
    case .fullRebuild:
      return LauncherPalette.amber
    case .reinstallLastBuild:
      return LauncherPalette.green
    case .checkConnection:
      return LauncherPalette.teal
    case .revealMetroLog:
      return LauncherPalette.blue
    case .openProjectFolder:
      return LauncherPalette.label
    }
  }

  var npmScript: String? {
    switch self {
    case .fastLaunch:
      return "ios:device:launch"
    case .liveReloadLaunch:
      return "ios:device:launch:dev"
    case .liveReloadLaunchClear:
      return "ios:device:launch:dev:clear"
    case .fullRebuild:
      return "ios:device"
    case .reinstallLastBuild:
      return "ios:device:install"
    case .checkConnection, .revealMetroLog, .openProjectFolder:
      return nil
    }
  }

  var recommended: Bool {
    self == .fastLaunch
  }
}

@MainActor
final class LauncherViewModel: ObservableObject {
  @Published var devices: [LauncherDevice] = []
  @Published var selectedDeviceID = ""
  @Published var output = "MSML iPhone Launcher is ready.\n"
  @Published var status = LauncherStatusBanner(
    tone: .busy,
    title: "Checking for connected iPhones",
    message: "Looking for paired physical iPhones through Xcode."
  )
  @Published var isRefreshing = false
  @Published var isRunning = false
  @Published var activeAction: LauncherAction?
  @Published var lastFinishedSummary = "No launcher commands run yet."

  private var runningProcess: Process?
  private let projectURL = URL(fileURLWithPath: LauncherBuildConfig.projectRoot)
  private let metroLogURL = URL(fileURLWithPath: LauncherBuildConfig.metroLogPath)

  var selectedDevice: LauncherDevice? {
    devices.first(where: { $0.id == selectedDeviceID })
  }

  var runActions: [LauncherAction] {
    LauncherAction.allCases.filter { $0.category == .run }
  }

  var utilityActions: [LauncherAction] {
    LauncherAction.allCases.filter { $0.category == .utility }
  }

  func loadOnAppear() {
    guard devices.isEmpty else { return }
    Task {
      await refreshDevices(showBusyBanner: true)
    }
  }

  func refreshDevices(showBusyBanner: Bool = false) async {
    guard !isRefreshing else { return }

    if showBusyBanner {
      status = LauncherStatusBanner(
        tone: .busy,
        title: "Refreshing connected devices",
        message: "Checking for paired physical iPhones."
      )
    }

    isRefreshing = true
    defer { isRefreshing = false }

    do {
      let loadedDevices = try await Task.detached(priority: .userInitiated) {
        try DeviceDiscovery.fetchDevices()
      }.value

      let previousSelection = selectedDeviceID
      devices = loadedDevices

      if loadedDevices.isEmpty {
        selectedDeviceID = ""
        status = LauncherStatusBanner(
          tone: .warning,
          title: "No iPhone detected",
          message: "Plug in your iPhone, unlock it, trust this Mac if prompted, and keep Developer Mode enabled."
        )
      } else {
        if loadedDevices.contains(where: { $0.id == previousSelection }) {
          selectedDeviceID = previousSelection
        } else {
          selectedDeviceID = loadedDevices[0].id
        }
        syncStatusToCurrentDevice(successPrefix: loadedDevices.count == 1 ? "1 iPhone ready" : "\(loadedDevices.count) iPhones ready")
      }
    } catch {
      status = LauncherStatusBanner(
        tone: .error,
        title: "Could not read connected devices",
        message: error.localizedDescription
      )
      note("Device refresh failed: \(error.localizedDescription)")
    }
  }

  func handleDeviceSelectionChange() {
    guard !isRunning else { return }
    syncStatusToCurrentDevice(successPrefix: devices.count == 1 ? "1 iPhone ready" : "\(devices.count) iPhones ready")
  }

  func perform(_ action: LauncherAction) {
    switch action {
    case .checkConnection:
      Task {
        await refreshDevices(showBusyBanner: true)
        if let device = selectedDevice {
          status = LauncherStatusBanner(
            tone: .success,
            title: "Selected iPhone is ready",
            message: "\(device.displayName) is available for launcher actions."
          )
        }
      }
    case .revealMetroLog:
      guard FileManager.default.fileExists(atPath: metroLogURL.path) else {
        status = LauncherStatusBanner(
          tone: .warning,
          title: "Metro log not found yet",
          message: "Run a live-reload launcher action first and the Metro log will appear at `.expo/ios-device-metro.log`."
        )
        return
      }
      NSWorkspace.shared.activateFileViewerSelecting([metroLogURL])
      status = LauncherStatusBanner(
        tone: .neutral,
        title: "Opened Metro log",
        message: "Finder is showing the current Metro log."
      )
    case .openProjectFolder:
      NSWorkspace.shared.open(projectURL)
      status = LauncherStatusBanner(
        tone: .neutral,
        title: "Opened project folder",
        message: "Finder is now focused on the mobile app project."
      )
    case .fastLaunch, .liveReloadLaunch, .liveReloadLaunchClear, .fullRebuild, .reinstallLastBuild:
      guard let device = selectedDevice else {
        status = LauncherStatusBanner(
          tone: .warning,
          title: "No iPhone selected",
          message: "Connect a paired physical iPhone before running launcher actions."
        )
        return
      }
      runShellAction(action, on: device)
    }
  }

  func stopCurrentRun() {
    guard let runningProcess else { return }
    runningProcess.terminate()
    status = LauncherStatusBanner(
      tone: .warning,
      title: "Stopping current run",
      message: "The launcher asked the running command to terminate."
    )
    note("Stop requested for the current launcher process.")
  }

  func clearOutput() {
    output = ""
    note("Output cleared.")
  }

  func copyOutput() {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(output, forType: .string)
    status = LauncherStatusBanner(
      tone: .neutral,
      title: "Output copied",
      message: "The launcher output was copied to the clipboard."
    )
  }

  private func syncStatusToCurrentDevice(successPrefix: String) {
    guard let device = selectedDevice else { return }

    if device.developerModeEnabled {
      status = LauncherStatusBanner(
        tone: .success,
        title: successPrefix,
        message: "\(device.displayName) is selected and ready on \(device.transportLabel.lowercased())."
      )
    } else {
      status = LauncherStatusBanner(
        tone: .warning,
        title: "iPhone connected, but Developer Mode needs attention",
        message: "\(device.displayName) is visible, but Developer Mode is not reported as enabled."
      )
    }
  }

  private func runShellAction(_ action: LauncherAction, on device: LauncherDevice) {
    guard !isRunning else { return }
    guard let command = action.makeShellCommand(for: device, projectRoot: projectURL.path) else { return }

    let packageJSONURL = projectURL.appendingPathComponent("package.json")
    guard FileManager.default.isReadableFile(atPath: packageJSONURL.path) else {
      status = LauncherStatusBanner(
        tone: .error,
        title: "Launcher cannot access the project folder",
        message: "macOS is likely blocking the launcher from reading this repo in Documents. Grant access to MSML iPhone Launcher in Privacy & Security, or move the repo outside Desktop/Documents/Downloads."
      )
      note("Project access check failed for \(packageJSONURL.path).")
      return
    }

    isRunning = true
    activeAction = action
    status = LauncherStatusBanner(
      tone: .busy,
      title: "Running \(action.title)",
      message: "Streaming launcher output below for \(device.displayName)."
    )

    note("Selected device: \(device.displayName) [\(device.id)]")
    note("Starting \(action.title)...")
    note("Command preview: npm run \(action.npmScript ?? "") -- --device \(device.id)")

    let process = Process()
    let pipe = Pipe()

    process.executableURL = URL(fileURLWithPath: "/bin/zsh")
    process.arguments = ["-c", command]
    process.currentDirectoryURL = projectURL

    var environment = ProcessInfo.processInfo.environment
    environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:" + (environment["PATH"] ?? "")
    environment["EXPO_NO_DOTENV"] = "1"
    environment["PWD"] = projectURL.path
    let existingLocale =
      environment["LC_ALL"] ??
      environment["LC_CTYPE"] ??
      environment["LANG"] ??
      ""
    let launcherLocale =
      existingLocale.localizedCaseInsensitiveContains("UTF-8") ? existingLocale : "en_US.UTF-8"
    environment["LANG"] = launcherLocale
    environment["LC_ALL"] = launcherLocale
    environment["LC_CTYPE"] = launcherLocale
    process.environment = environment
    process.standardOutput = pipe
    process.standardError = pipe

    pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
      let data = handle.availableData
      guard !data.isEmpty else { return }
      let text = String(decoding: data, as: UTF8.self)
      Task { @MainActor in
        self?.appendOutput(text)
      }
    }

    process.terminationHandler = { [weak self] finishedProcess in
      pipe.fileHandleForReading.readabilityHandler = nil
      Task { @MainActor in
        guard let self else { return }

        self.isRunning = false
        self.activeAction = nil
        self.runningProcess = nil

        let exitCode = finishedProcess.terminationStatus
        if exitCode == 0 {
          self.status = LauncherStatusBanner(
            tone: .success,
            title: "\(action.title) finished",
            message: "The launcher completed successfully for \(device.displayName)."
          )
          self.lastFinishedSummary = "\(action.title) finished successfully for \(device.name)."
          self.note("\(action.title) completed successfully.")
          Task {
            await self.refreshDevices(showBusyBanner: false)
          }
        } else {
          self.status = LauncherStatusBanner(
            tone: .error,
            title: "\(action.title) failed",
            message: "The launcher exited with code \(exitCode). Review the output panel for details."
          )
          self.lastFinishedSummary = "\(action.title) failed with exit code \(exitCode)."
          self.note("\(action.title) failed with exit code \(exitCode).")
        }
      }
    }

    do {
      try process.run()
      runningProcess = process
    } catch {
      pipe.fileHandleForReading.readabilityHandler = nil
      runningProcess = nil
      isRunning = false
      activeAction = nil
      status = LauncherStatusBanner(
        tone: .error,
        title: "Could not start launcher command",
        message: error.localizedDescription
      )
      note("Failed to start launcher command: \(error.localizedDescription)")
    }
  }

  private func note(_ text: String) {
    appendOutput("[Launcher] \(text)\n")
  }

  private func appendOutput(_ text: String) {
    output += text
    let maxCharacters = 160_000
    if output.count > maxCharacters {
      output.removeFirst(output.count - maxCharacters)
    }
  }
}

@main
struct MSMLLauncherApp: App {
  var body: some Scene {
    WindowGroup {
      LauncherDashboard()
        .frame(minWidth: 1120, minHeight: 780)
    }
    .defaultSize(width: 1180, height: 800)
    .windowResizability(.contentMinSize)
    .windowStyle(.hiddenTitleBar)
  }
}

struct LauncherDashboard: View {
  @StateObject private var viewModel = LauncherViewModel()

  var body: some View {
    ZStack {
      LauncherPalette.background
        .ignoresSafeArea()

      AmbientGlowBackground()
        .ignoresSafeArea()

      HStack(spacing: 0) {
        sidebar
        mainPanel
      }
    }
    .onAppear {
      viewModel.loadOnAppear()
    }
  }

  private var sidebar: some View {
    VStack(spacing: 0) {
      sidebarBrand

      Rectangle()
        .fill(LauncherPalette.border.opacity(0.9))
        .frame(height: 1)

      selectedDeviceRail

      Rectangle()
        .fill(LauncherPalette.border.opacity(0.9))
        .frame(height: 1)

      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          SidebarSectionLabel(text: "Workflow")

          GuidanceRow(
            systemImage: "bolt.fill",
            title: "Fast Launch",
            message: "Use for normal JS, TS, or styling changes. It launches from the embedded bundle and skips Metro."
          )

          GuidanceRow(
            systemImage: "bolt.circle.fill",
            title: "Live Reload Launch",
            message: "Use when you want Metro and hot reload on the phone without rebuilding native code."
          )

          GuidanceRow(
            systemImage: "arrow.clockwise.circle.fill",
            title: "Live Reload + Clear Cache",
            message: "Use when Metro seems stale, hot reload is off, or old code keeps appearing."
          )

          GuidanceRow(
            systemImage: "hammer.fill",
            title: "Full Rebuild + Install",
            message: "Use after native modules, Expo plugins, pods, or iOS project files change."
          )

          SidebarSectionLabel(text: "Utilities")

          ForEach(viewModel.utilityActions) { action in
            UtilityRowButton(action: action) {
              viewModel.perform(action)
            }
          }

          SidebarSectionLabel(text: "Status")
          StatusBannerView(status: viewModel.status)

          if let selectedDevice = viewModel.selectedDevice {
            CalloutStrip(
              title: "Ready for \(selectedDevice.name)",
              message: "Recommended next step: Fast Launch for bundle-first testing, Live Reload Launch for hot reload, and Full Rebuild after native changes.",
              tint: LauncherPalette.teal
            )
          }
        }
        .padding(16)
      }
      .frame(maxHeight: .infinity, alignment: .top)
    }
    .frame(width: 280)
    .frame(maxHeight: .infinity, alignment: .top)
    .background(
      LinearGradient(
        colors: [LauncherPalette.sidebarTop, LauncherPalette.sidebarBottom],
        startPoint: .top,
        endPoint: .bottom
      )
    )
    .overlay(alignment: .trailing) {
      Rectangle()
        .fill(LauncherPalette.borderStrong)
        .frame(width: 1)
    }
  }

  private var mainPanel: some View {
    VStack(spacing: 0) {
      topBar

      ScrollView {
        VStack(spacing: 16) {
          summaryMetrics

          HStack(alignment: .top, spacing: 16) {
            deviceCard
              .frame(width: 380)

            actionCard
          }

          outputCard
        }
        .padding(24)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
  }

  private var sidebarBrand: some View {
    HStack(alignment: .center, spacing: 12) {
      LauncherBrandMark(size: 42)

      VStack(alignment: .leading, spacing: 3) {
        Text("MSML")
          .font(LauncherTypography.display(13))
          .fontWeight(.semibold)
          .foregroundStyle(LauncherPalette.text)

        Text("Lifestyle Monitor · iPhone deployment")
          .font(LauncherTypography.body(10))
          .foregroundStyle(LauncherPalette.teal.opacity(0.84))
      }

      Spacer(minLength: 0)
    }
    .padding(.horizontal, 16)
    .padding(.top, 18)
    .padding(.bottom, 14)
  }

  private var selectedDeviceRail: some View {
    Group {
      if let device = viewModel.selectedDevice {
        HStack(spacing: 12) {
          ZStack {
            Circle()
              .fill(LauncherPalette.dimmed(LauncherPalette.teal))
              .frame(width: 34, height: 34)

            Text(deviceInitials(for: device.name))
              .font(LauncherTypography.body(12))
              .fontWeight(.bold)
              .foregroundStyle(LauncherPalette.teal)
          }

          VStack(alignment: .leading, spacing: 2) {
            Text(device.name)
              .font(LauncherTypography.body(13))
              .fontWeight(.semibold)
              .foregroundStyle(LauncherPalette.text)

            Text(device.model)
              .font(LauncherTypography.body(11))
              .foregroundStyle(LauncherPalette.muted)
          }

          Spacer(minLength: 0)

          Circle()
            .fill(device.developerModeEnabled ? LauncherPalette.green : LauncherPalette.amber)
            .frame(width: 8, height: 8)
        }
        .padding(16)
      } else {
        VStack(alignment: .leading, spacing: 5) {
          Text("No iPhone selected")
            .font(LauncherTypography.body(13))
            .fontWeight(.semibold)
            .foregroundStyle(LauncherPalette.text)

          Text("Plug in your iPhone, unlock it, trust this Mac, and refresh devices.")
            .font(LauncherTypography.body(11))
            .foregroundStyle(LauncherPalette.muted)
            .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(LauncherPalette.surface.opacity(0.35))
  }

  private var topBar: some View {
    VStack(spacing: 0) {
      HStack(alignment: .center, spacing: 16) {
        VStack(alignment: .leading, spacing: 3) {
          Text("iPhone deployment")
            .font(LauncherTypography.body(11))
            .fontWeight(.semibold)
            .foregroundStyle(LauncherPalette.teal.opacity(0.78))
            .textCase(.uppercase)

          Text("MSML iPhone Launcher")
            .font(LauncherTypography.display(24))
            .fontWeight(.bold)
            .foregroundStyle(LauncherPalette.text)

          Text(viewModel.selectedDevice?.displayName ?? "Choose a paired iPhone, then start with Fast Launch for bundle-first testing or Live Reload Launch for Metro.")
            .font(LauncherTypography.body(13))
            .foregroundStyle(LauncherPalette.muted)
            .fixedSize(horizontal: false, vertical: true)
        }

        Spacer(minLength: 20)

        HStack(spacing: 10) {
          SecondaryPill(
            icon: "iphone.gen3",
            text: viewModel.devices.isEmpty ? "No iPhone detected" : "\(viewModel.devices.count) iPhone\(viewModel.devices.count == 1 ? "" : "s") connected",
            tint: viewModel.devices.isEmpty ? LauncherPalette.amber : LauncherPalette.teal
          )

          GlossyButton(
            title: viewModel.isRefreshing ? "Refreshing..." : "Refresh Devices",
            systemImage: "arrow.clockwise",
            tint: LauncherPalette.teal
          ) {
            Task {
              await viewModel.refreshDevices(showBusyBanner: true)
            }
          }
          .disabled(viewModel.isRefreshing || viewModel.isRunning)

          GlossyButton(
            title: "Stop Current Run",
            systemImage: "stop.fill",
            tint: LauncherPalette.red,
            isSubtle: true
          ) {
            viewModel.stopCurrentRun()
          }
          .disabled(!viewModel.isRunning)
        }
      }
      .padding(.horizontal, 24)
      .padding(.top, 18)
      .padding(.bottom, 14)

      Rectangle()
        .fill(LauncherPalette.border.opacity(0.7))
        .frame(height: 1)
    }
    .background(LauncherPalette.background.opacity(0.92))
  }

  private var summaryMetrics: some View {
    LazyVGrid(
      columns: [
        GridItem(.flexible(), spacing: 16),
        GridItem(.flexible(), spacing: 16),
        GridItem(.flexible(), spacing: 16),
        GridItem(.flexible(), spacing: 16),
      ],
      spacing: 16
    ) {
      SummaryMetricCard(
        label: "Connected",
        value: "\(viewModel.devices.count)",
        status: viewModel.devices.isEmpty ? "No paired physical iPhones detected" : "Paired physical iPhones ready to target",
        tint: viewModel.devices.isEmpty ? LauncherPalette.amber : LauncherPalette.teal
      )

      SummaryMetricCard(
        label: "Selected Target",
        value: viewModel.selectedDevice?.name ?? "None",
        status: viewModel.selectedDevice?.model ?? "Pick an iPhone from the device card",
        tint: viewModel.selectedDevice == nil ? LauncherPalette.amber : LauncherPalette.blue
      )

      SummaryMetricCard(
        label: "Developer Mode",
        value: developerModeSummary,
        status: developerModeGuidance,
        tint: developerModeTint
      )

      SummaryMetricCard(
        label: "Launcher State",
        value: viewModel.isRunning ? "Running" : "Idle",
        status: viewModel.isRunning ? (viewModel.activeAction?.title ?? "Executing command") : "Ready for the next launch or rebuild",
        tint: viewModel.isRunning ? LauncherPalette.teal : LauncherPalette.label
      )
    }
  }

  private var developerModeSummary: String {
    guard let selectedDevice = viewModel.selectedDevice else { return "Unknown" }
    return selectedDevice.developerModeEnabled ? "Enabled" : "Check"
  }

  private var developerModeGuidance: String {
    guard let selectedDevice = viewModel.selectedDevice else {
      return "Choose a device to see whether Developer Mode is ready."
    }
    return selectedDevice.developerModeEnabled
      ? "This iPhone is ready for local installs."
      : "Open Settings > Privacy & Security on the phone and confirm Developer Mode."
  }

  private var developerModeTint: Color {
    guard let selectedDevice = viewModel.selectedDevice else { return LauncherPalette.label }
    return selectedDevice.developerModeEnabled ? LauncherPalette.green : LauncherPalette.amber
  }

  private var deviceCard: some View {
    SurfaceCard {
      VStack(alignment: .leading, spacing: 18) {
        SectionHeader(
          eyebrow: "Connected Device",
          title: "Target the iPhone you want to install to",
          subtitle: "Only paired physical iPhones reported by Xcode appear here."
        )

        if viewModel.devices.isEmpty {
          EmptyStateCard(
            systemImage: "iphone.slash",
            title: "No paired iPhone found",
            message: "Plug in your iPhone, unlock it, trust this Mac, and make sure Developer Mode is enabled."
          )
        } else {
          VStack(alignment: .leading, spacing: 12) {
            Text("Selected iPhone")
              .font(LauncherTypography.body(11))
              .fontWeight(.bold)
              .foregroundStyle(LauncherPalette.muted)
              .textCase(.uppercase)

            Picker("Selected iPhone", selection: $viewModel.selectedDeviceID) {
              ForEach(viewModel.devices) { device in
                Text(device.displayName).tag(device.id)
              }
            }
            .labelsHidden()
            .pickerStyle(.menu)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
              RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(LauncherPalette.surface2)
                .overlay(
                  RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(LauncherPalette.border, lineWidth: 1)
                )
            )
            .onChange(of: viewModel.selectedDeviceID) { _ in
              viewModel.handleDeviceSelectionChange()
            }

            if let device = viewModel.selectedDevice {
              VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 12) {
                  VStack(alignment: .leading, spacing: 4) {
                    Text(device.name)
                      .font(LauncherTypography.display(22))
                      .fontWeight(.bold)
                      .foregroundStyle(LauncherPalette.text)

                    Text(device.model)
                      .font(LauncherTypography.body(13))
                      .foregroundStyle(LauncherPalette.muted)
                  }

                  Spacer()

                  SecondaryPill(
                    icon: device.developerModeEnabled ? "checkmark.shield.fill" : "exclamationmark.triangle.fill",
                    text: device.developerModeEnabled ? "Developer Mode On" : "Developer Mode Check",
                    tint: device.developerModeEnabled ? LauncherPalette.green : LauncherPalette.amber
                  )
                }

                DeviceFactGrid(device: device)
              }
              .padding(16)
              .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                  .fill(LauncherPalette.surfaceOverlay)
                  .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                      .stroke(LauncherPalette.border, lineWidth: 1)
                  )
                  .overlay(alignment: .top) {
                    Rectangle()
                      .fill(LauncherPalette.blue)
                      .frame(height: 2)
                      .clipShape(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                      )
                  }
              )
            }
          }
        }
      }
    }
  }

  private var actionCard: some View {
    SurfaceCard {
      VStack(alignment: .leading, spacing: 18) {
        SectionHeader(
          eyebrow: "Actions",
          title: "Run the workflow that matches your change",
          subtitle: "The selected iPhone UDID is added automatically, so each action targets the correct phone."
        )

        LazyVGrid(
          columns: [
            GridItem(.flexible(), spacing: 14),
            GridItem(.flexible(), spacing: 14),
          ],
          spacing: 14
        ) {
          ForEach(viewModel.runActions) { action in
            ActionCardButton(
              action: action,
              isRunning: viewModel.activeAction == action,
              disabled: viewModel.isRunning || viewModel.selectedDevice == nil
            ) {
              viewModel.perform(action)
            }
          }
        }

        if let selectedDevice = viewModel.selectedDevice {
          CalloutStrip(
            title: "Ready for \(selectedDevice.name)",
            message: "Use Fast Launch for bundle-first installs, Live Reload Launch when you want Metro, Live Reload + Clear Cache for stale Metro behavior, and Full Rebuild after native changes.",
            tint: LauncherPalette.teal
          )
        }
      }
    }
  }

  private var outputCard: some View {
    SurfaceCard {
      VStack(alignment: .leading, spacing: 16) {
        HStack(alignment: .top) {
          SectionHeader(
            eyebrow: "Live Output",
            title: "See exactly what the launcher is doing",
            subtitle: viewModel.lastFinishedSummary
          )

          Spacer()

          HStack(spacing: 10) {
            GlossyButton(
              title: "Copy Output",
              systemImage: "doc.on.doc",
              tint: LauncherPalette.blue,
              isSubtle: true
            ) {
              viewModel.copyOutput()
            }

            GlossyButton(
              title: "Clear",
              systemImage: "trash",
              tint: LauncherPalette.label,
              isSubtle: true
            ) {
              viewModel.clearOutput()
            }
          }
        }

        OutputConsole(output: viewModel.output)
          .frame(maxWidth: .infinity, minHeight: 420)

        HStack(spacing: 12) {
          SecondaryPill(
            icon: viewModel.isRunning ? "bolt.horizontal.circle.fill" : "checkmark.circle",
            text: viewModel.isRunning ? "Command running" : "Idle",
            tint: viewModel.isRunning ? LauncherPalette.teal : LauncherPalette.label
          )

          SecondaryPill(
            icon: "folder",
            text: "Metro log (dev mode only)",
            tint: LauncherPalette.blue
          )
        }
      }
    }
    .frame(maxWidth: .infinity)
  }

  private func deviceInitials(for name: String) -> String {
    let pieces = name.split(separator: " ")
    let initials = pieces.prefix(2).compactMap { $0.first }
    if initials.isEmpty {
      return String(name.prefix(2)).uppercased()
    }
    return String(initials).uppercased()
  }
}

struct AmbientGlowBackground: View {
  var body: some View {
    ZStack {
      Circle()
        .fill(LauncherPalette.teal.opacity(0.10))
        .frame(width: 360, height: 360)
        .blur(radius: 86)
        .offset(x: -260, y: -260)

      Circle()
        .fill(LauncherPalette.brandPurple.opacity(0.18))
        .frame(width: 430, height: 430)
        .blur(radius: 110)
        .offset(x: 360, y: -240)

      Circle()
        .fill(LauncherPalette.brandBlue.opacity(0.16))
        .frame(width: 400, height: 400)
        .blur(radius: 98)
        .offset(x: 240, y: 250)
    }
  }
}

struct LauncherBrandMark: View {
  let size: CGFloat

  var body: some View {
    ZStack {
      RoundedRectangle(cornerRadius: size * 0.24, style: .continuous)
        .fill(
          LinearGradient(
            colors: [
              LauncherPalette.brandBlue,
              LauncherPalette.brandPurple,
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
          )
        )
        .overlay(
          RoundedRectangle(cornerRadius: size * 0.24, style: .continuous)
            .stroke(LauncherPalette.brandPurple.opacity(0.55), lineWidth: 1)
        )
        .shadow(color: LauncherPalette.brandPurple.opacity(0.35), radius: size * 0.18, y: size * 0.08)

      Circle()
        .fill(LauncherPalette.teal.opacity(0.20))
        .frame(width: size * 0.74, height: size * 0.74)
        .blur(radius: size * 0.08)

      PulseLineShape()
        .stroke(
          LauncherPalette.text.opacity(0.96),
          style: StrokeStyle(lineWidth: size * 0.055, lineCap: .round, lineJoin: .round)
        )
        .frame(width: size * 0.56, height: size * 0.24)

      Circle()
        .fill(LauncherPalette.teal)
        .frame(width: size * 0.11, height: size * 0.11)
        .offset(x: size * 0.28, y: -size * 0.20)
    }
    .frame(width: size, height: size)
  }
}

struct PulseLineShape: Shape {
  func path(in rect: CGRect) -> Path {
    var path = Path()
    let startY = rect.midY
    path.move(to: CGPoint(x: rect.minX, y: startY))
    path.addLine(to: CGPoint(x: rect.minX + rect.width * 0.24, y: startY))
    path.addLine(to: CGPoint(x: rect.minX + rect.width * 0.40, y: rect.minY + rect.height * 0.15))
    path.addLine(to: CGPoint(x: rect.minX + rect.width * 0.56, y: rect.maxY))
    path.addLine(to: CGPoint(x: rect.minX + rect.width * 0.70, y: rect.midY + rect.height * 0.05))
    path.addLine(to: CGPoint(x: rect.maxX, y: rect.midY + rect.height * 0.05))
    return path
  }
}

struct SurfaceCard<Content: View>: View {
  @ViewBuilder var content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      content
    }
    .padding(18)
    .background(
      RoundedRectangle(cornerRadius: 12, style: .continuous)
        .fill(
          LinearGradient(
            colors: [LauncherPalette.surface2, LauncherPalette.surface],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
          )
        )
        .overlay(
          RoundedRectangle(cornerRadius: 12, style: .continuous)
            .stroke(LauncherPalette.borderStrong, lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.32), radius: 12, y: 6)
    )
  }
}

struct SectionHeader: View {
  let eyebrow: String
  let title: String
  let subtitle: String

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(eyebrow)
        .font(LauncherTypography.body(10))
        .fontWeight(.semibold)
        .foregroundStyle(LauncherPalette.muted)
        .textCase(.uppercase)

      Text(title)
        .font(LauncherTypography.display(19))
        .fontWeight(.bold)
        .foregroundStyle(LauncherPalette.text)

      Text(subtitle)
        .font(LauncherTypography.body(13))
        .foregroundStyle(LauncherPalette.muted)
        .fixedSize(horizontal: false, vertical: true)
    }
  }
}

struct StatusBannerView: View {
  let status: LauncherStatusBanner

  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: status.tone.symbol)
        .font(.system(size: 16, weight: .bold))
        .foregroundStyle(status.tone.color)

      VStack(alignment: .leading, spacing: 3) {
        Text(status.title)
          .font(LauncherTypography.body(13))
          .fontWeight(.semibold)
          .foregroundStyle(LauncherPalette.text)

        Text(status.message)
          .font(LauncherTypography.body(12))
          .foregroundStyle(LauncherPalette.muted)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 11)
    .background(
      RoundedRectangle(cornerRadius: 8, style: .continuous)
        .fill(LauncherPalette.dimmed(status.tone.color))
        .overlay(
          RoundedRectangle(cornerRadius: 8, style: .continuous)
            .stroke(status.tone.color.opacity(0.24), lineWidth: 1)
        )
    )
  }
}

struct SecondaryPill: View {
  let icon: String
  let text: String
  let tint: Color

  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: icon)
        .font(.system(size: 11, weight: .bold))
      Text(text)
    }
    .font(LauncherTypography.body(11))
    .fontWeight(.semibold)
    .foregroundStyle(tint)
    .padding(.horizontal, 12)
    .padding(.vertical, 7)
    .background(
      Capsule(style: .continuous)
        .fill(LauncherPalette.dimmed(tint, opacity: 0.12))
        .overlay(
          Capsule(style: .continuous)
            .stroke(tint.opacity(0.28), lineWidth: 1)
        )
    )
  }
}

struct GlossyButton: View {
  let title: String
  let systemImage: String
  let tint: Color
  var isSubtle = false
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 8) {
        Image(systemName: systemImage)
        Text(title)
      }
      .font(LauncherTypography.body(13))
      .fontWeight(.semibold)
      .foregroundStyle(isSubtle ? tint : LauncherPalette.background)
      .padding(.horizontal, 14)
      .padding(.vertical, 9)
      .background(
        RoundedRectangle(cornerRadius: 8, style: .continuous)
          .fill(isSubtle ? LauncherPalette.dimmed(tint, opacity: 0.10) : tint)
          .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
              .stroke(isSubtle ? tint.opacity(0.25) : tint.opacity(0.14), lineWidth: 1)
          )
      )
    }
    .buttonStyle(.plain)
  }
}

struct EmptyStateCard: View {
  let systemImage: String
  let title: String
  let message: String

  var body: some View {
    VStack(spacing: 14) {
      Image(systemName: systemImage)
        .font(.system(size: 34, weight: .semibold))
        .foregroundStyle(LauncherPalette.amber)

      Text(title)
        .font(LauncherTypography.display(18))
        .fontWeight(.bold)
        .foregroundStyle(LauncherPalette.text)

      Text(message)
        .font(LauncherTypography.body(13))
        .foregroundStyle(LauncherPalette.muted)
        .multilineTextAlignment(.center)
        .frame(maxWidth: 360)
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, 28)
    .background(
      RoundedRectangle(cornerRadius: 8, style: .continuous)
        .fill(LauncherPalette.surfaceOverlay)
        .overlay(
          RoundedRectangle(cornerRadius: 8, style: .continuous)
            .stroke(LauncherPalette.border, lineWidth: 1)
        )
        .overlay(alignment: .top) {
          Rectangle()
            .fill(LauncherPalette.amber)
            .frame(height: 2)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
    )
  }
}

struct DeviceFactGrid: View {
  let device: LauncherDevice

  var body: some View {
    VStack(spacing: 10) {
      HStack(spacing: 10) {
        DeviceFact(title: "OS", value: "iOS \(device.osVersion)")
        DeviceFact(title: "Transport", value: device.transportLabel)
      }

      HStack(spacing: 10) {
        DeviceFact(title: "Boot State", value: device.bootStateLabel)
        DeviceFact(
          title: "Developer Mode",
          value: device.developerModeEnabled ? "Enabled" : "Needs check",
          valueColor: device.developerModeEnabled ? LauncherPalette.green : LauncherPalette.amber
        )
      }
    }
  }
}

struct DeviceFact: View {
  let title: String
  let value: String
  var valueColor: Color = LauncherPalette.text

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(title)
        .font(LauncherTypography.body(10))
        .fontWeight(.semibold)
        .foregroundStyle(LauncherPalette.muted)
        .textCase(.uppercase)

      Text(value)
        .font(LauncherTypography.body(14))
        .fontWeight(.bold)
        .foregroundStyle(valueColor)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(12)
    .background(
      RoundedRectangle(cornerRadius: 8, style: .continuous)
        .fill(LauncherPalette.surfaceOverlay)
        .overlay(
          RoundedRectangle(cornerRadius: 8, style: .continuous)
            .stroke(LauncherPalette.border, lineWidth: 1)
        )
    )
  }
}

struct GuidanceRow: View {
  let systemImage: String
  let title: String
  let message: String

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      Image(systemName: systemImage)
        .font(.system(size: 14, weight: .bold))
        .foregroundStyle(LauncherPalette.teal)
        .frame(width: 28, height: 28)
        .background(
          RoundedRectangle(cornerRadius: 8, style: .continuous)
            .fill(LauncherPalette.dimmed(LauncherPalette.teal))
        )

      VStack(alignment: .leading, spacing: 4) {
        Text(title)
          .font(LauncherTypography.body(13))
          .fontWeight(.semibold)
          .foregroundStyle(LauncherPalette.text)

        Text(message)
          .font(LauncherTypography.body(12))
          .foregroundStyle(LauncherPalette.muted)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .padding(12)
    .background(
      RoundedRectangle(cornerRadius: 8, style: .continuous)
        .fill(LauncherPalette.surface.opacity(0.34))
        .overlay(
          RoundedRectangle(cornerRadius: 8, style: .continuous)
            .stroke(LauncherPalette.border, lineWidth: 1)
        )
    )
  }
}

struct ActionCardButton: View {
  let action: LauncherAction
  let isRunning: Bool
  let disabled: Bool
  let trigger: () -> Void

  var body: some View {
    Button(action: trigger) {
      VStack(alignment: .leading, spacing: 14) {
        HStack(alignment: .top) {
          ZStack {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
              .fill(LauncherPalette.dimmed(action.tint))
              .frame(width: 40, height: 40)

            Image(systemName: action.systemImage)
              .font(.system(size: 16, weight: .bold))
              .foregroundStyle(action.tint)
          }

          Spacer()

          if action.recommended {
            Text("Recommended")
              .font(LauncherTypography.body(10))
              .fontWeight(.bold)
              .foregroundStyle(LauncherPalette.teal)
              .padding(.horizontal, 10)
              .padding(.vertical, 5)
              .background(
                Capsule(style: .continuous)
                  .fill(LauncherPalette.dimmed(LauncherPalette.teal))
                  .overlay(
                    Capsule(style: .continuous)
                      .stroke(LauncherPalette.teal.opacity(0.24), lineWidth: 1)
                  )
              )
          } else if isRunning {
            ProgressView()
              .controlSize(.small)
              .tint(action.tint)
          }
        }

        VStack(alignment: .leading, spacing: 8) {
          Text(action.title)
            .font(LauncherTypography.display(15))
            .fontWeight(.bold)
            .foregroundStyle(LauncherPalette.text)
            .multilineTextAlignment(.leading)

          Text(action.subtitle)
            .font(LauncherTypography.body(12))
            .foregroundStyle(LauncherPalette.muted)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
      .padding(16)
      .frame(maxWidth: .infinity, minHeight: 164, alignment: .topLeading)
      .background(
        RoundedRectangle(cornerRadius: 12, style: .continuous)
          .fill(
            LinearGradient(
              colors: [LauncherPalette.surface2, LauncherPalette.surface],
              startPoint: .topLeading,
              endPoint: .bottomTrailing
            )
          )
          .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
              .stroke(LauncherPalette.borderStrong, lineWidth: 1)
          )
          .overlay(alignment: .top) {
            Rectangle()
              .fill(action.tint)
              .frame(height: 2)
              .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
          }
      )
    }
    .buttonStyle(.plain)
    .disabled(disabled)
    .opacity(disabled ? 0.55 : 1)
  }
}

struct SummaryMetricCard: View {
  let label: String
  let value: String
  let status: String
  let tint: Color

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(label)
        .font(LauncherTypography.body(10))
        .fontWeight(.semibold)
        .foregroundStyle(LauncherPalette.muted)
        .textCase(.uppercase)

      Text(value)
        .font(LauncherTypography.display(24))
        .fontWeight(.bold)
        .foregroundStyle(tint)
        .lineLimit(1)
        .minimumScaleFactor(0.72)

      Text(status)
        .font(LauncherTypography.body(12))
        .foregroundStyle(LauncherPalette.muted)
        .lineLimit(2)
        .fixedSize(horizontal: false, vertical: true)
    }
    .frame(maxWidth: .infinity, minHeight: 118, alignment: .topLeading)
    .padding(16)
    .background(
      RoundedRectangle(cornerRadius: 12, style: .continuous)
        .fill(
          LinearGradient(
            colors: [LauncherPalette.surface2, LauncherPalette.surface],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
          )
        )
        .overlay(
          RoundedRectangle(cornerRadius: 12, style: .continuous)
            .stroke(LauncherPalette.borderStrong, lineWidth: 1)
        )
        .overlay(alignment: .top) {
          Rectangle()
            .fill(tint)
            .frame(height: 2)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    )
  }
}

struct UtilityRowButton: View {
  let action: LauncherAction
  let trigger: () -> Void

  var body: some View {
    Button(action: trigger) {
      HStack(spacing: 12) {
        Image(systemName: action.systemImage)
          .font(.system(size: 14, weight: .bold))
          .foregroundStyle(action.tint)
          .frame(width: 24, height: 24)

        VStack(alignment: .leading, spacing: 3) {
          Text(action.title)
            .font(LauncherTypography.body(12))
            .fontWeight(.semibold)
            .foregroundStyle(LauncherPalette.text)

          Text(action.subtitle)
            .font(LauncherTypography.body(11))
            .foregroundStyle(LauncherPalette.muted)
            .fixedSize(horizontal: false, vertical: true)
        }

        Spacer()

        Image(systemName: "arrow.right")
          .font(.system(size: 11, weight: .bold))
          .foregroundStyle(LauncherPalette.muted)
      }
      .padding(12)
      .background(
        RoundedRectangle(cornerRadius: 8, style: .continuous)
          .fill(LauncherPalette.surface.opacity(0.36))
          .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
              .stroke(LauncherPalette.border, lineWidth: 1)
          )
          .overlay(alignment: .leading) {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
              .fill(action.tint.opacity(0.18))
              .frame(width: 3)
          }
      )
    }
    .buttonStyle(.plain)
  }
}

struct CalloutStrip: View {
  let title: String
  let message: String
  let tint: Color

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      Image(systemName: "sparkles")
        .font(.system(size: 16, weight: .bold))
        .foregroundStyle(tint)

      VStack(alignment: .leading, spacing: 5) {
        Text(title)
          .font(LauncherTypography.body(13))
          .fontWeight(.semibold)
          .foregroundStyle(LauncherPalette.text)

        Text(message)
          .font(LauncherTypography.body(12))
          .foregroundStyle(LauncherPalette.muted)
      }
    }
    .padding(14)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(
      RoundedRectangle(cornerRadius: 8, style: .continuous)
        .fill(LauncherPalette.dimmed(tint))
        .overlay(
          RoundedRectangle(cornerRadius: 8, style: .continuous)
            .stroke(tint.opacity(0.24), lineWidth: 1)
        )
    )
  }
}

struct SidebarSectionLabel: View {
  let text: String

  var body: some View {
    Text(text)
      .font(LauncherTypography.body(9))
      .fontWeight(.semibold)
      .foregroundStyle(LauncherPalette.muted)
      .textCase(.uppercase)
      .tracking(1.2)
  }
}

struct OutputConsole: View {
  let output: String

  var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          Text(output.isEmpty ? "Launcher output will appear here." : output)
            .font(.system(size: 12, weight: .medium, design: .monospaced))
            .foregroundStyle(output.isEmpty ? LauncherPalette.muted : LauncherPalette.text)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .padding(16)

          Color.clear
            .frame(height: 1)
            .id("output-bottom")
        }
      }
      .background(
        RoundedRectangle(cornerRadius: 8, style: .continuous)
          .fill(LauncherPalette.surfaceOverlay)
          .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
              .stroke(LauncherPalette.border, lineWidth: 1)
          )
      )
      .onChange(of: output) { _ in
        withAnimation(.easeOut(duration: 0.18)) {
          proxy.scrollTo("output-bottom", anchor: .bottom)
        }
      }
    }
  }
}

private enum DeviceDiscovery {
  static func fetchDevices() throws -> [LauncherDevice] {
    let temporaryURL = FileManager.default.temporaryDirectory.appendingPathComponent("msml-launcher-\(UUID().uuidString).json")
    defer {
      try? FileManager.default.removeItem(at: temporaryURL)
    }

    let process = Process()
    let stderr = Pipe()

    process.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
    process.arguments = ["devicectl", "list", "devices", "--json-output", temporaryURL.path]
    process.standardError = stderr

    try process.run()
    process.waitUntilExit()

    let stderrData = stderr.fileHandleForReading.readDataToEndOfFile()
    let stderrText = String(data: stderrData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

    guard process.terminationStatus == 0 else {
      throw LauncherError.deviceQueryFailed(
        stderrText.isEmpty
          ? "Xcode could not list devices. Make sure Command Line Tools and device support are available."
          : stderrText
      )
    }

    let data = try Data(contentsOf: temporaryURL)
    let response = try JSONDecoder().decode(DeviceListResponse.self, from: data)

    return (response.result?.devices ?? [])
      .filter { device in
        device.hardwareProperties?.platform == "iOS" &&
          device.hardwareProperties?.reality == "physical" &&
          device.connectionProperties?.pairingState == "paired"
      }
      .compactMap { device in
        let udid = device.hardwareProperties?.udid ?? device.identifier ?? ""
        guard !udid.isEmpty else { return nil }

        return LauncherDevice(
          id: udid,
          name: device.deviceProperties?.name ?? "Unknown iPhone",
          model: device.hardwareProperties?.marketingName ?? device.hardwareProperties?.deviceType ?? "iPhone",
          osVersion: device.deviceProperties?.osVersionNumber ?? "Unknown",
          transport: device.connectionProperties?.transportType ?? "unknown",
          developerModeStatus: device.deviceProperties?.developerModeStatus ?? "unknown",
          bootState: device.deviceProperties?.bootState ?? "unknown"
        )
      }
      .sorted { $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending }
  }
}

private enum LauncherError: LocalizedError {
  case deviceQueryFailed(String)

  var errorDescription: String? {
    switch self {
    case let .deviceQueryFailed(message):
      return message
    }
  }
}

private struct DeviceListResponse: Decodable {
  let result: DeviceListResult?
}

private struct DeviceListResult: Decodable {
  let devices: [DevicePayload]
}

private struct DevicePayload: Decodable {
  let connectionProperties: ConnectionProperties?
  let deviceProperties: DeviceProperties?
  let hardwareProperties: HardwareProperties?
  let identifier: String?
}

private struct ConnectionProperties: Decodable {
  let pairingState: String?
  let transportType: String?
}

private struct DeviceProperties: Decodable {
  let name: String?
  let osVersionNumber: String?
  let developerModeStatus: String?
  let bootState: String?
}

private struct HardwareProperties: Decodable {
  let platform: String?
  let reality: String?
  let marketingName: String?
  let deviceType: String?
  let udid: String?
}

private extension LauncherAction {
  func makeShellCommand(for device: LauncherDevice, projectRoot: String) -> String? {
    guard let npmScript else { return nil }
    return """
    export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    if [ -s "$NVM_DIR/nvm.sh" ]; then
      . "$NVM_DIR/nvm.sh"
    fi
    npm run \(npmScript) -- --device \(shellQuote(device.id))
    """
  }
}

private func shellQuote(_ value: String) -> String {
  let escaped = value.replacingOccurrences(of: "'", with: "'\\''")
  return "'\(escaped)'"
}
