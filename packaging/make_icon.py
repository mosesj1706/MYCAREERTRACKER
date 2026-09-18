"""Render the MCT wordmark into an .icns using only macOS built-ins (Cocoa via pyobjc + iconutil)."""
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    from AppKit import NSImage, NSFont, NSColor, NSBitmapImageRep, NSAttributedString, NSMakeRect, NSPNGFileType
    from AppKit import NSFontAttributeName, NSGraphicsContext
except ImportError:
    sys.exit("pyobjc AppKit not available; skipping icon")


def render(size: int, out: Path) -> None:
    img = NSImage.alloc().initWithSize_((size, size))
    img.lockFocus()
    NSColor.colorWithCalibratedRed_green_blue_alpha_(0.31, 0.42, 1.0, 1).setFill()  # accent #4f6bff
    from AppKit import NSBezierPath, NSForegroundColorAttributeName, NSKernAttributeName
    NSBezierPath.bezierPathWithRoundedRect_xRadius_yRadius_(NSMakeRect(0, 0, size, size), size * 0.22, size * 0.22).fill()
    text = NSAttributedString.alloc().initWithString_attributes_("MCT", {
        NSFontAttributeName: NSFont.boldSystemFontOfSize_(size * 0.36),
        NSForegroundColorAttributeName: NSColor.whiteColor(),
        NSKernAttributeName: -size * 0.012,
    })
    w, h = text.size()
    text.drawAtPoint_(((size - w) / 2, (size - h) / 2))
    img.unlockFocus()
    tiff = img.TIFFRepresentation()
    rep = NSBitmapImageRep.imageRepWithData_(tiff)
    png = rep.representationUsingType_properties_(NSPNGFileType, None)
    png.writeToFile_atomically_(str(out), True)


def main(dest: str) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        iconset = Path(tmp) / "icon.iconset"
        iconset.mkdir()
        for base in (16, 32, 128, 256, 512):
            render(base, iconset / f"icon_{base}x{base}.png")
            render(base * 2, iconset / f"icon_{base}x{base}@2x.png")
        subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", dest], check=True)
    print("icon written:", dest)


if __name__ == "__main__":
    main(sys.argv[1])
