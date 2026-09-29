import SwiftUI
import UIKit

/// Cold-start splash: black screen, centered logo, pop-and-vanish exit once bootstrap finishes.
struct StartupSplashView: View {
    let isBootstrapComplete: Bool
    let onFinished: () -> Void

    private enum Phase: String {
        case waiting
        case popping
        case vanishing
        case done
    }

    /// Minimum time the logo stays visible so the exit animation always reads.
    private let minimumVisibleSeconds: TimeInterval = 0.85
    private let popScale: CGFloat = 1.14
    private let logoSize: CGFloat = 120

    @State private var phase: Phase = .waiting
    @State private var logoScale: CGFloat = 1
    @State private var logoOpacity: Double = 1
    @State private var backdropOpacity: Double = 1
    @State private var minimumElapsed = false
    /// Mirrors `isBootstrapComplete` so long-running tasks see the updated value.
    @State private var bootstrapComplete = false
    @State private var appearedAt = Date()
    @State private var copyFlash: String?

    var body: some View {
        ZStack {
            Color.black
                .opacity(backdropOpacity)
                .ignoresSafeArea()

            if phase != .done {
                logoImage
                    .frame(width: logoSize, height: logoSize)
                    .clipShape(RoundedRectangle(cornerRadius: logoSize * 0.22, style: .continuous))
                    .shadow(color: .black.opacity(0.35), radius: 16, y: 8)
                    .scaleEffect(logoScale)
                    .opacity(logoOpacity)
            }

            if DevTestMode.isUIEnabled, phase == .waiting {
                VStack {
                    Spacer()
                    if let copyFlash {
                        Text(copyFlash)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.cyan)
                            .padding(.bottom, 8)
                    }
                    Button {
                        copyDiagnosticLog()
                    } label: {
                        Label("Copy Log", systemImage: "doc.on.doc")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                            .background(
                                Capsule()
                                    .fill(Color.white.opacity(0.18))
                            )
                    }
                    .buttonStyle(.plain)
                    .padding(.bottom, 36)
                }
            }
        }
        .task { await runMinimumTimer() }
        .task { await splashWatchdog() }
        .onChange(of: isBootstrapComplete) { _, complete in
            bootstrapComplete = complete
            DiagnosticLog.shared.append(
                category: "system",
                message: "Splash bootstrapComplete=\(complete) phase=\(phase.rawValue) minElapsed=\(minimumElapsed) waited=\(elapsedLabel())"
            )
            if complete { tryBeginExit() }
        }
        .onChange(of: minimumElapsed) { _, elapsed in
            guard elapsed else { return }
            DiagnosticLog.shared.append(
                category: "system",
                message: "Splash minimumVisible elapsed bootstrapComplete=\(isBootstrapComplete) phase=\(phase.rawValue)"
            )
            tryBeginExit()
        }
        .onAppear {
            appearedAt = Date()
            bootstrapComplete = isBootstrapComplete
            DiagnosticLog.shared.append(
                category: "system",
                message: "Splash appear bootstrapComplete=\(isBootstrapComplete) testUI=\(DevTestMode.isUIEnabled)"
            )
            if isBootstrapComplete { tryBeginExit() }
        }
    }

    @ViewBuilder
    private var logoImage: some View {
        if let uiImage = AppIconImage.current {
            Image(uiImage: uiImage)
                .resizable()
                .scaledToFit()
        } else {
            Image(systemName: "tag.fill")
                .font(.system(size: 56, weight: .semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.accentColor)
        }
    }

    private func elapsedLabel() -> String {
        String(format: "%.2fs", Date().timeIntervalSince(appearedAt))
    }

    private func copyDiagnosticLog() {
        let text = DiagnosticLog.shared.exportText()
        UIPasteboard.general.string = text.isEmpty ? "(no log entries yet)" : text
        let count = DiagnosticLog.shared.entries.count
        copyFlash = "Copied \(count) log\(count == 1 ? "" : "s")"
        DiagnosticLog.shared.append(
            category: "system",
            message: "Splash Copy Log tapped entries=\(count) waited=\(elapsedLabel()) bootstrapComplete=\(bootstrapComplete) phase=\(phase.rawValue)"
        )
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) {
            if copyFlash?.hasPrefix("Copied") == true { copyFlash = nil }
        }
    }

    private func runMinimumTimer() async {
        try? await Task.sleep(nanoseconds: UInt64(minimumVisibleSeconds * 1_000_000_000))
        minimumElapsed = true
    }

    /// Heartbeat while splash is stuck waiting — helps diagnose force-kill cold starts.
    private func splashWatchdog() async {
        var tick = 0
        while !Task.isCancelled, phase == .waiting {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard phase == .waiting else { break }
            tick += 1
            let waited = Date().timeIntervalSince(appearedAt)
            DiagnosticLog.shared.append(
                category: "system",
                message: """
                Splash watchdog #\(tick) waited=\(String(format: "%.1fs", waited)) \
                bootstrapComplete=\(bootstrapComplete) minElapsed=\(minimumElapsed) \
                phase=\(phase.rawValue)
                """,
                level: waited >= 8 ? "warn" : "info"
            )
            if waited >= 20 {
                DiagnosticLog.shared.append(
                    category: "error",
                    message: "Splash still waiting after \(String(format: "%.0fs", waited)) — bootstrap may be hung (network / catalog / presence)",
                    level: "error"
                )
            }
        }
    }

    private func tryBeginExit() {
        guard minimumElapsed, isBootstrapComplete, phase == .waiting else { return }
        playExitAnimation()
    }

    private func playExitAnimation() {
        DiagnosticLog.shared.append(
            category: "system",
            message: "Splash exit animation begin waited=\(elapsedLabel())"
        )
        phase = .popping
        withAnimation(.spring(response: 0.28, dampingFraction: 0.62)) {
            logoScale = popScale
        }

        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 180_000_000)
            phase = .vanishing
            withAnimation(.easeIn(duration: 0.22)) {
                logoScale = 0.05
                logoOpacity = 0
                backdropOpacity = 0
            }
            try? await Task.sleep(nanoseconds: 240_000_000)
            phase = .done
            DiagnosticLog.shared.append(
                category: "system",
                message: "Splash dismissed totalWait=\(elapsedLabel())"
            )
            onFinished()
        }
    }
}

enum AppIconImage {
    /// Best-effort load of the marketing app icon for splash/branding.
    static var current: UIImage? {
        if let image = UIImage(named: "LaunchLogo") {
            return image
        }
        guard
            let icons = Bundle.main.infoDictionary?["CFBundleIcons"] as? [String: Any],
            let primary = icons["CFBundlePrimaryIcon"] as? [String: Any],
            let files = primary["CFBundleIconFiles"] as? [String]
        else {
            return nil
        }
        for name in files.reversed() {
            if let image = UIImage(named: name) {
                return image
            }
        }
        return nil
    }
}
