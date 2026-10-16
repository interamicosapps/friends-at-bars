import Foundation

/// Allowed wait-time buckets (minutes). `45` displays as "45+".
enum WaitTimeBucket: Int, CaseIterable, Identifiable {
    case five = 5
    case ten = 10
    case fifteen = 15
    case thirty = 30
    case fortyFivePlus = 45

    var id: Int { rawValue }

    /// How long a report continues to influence aggregation (seconds).
    var influenceSeconds: TimeInterval {
        max(
            TimeInterval(AppConfig.waitTimeCountingWindowSeconds),
            TimeInterval(rawValue * 60)
        )
    }

    var shortLabel: String {
        rawValue == 45 ? "45+" : "\(rawValue)"
    }

    var waitPhrase: String {
        rawValue == 45 ? "45+ minute wait" : "\(rawValue) minute wait"
    }

    static func from(minutes: Int) -> WaitTimeBucket? {
        WaitTimeBucket(rawValue: minutes)
    }
}

struct WaitTimeReportRow: Decodable {
    let venue_name: String
    let wait_minutes: Int
    let updated_at: String
    let author_id: String
}

struct WaitTimeReport: Codable {
    let venueName: String
    let minutes: Int
    let updatedAt: Date
    let authorId: String

    init(row: WaitTimeReportRow, formatter: ISO8601DateFormatter) {
        venueName = row.venue_name
        minutes = row.wait_minutes
        updatedAt = formatter.date(from: row.updated_at)
            ?? ISO8601DateFormatter().date(from: row.updated_at)
            ?? Date.distantPast
        authorId = row.author_id
    }

    init(venueName: String, minutes: Int, updatedAt: Date, authorId: String? = nil) {
        self.venueName = venueName
        self.minutes = minutes
        self.updatedAt = updatedAt
        self.authorId = authorId ?? AnonymousIdentity.userId()
    }

    var isMine: Bool { authorId == AnonymousIdentity.userId() }
}

struct WaitTimeSummary: Equatable {
    enum Mode: Equatable {
        case none
        case sparse
        case consensus
    }

    let mode: Mode
    let displayMinutes: Int?
    let reportCount20m: Int
    let latestReportAt: Date?

    static let none = WaitTimeSummary(mode: .none, displayMinutes: nil, reportCount20m: 0, latestReportAt: nil)

    var displayText: String {
        switch mode {
        case .none:
            return "No Recent Wait-Time Reports"
        case .sparse, .consensus:
            guard let minutes = displayMinutes else {
                return "No Recent Wait-Time Reports"
            }
            let bucket = WaitTimeBucket.from(minutes: minutes)
            let waitLabel = bucket?.waitPhrase ?? "\(minutes) minute wait"
            if let latest = latestReportAt {
                let ago = Self.formatElapsed(since: latest)
                if mode == .consensus {
                    return "\(waitLabel) · \(reportCount20m) reports · \(ago)"
                }
                return "\(waitLabel) · \(ago)"
            }
            // CMS mock wait counts have no timestamp — omit "ago".
            if mode == .consensus {
                return "\(waitLabel) · \(reportCount20m) reports"
            }
            return waitLabel
        }
    }

    /// Build a summary from CMS mock bucket counts (no report timestamps).
    static func fromMockBucketCounts(_ counts: [Int: Int]) -> WaitTimeSummary {
        let total = counts.values.reduce(0, +)
        guard total > 0 else { return .none }
        let winning = counts.max { a, b in
            if a.value != b.value { return a.value < b.value }
            return a.key < b.key
        }!.key
        if total >= 3 {
            return WaitTimeSummary(
                mode: .consensus,
                displayMinutes: winning,
                reportCount20m: total,
                latestReportAt: nil
            )
        }
        return WaitTimeSummary(
            mode: .sparse,
            displayMinutes: winning,
            reportCount20m: total,
            latestReportAt: nil
        )
    }

    static func formatElapsed(since date: Date, now: Date = Date()) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(date)))
        if seconds < 60 { return "just now" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m ago" }
        let hours = minutes / 60
        return "\(hours)h ago"
    }
}

/// Weighted aggregation: recent reports weigh more; each report stays influential for
/// max(20 minutes, its bucket duration) so a 45+ report at 30m ago still counts.
enum WaitTimeAggregator {
    static func summarize(reports: [WaitTimeReport], now: Date = Date()) -> WaitTimeSummary {
        struct Influential {
            let minutes: Int
            let updatedAt: Date
            let weight: Double
        }

        let countingWindow = TimeInterval(AppConfig.waitTimeCountingWindowSeconds)
        var influential: [Influential] = []

        for report in reports {
            guard let bucket = WaitTimeBucket.from(minutes: report.minutes) else { continue }
            let age = now.timeIntervalSince(report.updatedAt)
            let influenceSec = bucket.influenceSeconds
            guard age <= influenceSec else { continue }
            let weight = max(0, 1 - age / influenceSec)
            influential.append(Influential(minutes: report.minutes, updatedAt: report.updatedAt, weight: weight))
        }

        guard !influential.isEmpty else { return .none }

        let reports20m = influential.filter { now.timeIntervalSince($0.updatedAt) <= countingWindow }
        let count20m = reports20m.count
        let latestOverall = influential.map(\.updatedAt).max()

        if count20m >= 3 {
            var weightByBucket: [Int: Double] = [:]
            for item in influential {
                weightByBucket[item.minutes, default: 0] += item.weight
            }
            let maxWeight = weightByBucket.values.max() ?? 0
            let topBuckets = weightByBucket.filter { abs($0.value - maxWeight) < 0.0001 }.map(\.key)
            let winningMinutes: Int
            if topBuckets.count == 1 {
                winningMinutes = topBuckets[0]
            } else {
                winningMinutes = influential
                    .filter { topBuckets.contains($0.minutes) }
                    .max(by: { $0.updatedAt < $1.updatedAt })!
                    .minutes
            }
            return WaitTimeSummary(
                mode: .consensus,
                displayMinutes: winningMinutes,
                reportCount20m: count20m,
                latestReportAt: latestOverall
            )
        }

        let latestMinutes = influential.max(by: { $0.updatedAt < $1.updatedAt })!.minutes
        return WaitTimeSummary(
            mode: .sparse,
            displayMinutes: latestMinutes,
            reportCount20m: count20m,
            latestReportAt: latestOverall
        )
    }

    static func summariesByVenue(reports: [WaitTimeReport], now: Date = Date()) -> [String: WaitTimeSummary] {
        let grouped = Dictionary(grouping: reports, by: \.venueName)
        var result: [String: WaitTimeSummary] = [:]
        for (venue, rows) in grouped {
            result[venue] = summarize(reports: rows, now: now)
        }
        return result
    }
}
