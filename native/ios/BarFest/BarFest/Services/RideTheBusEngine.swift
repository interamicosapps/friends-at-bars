import Foundation
import SwiftUI

// MARK: - Types (web parity: src/lib/rideTheBus)

enum RTBSuit: String, CaseIterable, Identifiable, Hashable {
    case hearts, diamonds, clubs, spades

    var id: String { rawValue }

    var isRed: Bool { self == .hearts || self == .diamonds }

    var symbol: String {
        switch self {
        case .hearts: return "♥"
        case .diamonds: return "♦"
        case .clubs: return "♣"
        case .spades: return "♠"
        }
    }

    var label: String { rawValue.capitalized }
}

enum RTBRank: String, CaseIterable, Hashable {
    case two = "2", three = "3", four = "4", five = "5", six = "6"
    case seven = "7", eight = "8", nine = "9", ten = "10"
    case jack = "J", queen = "Q", king = "K", ace = "A"

    /// Ace high: 2…10, J=11, Q=12, K=13, A=14
    var value: Int {
        switch self {
        case .ace: return 14
        case .king: return 13
        case .queen: return 12
        case .jack: return 11
        default: return Int(rawValue) ?? 0
        }
    }
}

struct RTBCard: Identifiable, Equatable, Hashable {
    let id: String
    let suit: RTBSuit
    let rank: RTBRank

    var faceLabel: String { "\(rank.rawValue)\(suit.symbol)" }
}

enum RTBGuess: Equatable {
    case color(ColorGuess)
    case compare(CompareGuess)
    case range(RangeGuess)
    case suit(RTBSuit)

    enum ColorGuess: String { case red, black }
    enum CompareGuess: String { case higher, lower }
    enum RangeGuess: String { case inside, outside }
}

enum RTBPhase: Equatable {
    case awaitingGuess
    case revealing
    case successFeedback
    /// Wrong guess — still on the round UI with short “Engine Overheated!”
    case failing
    /// Cards cleared; Red/Black shown with longer fail copy (~2s pause).
    case failInterstitial
    case dealing
}

// MARK: - Engine

@MainActor
final class RideTheBusEngine: ObservableObject {
    enum Screen: Equatable {
        case lobby
        case playing
        case won
    }

    @Published var screen: Screen = .lobby
    @Published var deck: [RTBCard] = []
    @Published var discard: [RTBCard] = []
    @Published var current: RTBCard?
    @Published var currentRevealed = false
    /// Slots 1…3 for completed rounds 0…2.
    @Published var slots: [RTBCard?] = [nil, nil, nil]
    @Published var round: Int = 0
    @Published var phase: RTBPhase = .awaitingGuess
    @Published var lastResultCorrect: Bool?
    @Published var message: String?
    /// Highlights the player’s pick; others dim while resolving.
    @Published var selectedGuess: RTBGuess?

    private var runCards: [RTBCard] = []
    private var lastDrawnRank: Int?
    private var failCycleIndex = 0

    // MARK: - Public actions

    /// Leaving the game fully resets the session deck.
    func returnToLobby() {
        resetBoard(freshDeck: true)
        screen = .lobby
        phase = .awaitingGuess
        clearMessages()
        selectedGuess = nil
        failCycleIndex = 0
    }

    /// Lobby → playing with a fresh 52-card session.
    func startGame() {
        resetBoard(freshDeck: true)
        screen = .playing
        clearMessages()
        selectedGuess = nil
        dealNextCard()
    }

    /// Win → next run keeps remaining deck / trash from this session.
    func newGameFromWin() {
        resetBoard(freshDeck: false)
        clearMessages()
        selectedGuess = nil
        screen = .playing
        dealNextCard()
    }

    func submitGuess(_ guess: RTBGuess) {
        guard screen == .playing,
              phase == .awaitingGuess,
              let card = current,
              !currentRevealed
        else { return }

        guard guessMatchesRound(guess) else { return }

        let correct = Self.isCorrect(
            guess: guess,
            round: round,
            runCards: runCards,
            current: card
        )

        selectedGuess = guess
        currentRevealed = true
        lastResultCorrect = correct
        phase = .revealing
        if correct {
            message = "Correct!"
        } else {
            message = nextFailHeadline()
        }
    }

    func advanceAfterReveal() {
        guard phase == .revealing else { return }
        if lastResultCorrect == true {
            phase = .successFeedback
        } else {
            phase = .failing
        }
    }

    func resolveSuccess() {
        guard phase == .successFeedback, let card = current else { return }

        if round == 3 {
            runCards.append(card)
            current = nil
            currentRevealed = false
            selectedGuess = nil
            phase = .awaitingGuess
            screen = .won
            message = "Congrats! You’ve Conquered The Bus!"
            return
        }

        var nextSlots = slots
        nextSlots[round] = card
        slots = nextSlots
        runCards.append(card)
        current = nil
        currentRevealed = false
        selectedGuess = nil
        round += 1
        clearMessages()
        lastResultCorrect = nil
        dealNextCard()
    }

    /// After fall animation: trash cards, show Red/Black + long fail copy (no deal yet).
    func enterFailInterstitial() {
        guard phase == .failing else { return }

        var failed: [RTBCard] = []
        for s in slots {
            if let c = s { failed.append(c) }
        }
        // Incorrect active last so trash top = most recent wrong card (face up).
        if let c = current { failed.append(c) }

        var seen = Set<String>()
        let unique = failed.filter { seen.insert($0.id).inserted }
        discard.append(contentsOf: unique)

        slots = [nil, nil, nil]
        runCards = []
        current = nil
        currentRevealed = false
        round = 0
        selectedGuess = nil
        lastDrawnRank = nil
        lastResultCorrect = false
        phase = .failInterstitial
        // Headline already set at guess time; keep it through the trash flight only.
    }

    /// Deal the next face-down card after a fail. Clears the brief fail headline (same window as Correct!).
    func finishFailInterstitialAndDeal(clearFailCopy: Bool = true) {
        guard phase == .failInterstitial else { return }
        if clearFailCopy {
            clearMessages()
        }
        lastResultCorrect = nil
        dealNextCard()
    }

    // MARK: - Draw / deck

    private func dealNextCard() {
        phase = .dealing
        currentRevealed = false
        lastResultCorrect = nil
        selectedGuess = nil

        reshuffleIfNeeded()
        guard let card = pickNextCard() else {
            deck = Self.freshShuffledDeck()
            discard = []
            guard let retry = pickNextCard() else {
                phase = .awaitingGuess
                return
            }
            applyDrawn(retry)
            return
        }
        applyDrawn(card)
    }

    private func applyDrawn(_ card: RTBCard) {
        deck.removeAll { $0.id == card.id }
        current = card
        lastDrawnRank = card.rank.value
        phase = .awaitingGuess
    }

    /// When the deck is empty, reshuffle trash back into the deck and continue.
    private func reshuffleIfNeeded() {
        guard deck.isEmpty else { return }
        if discard.isEmpty {
            deck = Self.freshShuffledDeck()
        } else {
            deck = Self.shuffle(discard)
            discard = []
        }
    }

    private func pickNextCard() -> RTBCard? {
        guard !deck.isEmpty else { return nil }

        let lastRank = lastDrawnRank
        let avoidConsecutive: (RTBCard) -> Bool = { c in
            guard let lastRank else { return true }
            return c.rank.value != lastRank
        }
        let avoidRound1: (RTBCard) -> Bool = { [runCards, round] c in
            guard round >= 1, let first = runCards.first else { return true }
            return c.rank != first.rank
        }
        let avoidRound2: (RTBCard) -> Bool = { [runCards, round] c in
            guard round >= 2, runCards.count >= 2 else { return true }
            return c.rank != runCards[0].rank && c.rank != runCards[1].rank
        }

        let tiers: [(RTBCard) -> Bool] = [
            { avoidConsecutive($0) && avoidRound1($0) && avoidRound2($0) },
            { avoidConsecutive($0) && avoidRound1($0) },
            { avoidConsecutive($0) },
            { _ in true },
        ]

        for pred in tiers {
            let pool = deck.filter(pred)
            if !pool.isEmpty {
                return pool.randomElement()
            }
        }
        return deck.first
    }

    private func resetBoard(freshDeck: Bool) {
        if freshDeck {
            deck = Self.freshShuffledDeck()
            discard = []
        }
        current = nil
        currentRevealed = false
        slots = [nil, nil, nil]
        round = 0
        runCards = []
        lastDrawnRank = nil
        lastResultCorrect = nil
        selectedGuess = nil
    }

    private func clearMessages() {
        message = nil
    }

    private func nextFailHeadline() -> String {
        let pool = RTBFailMessages.all
        let headline = pool[failCycleIndex % pool.count]
        failCycleIndex += 1
        return headline
    }

    private func guessMatchesRound(_ guess: RTBGuess) -> Bool {
        switch (round, guess) {
        case (0, .color): return true
        case (1, .compare): return true
        case (2, .range): return true
        case (3, .suit): return true
        default: return false
        }
    }

    // MARK: - Evaluate

    static func isCorrect(
        guess: RTBGuess,
        round: Int,
        runCards: [RTBCard],
        current: RTBCard
    ) -> Bool {
        switch round {
        case 0:
            guard case .color(let v) = guess else { return false }
            let red = current.suit.isRed
            return v == .red ? red : !red
        case 1:
            guard case .compare(let v) = guess, let first = runCards.first else { return false }
            let v1 = first.rank.value
            let v2 = current.rank.value
            if v2 == v1 { return false }
            return v == .higher ? v2 > v1 : v2 < v1
        case 2:
            guard case .range(let v) = guess,
                  runCards.count >= 2
            else { return false }
            let v3 = current.rank.value
            let a = runCards[0].rank.value
            let b = runCards[1].rank.value
            if v3 == a || v3 == b { return false }
            let lo = min(a, b)
            let hi = max(a, b)
            let inside = v3 > lo && v3 < hi
            return v == .inside ? inside : !inside
        case 3:
            guard case .suit(let s) = guess else { return false }
            return current.suit == s
        default:
            return false
        }
    }

    // MARK: - Deck helpers

    static func createDeck() -> [RTBCard] {
        var cards: [RTBCard] = []
        var n = 0
        for suit in RTBSuit.allCases {
            for rank in RTBRank.allCases {
                cards.append(RTBCard(id: "c\(n)", suit: suit, rank: rank))
                n += 1
            }
        }
        return cards
    }

    static func shuffle(_ items: [RTBCard]) -> [RTBCard] {
        var out = items
        for i in stride(from: out.count - 1, through: 1, by: -1) {
            let j = Int.random(in: 0...i)
            out.swapAt(i, j)
        }
        return out
    }

    static func freshShuffledDeck() -> [RTBCard] {
        shuffle(createDeck())
    }
}
