import Foundation

enum ChatService {
    static func fetchFeed(sort: String) async throws -> [ChatPost] {
        var query: [URLQueryItem] = [
            URLQueryItem(name: "is_hidden", value: "eq.false"),
            URLQueryItem(name: "expires_at", value: "gt.\(ISO8601DateFormatter().string(from: Date()))"),
            URLQueryItem(name: "select", value: "*"),
            URLQueryItem(name: "limit", value: "50"),
        ]
        if sort == "popular" {
            query.append(URLQueryItem(name: "order", value: "score.desc,created_at.desc"))
        } else {
            query.append(URLQueryItem(name: "order", value: "created_at.desc"))
        }
        return try await SupabaseClient.shared.get(path: "rest/v1/chat_posts", query: query)
    }

    static func createPost(
        body: String,
        geographyId: UUID,
        latitude: Double,
        longitude: Double,
        venueName: String?,
        avatarIcon: String,
        avatarColor: String
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
}

enum LiveLocationService {
    static func venueCounts(maxAgeSeconds: Int = AppConfig.liveLocationCountMaxAgeSeconds) async throws -> [String: Int] {
        struct Row: Decodable {
            let venue_name: String
            let is_active: Bool?
            let last_updated: String?
            let user_id: String?
        }
        let rows: [Row]
        do {
            rows = try await SupabaseClient.shared.get(
                path: "rest/v1/live_locations",
                query: [
                    URLQueryItem(name: "is_active", value: "eq.true"),
                    URLQueryItem(name: "select", value: "venue_name,is_active,last_updated,user_id"),
                ]
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

        let cutoff = Date().addingTimeInterval(TimeInterval(-maxAgeSeconds))
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var counts: [String: Int] = [:]
        var stale = 0
        var missingStamp = 0
        for row in rows {
            if let s = row.last_updated {
                let date = formatter.date(from: s)
                    ?? ISO8601DateFormatter().date(from: s)
                if let date, date < cutoff {
                    stale += 1
                    continue
                }
            } else {
                missingStamp += 1
            }
            counts[row.venue_name, default: 0] += 1
        }
        let totalPeople = counts.values.reduce(0, +)
        let venueCount = counts.count
        let staleDropped = stale
        let missingLastUpdated = missingStamp
        let top = counts.sorted { $0.value > $1.value }.prefix(5)
            .map { "\($0.key)=\($0.value)" }
            .joined(separator: ", ")
        await MainActor.run {
            DiagnosticLog.shared.append(
                category: "location",
                message: """
                venueCounts rawActive=\(rows.count) counted=\(totalPeople) \
                venuesWithPeople=\(venueCount) staleDropped=\(staleDropped) \
                missingLastUpdated=\(missingLastUpdated) maxAgeSec=\(maxAgeSeconds)
                """
            )
            if !top.isEmpty {
                DiagnosticLog.shared.append(
                    category: "location",
                    message: "venueCounts top: \(top)"
                )
            } else if rows.isEmpty {
                DiagnosticLog.shared.append(
                    category: "location",
                    message: "venueCounts: no active live_locations rows (nobody checked in / tracking off)"
                )
            } else {
                DiagnosticLog.shared.append(
                    category: "location",
                    message: "venueCounts: \(rows.count) active rows but all stale or uncountable — check last_updated heartbeats"
                )
            }
        }
        return counts
    }

    /// CMS-managed mock headcounts for Test Mode (`mock_venue_attendance`).
    static func mockVenueCounts() async throws -> [String: Int] {
        struct Row: Decodable {
            let venue_name: String
            let attendance: Int
        }
        let rows: [Row]
        do {
            rows = try await SupabaseClient.shared.get(
                path: "rest/v1/mock_venue_attendance",
                query: [
                    URLQueryItem(name: "select", value: "venue_name,attendance"),
                ]
            )
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
        var counts: [String: Int] = [:]
        for row in rows where row.attendance > 0 {
            counts[row.venue_name] = row.attendance
        }
        await MainActor.run {
            DiagnosticLog.shared.append(
                category: "location",
                message: "mockVenueCounts rows=\(rows.count) withPeople=\(counts.count)"
            )
        }
        return counts
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
