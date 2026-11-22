import Foundation

enum ChatService {
    private struct ChatRPCRow: Decodable {
        let id: UUID
        let body: String
        let venue_name: String
        let geography_id: UUID?
        let score: Int
        let is_hidden: Bool
        let created_at: String
        let expires_at: String
        let avatar_icon: String?
        let avatar_color: String?
        let parent_id: UUID?
        let reply_count: Int?
        let is_mine: Bool
        let my_vote: Int?
        let author_key: String
    }

    private static func map(_ row: ChatRPCRow) -> ChatPost {
        ChatPost(
            id: row.id,
            body: row.body,
            venue_name: row.venue_name,
            geography_id: row.geography_id,
            score: row.score,
            is_hidden: row.is_hidden,
            created_at: row.created_at,
            expires_at: row.expires_at,
            is_mine: row.is_mine,
            my_vote: row.my_vote,
            author_key: row.author_key,
            avatar_icon: row.avatar_icon,
            avatar_color: row.avatar_color,
            parent_id: row.parent_id,
            reply_count: row.reply_count
        )
    }

    static func fetchFeed(sort: String) async throws -> [ChatPost] {
        let rows: [ChatRPCRow] = try await SupabaseClient.shared.rpcJSON(
            "fetch_chat_feed",
            params: [
                "p_viewer_id": AnonymousIdentity.userId(),
                "p_sort": sort,
                "p_limit": 50,
            ]
        )
        return rows.map(map)
    }

    static func fetchReplies(parentId: UUID) async throws -> [ChatPost] {
        let rows: [ChatRPCRow] = try await SupabaseClient.shared.rpcJSON(
            "fetch_chat_replies",
            params: [
                "p_viewer_id": AnonymousIdentity.userId(),
                "p_parent_id": parentId.uuidString,
            ]
        )
        return rows.map(map)
    }

    static func fetchPost(id: UUID) async throws -> ChatPost? {
        let rows: [ChatRPCRow] = try await SupabaseClient.shared.rpcJSON(
            "fetch_chat_post",
            params: [
                "p_viewer_id": AnonymousIdentity.userId(),
                "p_post_id": id.uuidString,
            ]
        )
        return rows.first.map(map)
    }

    static func createPost(
        body: String,
        geographyId: UUID,
        latitude: Double,
        longitude: Double,
        venueName: String?,
        avatarIcon: String,
        avatarColor: String,
        parentId: UUID? = nil
    ) async throws {
        let uid = String(AnonymousIdentity.userId().prefix(12))
        let venueLabel = venueName ?? ""
        DiagnosticLog.log(
            category: "location",
            message: """
            chat create_chat_post geo=\(geographyId.uuidString.prefix(8))… \
            venue=\(venueLabel.isEmpty ? "(none)" : venueLabel) userId=\(uid)…
            """
        )
        var params: [String: Any] = [
            "p_author_id": AnonymousIdentity.userId(),
            "p_body": body,
            "p_geography_id": geographyId.uuidString,
            "p_latitude": latitude,
            "p_longitude": longitude,
            "p_avatar_icon": avatarIcon,
            "p_avatar_color": avatarColor,
        ]
        if let venueName, !venueName.isEmpty {
            params["p_venue_name"] = venueName
        } else {
            params["p_venue_name"] = NSNull()
        }
        if let parentId {
            params["p_parent_id"] = parentId.uuidString
        }
        do {
            try await SupabaseClient.shared.rpcVoid("create_chat_post", params: params)
            DiagnosticLog.log(
                category: "location",
                message: "chat create_chat_post ok venue=\(venueLabel.isEmpty ? "(none)" : venueLabel)"
            )
        } catch {
            DiagnosticLog.log(
                category: "location",
                message: "chat create_chat_post failed: \(error.localizedDescription)",
                level: "error"
            )
            throw error
        }
    }

    /// direction: "up" | "down" — same direction again clears (RPC behavior).
    static func setVote(postId: UUID, direction: String) async throws {
        try await SupabaseClient.shared.rpcVoid("set_chat_vote", params: [
            "p_voter_id": AnonymousIdentity.userId(),
            "p_post_id": postId.uuidString,
            "p_direction": direction,
        ])
    }

    static func hideOwn(postId: UUID) async throws {
        try await SupabaseClient.shared.rpcVoid("hide_own_chat_post", params: [
            "p_author_id": AnonymousIdentity.userId(),
            "p_post_id": postId.uuidString,
        ])
    }

    static func report(postId: UUID, reason: String?) async throws {
        var params: [String: Any] = [
            "p_reporter_id": AnonymousIdentity.userId(),
            "p_post_id": postId.uuidString,
        ]
        if let reason {
            params["p_reason"] = reason
        } else {
            params["p_reason"] = NSNull()
        }
        try await SupabaseClient.shared.rpcVoid("report_chat_post", params: params)
    }

    static func blockAuthor(postId: UUID) async throws {
        try await SupabaseClient.shared.rpcVoid("block_author", params: [
            "p_blocker_id": AnonymousIdentity.userId(),
            "p_post_id": postId.uuidString,
        ])
    }
}

enum LiveLocationService {
    static func venueCounts(maxAgeSeconds: Int = AppConfig.liveLocationCountMaxAgeSeconds) async throws -> [String: Int] {
        struct Row: Decodable {
            let venue_name: String
            let live: Int
        }
        let rows: [Row]
        do {
            rows = try await SupabaseClient.shared.rpcJSON(
                "get_venue_counts",
                params: ["p_max_age_seconds": maxAgeSeconds]
            )
        } catch {
            await MainActor.run {
                DiagnosticLog.shared.append(
                    category: "location",
                    message: "venueCounts fetch failed: \(error.localizedDescription)",
                    level: "error"
                )
            }
            throw error
        }

        var counts: [String: Int] = [:]
        for row in rows where row.live > 0 {
            counts[row.venue_name] = row.live
        }
        let totalPeople = counts.values.reduce(0, +)
        let venueCount = counts.count
        let top = counts.sorted { $0.value > $1.value }.prefix(5)
            .map { "\($0.key)=\($0.value)" }
            .joined(separator: ", ")
        await MainActor.run {
            DiagnosticLog.shared.append(
                category: "location",
                message: """
                venueCounts rpc counted=\(totalPeople) venuesWithPeople=\(venueCount) \
                maxAgeSec=\(maxAgeSeconds)
                """
            )
            if !top.isEmpty {
                DiagnosticLog.shared.append(
                    category: "location",
                    message: "venueCounts top: \(top)"
                )
            } else {
                DiagnosticLog.shared.append(
                    category: "location",
                    message: "venueCounts: no active live_locations rows (nobody checked in / tracking off)"
                )
            }
        }
        return counts
    }

    /// Distinct While Using App visitors per bar in the recent window (not live attendance).
    static func recentWhileUsingCounts(
        windowSeconds: Int = AppConfig.recentWhileUsingWindowSeconds
    ) async throws -> [String: Int] {
        struct Row: Decodable {
            let venue_name: String
            let recent: Int
        }
        let rows: [Row]
        do {
            rows = try await SupabaseClient.shared.rpcJSON(
                "get_recent_counts",
                params: ["p_window_seconds": windowSeconds]
            )
        } catch {
            await MainActor.run {
                DiagnosticLog.shared.append(
                    category: "location",
                    message: "recentWhileUsingCounts fetch failed: \(error.localizedDescription)",
                    level: "error"
                )
            }
            throw error
        }

        var counts: [String: Int] = [:]
        for row in rows where row.recent > 0 {
            counts[row.venue_name] = row.recent
        }
        let total = counts.values.reduce(0, +)
        await MainActor.run {
            DiagnosticLog.shared.append(
                category: "location",
                message: "recentWhileUsing windowSec=\(windowSeconds) people=\(total) venues=\(counts.count)"
            )
        }
        return counts
    }

    /// CMS-managed mock headcounts for Test Mode (`mock_venue_attendance`).
    static func mockVenueCounts() async throws -> [String: Int] {
        let rows = try await mockAttendanceRows()
        var counts: [String: Int] = [:]
        for row in rows where row.attendance > 0 {
            counts[row.venue_name] = row.attendance
        }
        let withPeople = counts.count
        let rowCount = rows.count
        await MainActor.run {
            DiagnosticLog.shared.append(
                category: "location",
                message: "mockVenueCounts rows=\(rowCount) withPeople=\(withPeople)"
            )
        }
        return counts
    }

    /// CMS-managed mock "N recent" counts for Test Mode.
    static func mockRecentWhileUsingCounts() async throws -> [String: Int] {
        let rows = try await mockAttendanceRows()
        var counts: [String: Int] = [:]
        for row in rows where row.recent > 0 {
            counts[row.venue_name] = row.recent
        }
        let withPeople = counts.count
        await MainActor.run {
            DiagnosticLog.shared.append(
                category: "location",
                message: "mockRecentWhileUsingCounts venues=\(withPeople)"
            )
        }
        return counts
    }

    private struct MockAttendanceRow: Decodable {
        let venue_name: String
        let attendance: Int
        let recent: Int?

        var recentValue: Int { recent ?? 0 }
    }

    private static func mockAttendanceRows() async throws -> [(venue_name: String, attendance: Int, recent: Int)] {
        do {
            let rows: [MockAttendanceRow] = try await SupabaseClient.shared.get(
                path: "rest/v1/mock_venue_attendance",
                query: [
                    URLQueryItem(name: "select", value: "venue_name,attendance,recent"),
                ]
            )
            return rows.map { ($0.venue_name, $0.attendance, $0.recentValue) }
        } catch {
            do {
                struct Legacy: Decodable {
                    let venue_name: String
                    let attendance: Int
                }
                let rows: [Legacy] = try await SupabaseClient.shared.get(
                    path: "rest/v1/mock_venue_attendance",
                    query: [
                        URLQueryItem(name: "select", value: "venue_name,attendance"),
                    ]
                )
                await MainActor.run {
                    DiagnosticLog.shared.append(
                        category: "location",
                        message: "mock attendance: recent column missing — run mock_venue_attendance_recent.sql",
                        level: "warn"
                    )
                }
                return rows.map { ($0.venue_name, $0.attendance, 0) }
            } catch {
                await MainActor.run {
                    DiagnosticLog.shared.append(
                        category: "location",
                        message: "mockVenueCounts fetch failed: \(error.localizedDescription)",
                        level: "error"
                    )
                }
                throw error
            }
        }
    }
}

enum CheckInService {
    static func recent(limit: Int = 40) async throws -> [CheckInRow] {
        do {
            let rows: [CheckInRow] = try await SupabaseClient.shared.get(
                path: "rest/v1/checkins",
                query: [
                    URLQueryItem(name: "order", value: "created_at.desc"),
                    URLQueryItem(name: "limit", value: "\(limit)"),
                    URLQueryItem(
                        name: "select",
                        value: "id,venue,start_time,end_time,date,created_at"
                    ),
                ]
            )
            await MainActor.run {
                let sample = rows.prefix(3).map(\.venue).joined(separator: ", ")
                DiagnosticLog.shared.append(
                    category: "system",
                    message: "checkins fetch ok count=\(rows.count) sample=\(sample.isEmpty ? "(none)" : sample)"
                )
            }
            return rows
        } catch {
            await MainActor.run {
                DiagnosticLog.shared.append(
                    category: "error",
                    message: "checkins fetch failed: \(error.localizedDescription)",
                    level: "error"
                )
            }
            throw error
        }
    }
}
