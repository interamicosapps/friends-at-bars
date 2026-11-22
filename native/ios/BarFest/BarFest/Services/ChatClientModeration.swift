import Foundation

/// Client-side chat safety helpers (rules acceptance + local hide after report).
enum ChatClientModeration {
    static let rulesKey = "barfest_chat_rules_accepted_v1"
    private static let hiddenKey = "barfest_chat_locally_hidden_v1"
    private static let hideDuration: TimeInterval = 24 * 60 * 60

    static var hasAcceptedRules: Bool {
        UserDefaults.standard.bool(forKey: rulesKey)
    }

    static func acceptRules() {
        UserDefaults.standard.set(true, forKey: rulesKey)
    }

    static func hideLocally(postId: UUID) {
        var map = loadHidden()
        map[postId.uuidString] = Date().addingTimeInterval(hideDuration).timeIntervalSince1970
        saveHidden(map)
    }

    static func isLocallyHidden(postId: UUID) -> Bool {
        pruneExpired()
        guard let expiry = loadHidden()[postId.uuidString] else { return false }
        return Date().timeIntervalSince1970 < expiry
    }

    static func filterVisible(_ posts: [ChatPost]) -> [ChatPost] {
        pruneExpired()
        return posts.filter { !isLocallyHidden(postId: $0.id) }
    }

    private static func pruneExpired() {
        let now = Date().timeIntervalSince1970
        let map = loadHidden().filter { $0.value > now }
        saveHidden(map)
    }

    private static func loadHidden() -> [String: Double] {
        (UserDefaults.standard.dictionary(forKey: hiddenKey) as? [String: Double]) ?? [:]
    }

    private static func saveHidden(_ map: [String: Double]) {
        UserDefaults.standard.set(map, forKey: hiddenKey)
    }
}
