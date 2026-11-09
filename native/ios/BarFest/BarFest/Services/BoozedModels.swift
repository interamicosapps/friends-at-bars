import Foundation

enum BoozedTileKind: String, Codable {
    case safe
    case shot
}

struct BoozedBoardTile: Identifiable, Equatable {
    var id: Int { tile }
    let tile: Int
    var revealed: Bool
    var kind: BoozedTileKind?
    var item: String?

    static func faceDown(_ tile: Int) -> BoozedBoardTile {
        BoozedBoardTile(tile: tile, revealed: false, kind: nil, item: nil)
    }
}

struct BoozedProfileStats: Equatable {
    var tabScore: Int
    var streak: Int
    var bestMultiplier: Double
    var roundsPlayed: Int

    static let empty = BoozedProfileStats(tabScore: 0, streak: 0, bestMultiplier: 1, roundsPlayed: 0)
}

struct BoozedStartResult: Equatable {
    let roundId: String
    let proof: BoozedProof
    let shots: Int
}

struct BoozedRevealResult: Equatable {
    enum Outcome: Equatable {
        case safe
        case shot
    }

    let outcome: Outcome
    let tile: Int
    let item: String
    let safeCount: Int
    let multiplier: Double
    let nextMultiplier: Double?
    let nextShotChance: Double?
    let pointsIfCashout: Int?
    let boardCleared: Bool
    let points: Int?
    let tabScore: Int?
    let streak: Int?
    let bestMultiplier: Double?
    let fullBoard: [BoozedBoardTile]?
    let idempotent: Bool
}

struct BoozedCashoutResult: Equatable {
    let points: Int
    let multiplier: Double
    let tabScore: Int
    let streak: Int
    let bestMultiplier: Double
    let fullBoard: [BoozedBoardTile]
}

struct BoozedMeResult: Equatable {
    let profile: BoozedProfileStats
    let active: BoozedActiveRound?
}

struct BoozedActiveRound: Equatable {
    let roundId: String
    let proof: BoozedProof
    let shots: Int
    let safeCount: Int
    let multiplier: Double
    let nextMultiplier: Double
    let nextShotChance: Double
    let pointsIfCashout: Int
    let board: [BoozedBoardTile]
}

// MARK: - Wire DTOs (snake/camel from PostgREST jsonb)

struct BoozedJSONTile: Decodable {
    let tile: Int
    let type: String?
    let item: String?
    let revealed: Bool?

    func toModel() -> BoozedBoardTile {
        let revealed = self.revealed ?? (type != nil)
        let kind: BoozedTileKind? = {
            guard let type else { return nil }
            return BoozedTileKind(rawValue: type)
        }()
        return BoozedBoardTile(tile: tile, revealed: revealed, kind: kind, item: item)
    }
}

struct BoozedStartDTO: Decodable {
    let roundId: String
    let proof: Int
    let shots: Int

    enum CodingKeys: String, CodingKey {
        case roundId, proof, shots
        case round_id
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let id = try c.decodeIfPresent(String.self, forKey: .roundId) {
            roundId = id
        } else {
            roundId = try c.decode(String.self, forKey: .round_id)
        }
        proof = try c.decode(Int.self, forKey: .proof)
        shots = try c.decode(Int.self, forKey: .shots)
    }
}

struct BoozedRevealDTO: Decodable {
    let result: String
    let item: String
    let tile: Int
    let k: Int
    let multiplier: Double
    let nextMultiplier: Double?
    let nextShotChance: Double?
    let pointsIfCashout: Int?
    let boardCleared: Bool?
    let points: Int?
    let tabScore: Int?
    let streak: Int?
    let bestMultiplier: Double?
    let board: [BoozedJSONTile]?
    let idempotent: Bool?

    func toModel() -> BoozedRevealResult {
        BoozedRevealResult(
            outcome: result == "shot" ? .shot : .safe,
            tile: tile,
            item: item,
            safeCount: k,
            multiplier: multiplier,
            nextMultiplier: nextMultiplier,
            nextShotChance: nextShotChance,
            pointsIfCashout: pointsIfCashout,
            boardCleared: boardCleared ?? false,
            points: points,
            tabScore: tabScore,
            streak: streak,
            bestMultiplier: bestMultiplier,
            fullBoard: board?.map { $0.toModel() },
            idempotent: idempotent ?? false
        )
    }
}

struct BoozedCashoutDTO: Decodable {
    let points: Int
    let multiplier: Double
    let tabScore: Int
    let streak: Int
    let bestMultiplier: Double
    let board: [BoozedJSONTile]

    func toModel() -> BoozedCashoutResult {
        BoozedCashoutResult(
            points: points,
            multiplier: multiplier,
            tabScore: tabScore,
            streak: streak,
            bestMultiplier: bestMultiplier,
            fullBoard: board.map { $0.toModel() }
        )
    }
}

struct BoozedMeDTO: Decodable {
    let tabScore: Int
    let streak: Int
    let bestMultiplier: Double
    let roundsPlayed: Int
    let activeRound: BoozedActiveRoundDTO?

    func toModel() -> BoozedMeResult {
        BoozedMeResult(
            profile: BoozedProfileStats(
                tabScore: tabScore,
                streak: streak,
                bestMultiplier: bestMultiplier,
                roundsPlayed: roundsPlayed
            ),
            active: activeRound?.toModel()
        )
    }
}

struct BoozedActiveRoundDTO: Decodable {
    let roundId: String
    let proof: Int
    let shots: Int
    let safeCount: Int
    let multiplier: Double
    let nextMultiplier: Double
    let nextShotChance: Double
    let pointsIfCashout: Int
    let board: [BoozedJSONTile]

    func toModel() -> BoozedActiveRound? {
        guard let proof = BoozedProof.from(raw: proof) else { return nil }
        return BoozedActiveRound(
            roundId: roundId,
            proof: proof,
            shots: shots,
            safeCount: safeCount,
            multiplier: multiplier,
            nextMultiplier: nextMultiplier,
            nextShotChance: nextShotChance,
            pointsIfCashout: pointsIfCashout,
            board: board.map { $0.toModel() }
        )
    }
}
