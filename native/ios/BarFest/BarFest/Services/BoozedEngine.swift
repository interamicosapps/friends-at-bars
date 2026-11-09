import Foundation
import SwiftUI

@MainActor
final class BoozedEngine: ObservableObject {
    enum Screen {
        case lobby
        case playing
        case ended
    }

    enum EndKind {
        case cashed
        case blown
        case cleared
    }

    @Published var screen: Screen = .lobby
    @Published var proof: BoozedProof = .eighty
    @Published var board: [BoozedBoardTile] = (0 ..< BoozedMath.tileCount).map { .faceDown($0) }
    @Published var safeCount = 0
    @Published var shots = 3
    @Published var multiplier = 1.0
    @Published var nextMultiplier = BoozedMath.multiplier(safeCount: 1, shots: 3)
    @Published var nextShotChance = BoozedMath.nextShotChance(safeCount: 0, shots: 3)
    @Published var pointsIfCashout = 0
    @Published var message = ""
    @Published var profile = BoozedProfileStats.empty
    @Published var endKind: EndKind?
    @Published var lastPoints = 0
    @Published var isBusy = false
    @Published var revealInFlight = false
    @Published var errorText: String?
    @Published var usingOfflineRules = false
    @Published var flippingTile: Int?
    @Published var leaderboard: [BoozedLeaderboardEntry] = []
    @Published var leaderboardLoading = false

    private var roundId: String?
    private let api = BoozedAPIRouter.shared
    private var userId: String { AnonymousIdentity.userId() }

    func appear() {
        #if DEBUG
        BoozedMath.assertReferenceMultipliers()
        #endif
        Task { await refreshMe() }
    }

    func selectProof(_ value: BoozedProof) {
        guard screen == .lobby || screen == .ended else { return }
        proof = value
        shots = value.shots
        nextMultiplier = BoozedMath.multiplier(safeCount: 1, shots: value.shots)
        nextShotChance = BoozedMath.nextShotChance(safeCount: 0, shots: value.shots)
    }

    func startRound() {
        guard !isBusy else { return }
        isBusy = true
        errorText = nil
        Task {
            defer { isBusy = false }
            do {
                let started = try await api.start(userId: userId, proof: proof)
                usingOfflineRules = api.usingLocalBackend
                roundId = started.roundId
                shots = started.shots
                proof = started.proof
                board = (0 ..< BoozedMath.tileCount).map { .faceDown($0) }
                safeCount = 0
                multiplier = 1
                nextMultiplier = BoozedMath.multiplier(safeCount: 1, shots: shots)
                nextShotChance = BoozedMath.nextShotChance(safeCount: 0, shots: shots)
                pointsIfCashout = 0
                endKind = nil
                lastPoints = 0
                message = "Tap a coaster. Close your tab when you're ready."
                screen = .playing
            } catch {
                errorText = UserFacingError.message(for: error)
            }
        }
    }

    func tapTile(_ tile: Int) {
        guard screen == .playing, !revealInFlight, !isBusy else { return }
        guard board.indices.contains(tile), !board[tile].revealed else { return }
        guard let roundId else { return }

        revealInFlight = true
        flippingTile = tile
        // Optimistic face — unknown kind until server replies.
        board[tile].revealed = true
        board[tile].item = "…"
        message = "Flipping…"

        Task {
            defer {
                revealInFlight = false
                flippingTile = nil
            }
            do {
                let result = try await api.reveal(userId: userId, roundId: roundId, tile: tile)
                applyReveal(result)
            } catch {
                // Roll back optimistic flip
                board[tile] = .faceDown(tile)
                errorText = UserFacingError.message(for: error)
                message = "Couldn’t reveal that coaster. Try again."
            }
        }
    }

    func closeTab() {
        guard screen == .playing, safeCount >= 1, !revealInFlight, !isBusy else { return }
        guard let roundId else { return }
        isBusy = true
        Task {
            defer { isBusy = false }
            do {
                let result = try await api.cashout(userId: userId, roundId: roundId)
                applyCashout(result, kind: .cashed)
                await refreshLeaderboard()
            } catch {
                errorText = UserFacingError.message(for: error)
            }
        }
    }

    func nextRound() {
        endKind = nil
        screen = .lobby
        message = ""
        board = (0 ..< BoozedMath.tileCount).map { .faceDown($0) }
        selectProof(proof)
    }

    func refreshMe() async {
        do {
            let me = try await api.me(userId: userId)
            usingOfflineRules = api.usingLocalBackend
            profile = me.profile
            if let active = me.active {
                resume(active)
            }
        } catch {
            // Silent on lobby; local backend will kick in on start.
        }
        await refreshLeaderboard()
    }

    func refreshLeaderboard() async {
        leaderboardLoading = true
        defer { leaderboardLoading = false }
        leaderboard = await BoozedLeaderboardStore.fetchToday()
    }

    // MARK: - Private

    private func resume(_ active: BoozedActiveRound) {
        roundId = active.roundId
        proof = active.proof
        shots = active.shots
        safeCount = active.safeCount
        multiplier = active.multiplier
        nextMultiplier = active.nextMultiplier
        nextShotChance = active.nextShotChance
        pointsIfCashout = active.pointsIfCashout
        board = normalizedBoard(active.board)
        endKind = nil
        message = safeCount == 0
            ? "Welcome back — keep going or close your tab after a safe pick."
            : "Welcome back. Close your tab anytime."
        screen = .playing
    }

    private func applyReveal(_ result: BoozedRevealResult) {
        var tile = board[result.tile]
        tile.revealed = true
        tile.item = result.item
        tile.kind = result.outcome == .shot ? .shot : .safe
        board[result.tile] = tile

        safeCount = result.safeCount
        multiplier = result.multiplier
        if let n = result.nextMultiplier { nextMultiplier = n }
        if let c = result.nextShotChance { nextShotChance = c }
        if let p = result.pointsIfCashout { pointsIfCashout = p }

        if result.outcome == .shot {
            if let full = result.fullBoard {
                board = normalizedBoard(full)
            }
            if let tab = result.tabScore { profile.tabScore = tab }
            if let streak = result.streak { profile.streak = streak }
            if let best = result.bestMultiplier { profile.bestMultiplier = best }
            lastPoints = 0
            endKind = .blown
            message = "Blacked out on \(result.item). Round blown, no points."
            screen = .ended
            return
        }

        if result.boardCleared {
            if let full = result.fullBoard {
                board = normalizedBoard(full)
            }
            lastPoints = result.points ?? pointsIfCashout
            if let tab = result.tabScore { profile.tabScore = tab }
            if let streak = result.streak { profile.streak = streak }
            if let best = result.bestMultiplier { profile.bestMultiplier = best }
            endKind = .cleared
            message = "You cleared the whole bar. +\(lastPoints) pts."
            screen = .ended
            Task { await refreshLeaderboard() }
            return
        }

        message = "\(result.item). Keep going or close your tab."
    }

    private func applyCashout(_ result: BoozedCashoutResult, kind: EndKind) {
        board = normalizedBoard(result.fullBoard)
        lastPoints = result.points
        multiplier = result.multiplier
        profile.tabScore = result.tabScore
        profile.streak = result.streak
        profile.bestMultiplier = result.bestMultiplier
        endKind = kind
        message = "Tab closed at \(BoozedMath.formatMultiplier(result.multiplier)). +\(result.points) pts."
        screen = .ended
    }

    private func normalizedBoard(_ tiles: [BoozedBoardTile]) -> [BoozedBoardTile] {
        var out = (0 ..< BoozedMath.tileCount).map { BoozedBoardTile.faceDown($0) }
        for t in tiles where t.tile >= 0 && t.tile < BoozedMath.tileCount {
            out[t.tile] = t
        }
        return out
    }
}

struct BoozedLeaderboardEntry: Identifiable, Equatable {
    var id: String { "\(rank)-\(userId)" }
    let rank: Int
    let userId: String
    let scorePoints: Int
    let displayName: String
}

enum BoozedLeaderboardStore {
    static func fetchToday() async -> [BoozedLeaderboardEntry] {
        let playDate = easternPlayDateString()
        do {
            let rows: [RankedBoozedRow] = try await SupabaseClient.shared.get(
                path: "rest/v1/ranked_daily_scores",
                query: [
                    URLQueryItem(name: "select", value: "user_id,score_points,finished_at"),
                    URLQueryItem(name: "game_type", value: "eq.boozed"),
                    URLQueryItem(name: "play_date", value: "eq.\(playDate)"),
                    URLQueryItem(name: "order", value: "score_points.desc.nullslast,finished_at.asc"),
                    URLQueryItem(name: "limit", value: "50"),
                ]
            )
            return rows.enumerated().map { idx, row in
                let short = String(row.user_id.prefix(8))
                return BoozedLeaderboardEntry(
                    rank: idx + 1,
                    userId: row.user_id,
                    scorePoints: row.score_points ?? 0,
                    displayName: "Player \(short)"
                )
            }
        } catch {
            return []
        }
    }

    private static func easternPlayDateString() -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "America/New_York") ?? .current
        let comps = cal.dateComponents([.year, .month, .day], from: Date())
        let y = comps.year ?? 1970
        let m = comps.month ?? 1
        let d = comps.day ?? 1
        return String(format: "%04d-%02d-%02d", y, m, d)
    }
}

private struct RankedBoozedRow: Decodable {
    let user_id: String
    let score_points: Int?
    let finished_at: String?
}
