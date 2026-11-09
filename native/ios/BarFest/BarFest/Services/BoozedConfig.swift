import Foundation

enum BoozedProof: Int, CaseIterable, Identifiable, Codable {
    case eighty = 80
    case oneHundred = 100
    case oneTwenty = 120
    case oneFiftyOne = 151

    var id: Int { rawValue }
    var label: String { "\(rawValue)" }
    var shots: Int {
        switch self {
        case .eighty: return 3
        case .oneHundred: return 5
        case .oneTwenty: return 8
        case .oneFiftyOne: return 12
        }
    }

    static func from(raw: Int) -> BoozedProof? {
        BoozedProof(rawValue: raw)
    }
}

enum BoozedMath {
    static let tileCount = 25
    static let basePoints = 100

    /// Fair-odds multiplier after `k` safe reveals with `m` shots.
    static func multiplier(safeCount k: Int, shots m: Int) -> Double {
        guard k > 0 else { return 1 }
        var result = 1.0
        for i in 0 ..< k {
            result *= Double(tileCount - i) / Double(tileCount - m - i)
        }
        return result
    }

    static func points(safeCount k: Int, shots m: Int) -> Int {
        Int(floor(Double(basePoints) * multiplier(safeCount: k, shots: m)))
    }

    static func nextShotChance(safeCount k: Int, shots m: Int) -> Double {
        let remaining = tileCount - k
        guard remaining > 0 else { return 0 }
        return Double(m) / Double(remaining)
    }

    static func formatMultiplier(_ value: Double) -> String {
        String(format: "%.2f×", value)
    }

    /// Sanity checks from the Boozed spec (m = 3).
    static func assertReferenceMultipliers() {
        let m = 3
        let k1 = multiplier(safeCount: 1, shots: m)
        let k2 = multiplier(safeCount: 2, shots: m)
        let k3 = multiplier(safeCount: 3, shots: m)
        assert(abs(k1 - 25.0 / 22.0) < 0.0001)
        assert(abs(k2 - (25.0 / 22.0) * (24.0 / 21.0)) < 0.0001)
        assert(abs(k3 - (25.0 / 22.0) * (24.0 / 21.0) * (23.0 / 20.0)) < 0.0001)
    }
}

enum BoozedItems {
    static let safes: [String] = [
        "Water", "Pretzels", "Seltzer", "Nachos", "Lime wedge", "Fries", "Light beer",
        "Ginger ale", "Wings", "Club soda", "Orange juice", "Popcorn", "Cola", "Slider",
        "Pickle spear", "Peanuts", "Iced tea", "Tater tots", "Mozz sticks", "Cranberry",
        "Tonic", "Chips + salsa", "Soft pretzel", "Mocktail", "Garlic bread",
    ]

    static let shots: [String] = [
        "Everclear", "Bacardi 151", "Absinthe", "Fireball", "Rumple Minze", "Malort",
        "Jager shot", "Cheap tequila", "Moonshine", "Goldschlager", "Sambuca", "Overproof rum",
    ]
}
