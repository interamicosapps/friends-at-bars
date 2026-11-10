import Foundation

/// Bucketed Switch Search word library (matches web `wordLibrary.json`).
struct WordLibrary: Codable, Equatable {
    var fourLetter: [String]
    var fiveLetter: [String]
    var sixLetter: [String]
    var sevenLetter: [String]

    var isEmpty: Bool {
        fourLetter.isEmpty && fiveLetter.isEmpty && sixLetter.isEmpty && sevenLetter.isEmpty
    }

    var allWords: [String] {
        fourLetter + fiveLetter + sixLetter + sevenLetter
    }

    static let empty = WordLibrary(
        fourLetter: [],
        fiveLetter: [],
        sixLetter: [],
        sevenLetter: []
    )

    /// Tiny offline fallback if CMS and the bundled resource are both unavailable.
    static let minimalFallback = WordLibrary(
        fourLetter: ["bar", "fest", "beer", "shot"],
        fiveLetter: ["drink", "party", "happy"],
        sixLetter: ["campus", "friday"],
        sevenLetter: ["weekend", "special"]
    )

    enum CodingKeys: String, CodingKey {
        case fourLetter, fiveLetter, sixLetter, sevenLetter
        case words
    }

    init(
        fourLetter: [String],
        fiveLetter: [String],
        sixLetter: [String],
        sevenLetter: [String]
    ) {
        self.fourLetter = fourLetter
        self.fiveLetter = fiveLetter
        self.sixLetter = sixLetter
        self.sevenLetter = sevenLetter
    }

    init(from decoder: Decoder) throws {
        // Bare JSON array → bucket by length.
        if var unkeyed = try? decoder.unkeyedContainer() {
            var words: [String] = []
            while !unkeyed.isAtEnd {
                words.append(try unkeyed.decode(String.self))
            }
            self = Self.bucketByLength(words)
            return
        }

        let c = try decoder.container(keyedBy: CodingKeys.self)
        // Bucket decode only (overlay merge is handled by SwitchSearchCMSPayload).
        let four = try c.decodeIfPresent([String].self, forKey: .fourLetter) ?? []
        let five = try c.decodeIfPresent([String].self, forKey: .fiveLetter) ?? []
        let six = try c.decodeIfPresent([String].self, forKey: .sixLetter) ?? []
        let seven = try c.decodeIfPresent([String].self, forKey: .sevenLetter) ?? []
        if !four.isEmpty || !five.isEmpty || !six.isEmpty || !seven.isEmpty {
            fourLetter = four
            fiveLetter = five
            sixLetter = six
            sevenLetter = seven
            return
        }
        // Legacy flat `{ "words": [...] }`
        if let words = try c.decodeIfPresent([String].self, forKey: .words), !words.isEmpty {
            self = Self.bucketByLength(words)
            return
        }
        fourLetter = []
        fiveLetter = []
        sixLetter = []
        sevenLetter = []
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(fourLetter, forKey: .fourLetter)
        try c.encode(fiveLetter, forKey: .fiveLetter)
        try c.encode(sixLetter, forKey: .sixLetter)
        try c.encode(sevenLetter, forKey: .sevenLetter)
    }

    static func loadBundled() -> WordLibrary {
        if let url = Bundle.main.url(forResource: "wordLibrary", withExtension: "json"),
           let data = try? Data(contentsOf: url),
           let lib = try? JSONDecoder().decode(WordLibrary.self, from: data),
           !lib.isEmpty {
            return lib
        }
        return .minimalFallback
    }

    /// Build from raw CMS / file bytes (legacy full pack or bare buckets). Prefer `SwitchSearchCMSPayload.resolved`.
    static func fromCMSPayload(_ data: Data) -> WordLibrary? {
        if let payload = try? JSONDecoder().decode(SwitchSearchCMSPayload.self, from: data) {
            let resolved = payload.resolved(base: .loadBundled())
            return resolved.isEmpty ? nil : resolved
        }
        guard let lib = try? JSONDecoder().decode(WordLibrary.self, from: data), !lib.isEmpty else {
            return nil
        }
        return lib
    }

    func merging(extras: WordLibrary, bans: Set<String>) -> WordLibrary {
        WordLibrary(
            fourLetter: Self.mergeBucket(fourLetter, extras.fourLetter, bans: bans),
            fiveLetter: Self.mergeBucket(fiveLetter, extras.fiveLetter, bans: bans),
            sixLetter: Self.mergeBucket(sixLetter, extras.sixLetter, bans: bans),
            sevenLetter: Self.mergeBucket(sevenLetter, extras.sevenLetter, bans: bans)
        )
    }

    private static func mergeBucket(_ base: [String], _ extras: [String], bans: Set<String>) -> [String] {
        var seen = Set<String>()
        var out: [String] = []
        for raw in base + extras {
            guard let w = normalizeWord(raw), !bans.contains(w), !seen.contains(w) else { continue }
            seen.insert(w)
            out.append(w)
        }
        return out
    }

    fileprivate static func normalizeWord(_ raw: String) -> String? {
        let w = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard w.count >= 4, w.count <= 7, w.unicodeScalars.allSatisfy({ CharacterSet.lowercaseLetters.contains($0) }) else {
            return nil
        }
        return w
    }

    fileprivate static func bucketByLength(_ words: [String]) -> WordLibrary {
        let cleaned = words.compactMap(normalizeWord)
        return WordLibrary(
            fourLetter: cleaned.filter { $0.count == 4 },
            fiveLetter: cleaned.filter { $0.count == 5 },
            sixLetter: cleaned.filter { $0.count == 6 },
            sevenLetter: cleaned.filter { $0.count == 7 }
        )
    }
}

/// CMS payload for Switch Search (`catalog_game_content.payload`).
struct SwitchSearchCMSPayload: Codable, Equatable {
    var schema: Int?
    var extras: WordLibrary?
    var bans: [String]?
    var fourLetter: [String]?
    var fiveLetter: [String]?
    var sixLetter: [String]?
    var sevenLetter: [String]?
    var words: [String]?

    var isOverlay: Bool {
        schema == 2 || extras != nil || bans != nil
    }

    func resolved(base: WordLibrary = .loadBundled()) -> WordLibrary {
        if isOverlay {
            let banSet = Set((bans ?? []).compactMap(WordLibrary.normalizeWord))
            return base.merging(extras: extras ?? .empty, bans: banSet)
        }
        let legacy = WordLibrary(
            fourLetter: fourLetter ?? [],
            fiveLetter: fiveLetter ?? [],
            sixLetter: sixLetter ?? [],
            sevenLetter: sevenLetter ?? []
        )
        if !legacy.isEmpty { return legacy }
        if let words, !words.isEmpty {
            return WordLibrary.bucketByLength(words)
        }
        return base
    }
}

/// CMS game hub row (`catalog_games`).
struct CatalogGame: Codable, Equatable, Identifiable {
    var id: String { gameKey }
    let gameKey: String
    let title: String
    let sortOrder: Int
    let enabledInTest: Bool
    let enabledInProduction: Bool
    let hasDetails: Bool

    enum CodingKeys: String, CodingKey {
        case gameKey = "game_key"
        case title
        case sortOrder = "sort_order"
        case enabledInTest = "enabled_in_test"
        case enabledInProduction = "enabled_in_production"
        case hasDetails = "has_details"
    }
}
