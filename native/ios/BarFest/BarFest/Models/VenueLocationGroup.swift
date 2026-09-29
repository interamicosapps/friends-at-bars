import Foundation

/// One Activities row / map pin. A card is a single bar, or every bar that shares an explicit CMS location group.
struct VenueLocationCard: Identifiable, Hashable {
    /// Stable id: venue id, or `geo + group` when several bars share a location.
    let id: String
    let venues: [CatalogVenue]

    var primary: CatalogVenue { venues[0] }

    var title: String {
        venues.map(\.name).joined(separator: " / ")
    }

    var area: String { primary.area }

    var isShared: Bool { venues.count > 1 }

    /// Live headcount for this location. Bars that share a polygon are one place,
    /// so each of them shows the same count recorded in live location data.
    func attendance(in counts: [String: Int]) -> Int {
        venues.reduce(0) { partial, venue in
            max(partial, counts[venue.name] ?? 0)
        }
    }
}

enum VenueLocationGrouping {
    static func key(for venue: CatalogVenue) -> String {
        let raw = venue.location_group?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if raw.isEmpty {
            return "venue:\(venue.id.uuidString)"
        }
        let geo = venue.geography_id?.uuidString ?? "none"
        return "group:\(geo):\(raw.lowercased())"
    }

    /// Groups `venues` by explicit location group. Member order is sort_order, then name.
    /// First-seen group order follows `venues`.
    static func cards(from venues: [CatalogVenue]) -> [VenueLocationCard] {
        var buckets: [String: [CatalogVenue]] = [:]
        var order: [String] = []
        for venue in venues {
            let key = key(for: venue)
            if buckets[key] == nil {
                order.append(key)
                buckets[key] = []
            }
            buckets[key]?.append(venue)
        }
        return order.compactMap { key in
            guard var members = buckets[key], !members.isEmpty else { return nil }
            members.sort { a, b in
                if a.sort_order != b.sort_order { return a.sort_order < b.sort_order }
                return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
            }
            return VenueLocationCard(id: key, venues: members)
        }
    }

    static func card(containing venue: CatalogVenue, in venues: [CatalogVenue]) -> VenueLocationCard? {
        let wanted = key(for: venue)
        return cards(from: venues).first { $0.id == wanted }
    }
}
