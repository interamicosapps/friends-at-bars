import Foundation

enum WaitTimeService {
    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    /// Fetches reports still within the longest possible influence window (45+ bucket).
    static func fetchReports(geographyId: UUID) async throws -> [WaitTimeReport] {
        struct Row: Decodable {
            let venue_name: String
            let wait_minutes: Int
            let updated_at: String
            let is_mine: Bool
        }

        let rows: [Row] = try await SupabaseClient.shared.rpcJSON(
            "fetch_wait_summaries",
            params: [
                "p_geography_id": geographyId.uuidString,
                "p_viewer_id": AnonymousIdentity.userId(),
            ]
        )

        return rows.map { row in
            WaitTimeReport(
                venueName: row.venue_name,
                minutes: row.wait_minutes,
                updatedAt: isoFormatter.date(from: row.updated_at)
                    ?? ISO8601DateFormatter().date(from: row.updated_at)
                    ?? Date.distantPast,
                authorId: row.is_mine ? AnonymousIdentity.userId() : "other"
            )
        }
    }

    /// CMS mock wait bucket counts → summaries for Test Mode (no timestamps).
    static func fetchMockWaitSummaries() async throws -> [String: WaitTimeSummary] {
        struct Row: Decodable {
            let venue_name: String
            let count_5: Int
            let count_10: Int
            let count_15: Int
            let count_30: Int
            let count_45: Int
        }
        let rows: [Row] = try await SupabaseClient.shared.get(
            path: "rest/v1/mock_venue_wait",
            query: [
                URLQueryItem(
                    name: "select",
                    value: "venue_name,count_5,count_10,count_15,count_30,count_45"
                ),
            ]
        )
        var result: [String: WaitTimeSummary] = [:]
        for row in rows {
            let counts: [Int: Int] = [
                5: max(0, row.count_5),
                10: max(0, row.count_10),
                15: max(0, row.count_15),
                30: max(0, row.count_30),
                45: max(0, row.count_45),
            ].filter { $0.value > 0 }
            let summary = WaitTimeSummary.fromMockBucketCounts(counts)
            if summary.mode != .none {
                result[row.venue_name] = summary
            }
        }
        return result
    }

    static func submitReport(
        venueName: String,
        waitMinutes: Int,
        latitude: Double?,
        longitude: Double?,
        isMock: Bool
    ) async throws {
        var params: [String: Any] = [
            "p_author_id": AnonymousIdentity.userId(),
            "p_venue_name": venueName,
            "p_wait_minutes": waitMinutes,
            "p_is_mock": isMock,
        ]
        if let latitude, let longitude {
            params["p_latitude"] = latitude
            params["p_longitude"] = longitude
        } else {
            params["p_latitude"] = NSNull()
            params["p_longitude"] = NSNull()
        }

        DiagnosticLog.log(
            category: "location",
            message: "wait report submit venue=\(venueName) min=\(waitMinutes) mock=\(isMock)"
        )
        do {
            try await SupabaseClient.shared.rpcVoid("submit_venue_wait_report", params: params)
            DiagnosticLog.log(category: "location", message: "wait report submit ok venue=\(venueName)")
        } catch {
            DiagnosticLog.log(
                category: "location",
                message: "wait report submit failed: \(error.localizedDescription)",
                level: "error"
            )
            throw error
        }
    }
}
