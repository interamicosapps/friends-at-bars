import Foundation

enum AppConfig {
    static var supabaseURL: String {
        let fromPlist = Bundle.main.object(forInfoDictionaryKey: "VITE_SUPABASE_URL") as? String
        if let fromPlist, !fromPlist.isEmpty, !fromPlist.contains("$(") {
            return fromPlist
        }
        return ProcessInfo.processInfo.environment["VITE_SUPABASE_URL"]
            ?? "https://YOUR_PROJECT.supabase.co"
    }

    static var supabaseAnonKey: String {
        let fromPlist =
            Bundle.main.object(forInfoDictionaryKey: "VITE_SUPABASE_PUBLISHABLE_KEY") as? String
        if let fromPlist, !fromPlist.isEmpty, !fromPlist.contains("$(") {
            return fromPlist
        }
        return ProcessInfo.processInfo.environment["VITE_SUPABASE_PUBLISHABLE_KEY"]
            ?? "YOUR_PUBLISHABLE_KEY"
    }

    /// Tight presence used only as legacy fallback when footprint is missing.
    static let venueRadiusMeters: Double = 100
    /// Larger OS geofence / approach radius — wakes the app before the footprint.
    static let venueApproachRadiusMeters: Double = 400
    /// Outside this distance from footprint edge, sticky exit countdown starts.
    /// (Presence itself is polygon containment; buffer is for sticky / wait prompt.)
    static let venueExitRadiusMeters: Double = 15
    /// Clearly gone: clear sticky / deactivate immediately (no exit wait).
    static let venueHardClearRadiusMeters: Double = 15
    /// Half-side of default footprint square seeded from center (NW/NE/SE/SW).
    static let venueFootprintDefaultHalfMeters: Double = 10
    /// Consecutive inside-footprint fixes required before first upsert (dwell).
    static let presenceDwellFixCount: Int = 2
    /// Seconds continuously outside the footprint (but still in sticky buffer)
    /// before clearing sticky / wait eligibility.
    static let presenceExitConfirmSeconds: TimeInterval = 20
    /// Continuous seconds inside footprint ∪ sticky buffer before wait-time prompt.
    static let waitPromptProximitySeconds: TimeInterval = 20
    /// Ignore a GPS sample for exit decisions when horizontalAccuracy is worse than this.
    static let presenceMaxAccuracyForExitMeters: Double = 200

    static let maxChatChars = 150

    /// How often we re-upsert `live_locations` while staying at the same bar.
    static let liveLocationHeartbeatMs: Int = 15 * 60 * 1000 // 15 minutes
    /// Rows older than this are excluded from headcounts (heartbeat + grace).
    static let liveLocationCountMaxAgeSeconds: Int = 18 * 60 // 18 minutes
    /// Matches chat RPC freshness window (`create_chat_post`).
    static let liveLocationChatFreshnessSeconds: Int = liveLocationCountMaxAgeSeconds
    /// While Using visits older than this drop off the quieter "N recent" Activities line.
    static let recentWhileUsingWindowSeconds: Int = 25 * 60 // 25 minutes

    /// Reports inside this window count toward the "N reports" threshold.
    static let waitTimeCountingWindowSeconds: Int = 20 * 60
    /// Longest influence window (45+ bucket) used when fetching reports.
    static let waitTimeMaxInfluenceSeconds: Int = 45 * 60
}
