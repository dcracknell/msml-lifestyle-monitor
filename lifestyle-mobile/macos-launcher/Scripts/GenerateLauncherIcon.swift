import AppKit

let outputPath = CommandLine.arguments.dropFirst().first ?? {
  fputs("Usage: swift GenerateLauncherIcon.swift /path/to/output.png\n", stderr)
  exit(1)
}()

let canvasSize = CGSize(width: 1024, height: 1024)
let rect = CGRect(origin: .zero, size: canvasSize)

let image = NSImage(size: canvasSize)
image.lockFocus()

let backgroundPath = NSBezierPath(roundedRect: rect, xRadius: 230, yRadius: 230)
NSGradient(colors: [
  NSColor(calibratedRed: 0.03, green: 0.09, blue: 0.16, alpha: 1.0),
  NSColor(calibratedRed: 0.02, green: 0.06, blue: 0.11, alpha: 1.0),
])?.draw(in: backgroundPath, angle: -24)

let upperGlow = NSBezierPath(ovalIn: CGRect(x: 82, y: 560, width: 520, height: 520))
NSColor(calibratedRed: 0.00, green: 0.90, blue: 0.80, alpha: 0.16).setFill()
upperGlow.fill()

let lowerGlow = NSBezierPath(ovalIn: CGRect(x: 520, y: 120, width: 380, height: 380))
NSColor(calibratedRed: 0.63, green: 0.50, blue: 1.0, alpha: 0.18).setFill()
lowerGlow.fill()

let cardRect = CGRect(x: 148, y: 138, width: 728, height: 748)
let cardPath = NSBezierPath(roundedRect: cardRect, xRadius: 180, yRadius: 180)
NSGradient(colors: [
  NSColor(calibratedRed: 0.10, green: 0.18, blue: 0.30, alpha: 1.0),
  NSColor(calibratedRed: 0.04, green: 0.09, blue: 0.16, alpha: 1.0),
])?.draw(in: cardPath, angle: -36)

NSColor.white.withAlphaComponent(0.08).setStroke()
cardPath.lineWidth = 8
cardPath.stroke()

let haloRect = CGRect(x: 212, y: 260, width: 600, height: 600)
let haloPath = NSBezierPath(ovalIn: haloRect)
NSColor(calibratedRed: 0.00, green: 0.90, blue: 0.80, alpha: 0.14).setFill()
haloPath.fill()

let phoneRect = CGRect(x: 384, y: 258, width: 256, height: 462)
let phonePath = NSBezierPath(roundedRect: phoneRect, xRadius: 74, yRadius: 74)
NSColor.white.withAlphaComponent(0.92).setStroke()
phonePath.lineWidth = 26
phonePath.stroke()

let speakerRect = CGRect(x: phoneRect.midX - 44, y: phoneRect.maxY - 64, width: 88, height: 14)
let speakerPath = NSBezierPath(roundedRect: speakerRect, xRadius: 7, yRadius: 7)
NSColor.white.withAlphaComponent(0.92).setFill()
speakerPath.fill()

let pulse = NSBezierPath()
pulse.lineWidth = 30
pulse.lineCapStyle = .round
pulse.lineJoinStyle = .round

let midY = phoneRect.midY - 4
pulse.move(to: CGPoint(x: phoneRect.minX + 34, y: midY))
pulse.line(to: CGPoint(x: phoneRect.minX + 88, y: midY))
pulse.line(to: CGPoint(x: phoneRect.minX + 124, y: midY + 56))
pulse.line(to: CGPoint(x: phoneRect.minX + 162, y: midY - 74))
pulse.line(to: CGPoint(x: phoneRect.minX + 194, y: midY + 8))
pulse.line(to: CGPoint(x: phoneRect.maxX - 30, y: midY + 8))

NSColor(calibratedRed: 0.00, green: 0.90, blue: 0.80, alpha: 1.0).setStroke()
pulse.stroke()

let statusDotPath = NSBezierPath(ovalIn: CGRect(x: phoneRect.maxX + 34, y: phoneRect.maxY - 86, width: 54, height: 54))
NSColor(calibratedRed: 0.63, green: 0.50, blue: 1.0, alpha: 1.0).setFill()
statusDotPath.fill()

image.unlockFocus()

guard
  let tiffData = image.tiffRepresentation,
  let bitmap = NSBitmapImageRep(data: tiffData),
  let pngData = bitmap.representation(using: .png, properties: [:])
else {
  fputs("Failed to encode launcher icon PNG.\n", stderr)
  exit(1)
}

do {
  try pngData.write(to: URL(fileURLWithPath: outputPath))
} catch {
  fputs("Failed to write launcher icon: \(error.localizedDescription)\n", stderr)
  exit(1)
}
