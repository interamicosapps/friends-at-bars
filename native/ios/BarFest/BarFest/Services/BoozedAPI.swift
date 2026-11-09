import Foundation

protocol BoozedBackend: AnyObject {
    func me(userId: String) async throws -> BoozedMeResult
    func start(userId: String, proof: BoozedProof) async throws -> BoozedStartResult
    func reveal(userId: String, roundId: String, tile: Int) async throws -> BoozedRevealResult
    func cashout(userId: String, roundId: String) async throws -> BoozedCashoutResult
}

enum BoozedAPIError: LocalizedError {
    case invalidProof
    case activeRoundExists
    case roundNotFound
    case roundNotActive
    case cashoutTooEarly
    case tileOutOfRange
    case decoding

    var errorDescription: String? {
        switch self {
        case .invalidProof: return "Invalid proof level."
        case .activeRoundExists: return "Finish your open round first."
        case .roundNotFound: return "Round not found."
        case .roundNotActive: return "That round already ended."
        case .cashoutTooEarly: return "Reveal at least one safe coaster first."
        case .tileOutOfRange: return "Invalid coaster."
        case .decoding: return UserFacingError.tryAgain
        }
    }
}

// MARK: - Supabase

final class BoozedSupabaseBackend: BoozedBackend {
    func me(userId: String) async throws -> BoozedMeResult {
        let dto: BoozedMeDTO = try await SupabaseClient.shared.rpcJSON(
            "boozed_me",
            params: ["p_user_id": userId]
        )
        return dto.toModel()
    }

    func start(userId: String, proof: BoozedProof) async throws -> BoozedStartResult {
        do {
            let dto: BoozedStartDTO = try await SupabaseClient.shared.rpcJSON(
                "boozed_start",
                params: ["p_user_id": userId, "p_proof": proof.rawValue]
            )
            guard let p = BoozedProof.from(raw: dto.proof) else { throw BoozedAPIError.invalidProof }
            return BoozedStartResult(roundId: dto.roundId, proof: p, shots: dto.shots)
        } catch {
            throw mapHTTP(error)
        }
    }

    func reveal(userId: String, roundId: String, tile: Int) async throws -> BoozedRevealResult {
        do {
            let dto: BoozedRevealDTO = try await SupabaseClient.shared.rpcJSON(
                "boozed_reveal",
                params: ["p_user_id": userId, "p_round_id": roundId, "p_tile": tile]
            )
            return dto.toModel()
        } catch {
            throw mapHTTP(error)
        }
    }

    func cashout(userId: String, roundId: String) async throws -> BoozedCashoutResult {
        do {
            let dto: BoozedCashoutDTO = try await SupabaseClient.shared.rpcJSON(
                "boozed_cashout",
                params: ["p_user_id": userId, "p_round_id": roundId]
            )
            return dto.toModel()
        } catch {
            throw mapHTTP(error)
        }
    }

    private func mapHTTP(_ error: Error) -> Error {
        guard case let SupabaseError.http(_, body) = error else { return error }
        let lower = body.lowercased()
        if lower.contains("active round exists") { return BoozedAPIError.activeRoundExists }
        if lower.contains("round not found") { return BoozedAPIError.roundNotFound }
        if lower.contains("round not active") { return BoozedAPIError.roundNotActive }
        if lower.contains("cashout requires") { return BoozedAPIError.cashoutTooEarly }
        if lower.contains("invalid proof") { return BoozedAPIError.invalidProof }
        if lower.contains("tile out of range") { return BoozedAPIError.tileOutOfRange }
        return error
    }
}

// MARK: - Local in-process server (bombs never published until round ends)

/// Mirrors SQL rules for offline / pre-migration play. Bomb map stays private to this actor.
actor BoozedLocalBackend: BoozedBackend {
    private struct Round {
        let id: String
        let userId: String
        let proof: BoozedProof
        let shots: Int
        let bombs: Set<Int>
        var items: [String] // index = tile
        var kinds: [BoozedTileKind]
        var revealed: Set<Int>
        var safeCount: Int
        var status: String // active | cashed | blown | cleared
        let createdAt: Date
    }

    private var rounds: [String: Round] = [:]
    private var profiles: [String: BoozedProfileStats] = [:]
    private let staleInterval: TimeInterval = 24 * 60 * 60

    func me(userId: String) async throws -> BoozedMeResult {
        expireStale(userId: userId)
        let profile = ensureProfile(userId)
        let active = rounds.values.first { $0.userId == userId && $0.status == "active" }
        return BoozedMeResult(profile: profile, active: active.map(publicActive))
    }

    func start(userId: String, proof: BoozedProof) async throws -> BoozedStartResult {
        expireStale(userId: userId)
        _ = ensureProfile(userId)
        if rounds.values.contains(where: { $0.userId == userId && $0.status == "active" }) {
            throw BoozedAPIError.activeRoundExists
        }
        let m = proof.shots
        var tiles = Array(0 ..< BoozedMath.tileCount)
        tiles.shuffle()
        let bombs = Set(tiles.prefix(m))
        var safes = BoozedItems.safes.shuffled()
        var shots = BoozedItems.shots.shuffled()
        var items = Array(repeating: "", count: BoozedMath.tileCount)
        var kinds = Array(repeating: BoozedTileKind.safe, count: BoozedMath.tileCount)
        var si = 0
        var sh = 0
        for t in 0 ..< BoozedMath.tileCount {
            if bombs.contains(t) {
                kinds[t] = .shot
                items[t] = shots[sh % shots.count]
                sh += 1
            } else {
                kinds[t] = .safe
                items[t] = safes[si % safes.count]
                si += 1
            }
        }
        let id = UUID().uuidString.lowercased()
        rounds[id] = Round(
            id: id,
            userId: userId,
            proof: proof,
            shots: m,
            bombs: bombs,
            items: items,
            kinds: kinds,
            revealed: [],
            safeCount: 0,
            status: "active",
            createdAt: Date()
        )
        return BoozedStartResult(roundId: id, proof: proof, shots: m)
    }

    func reveal(userId: String, roundId: String, tile: Int) async throws -> BoozedRevealResult {
        expireStale(userId: userId)
        guard tile >= 0, tile < BoozedMath.tileCount else { throw BoozedAPIError.tileOutOfRange }
        guard var round = rounds[roundId], round.userId == userId else {
            throw BoozedAPIError.roundNotFound
        }
        guard round.status == "active" else { throw BoozedAPIError.roundNotActive }

        if round.revealed.contains(tile) {
            let mult = BoozedMath.multiplier(safeCount: round.safeCount, shots: round.shots)
            return BoozedRevealResult(
                outcome: round.kinds[tile] == .shot ? .shot : .safe,
                tile: tile,
                item: round.items[tile],
                safeCount: round.safeCount,
                multiplier: mult,
                nextMultiplier: BoozedMath.multiplier(safeCount: round.safeCount + 1, shots: round.shots),
                nextShotChance: BoozedMath.nextShotChance(safeCount: round.safeCount, shots: round.shots),
                pointsIfCashout: round.safeCount >= 1 ? BoozedMath.points(safeCount: round.safeCount, shots: round.shots) : nil,
                boardCleared: false,
                points: nil,
                tabScore: nil,
                streak: nil,
                bestMultiplier: nil,
                fullBoard: nil,
                idempotent: true
            )
        }

        round.revealed.insert(tile)

        if round.bombs.contains(tile) {
            round.status = "blown"
            rounds[roundId] = round
            let profile = applyBlow(userId: userId)
            let mult = BoozedMath.multiplier(safeCount: round.safeCount, shots: round.shots)
            return BoozedRevealResult(
                outcome: .shot,
                tile: tile,
                item: round.items[tile],
                safeCount: round.safeCount,
                multiplier: mult,
                nextMultiplier: nil,
                nextShotChance: nil,
                pointsIfCashout: nil,
                boardCleared: false,
                points: 0,
                tabScore: profile.tabScore,
                streak: profile.streak,
                bestMultiplier: profile.bestMultiplier,
                fullBoard: fullBoard(round),
                idempotent: false
            )
        }

        round.safeCount += 1
        let mult = BoozedMath.multiplier(safeCount: round.safeCount, shots: round.shots)
        let safesLeft = BoozedMath.tileCount - round.shots - round.safeCount

        if safesLeft <= 0 {
            let pts = BoozedMath.points(safeCount: round.safeCount, shots: round.shots)
            round.status = "cleared"
            rounds[roundId] = round
            let profile = applyCashout(userId: userId, points: pts, multiplier: mult)
            return BoozedRevealResult(
                outcome: .safe,
                tile: tile,
                item: round.items[tile],
                safeCount: round.safeCount,
                multiplier: mult,
                nextMultiplier: nil,
                nextShotChance: nil,
                pointsIfCashout: pts,
                boardCleared: true,
                points: pts,
                tabScore: profile.tabScore,
                streak: profile.streak,
                bestMultiplier: profile.bestMultiplier,
                fullBoard: fullBoard(round),
                idempotent: false
            )
        }

        rounds[roundId] = round
        return BoozedRevealResult(
            outcome: .safe,
            tile: tile,
            item: round.items[tile],
            safeCount: round.safeCount,
            multiplier: mult,
            nextMultiplier: BoozedMath.multiplier(safeCount: round.safeCount + 1, shots: round.shots),
            nextShotChance: BoozedMath.nextShotChance(safeCount: round.safeCount, shots: round.shots),
            pointsIfCashout: BoozedMath.points(safeCount: round.safeCount, shots: round.shots),
            boardCleared: false,
            points: nil,
            tabScore: nil,
            streak: nil,
            bestMultiplier: nil,
            fullBoard: nil,
            idempotent: false
        )
    }

    func cashout(userId: String, roundId: String) async throws -> BoozedCashoutResult {
        expireStale(userId: userId)
        guard var round = rounds[roundId], round.userId == userId else {
            throw BoozedAPIError.roundNotFound
        }
        guard round.status == "active" else { throw BoozedAPIError.roundNotActive }
        guard round.safeCount >= 1 else { throw BoozedAPIError.cashoutTooEarly }

        let mult = BoozedMath.multiplier(safeCount: round.safeCount, shots: round.shots)
        let pts = BoozedMath.points(safeCount: round.safeCount, shots: round.shots)
        round.status = "cashed"
        rounds[roundId] = round
        let profile = applyCashout(userId: userId, points: pts, multiplier: mult)
        return BoozedCashoutResult(
            points: pts,
            multiplier: mult,
            tabScore: profile.tabScore,
            streak: profile.streak,
            bestMultiplier: profile.bestMultiplier,
            fullBoard: fullBoard(round)
        )
    }

    // MARK: - Helpers

    private func ensureProfile(_ userId: String) -> BoozedProfileStats {
        if let p = profiles[userId] { return p }
        let p = BoozedProfileStats.empty
        profiles[userId] = p
        return p
    }

    private func applyCashout(userId: String, points: Int, multiplier: Double) -> BoozedProfileStats {
        var p = ensureProfile(userId)
        p.tabScore += points
        p.streak += 1
        p.bestMultiplier = max(p.bestMultiplier, multiplier)
        p.roundsPlayed += 1
        profiles[userId] = p
        return p
    }

    private func applyBlow(userId: String) -> BoozedProfileStats {
        var p = ensureProfile(userId)
        p.streak = 0
        p.roundsPlayed += 1
        profiles[userId] = p
        return p
    }

    private func expireStale(userId: String) {
        let cutoff = Date().addingTimeInterval(-staleInterval)
        for (id, round) in rounds where round.userId == userId && round.status == "active" && round.createdAt < cutoff {
            var r = round
            r.status = "blown"
            rounds[id] = r
            _ = applyBlow(userId: userId)
        }
    }

    private func fullBoard(_ round: Round) -> [BoozedBoardTile] {
        (0 ..< BoozedMath.tileCount).map { t in
            BoozedBoardTile(tile: t, revealed: true, kind: round.kinds[t], item: round.items[t])
        }
    }

    private func publicActive(_ round: Round) -> BoozedActiveRound {
        let mult = BoozedMath.multiplier(safeCount: round.safeCount, shots: round.shots)
        let board = (0 ..< BoozedMath.tileCount).map { t -> BoozedBoardTile in
            if round.revealed.contains(t) {
                return BoozedBoardTile(tile: t, revealed: true, kind: round.kinds[t], item: round.items[t])
            }
            return .faceDown(t)
        }
        return BoozedActiveRound(
            roundId: round.id,
            proof: round.proof,
            shots: round.shots,
            safeCount: round.safeCount,
            multiplier: mult,
            nextMultiplier: BoozedMath.multiplier(safeCount: round.safeCount + 1, shots: round.shots),
            nextShotChance: BoozedMath.nextShotChance(safeCount: round.safeCount, shots: round.shots),
            pointsIfCashout: round.safeCount >= 1
                ? BoozedMath.points(safeCount: round.safeCount, shots: round.shots) : 0,
            board: board
        )
    }
}

/// Tries Supabase first; falls back to a shared local backend if RPCs are missing / network fails.
@MainActor
final class BoozedAPIRouter: BoozedBackend {
    static let shared = BoozedAPIRouter()

    private let remote = BoozedSupabaseBackend()
    private let local = BoozedLocalBackend()
    private(set) var usingLocalBackend = false

    func me(userId: String) async throws -> BoozedMeResult {
        do {
            let result = try await remote.me(userId: userId)
            usingLocalBackend = false
            return result
        } catch {
            usingLocalBackend = true
            return try await local.me(userId: userId)
        }
    }

    func start(userId: String, proof: BoozedProof) async throws -> BoozedStartResult {
        do {
            let result = try await remote.start(userId: userId, proof: proof)
            usingLocalBackend = false
            return result
        } catch let err as BoozedAPIError {
            throw err
        } catch {
            // Prefer local when SQL not deployed yet (404 / undefined function) or network down.
            usingLocalBackend = true
            return try await local.start(userId: userId, proof: proof)
        }
    }

    func reveal(userId: String, roundId: String, tile: Int) async throws -> BoozedRevealResult {
        if usingLocalBackend {
            return try await local.reveal(userId: userId, roundId: roundId, tile: tile)
        }
        do {
            return try await remote.reveal(userId: userId, roundId: roundId, tile: tile)
        } catch {
            // Round ids from remote won't exist locally — surface error.
            throw error
        }
    }

    func cashout(userId: String, roundId: String) async throws -> BoozedCashoutResult {
        if usingLocalBackend {
            return try await local.cashout(userId: userId, roundId: roundId)
        }
        return try await remote.cashout(userId: userId, roundId: roundId)
    }
}
