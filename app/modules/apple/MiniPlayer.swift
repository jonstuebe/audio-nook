// Audio Nook's Mini Player window, as Music's MiniPlayer: a small glass panel of its own, beside
// the main window, that can float above other apps. Contract owns every value: the panel is the
// `nook-mini-player` tag's view, given the player's state as props and answering each button as
// a `message` the app's actions handle, so it is always in step with the main player.
//
// The node in the page is a 1-point box; the panel is an `NSPanel` this instance owns, shown
// while `open` is "true". Under the agent, typed text presses the panel's own buttons
// (`type "mini-window" "toggle"`), and after each change the panel says back what it shows
// (`shown:<title>|<elapsed>|<playing or paused>|<floating>`), so a test can read the window.
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

/// The node's own box: nothing to see, but it takes focus so the agent can type at it.
private final class Anchor: NSView {
    override var acceptsFirstResponder: Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

/// The panel's controls' target and its delegate: AppKit's callbacks need an `NSObject`.
private final class Target: NSObject, NSWindowDelegate {
    var pressed: (NSButton) -> Void = { _ in }
    var scrubbed: (NSSlider) -> Void = { _ in }
    var closed: () -> Void = {}
    @objc func press(_ sender: NSButton) { pressed(sender) }
    @objc func scrub(_ sender: NSSlider) { scrubbed(sender) }
    func windowWillClose(_ notification: Notification) { closed() }
}

final class MiniPlayer: ExactNativeInstance {
    private let anchor = Anchor(frame: .zero)
    private let agent: Bool
    private var panel: NSPanel?
    private var props: [String: String] = [:]
    private var lastShown = ""
    private var coverURL = ""

    private let cover = NSImageView()
    private let titleLabel = NSTextField(labelWithString: "")
    private let detailLabel = NSTextField(labelWithString: "")
    private let elapsedLabel = NSTextField(labelWithString: "0:00")
    private let remainingLabel = NSTextField(labelWithString: "-0:00")
    private let slider = NSSlider(value: 0, minValue: 0, maxValue: 1, target: nil, action: nil)
    private var buttons: [String: NSButton] = [:]
    private let target = Target()

    init(agent: Bool, props: [String: String], events: ExactNativeEvents) {
        self.agent = agent
        super.init(events: events)
        target.pressed = { [weak self] in self?.pressed($0) }
        target.scrubbed = { [weak self] in self?.scrubbed($0) }
        target.closed = { [weak self] in self?.events.message("closed") }
        try? setProps(props)
    }

    override var view: ExactNativeView { anchor }
    override var focusTarget: ExactNativeView? { anchor }

    override func setProps(_ props: [String: String]) throws {
        self.props = props
        if props["open"] == "true" {
            let made = panel ?? makePanel()
            show(made)
        } else if let panel, panel.isVisible {
            panel.orderOut(nil)
        }
        echo()
    }

    override func destroy() {
        panel?.delegate = nil
        panel?.close()
        panel = nil
    }

    /// The agent's presses: the name of a panel button, or `seek:<seconds>` for the slider.
    override func agentInput(_ input: ExactNativeInput) throws {
        guard case let .text(text) = input else { throw ExactNativeRefusal("type a button's name: toggle, back30, forward30, previous, next, float, close or seek:<s>") }
        if text.hasPrefix("seek:"), let to = Double(text.dropFirst(5)) {
            slider.doubleValue = to
            scrubbed(slider)
        } else if agent, text.hasPrefix("snapshot:") {
            try snapshotPanel(to: String(text.dropFirst(9)))
        } else if text == "close" {
            panel?.performClose(nil)
        } else if let button = buttons[text] {
            button.performClick(nil)
        } else {
            throw ExactNativeRefusal("no Mini Player button \(text)")
        }
    }

    /// Under the agent only: the panel as the window server composites it (its glass included),
    /// written as a PNG, for the README's screenshots. `CGWindowListCreateImage` is looked up at
    /// run time, as Exact's own agent does: the SDK marks it unavailable, and the window server
    /// still answers it for this process's own windows without asking for Screen Recording.
    private func snapshotPanel(to path: String) throws {
        guard let panel, panel.isVisible else { throw ExactNativeRefusal("the Mini Player is not open") }
        typealias Create = @convention(c) (CGRect, UInt32, UInt32, UInt32) -> Unmanaged<CGImage>?
        guard let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "CGWindowListCreateImage") else { throw ExactNativeRefusal("no window capture here") }
        let create = unsafeBitCast(symbol, to: Create.self)
        // kCGWindowListOptionIncludingWindow; kCGWindowImageBestResolution (with its shadow)
        guard let image = create(.null, 1 << 3, UInt32(panel.windowNumber), 1 << 3)?.takeRetainedValue() else { throw ExactNativeRefusal("the window server gave no picture") }
        let rep = NSBitmapImageRep(cgImage: image)
        guard let png = rep.representation(using: .png, properties: [:]) else { throw ExactNativeRefusal("no PNG") }
        try png.write(to: URL(fileURLWithPath: path))
    }

    // MARK: The panel

    private func makePanel() -> NSPanel {
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 400, height: 148),
                            styleMask: [.titled, .closable, .fullSizeContentView, .nonactivatingPanel],
                            backing: .buffered, defer: false)
        panel.title = "Mini Player"
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.isMovableByWindowBackground = true
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.collectionBehavior = [.fullScreenAuxiliary, .moveToActiveSpace]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.setFrameAutosaveName("AudioNookMiniPlayer")
        panel.delegate = target
        // A mini player closes; it neither minimises nor zooms (Music's has Close alone).
        panel.standardWindowButton(.miniaturizeButton)?.isHidden = true
        panel.standardWindowButton(.zoomButton)?.isHidden = true

        let content = layout()
        if #available(macOS 26.0, *) {
            let glass = NSGlassEffectView()
            glass.cornerRadius = 22
            glass.contentView = content
            panel.contentView = glass
        } else {
            let material = NSVisualEffectView()
            material.material = .hudWindow
            material.blendingMode = .behindWindow
            material.state = .active
            material.addSubview(content)
            pin(content, to: material)
            panel.contentView = material
        }
        if panel.frame.origin == .zero, let screen = NSScreen.main?.visibleFrame {
            panel.setFrameTopLeftPoint(NSPoint(x: screen.maxX - 420, y: screen.maxY - 20))
        }
        self.panel = panel
        return panel
    }

    private func show(_ panel: NSPanel) {
        panel.level = props["floating"] == "true" ? .floating : .normal
        apply()
        if !panel.isVisible { panel.orderFront(nil) }
    }

    private func layout() -> NSView {
        cover.imageScaling = .scaleProportionallyUpOrDown
        cover.wantsLayer = true
        cover.layer?.cornerRadius = 10
        cover.layer?.masksToBounds = true
        cover.image = NSImage(systemSymbolName: "headphones", accessibilityDescription: nil)
        cover.contentTintColor = .tertiaryLabelColor
        cover.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([cover.widthAnchor.constraint(equalToConstant: 92), cover.heightAnchor.constraint(equalToConstant: 92)])

        titleLabel.font = .systemFont(ofSize: NSFont.systemFontSize, weight: .semibold)
        detailLabel.font = .systemFont(ofSize: NSFont.smallSystemFontSize)
        detailLabel.textColor = .secondaryLabelColor
        for label in [titleLabel, detailLabel] { label.lineBreakMode = .byTruncatingTail; label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal) }
        for label in [elapsedLabel, remainingLabel] {
            label.font = .monospacedDigitSystemFont(ofSize: NSFont.smallSystemFontSize - 1, weight: .regular)
            label.textColor = .secondaryLabelColor
        }
        slider.controlSize = .small
        slider.target = target
        slider.action = #selector(Target.scrub(_:))
        slider.isContinuous = false

        let times = NSStackView(views: [elapsedLabel, NSView(), remainingLabel])
        let controls = NSStackView(views: [
            button("previous", "backward.end.fill", "Previous Chapter"),
            button("back30", "gobackward.30", "Back 30 Seconds"),
            button("toggle", "play.fill", "Play", prominent: true),
            button("forward30", "goforward.30", "Forward 30 Seconds"),
            button("next", "forward.end.fill", "Next Chapter"),
            NSView(),
            button("float", "pin", "Keep on Top"),
        ])
        controls.spacing = 6
        let text = NSStackView(views: [titleLabel, detailLabel, slider, times, controls])
        text.orientation = .vertical
        text.alignment = .leading
        text.spacing = 3
        text.setCustomSpacing(8, after: detailLabel)
        for v in [slider, times, controls] { v.translatesAutoresizingMaskIntoConstraints = false; v.widthAnchor.constraint(equalTo: text.widthAnchor).isActive = true }

        let row = NSStackView(views: [cover, text])
        row.spacing = 14
        row.alignment = .centerY
        row.edgeInsets = NSEdgeInsets(top: 34, left: 18, bottom: 16, right: 18)
        return row
    }

    private func button(_ name: String, _ symbol: String, _ label: String, prominent: Bool = false) -> NSButton {
        let image = NSImage(systemSymbolName: symbol, accessibilityDescription: label) ?? NSImage()
        let b = NSButton(image: image, target: target, action: #selector(Target.press(_:)))
        b.identifier = NSUserInterfaceItemIdentifier(name)
        b.setAccessibilityLabel(label)
        b.toolTip = label
        if #available(macOS 26.0, *) {
            b.bezelStyle = .glass
            if prominent { b.bezelColor = .controlAccentColor; b.contentTintColor = .white }
        } else {
            b.bezelStyle = .texturedRounded
        }
        b.controlSize = prominent ? .large : .regular
        buttons[name] = b
        return b
    }

    private func pin(_ view: NSView, to parent: NSView) {
        view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([view.leadingAnchor.constraint(equalTo: parent.leadingAnchor), view.trailingAnchor.constraint(equalTo: parent.trailingAnchor),
                                     view.topAnchor.constraint(equalTo: parent.topAnchor), view.bottomAnchor.constraint(equalTo: parent.bottomAnchor)])
    }

    /// What the props say, into the panel's controls.
    private func apply() {
        let paused = props["state"] != "playing"
        titleLabel.stringValue = props["bookTitle"] ?? ""
        detailLabel.stringValue = [props["chapter"], props["author"]].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " — ")
        elapsedLabel.stringValue = props["elapsed"] ?? "0:00"
        remainingLabel.stringValue = props["remaining"] ?? ""
        slider.maxValue = max(1, Double(props["duration"] ?? "") ?? 1)
        if slider.window?.firstResponder !== slider { slider.doubleValue = Double(props["seconds"] ?? "") ?? 0 }
        if let toggle = buttons["toggle"] {
            toggle.image = NSImage(systemSymbolName: paused ? "play.fill" : "pause.fill", accessibilityDescription: paused ? "Play" : "Pause")
            toggle.setAccessibilityLabel(paused ? "Play" : "Pause")
        }
        buttons["previous"]?.isEnabled = props["hasPrevious"] != "false"
        buttons["next"]?.isEnabled = props["hasNext"] == "true"
        let floating = props["floating"] == "true"
        buttons["float"]?.image = NSImage(systemSymbolName: floating ? "pin.fill" : "pin", accessibilityDescription: "Keep on Top")
        buttons["float"]?.state = floating ? .on : .off
        panel?.level = floating ? .floating : .normal
        loadCover(props["cover"] ?? "")
    }

    private func loadCover(_ url: String) {
        guard url != coverURL else { return }
        coverURL = url
        guard let target = URL(string: url) else { return }
        let load = { [weak self] (data: Data?) in
            DispatchQueue.main.async {
                guard let self, self.coverURL == url, let data, let image = NSImage(data: data) else { return }
                self.cover.image = image
                self.cover.contentTintColor = nil
            }
        }
        if target.isFileURL { DispatchQueue.global().async { load(try? Data(contentsOf: target)) } }
        else { URLSession.shared.dataTask(with: target) { data, _, _ in load(data) }.resume() }
    }

    /// Under the agent: what the panel shows, as a message the app keeps for its tests.
    private func echo() {
        guard agent else { return }
        let visible = panel?.isVisible == true
        let paused = props["state"] != "playing"
        let shown = visible ? "shown:\(titleLabel.stringValue)|\(elapsedLabel.stringValue)|\(paused ? "paused" : "playing")|\(panel?.level == .floating ? "floating" : "normal")" : "shown:"
        guard shown != lastShown else { return }
        lastShown = shown
        events.message(shown)
    }

    private func pressed(_ sender: NSButton) {
        guard let name = sender.identifier?.rawValue else { return }
        events.message(name == "float" ? (props["floating"] == "true" ? "float:off" : "float:on") : name)
    }

    private func scrubbed(_ sender: NSSlider) {
        events.message("seek:\(Int(sender.doubleValue.rounded()))")
    }
}
#endif
