// Draws the Codex app icon (1024×1024 PNG): the logo of the design — a document outlined in the Nocturne accent,
// glowing on the dark ground. Usage: swift make-icon.swift out.png
import AppKit

let size: CGFloat = 1024
let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon.png"
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let ctx = NSGraphicsContext.current!.cgContext

func rgb(_ hex: Int, _ a: CGFloat = 1) -> CGColor {
  CGColor(red: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: a)
}

// macOS icon grid: 824×824 rounded square centred in 1024.
let tile = CGRect(x: 100, y: 100, width: 824, height: 824)
let tilePath = CGPath(roundedRect: tile, cornerWidth: 185, cornerHeight: 185, transform: nil)
ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -12), blur: 28, color: rgb(0x000000, 0.45))
ctx.addPath(tilePath); ctx.setFillColor(rgb(0x161826)); ctx.fillPath()
ctx.restoreGState()
ctx.saveGState()
ctx.addPath(tilePath); ctx.clip()
let ground = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [rgb(0x232532), rgb(0x161826)] as CFArray, locations: [0, 1])!
ctx.drawRadialGradient(ground, startCenter: CGPoint(x: 512, y: 860), startRadius: 0, endCenter: CGPoint(x: 512, y: 860), endRadius: 760, options: [.drawsAfterEndLocation])
ctx.restoreGState()
ctx.addPath(tilePath); ctx.setStrokeColor(rgb(0xe9e9ed, 0.10)); ctx.setLineWidth(3); ctx.strokePath()

// The document glyph of the design (24-unit grid: M6 3h9l4 4v14H6z M15 3v4h4 M9 12h6 M9 16h6), y flipped.
let unit: CGFloat = 26, ox: CGFloat = 512 - 12.5 * unit, oy: CGFloat = 512 + 12 * unit
func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x * unit, y: oy - y * unit) }
let glyph = CGMutablePath()
glyph.move(to: p(6, 3)); glyph.addLine(to: p(15, 3)); glyph.addLine(to: p(19, 7)); glyph.addLine(to: p(19, 21)); glyph.addLine(to: p(6, 21)); glyph.closeSubpath()
glyph.move(to: p(15, 3)); glyph.addLine(to: p(15, 7)); glyph.addLine(to: p(19, 7))
glyph.move(to: p(9, 12)); glyph.addLine(to: p(16, 12))
glyph.move(to: p(9, 16)); glyph.addLine(to: p(16, 16))
ctx.setLineCap(.round); ctx.setLineJoin(.round)
ctx.saveGState()
ctx.setShadow(offset: .zero, blur: 60, color: rgb(0x9184d9, 0.75))
ctx.addPath(glyph); ctx.setStrokeColor(rgb(0x9184d9)); ctx.setLineWidth(1.6 * unit * 0.85); ctx.strokePath()
ctx.restoreGState()
ctx.addPath(glyph); ctx.setStrokeColor(rgb(0xb5abfc)); ctx.setLineWidth(1.6 * unit * 0.85); ctx.strokePath()

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
