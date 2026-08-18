// Renders a transparent PNG with one or more text lines — helper for scripts/demo-gif.sh,
// because Homebrew ffmpeg ships without drawtext (no freetype). macOS-only (AppKit).
// Usage: swift demo-gif-text.swift out.png W H "line|size|hex|yFrac" ["line|size|hex|yFrac" ...]
import AppKit

let a = CommandLine.arguments
guard a.count >= 5, let W = Int(a[2]), let H = Int(a[3]) else {
  FileHandle.standardError.write("usage: out.png W H 'text|size|rrggbb|yFrac'...\n".data(using: .utf8)!); exit(2)
}
func color(_ hex: String) -> NSColor {
  let v = UInt32(hex, radix: 16) ?? 0xffffff
  return NSColor(srgbRed: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255,
                 blue: CGFloat(v & 0xff) / 255, alpha: 1)
}
let img = NSImage(size: NSSize(width: W, height: H))
img.lockFocus()
NSGraphicsContext.current?.imageInterpolation = .high
for spec in a[4...] {
  let p = spec.components(separatedBy: "|")
  let text = p[0], size = CGFloat(Double(p[1]) ?? 24), col = color(p[2]), yf = Double(p[3]) ?? 0.5
  let bold = p.count > 4 && p[4] == "bold"
  let font = bold ? NSFont.systemFont(ofSize: size, weight: .semibold) : NSFont.systemFont(ofSize: size, weight: .regular)
  let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: col]
  let s = NSAttributedString(string: text, attributes: attrs)
  let sz = s.size()
  // yFrac = vertical center of the line, measured from the TOP of the image
  s.draw(at: NSPoint(x: (CGFloat(W) - sz.width) / 2, y: CGFloat(H) * (1 - yf) - sz.height / 2))
}
img.unlockFocus()
let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: a[1]))
