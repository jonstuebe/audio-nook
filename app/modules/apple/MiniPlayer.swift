// Audio Nook's Mini Player, as picture in picture moves a video: the app's own window shrinks into
// a small player at the screen's corner, floating above other apps if asked, and grows back to
// where it was. There is never a second window. Contract owns every value and draws the small
// player itself (app.contract swaps its layout while `miniWindow` holds); this tag only moves
// the window it sits in: while `mini` is "true" the window is the mini player's size, its
// toolbar and title-bar buttons hidden, at the `floating` level when that is "true".
//
// The node in the page is a 1-point box; the window is the one it is in. Under the agent, after
// each change the tag says back what the window is (`shown:<mini or full>|<floating or
// normal>|<width>x<height>`), so a test can read it.
import Foundation
#if os(macOS)
import AppKit

final class AudioNookModule: ExactModule {
    override class var views: [String: ExactNativeFactory] {
        ["nook-mini-player": ExactNativeFactory(for: AudioNookModule.self) { module, props, events in
            MiniPlayer(agent: module.context.agent, props: props, events: events)
        }]
    }
}
let exactModule: ExactModule.Type = AudioNookModule.self

/// The node's own box: nothing to see; it says when it joins a window, the one it morphs.
private final class Anchor: NSView {
    var joined: () -> Void = {}
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
    override func viewDidMoveToWindow() { joined() }
}

final class MiniPlayer: ExactNativeInstance {
    /// The mini player's content size, under the title bar.
    static let size = NSSize(width: 440, height: 136)
    /// Where the mini player sat last, by its top-left corner, across shrinks and launches.
    private static let originKey = "AudioNookMiniPlayerOrigin"

    /// The window as it was before it shrank, to grow back into.
    private struct Full {
        let frame: NSRect
        let minSize: NSSize
        let maxSize: NSSize
        let level: NSWindow.Level
        let toolbarVisible: Bool
        let movable: Bool
        let titlebarTransparent: Bool
    }

    private let anchor = Anchor(frame: .zero)
    private let agent: Bool
    private var props: [String: String] = [:]
    private var full: Full?
    private var lastShown = ""
    private var quitting: NSObjectProtocol?

    init(agent: Bool, props: [String: String], events: ExactNativeEvents) {
        self.agent = agent
        super.init(events: events)
        anchor.joined = { [weak self] in self?.apply() }
        // The window's frame is saved as it quits; it should be the full one, not the mini.
        quitting = NotificationCenter.default.addObserver(forName: NSApplication.willTerminateNotification, object: nil, queue: .main) { [weak self] _ in
            self?.grow(animated: false)
        }
        try? setProps(props)
    }

    override var view: ExactNativeView { anchor }

    override func setProps(_ props: [String: String]) throws {
        self.props = props
        apply()
    }

    override func destroy() {
        grow(animated: false)
        if let quitting { NotificationCenter.default.removeObserver(quitting) }
    }

    private func apply() {
        guard let window = anchor.window else { return }
        if props["mini"] == "true" {
            if full == nil { shrink(window) }
            window.level = props["floating"] == "true" ? .floating : .normal
        } else {
            grow(animated: !agent)
        }
        echo()
    }

    private func shrink(_ window: NSWindow) {
        full = Full(frame: window.frame, minSize: window.minSize, maxSize: window.maxSize, level: window.level,
                    toolbarVisible: window.toolbar?.isVisible ?? false, movable: window.isMovableByWindowBackground,
                    titlebarTransparent: window.titlebarAppearsTransparent)
        window.toolbar?.isVisible = false
        window.titlebarAppearsTransparent = true
        for b in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] { window.standardWindowButton(b)?.isHidden = true }
        window.isMovableByWindowBackground = true
        // The size is the player's, under the title bar the window keeps.
        let size = window.frameRect(forContentRect: NSRect(origin: .zero, size: Self.size)).size
        window.minSize = size
        window.maxSize = size
        move(window, to: NSRect(origin: miniOrigin(for: window, size: size), size: size), animated: !agent)
    }

    private func grow(animated: Bool) {
        guard let full, let window = anchor.window else { return }
        self.full = nil
        let top = NSPoint(x: window.frame.minX, y: window.frame.maxY)
        UserDefaults.standard.set([top.x, top.y], forKey: Self.originKey)
        window.minSize = full.minSize
        window.maxSize = full.maxSize
        window.level = full.level
        window.isMovableByWindowBackground = full.movable
        window.titlebarAppearsTransparent = full.titlebarTransparent
        window.toolbar?.isVisible = full.toolbarVisible
        for b in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] { window.standardWindowButton(b)?.isHidden = false }
        move(window, to: full.frame, animated: animated)
    }

    /// The mini player's bottom-left corner: where it sat last if that is still on a screen,
    /// else the top right of the window's screen, as the old panel opened.
    private func miniOrigin(for window: NSWindow, size: NSSize) -> NSPoint {
        if let saved = UserDefaults.standard.array(forKey: Self.originKey) as? [Double], saved.count == 2 {
            let origin = NSPoint(x: saved[0], y: saved[1] - size.height)
            if NSScreen.screens.contains(where: { $0.visibleFrame.contains(NSRect(origin: origin, size: size)) }) { return origin }
        }
        let screen = (window.screen ?? NSScreen.main)?.visibleFrame ?? .zero
        return NSPoint(x: screen.maxX - size.width - 20, y: screen.maxY - size.height - 20)
    }

    private func move(_ window: NSWindow, to frame: NSRect, animated: Bool) {
        guard animated, !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else {
            window.setFrame(frame, display: true)
            return
        }
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.32
            context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            window.animator().setFrame(frame, display: true)
        }
    }

    /// Under the agent: what the window is, as a message the app keeps for its tests.
    private func echo() {
        guard agent, let window = anchor.window else { return }
        let size = full == nil ? window.frame.size : Self.size
        let shown = "shown:\(full == nil ? "full" : "mini")|\(window.level == .floating ? "floating" : "normal")|\(Int(size.width))x\(Int(size.height))"
        guard shown != lastShown else { return }
        lastShown = shown
        events.message(shown)
    }
}
#endif
