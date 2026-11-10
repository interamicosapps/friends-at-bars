import SwiftUI
import UIKit

/// Ride The Bus — presented via fullScreenCover from Games (no nav swipe-back).
struct RideTheBusView: View {
    @StateObject private var engine = RideTheBusEngine()
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var activeFlipDegrees: Double = 0
    @State private var activeScale: CGFloat = 1
    @State private var activeOffset: CGSize = .zero
    @State private var activeOpacity: Double = 1
    @State private var showActiveFace = false
    @State private var glowColor: Color = .clear
    @State private var glowPulse = false
    @State private var slotsShake: CGFloat = 0
    @State private var slotHighlightIndex: Int? = nil
    @State private var dealFromDeck = false
    @State private var isBusy = false
    @State private var cardFlightElevated = false
    @State private var optionsOpacity: Double = 1
    @State private var deckPulse = false
    @State private var confettiBurst = false
    /// Measured frames in the `rtbBoard` coordinate space (active / slots / trash).
    @State private var boardFrames: [String: CGRect] = [:]
    /// Independent flyer so engine can commit only after the motion finishes.
    @State private var flight: RTBFlight?

    private let cardW: CGFloat = 110
    private let cardH: CGFloat = 154
    private let slotW: CGFloat = 72
    private let slotH: CGFloat = 100
    private let pileW: CGFloat = 70
    private let pileH: CGFloat = 98
    private let boardSpace = "rtbBoard"
    private let flightDuration: TimeInterval = 0.42

    /// Springs used for card deal-ins (not for commit flights).
    private var cardSpring: Animation {
        .spring(response: 0.42, dampingFraction: 0.78)
    }

    private var flightEase: Animation {
        .easeInOut(duration: flightDuration)
    }

    private var quickFade: Animation {
        .easeOut(duration: 0.15)
    }

    private struct RTBFlight: Equatable {
        var card: RTBCard
        var center: CGPoint
        var width: CGFloat
        var height: CGFloat
        var opacity: Double
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            switch engine.screen {
            case .lobby:
                lobbyScreen
            case .playing, .won:
                gameScreen
            }

            if confettiBurst && !reduceMotion {
                RTBConfettiBurst()
                    .allowsHitTesting(false)
                    .transition(.opacity)
            }
        }
        .interactiveDismissDisabled(true)
    }

    // MARK: - Lobby

    private var lobbyScreen: some View {
        VStack(spacing: 0) {
            HStack {
                backButton
                Spacer()
            }
            .padding(.horizontal, 8)
            .padding(.top, 4)

            Spacer()
            Text("Ride The Bus")
                .font(.system(size: 34, weight: .bold))
                .foregroundStyle(.white)
                .padding(.bottom, 28)

            RTBCardBackView(label: "Deck", showCount: nil)
                .frame(width: cardW + 20, height: cardH + 28)
                .shadow(color: .white.opacity(0.08), radius: 8, y: 4)

            Spacer()

            Button {
                hapticLight()
                withAnimation(.easeOut(duration: 0.25)) {
                    engine.startGame()
                }
                Task { await playDealIn() }
            } label: {
                Text("Start Game")
                    .font(.headline.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(Color.green)
                    .foregroundStyle(.black)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 28)
            .padding(.bottom, 36)
        }
    }

    // MARK: - Game / Win

    private var gameScreen: some View {
        ZStack {
            VStack(spacing: 0) {
                topBar

                statusBanner
                    .padding(.top, 8)
                    .padding(.horizontal, 12)

                Spacer(minLength: 8)

                if engine.screen == .won {
                    // Victory: fan sits in the former active-card band (no checkmark card).
                    slotsRow
                        .padding(.horizontal, 24)
                        .background(RTBFrameReader(id: "slots", coordinateSpace: boardSpace))
                } else {
                    activeRow
                        .padding(.horizontal, 12)
                        .zIndex(cardFlightElevated ? 20 : 1)

                    Spacer(minLength: 16)

                    // Slots stay mounted the whole game — only opacity/transform animate, never removal.
                    slotsRow
                        .padding(.horizontal, 24)
                        .background(RTBFrameReader(id: "slots", coordinateSpace: boardSpace))
                }

                Spacer(minLength: 20)

                bottomPiles
                    .padding(.horizontal, 28)
                    .padding(.bottom, 28)
            }

            if let flight {
                RTBPlayingCardView(card: flight.card)
                    .frame(width: flight.width, height: flight.height)
                    .opacity(flight.opacity)
                    .position(flight.center)
                    .zIndex(200)
                    .allowsHitTesting(false)
            }
        }
        .coordinateSpace(name: boardSpace)
        .onPreferenceChange(RTBFramePreferenceKey.self) { boardFrames = $0 }
    }

    @ViewBuilder
    private var statusBanner: some View {
        if engine.screen == .playing || engine.screen == .won, let message = engine.message {
            let fail = engine.lastResultCorrect == false
            let success = engine.lastResultCorrect == true || engine.screen == .won

            Text(message)
                .font(.body.weight(.bold))
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(bannerFill(fail: fail, success: success))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.18), lineWidth: 1)
                )
                .transition(.move(edge: .top).combined(with: .opacity))
                .animation(quickFade, value: engine.message)
        } else {
            Color.clear.frame(height: 12)
        }
    }

    private func bannerFill(fail: Bool, success: Bool) -> Color {
        if fail { return Color(red: 0.55, green: 0.12, blue: 0.12).opacity(0.92) }
        if success { return Color(red: 0.08, green: 0.38, blue: 0.2).opacity(0.92) }
        return Color.white.opacity(0.1)
    }

    private var topBar: some View {
        ZStack {
            HStack {
                backButton
                Spacer()
            }
            Text("Ride The Bus")
                .font(.title2.bold())
                .foregroundStyle(.white)
                .shadow(color: .white.opacity(0.25), radius: 6)
        }
        .padding(.horizontal, 8)
        .padding(.top, 4)
    }

    private var backButton: some View {
        Button {
            engine.returnToLobby()
            dismiss()
        } label: {
            Image(systemName: "chevron.left")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Active + options

    private var activeRow: some View {
        HStack(alignment: .center, spacing: 10) {
            leftOptions
                .frame(maxWidth: .infinity)
                .opacity(optionsOpacity)
                .allowsHitTesting(optionsOpacity > 0.5)

            activeCard
                .frame(width: cardW, height: cardH)
                .scaleEffect(activeScale)
                .rotation3DEffect(
                    .degrees(activeFlipDegrees),
                    axis: (x: 0, y: 1, z: 0),
                    perspective: 0.65
                )
                .shadow(color: glowColor.opacity(glowPulse ? 0.95 : 0.35), radius: glowPulse ? 28 : 10)
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(glowColor.opacity(glowPulse ? 0.9 : 0.35), lineWidth: glowPulse ? 3 : 1.5)
                )
                .offset(activeOffset)
                .opacity(activeOpacity)
                .offset(x: slotsShake)
                .background(RTBFrameReader(id: "active", coordinateSpace: boardSpace))
                .zIndex(cardFlightElevated ? 30 : 2)

            rightOptions
                .frame(maxWidth: .infinity)
                .opacity(optionsOpacity)
                .allowsHitTesting(optionsOpacity > 0.5)
        }
        .disabled(isBusy || engine.phase != .awaitingGuess || engine.screen == .won)
    }

    @ViewBuilder
    private var leftOptions: some View {
        switch engine.round {
        case 0:
            guessButton(
                title: "Red",
                subtitle: "♥ ♦",
                tint: .red,
                guess: .color(.red),
                enabled: canGuess
            ) {
                Task { await handleGuess(.color(.red)) }
            }
        case 1:
            guessButton(
                title: "Higher",
                subtitle: "↑",
                tint: Color(white: 0.22),
                guess: .compare(.higher),
                enabled: canGuess
            ) {
                Task { await handleGuess(.compare(.higher)) }
            }
        case 2:
            guessButton(
                title: "Inside",
                subtitle: "→ ←",
                tint: Color(white: 0.22),
                guess: .range(.inside),
                enabled: canGuess
            ) {
                Task { await handleGuess(.range(.inside)) }
            }
        case 3:
            VStack(spacing: 10) {
                suitButton(.hearts, enabled: canGuess)
                suitButton(.diamonds, enabled: canGuess)
            }
        default:
            EmptyView()
        }
    }

    @ViewBuilder
    private var rightOptions: some View {
        switch engine.round {
        case 0:
            guessButton(
                title: "Black",
                subtitle: "♠ ♣",
                tint: Color(white: 0.18),
                guess: .color(.black),
                enabled: canGuess
            ) {
                Task { await handleGuess(.color(.black)) }
            }
        case 1:
            guessButton(
                title: "Lower",
                subtitle: "↓",
                tint: Color(white: 0.22),
                guess: .compare(.lower),
                enabled: canGuess
            ) {
                Task { await handleGuess(.compare(.lower)) }
            }
        case 2:
            guessButton(
                title: "Outside",
                subtitle: "← →",
                tint: Color(white: 0.22),
                guess: .range(.outside),
                enabled: canGuess
            ) {
                Task { await handleGuess(.range(.outside)) }
            }
        case 3:
            VStack(spacing: 10) {
                suitButton(.clubs, enabled: canGuess)
                suitButton(.spades, enabled: canGuess)
            }
        default:
            EmptyView()
        }
    }

    private var canGuess: Bool {
        !isBusy && engine.phase == .awaitingGuess && engine.screen == .playing && engine.current != nil
    }

    private var activeCard: some View {
        ZStack {
            if showActiveFace, let card = engine.current {
                RTBPlayingCardView(card: card)
            } else if engine.current != nil || dealFromDeck {
                RTBCardBackView(label: "Active Card", showCount: nil)
            } else {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.2), style: StrokeStyle(lineWidth: 2, dash: [6, 4]))
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(Color.white.opacity(0.04))
                    )
            }
        }
    }

    // MARK: - Slots

    /// In-play slots, or win fan (final flipped card centered).
    private var filledSlotCards: [(index: Int, card: RTBCard)] {
        if engine.screen == .won, !engine.winFanCards.isEmpty {
            return engine.winFanCards.enumerated().map { ($0.offset, $0.element) }
        }
        return engine.slots.enumerated().compactMap { index, card in
            guard let card else { return nil }
            return (index, card)
        }
    }

    private var slotsRow: some View {
        let filled = filledSlotCards
        let isWinFan = engine.screen == .won && filled.count == 3
        // Slightly larger cards when the fan is the win hero.
        let w = isWinFan ? slotW * 1.15 : slotW
        let h = isWinFan ? slotH * 1.15 : slotH
        return Group {
            if filled.isEmpty {
                // Reserve height so the board doesn’t jump when the first card lands.
                Color.clear.frame(height: slotH)
            } else {
                HStack(spacing: 0) {
                    Spacer(minLength: 0)
                    HStack(spacing: isWinFan ? 10 : 14) {
                        ForEach(Array(filled.enumerated()), id: \.element.index) { visibleIndex, item in
                            let fan: CGFloat = {
                                guard isWinFan else { return 0 }
                                return CGFloat(visibleIndex - 1) * 12
                            }()
                            let isCenter = isWinFan && visibleIndex == 1
                            ZStack {
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .fill(Color(red: 0.12, green: 0.18, blue: 0.35))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                                            .strokeBorder(
                                                isCenter
                                                    ? Color.green.opacity(0.85)
                                                    : (slotHighlightIndex == item.index
                                                        ? Color.yellow.opacity(0.9)
                                                        : Color.white.opacity(0.18)),
                                                lineWidth: isCenter || slotHighlightIndex == item.index ? 2.5 : 1
                                            )
                                    )
                                    .shadow(color: Color.black.opacity(0.35), radius: 6, y: 3)
                                RTBPlayingCardView(card: item.card)
                                    .padding(4)
                            }
                            .frame(width: isCenter ? w * 1.08 : w, height: isCenter ? h * 1.08 : h)
                            .rotationEffect(.degrees(Double(fan)))
                            .offset(y: isWinFan ? (isCenter ? -6 : abs(fan) * 0.45) : 0)
                            .zIndex(isCenter ? 2 : 0)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .animation(cardSpring, value: filled.count)
            }
        }
        .offset(x: slotsShake)
        .animation(cardSpring, value: engine.screen == .won)
    }

    // MARK: - Bottom piles

    private var bottomPiles: some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(spacing: 8) {
                RTBCardBackView(label: nil, showCount: nil)
                    .frame(width: pileW, height: pileH)
                    .scaleEffect(deckPulse ? 1.06 : 1)
                    .shadow(color: .blue.opacity(deckPulse ? 0.55 : 0.35), radius: deckPulse ? 12 : 8, y: 2)
                    .animation(.easeOut(duration: 0.18), value: deckPulse)
                Text("Deck")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.white.opacity(0.55))
            }

            if engine.screen == .won {
                Button {
                    hapticLight()
                    confettiBurst = false
                    withAnimation(.easeOut(duration: 0.2)) {
                        engine.newGameFromWin()
                    }
                    Task { await playDealIn() }
                } label: {
                    Text("New Game")
                        .font(.headline.weight(.semibold))
                        .foregroundStyle(.black)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(Color.green)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .shadow(color: .green.opacity(0.35), radius: 10, y: 2)
                }
                .buttonStyle(.plain)
            } else if DevTestMode.isUIEnabled {
                Button {
                    hapticWin()
                    isBusy = false
                    flight = nil
                    resetActiveTransforms()
                    optionsOpacity = 1
                    withAnimation(.easeInOut(duration: 0.25)) {
                        engine.jumpToVictoryForTesting()
                        confettiBurst = true
                    }
                } label: {
                    Text("Victory")
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(.black)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Color.yellow)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .shadow(color: .yellow.opacity(0.35), radius: 8, y: 2)
                }
                .buttonStyle(.plain)
                .disabled(isBusy)
            } else {
                Spacer(minLength: 0)
            }

            VStack(spacing: 8) {
                ZStack {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.25), style: StrokeStyle(lineWidth: 2, dash: [5, 4]))
                        .background(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .fill(Color.white.opacity(0.05))
                        )
                    // Short stack of recent discards (top = most recent).
                    ForEach(Array(trashStack.enumerated()), id: \.offset) { idx, card in
                        RTBPlayingCardView(card: card)
                            .padding(4)
                            .offset(x: CGFloat(idx) * 3, y: CGFloat(idx) * -3)
                    }
                    if trashStack.isEmpty {
                        Image(systemName: "trash")
                            .font(.title3)
                            .foregroundStyle(.white.opacity(0.35))
                    }
                }
                .frame(width: pileW, height: pileH)
                .background(RTBFrameReader(id: "trash", coordinateSpace: boardSpace))
                Text("Trash")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.white.opacity(0.55))
            }
        }
    }

    private var trashStack: [RTBCard] {
        Array(engine.discard.suffix(3))
    }

    // MARK: - Buttons (selection light-up / dim)

    private func optionOpacity(for guess: RTBGuess) -> Double {
        guard let selected = engine.selectedGuess else { return 1 }
        return selected == guess ? 1 : 0.35
    }

    private func optionScale(for guess: RTBGuess) -> CGFloat {
        guard let selected = engine.selectedGuess else { return 1 }
        return selected == guess ? 1.05 : 0.96
    }

    private func guessButton(
        title: String,
        subtitle: String,
        tint: Color,
        guess: RTBGuess,
        enabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        let lit = engine.selectedGuess == guess
        return Button(action: action) {
            VStack(spacing: 4) {
                Text(title)
                    .font(.subheadline.weight(.bold))
                Text(subtitle)
                    .font(.caption.weight(.semibold))
                    .opacity(0.9)
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(tint)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(Color.white.opacity(lit ? 0.85 : 0.15), lineWidth: lit ? 2.5 : 1)
            )
            .shadow(color: lit ? tint.opacity(0.7) : .clear, radius: lit ? 14 : 0)
            .opacity(enabled || engine.selectedGuess != nil ? optionOpacity(for: guess) : 0.45)
            .scaleEffect(optionScale(for: guess))
            .animation(.spring(response: 0.22, dampingFraction: 0.72), value: engine.selectedGuess)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }

    private func suitButton(_ suit: RTBSuit, enabled: Bool) -> some View {
        let tint: Color = suit.isRed ? .red : Color(white: 0.18)
        let guess = RTBGuess.suit(suit)
        let lit = engine.selectedGuess == guess
        return Button {
            Task { await handleGuess(guess) }
        } label: {
            VStack(spacing: 2) {
                Text(suit.symbol)
                    .font(.title2.weight(.bold))
                Text(suit.label)
                    .font(.caption2.weight(.semibold))
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(tint)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(Color.white.opacity(lit ? 0.85 : 0.15), lineWidth: lit ? 2.5 : 1)
            )
            .shadow(color: lit ? tint.opacity(0.7) : .clear, radius: lit ? 14 : 0)
            .opacity(enabled || engine.selectedGuess != nil ? optionOpacity(for: guess) : 0.45)
            .scaleEffect(optionScale(for: guess))
            .animation(.spring(response: 0.22, dampingFraction: 0.72), value: engine.selectedGuess)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }

    // MARK: - Haptics

    private func hapticLight() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    private func hapticSuccess() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    private func hapticError() {
        UINotificationFeedbackGenerator().notificationOccurred(.error)
    }

    private func hapticWin() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        UIImpactFeedbackGenerator(style: .heavy).impactOccurred(intensity: 1)
    }

    // MARK: - Flow / animation

    private func handleGuess(_ guess: RTBGuess) async {
        guard canGuess else { return }
        isBusy = true
        hapticLight()
        engine.submitGuess(guess)

        withAnimation(quickFade) { optionsOpacity = 0.15 }

        if reduceMotion {
            showActiveFace = true
            try? await Task.sleep(nanoseconds: 120_000_000)
        } else {
            await animateFlipReveal()
        }

        // Short hold (~450ms) instead of a long pause on the face.
        try? await Task.sleep(nanoseconds: reduceMotion ? 200_000_000 : 450_000_000)
        engine.advanceAfterReveal()

        if engine.lastResultCorrect == true {
            hapticSuccess()
            await animateSuccessHold()
            try? await Task.sleep(nanoseconds: 80_000_000)

            if engine.round == 3 {
                engine.resolveSuccess()
                hapticWin()
                withAnimation(.easeInOut(duration: 0.3)) {
                    confettiBurst = true
                    resetActiveTransforms()
                    optionsOpacity = 1
                }
                isBusy = false
                return
            }

            await flyActiveCardToSlot(slotIndex: engine.round)
            try? await Task.sleep(nanoseconds: 60_000_000)
            await playDealIn()
            withAnimation(quickFade) { optionsOpacity = 1 }
        } else {
            hapticError()
            await animateFailHoldAndShake()
            await flyActiveCardToTrash()
            // Clear fail headline with the deal — same brief window as Correct!.
            engine.finishFailInterstitialAndDeal(clearFailCopy: true)
            await playDealIn()
            withAnimation(quickFade) { optionsOpacity = 1 }
        }
        isBusy = false
    }

    private func playDealIn() async {
        guard engine.current != nil else { return }
        isBusy = true
        showActiveFace = false
        dealFromDeck = true
        cardFlightElevated = true
        glowColor = .clear
        glowPulse = false

        if reduceMotion {
            activeOpacity = 1
            activeOffset = .zero
            activeScale = 1
            activeFlipDegrees = 0
            try? await Task.sleep(nanoseconds: 120_000_000)
        } else {
            // Originate near the Deck (bottom-left of the active card).
            activeOpacity = 1
            activeOffset = CGSize(width: -118, height: 210)
            activeScale = 0.55
            activeFlipDegrees = 0
            deckPulse = true
            withAnimation(cardSpring) {
                activeOffset = .zero
                activeScale = 1
            }
            try? await Task.sleep(nanoseconds: 380_000_000)
            deckPulse = false
        }

        dealFromDeck = false
        cardFlightElevated = false
        isBusy = false
    }

    private func animateFlipReveal() async {
        withAnimation(.easeIn(duration: 0.14)) {
            activeFlipDegrees = 90
        }
        try? await Task.sleep(nanoseconds: 140_000_000)
        showActiveFace = true
        activeFlipDegrees = -90
        withAnimation(.spring(response: 0.28, dampingFraction: 0.72)) {
            activeFlipDegrees = 0
        }
        try? await Task.sleep(nanoseconds: 220_000_000)
    }

    private func animateSuccessHold() async {
        glowColor = .yellow
        withAnimation(.spring(response: 0.28, dampingFraction: 0.55)) {
            activeScale = 1.1
            glowPulse = true
        }
        try? await Task.sleep(nanoseconds: reduceMotion ? 150_000_000 : 280_000_000)
        withAnimation(.easeOut(duration: 0.2)) {
            glowPulse = false
            activeScale = 1
        }
        try? await Task.sleep(nanoseconds: 120_000_000)
    }

    private func animateFailHoldAndShake() async {
        glowColor = .red
        withAnimation(.easeInOut(duration: 0.14)) { glowPulse = true }
        if reduceMotion {
            try? await Task.sleep(nanoseconds: 200_000_000)
            glowPulse = false
            return
        }
        // Three quick horizontal oscillations (~6px).
        for _ in 0 ..< 3 {
            withAnimation(.easeInOut(duration: 0.05)) {
                activeOffset = CGSize(width: 6, height: 0)
                slotsShake = 4
            }
            try? await Task.sleep(nanoseconds: 50_000_000)
            withAnimation(.easeInOut(duration: 0.05)) {
                activeOffset = CGSize(width: -6, height: 0)
                slotsShake = -4
            }
            try? await Task.sleep(nanoseconds: 50_000_000)
        }
        withAnimation(.easeOut(duration: 0.08)) {
            activeOffset = .zero
            slotsShake = 0
            glowPulse = false
        }
        try? await Task.sleep(nanoseconds: 80_000_000)
    }

    /// Fly a ghost of the active card into the dynamic slot layout, then commit engine state.
    private func flyActiveCardToSlot(slotIndex: Int) async {
        guard let card = engine.current else {
            engine.resolveSuccess()
            resetActiveTransforms(keepHidden: false)
            return
        }

        glowColor = .clear
        glowPulse = false

        let from = boardFrames["active"] ?? CGRect(
            x: UIScreen.main.bounds.midX - cardW / 2,
            y: 220,
            width: cardW,
            height: cardH
        )
        let destCenter = slotDestinationCenter(slotIndex: slotIndex)

        if reduceMotion {
            activeOpacity = 0
            engine.resolveSuccess()
            slotHighlightIndex = slotIndex
            try? await Task.sleep(nanoseconds: 120_000_000)
            withAnimation(quickFade) { slotHighlightIndex = nil }
            resetActiveTransforms(keepHidden: true)
            return
        }

        // Hide the live active card while the flyer owns the motion.
        activeOpacity = 0
        var flyer = RTBFlight(
            card: card,
            center: CGPoint(x: from.midX, y: from.midY),
            width: cardW,
            height: cardH,
            opacity: 1
        )
        flight = flyer

        flyer.center = destCenter
        flyer.width = slotW
        flyer.height = slotH
        withAnimation(flightEase) {
            flight = flyer
        }
        try? await Task.sleep(nanoseconds: UInt64(flightDuration * 1_000_000_000))

        engine.resolveSuccess()
        slotHighlightIndex = slotIndex

        flyer.opacity = 0
        withAnimation(.easeOut(duration: 0.1)) {
            flight = flyer
        }
        try? await Task.sleep(nanoseconds: 100_000_000)
        flight = nil
        withAnimation(quickFade) { slotHighlightIndex = nil }
        resetActiveTransforms(keepHidden: true)
    }

    /// Fly a ghost into the trash pile, then commit the fail interstitial.
    private func flyActiveCardToTrash() async {
        guard let card = engine.current else {
            engine.enterFailInterstitial()
            resetActiveTransforms(keepHidden: false)
            return
        }

        glowColor = .clear
        glowPulse = false

        let from = boardFrames["active"] ?? CGRect(
            x: UIScreen.main.bounds.midX - cardW / 2,
            y: 220,
            width: cardW,
            height: cardH
        )
        let trash = boardFrames["trash"] ?? CGRect(
            x: UIScreen.main.bounds.maxX - 100,
            y: UIScreen.main.bounds.maxY - 180,
            width: pileW,
            height: pileH
        )
        let dest = CGPoint(x: trash.midX, y: trash.midY)

        if reduceMotion {
            activeOpacity = 0
            engine.enterFailInterstitial()
            resetActiveTransforms(keepHidden: true)
            try? await Task.sleep(nanoseconds: 100_000_000)
            return
        }

        activeOpacity = 0
        var flyer = RTBFlight(
            card: card,
            center: CGPoint(x: from.midX, y: from.midY),
            width: cardW,
            height: cardH,
            opacity: 1
        )
        flight = flyer

        flyer.center = dest
        flyer.width = pileW * 0.92
        flyer.height = pileH * 0.92
        withAnimation(flightEase) {
            flight = flyer
        }
        try? await Task.sleep(nanoseconds: UInt64(flightDuration * 1_000_000_000))

        engine.enterFailInterstitial()

        flyer.opacity = 0
        withAnimation(.easeOut(duration: 0.1)) {
            flight = flyer
        }
        try? await Task.sleep(nanoseconds: 100_000_000)
        flight = nil
        resetActiveTransforms(keepHidden: true)
    }

    private func slotDestinationCenter(slotIndex: Int) -> CGPoint {
        let countAfter = min(max(slotIndex, 0), 2) + 1
        let step = slotW + 14
        let totalWidth = CGFloat(countAfter) * slotW + CGFloat(countAfter - 1) * 14
        let slots = boardFrames["slots"] ?? CGRect(
            x: 24,
            y: 420,
            width: UIScreen.main.bounds.width - 48,
            height: slotH
        )
        let startX = slots.midX - totalWidth / 2
        let x = startX + CGFloat(slotIndex) * step + slotW / 2
        return CGPoint(x: x, y: slots.midY)
    }

    private func resetActiveTransforms(keepHidden: Bool = false) {
        activeFlipDegrees = 0
        activeScale = 1
        activeOffset = .zero
        activeOpacity = keepHidden ? 0 : 1
        showActiveFace = false
        glowColor = .clear
        glowPulse = false
        slotsShake = 0
        cardFlightElevated = false
        dealFromDeck = false
        deckPulse = false
    }
}

// MARK: - Frame measuring

private struct RTBFramePreferenceKey: PreferenceKey {
    static var defaultValue: [String: CGRect] = [:]
    static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) {
        value.merge(nextValue(), uniquingKeysWith: { $1 })
    }
}

private struct RTBFrameReader: View {
    let id: String
    let coordinateSpace: String

    var body: some View {
        GeometryReader { geo in
            Color.clear.preference(
                key: RTBFramePreferenceKey.self,
                value: [id: geo.frame(in: .named(coordinateSpace))]
            )
        }
    }
}

// MARK: - Light confetti (win)

private struct RTBConfettiBurst: View {
    private let colors: [Color] = [.green, .yellow, .white, .mint, .cyan]

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30)) { timeline in
            Canvas { context, size in
                let t = timeline.date.timeIntervalSinceReferenceDate
                for i in 0 ..< 28 {
                    let seed = Double(i)
                    let x = size.width * CGFloat((sin(seed * 1.7) + 1) / 2)
                    let y = size.height * 0.15 + CGFloat((t * (40 + seed * 3)).truncatingRemainder(dividingBy: Double(size.height)))
                    let rect = CGRect(x: x, y: y, width: 6, height: 10)
                    context.fill(
                        Path(roundedRect: rect, cornerRadius: 2),
                        with: .color(colors[i % colors.count].opacity(0.85))
                    )
                }
            }
        }
        .ignoresSafeArea()
    }
}

// MARK: - Card views

private struct RTBPlayingCardView: View {
    let card: RTBCard

    var body: some View {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
            .fill(Color(white: 0.9))
            .overlay(
                VStack(spacing: 2) {
                    Text(card.rank.rawValue)
                        .font(.system(size: 28, weight: .bold, design: .rounded))
                    Text(card.suit.symbol)
                        .font(.system(size: 26, weight: .semibold))
                }
                .foregroundStyle(card.suit.isRed ? Color.red : Color.black)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(Color.black.opacity(0.12), lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.35), radius: 6, y: 3)
    }
}

private struct RTBCardBackView: View {
    let label: String?
    let showCount: Int?

    var body: some View {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
            .fill(
                LinearGradient(
                    colors: [
                        Color(red: 0.12, green: 0.22, blue: 0.48),
                        Color(red: 0.08, green: 0.14, blue: 0.32),
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.25), lineWidth: 1.5)
            )
            .overlay(
                ZStack {
                    Image(systemName: "diamond.fill")
                        .font(.system(size: 22))
                        .foregroundStyle(.white.opacity(0.18))
                        .offset(y: -10)
                    if let showCount {
                        Text("\(showCount)")
                            .font(.system(size: 22, weight: .bold, design: .rounded))
                            .foregroundStyle(.white)
                            .shadow(color: .black.opacity(0.4), radius: 2)
                    } else if let label {
                        Text(label)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.white.opacity(0.85))
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 6)
                    }
                }
            )
    }
}
