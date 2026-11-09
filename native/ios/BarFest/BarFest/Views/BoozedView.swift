import SwiftUI

/// Boozed — push-your-luck coaster Mines. Presented via fullScreenCover from Games.
struct BoozedView: View {
    @StateObject private var engine = BoozedEngine()
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            switch engine.screen {
            case .lobby:
                lobby
            case .playing, .ended:
                playTable
            }
        }
        .interactiveDismissDisabled(true)
        .onAppear { engine.appear() }
        .alert("Boozed", isPresented: Binding(
            get: { engine.errorText != nil },
            set: { if !$0 { engine.errorText = nil } }
        )) {
            Button("OK", role: .cancel) { engine.errorText = nil }
        } message: {
            Text(engine.errorText ?? "")
        }
    }

    // MARK: - Lobby

    private var lobby: some View {
        ScrollView {
            VStack(spacing: 20) {
                HStack {
                    backButton
                    Spacer()
                }

                Text("Boozed")
                    .font(.largeTitle.bold())
                    .foregroundStyle(.white)

                Text("Push your luck. Close your tab before you black out.")
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.7))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 28)

                proofChips
                    .padding(.top, 8)

                statsStrip
                    .padding(.horizontal, 20)

                Button {
                    engine.startRound()
                } label: {
                    Text(engine.isBusy ? "Starting…" : "Start")
                        .font(.headline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(Color.accentColor)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(engine.isBusy)
                .padding(.horizontal, 28)

                Button("Exit") { dismiss() }
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.9))

                if engine.usingOfflineRules {
                    Text("Playing with on-device rules (server unavailable).")
                        .font(.caption2)
                        .foregroundStyle(.orange.opacity(0.85))
                }

                leaderboardSection
                    .padding(.top, 12)
                    .padding(.horizontal, 20)

                Text("No real money. Alcohol theme only — please drink responsibly.")
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.4))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
                    .padding(.bottom, 24)
            }
            .padding(.top, 8)
        }
    }

    private var proofChips: some View {
        VStack(spacing: 10) {
            Text("Proof")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.white.opacity(0.55))
            HStack(spacing: 10) {
                ForEach(BoozedProof.allCases) { level in
                    Button {
                        engine.selectProof(level)
                    } label: {
                        VStack(spacing: 4) {
                            Text(level.label)
                                .font(.headline.weight(.bold))
                            Text("\(level.shots) shots")
                                .font(.caption2)
                                .opacity(0.75)
                        }
                        .foregroundStyle(engine.proof == level ? Color.black : Color.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .fill(engine.proof == level ? Color.white : Color.white.opacity(0.08))
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .strokeBorder(Color.white.opacity(0.15), lineWidth: 1)
                        )
                    }
                    .buttonStyle(.plain)
                    .disabled(engine.screen == .playing)
                }
            }
            .padding(.horizontal, 16)
        }
    }

    private var statsStrip: some View {
        HStack(spacing: 0) {
            statCell("Tab", "\(engine.profile.tabScore)")
            statCell("Streak", "\(engine.profile.streak)")
            statCell("Best", BoozedMath.formatMultiplier(engine.profile.bestMultiplier))
        }
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color.white.opacity(0.06))
        )
    }

    private func statCell(_ title: String, _ value: String) -> some View {
        VStack(spacing: 4) {
            Text(title.uppercased())
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.white.opacity(0.45))
            Text(value)
                .font(.subheadline.weight(.bold).monospacedDigit())
                .foregroundStyle(.white)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Play

    private var playTable: some View {
        VStack(spacing: 0) {
            HStack {
                backButton
                Spacer()
                Text("Boozed")
                    .font(.headline.weight(.bold))
                    .foregroundStyle(.white)
                Spacer()
                Text("\(engine.proof.rawValue) proof")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.55))
                    .frame(width: 72, alignment: .trailing)
            }
            .padding(.horizontal, 12)
            .padding(.top, 4)

            Text(engine.message)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(messageColor)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 16)
                .padding(.top, 10)
                .padding(.bottom, 8)
                .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: engine.message)

            boardGrid
                .padding(.horizontal, 12)

            receipt
                .padding(.horizontal, 16)
                .padding(.top, 14)

            actionRow
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 20)
        }
    }

    private var messageColor: Color {
        switch engine.endKind {
        case .blown: return Color(red: 1, green: 0.45, blue: 0.42)
        case .cashed, .cleared: return Color.green
        case nil: return .white.opacity(0.8)
        }
    }

    private var boardGrid: some View {
        let cols = Array(repeating: GridItem(.flexible(), spacing: 8), count: 5)
        return LazyVGrid(columns: cols, spacing: 8) {
            ForEach(engine.board) { tile in
                BoozedCoasterView(
                    tile: tile,
                    isFlipping: engine.flippingTile == tile.tile,
                    reduceMotion: reduceMotion
                ) {
                    engine.tapTile(tile.tile)
                }
                .disabled(engine.screen != .playing || engine.revealInFlight || tile.revealed)
            }
        }
        .modifier(BoozedShakeModifier(
            shake: engine.endKind == .blown && !reduceMotion,
            reduceMotion: reduceMotion
        ))
    }

    private var receipt: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Multiplier")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.5))
                Spacer()
                Text(BoozedMath.formatMultiplier(engine.multiplier))
                    .font(.title.weight(.bold).monospacedDigit())
                    .foregroundStyle(.white)
            }
            HStack {
                labeled("This round", engine.safeCount >= 1 ? "\(engine.pointsIfCashout) pts" : "—")
                Spacer()
                labeled("Tab", "\(engine.profile.tabScore)")
            }
            HStack {
                labeled("Streak", "\(engine.profile.streak)")
                Spacer()
                labeled(
                    "Next safe",
                    engine.screen == .playing
                        ? "\(BoozedMath.formatMultiplier(engine.nextMultiplier)) · \(Int((engine.nextShotChance * 100).rounded()))% shot"
                        : "—"
                )
            }
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color.white.opacity(0.07))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(Color.white.opacity(0.12), lineWidth: 1)
        )
    }

    private func labeled(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title.uppercased())
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.white.opacity(0.4))
            Text(value)
                .font(.footnote.weight(.semibold).monospacedDigit())
                .foregroundStyle(.white.opacity(0.9))
        }
    }

    private var actionRow: some View {
        Group {
            if engine.screen == .ended {
                Button {
                    engine.nextRound()
                } label: {
                    Text("Next round")
                        .font(.headline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(Color.white)
                        .foregroundStyle(.black)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(.plain)
            } else {
                Button {
                    engine.closeTab()
                } label: {
                    Text(engine.safeCount >= 1
                          ? "Close your tab (+\(engine.pointsIfCashout) pts)"
                          : "Close your tab")
                        .font(.headline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(engine.safeCount >= 1 ? Color.green : Color.white.opacity(0.15))
                        .foregroundStyle(engine.safeCount >= 1 ? Color.black : Color.white.opacity(0.35))
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(engine.safeCount < 1 || engine.revealInFlight || engine.isBusy)
            }
        }
    }

    private var leaderboardSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Today’s board (Eastern)")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white.opacity(0.7))
            if engine.leaderboardLoading && engine.leaderboard.isEmpty {
                Text("Loading…")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.45))
            } else if engine.leaderboard.isEmpty {
                Text("No scores yet today. Close a tab to post.")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.45))
            } else {
                ForEach(engine.leaderboard.prefix(10)) { row in
                    HStack {
                        Text("#\(row.rank)")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.white.opacity(0.45))
                            .frame(width: 28, alignment: .leading)
                        Text(row.displayName)
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.white.opacity(0.85))
                        Spacer()
                        Text("\(row.scorePoints) pts")
                            .font(.caption.weight(.semibold).monospacedDigit())
                            .foregroundStyle(.white)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var backButton: some View {
        Button {
            dismiss()
        } label: {
            Image(systemName: "chevron.left")
                .font(.body.weight(.semibold))
                .foregroundStyle(.white)
                .frame(width: 44, height: 44, alignment: .leading)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Back to Games")
    }
}

// MARK: - Coaster

private struct BoozedCoasterView: View {
    let tile: BoozedBoardTile
    let isFlipping: Bool
    let reduceMotion: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(faceDown ? Color(red: 0.93, green: 0.88, blue: 0.78) : faceColor)
                if faceDown {
                    Text("BAR\nFEST")
                        .font(.system(size: 9, weight: .heavy))
                        .foregroundStyle(Color.black.opacity(0.35))
                        .multilineTextAlignment(.center)
                } else {
                    VStack(spacing: 4) {
                        Text(tile.item ?? "")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(.white)
                            .multilineTextAlignment(.center)
                            .lineLimit(3)
                            .minimumScaleFactor(0.7)
                        Text(tile.kind == .shot ? "BLOWN" : "SAFE")
                            .font(.system(size: 8, weight: .heavy))
                            .foregroundStyle(.white.opacity(0.85))
                    }
                    .padding(4)
                }
            }
            .aspectRatio(1, contentMode: .fit)
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(Color.white.opacity(faceDown ? 0.2 : 0.35), lineWidth: 1)
            )
            .rotation3DEffect(
                .degrees(isFlipping && !reduceMotion ? 90 : 0),
                axis: (x: 0, y: 1, z: 0)
            )
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.25), value: isFlipping)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: tile.revealed)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel)
    }

    private var faceDown: Bool { !tile.revealed }

    private var faceColor: Color {
        if tile.kind == .shot {
            return Color(red: 0.75, green: 0.18, blue: 0.16)
        }
        return Color(red: 0.12, green: 0.45, blue: 0.28)
    }

    private var accessibilityLabel: String {
        if !tile.revealed {
            return "Coaster \(tile.tile + 1), face down"
        }
        if tile.kind == .shot {
            return "\(tile.item ?? "Shot"), a shot"
        }
        return "\(tile.item ?? "Safe"), safe"
    }
}

private struct BoozedShakeModifier: ViewModifier {
    let shake: Bool
    let reduceMotion: Bool
    @State private var offset: CGFloat = 0

    func body(content: Content) -> some View {
        content
            .offset(x: offset)
            .onChange(of: shake) { _, on in
                guard on, !reduceMotion else { return }
                withAnimation(.default) {
                    offset = 8
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) {
                    withAnimation(.default) { offset = -8 }
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.16) {
                    withAnimation(.default) { offset = 0 }
                }
            }
    }
}
