import Foundation

struct CatalogVenue: Codable, Identifiable, Hashable {
    let id: UUID
    let name: String
    let area: String
    let geography_id: UUID?
    let latitude: Double
    let longitude: Double
    let radius_m: Int
    /// Optional NW→NE→SE→SW corners; when missing the app seeds a 10 m square.
    let footprint: [VenueFootprintCorner]?
    let is_test: Bool
    let is_active: Bool
    let sort_order: Int
    /// CMS key for bars that share a building. Empty means this bar stands alone.
    let location_group: String?
    let updated_at: String?

    init(
        id: UUID,
        name: String,
        area: String,
        geography_id: UUID?,
        latitude: Double,
        longitude: Double,
        radius_m: Int,
        footprint: [VenueFootprintCorner]?,
        is_test: Bool,
        is_active: Bool,
        sort_order: Int,
        location_group: String?,
        updated_at: String?
    ) {
        self.id = id
        self.name = name
        self.area = area
        self.geography_id = geography_id
        self.latitude = latitude
        self.longitude = longitude
        self.radius_m = radius_m
        self.footprint = footprint
        self.is_test = is_test
        self.is_active = is_active
        self.sort_order = sort_order
        self.location_group = location_group
        self.updated_at = updated_at
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        area = try c.decode(String.self, forKey: .area)
        geography_id = try c.decodeIfPresent(UUID.self, forKey: .geography_id)
        latitude = try c.decode(Double.self, forKey: .latitude)
        longitude = try c.decode(Double.self, forKey: .longitude)
        radius_m = try c.decodeIfPresent(Int.self, forKey: .radius_m) ?? 100
        footprint = try c.decodeIfPresent([VenueFootprintCorner].self, forKey: .footprint)
        is_test = try c.decodeIfPresent(Bool.self, forKey: .is_test) ?? false
        is_active = try c.decodeIfPresent(Bool.self, forKey: .is_active) ?? true
        sort_order = try c.decodeIfPresent(Int.self, forKey: .sort_order) ?? 0
        let rawGroup = try c.decodeIfPresent(String.self, forKey: .location_group)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        location_group = (rawGroup?.isEmpty == false) ? rawGroup : nil
        updated_at = try c.decodeIfPresent(String.self, forKey: .updated_at)
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, area, geography_id, latitude, longitude, radius_m
        case footprint, is_test, is_active, sort_order, location_group, updated_at
    }
}

struct CatalogGeography: Codable, Identifiable, Hashable {
    let id: UUID
    let name: String
    let latitude: Double
    let longitude: Double
    let radius_miles: Double
    let is_default: Bool
    let is_active: Bool
    let is_test: Bool
    let sort_order: Int
}

struct CatalogArea: Codable, Identifiable, Hashable {
    let id: UUID
    let geography_id: UUID
    let long_name: String
    let short_name: String
    let accent_hex: String
    let sort_order: Int
    let is_active: Bool
}

struct CatalogListing: Codable, Identifiable, Hashable {
    let id: UUID
    let venue_name: String
    let title: String
    let time_label: String
    let details: String
    let area: String
    let listing_kind: String
    let type_labels: [String]
    let days_of_week: [Int]
    let priority: Int
    let is_active: Bool
}

struct ChatPost: Codable, Identifiable, Hashable {
    let id: UUID
    let author_id: String
    let body: String
    let venue_name: String
    let geography_id: UUID?
    var score: Int
    var is_hidden: Bool
    let created_at: String
    let expires_at: String
    var my_vote: Int?
    /// Snapshot of the author's avatar at send time (stable even if they change later).
    var avatar_icon: String?
    var avatar_color: String?
}

struct CheckInRow: Codable, Hashable, Identifiable {
    let id: String
    let venue: String
    let start_time: String
    let end_time: String
    let date: String?
    let created_at: String

    enum CodingKeys: String, CodingKey {
        case rawId = "id"
        case venue, start_time, end_time, date, created_at
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let uuid = try? c.decode(UUID.self, forKey: .rawId) {
            id = uuid.uuidString
        } else if let s = try? c.decode(String.self, forKey: .rawId) {
            id = s
        } else {
            let venue = try c.decode(String.self, forKey: .venue)
            let created = try c.decode(String.self, forKey: .created_at)
            id = "\(venue)-\(created)"
            self.venue = venue
            start_time = (try? c.decode(String.self, forKey: .start_time)) ?? ""
            end_time = (try? c.decode(String.self, forKey: .end_time)) ?? ""
            date = try? c.decode(String.self, forKey: .date)
            created_at = created
            return
        }
        venue = try c.decode(String.self, forKey: .venue)
        start_time = (try? c.decode(String.self, forKey: .start_time)) ?? ""
        end_time = (try? c.decode(String.self, forKey: .end_time)) ?? ""
        date = try? c.decode(String.self, forKey: .date)
        created_at = try c.decode(String.self, forKey: .created_at)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .rawId)
        try c.encode(venue, forKey: .venue)
        try c.encode(start_time, forKey: .start_time)
        try c.encode(end_time, forKey: .end_time)
        try c.encodeIfPresent(date, forKey: .date)
        try c.encode(created_at, forKey: .created_at)
    }

    /// Short display line for Activities (matches web check-in fields).
    var displaySubtitle: String {
        let day = date?.trimmingCharacters(in: .whitespacesAndNewlines)
        let start = Self.shortClock(start_time)
        let end = Self.shortClock(end_time)
        var parts: [String] = []
        if let day, !day.isEmpty { parts.append(day) }
        if !start.isEmpty || !end.isEmpty {
            parts.append([start, end].filter { !$0.isEmpty }.joined(separator: "–"))
        }
        if parts.isEmpty { return created_at }
        return parts.joined(separator: " · ")
    }

    private static func shortClock(_ isoOrTime: String) -> String {
        let s = isoOrTime.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return "" }
        // Prefer HH:mm from ISO timestamps; fall back to raw string.
        if let d = ISO8601DateFormatter().date(from: s)
            ?? ISO8601DateFormatter().date(from: s.replacingOccurrences(of: "\\.\\d+", with: "", options: .regularExpression))
        {
            let f = DateFormatter()
            f.dateFormat = "h:mma"
            return f.string(from: d).lowercased()
        }
        if s.count >= 5, s.contains(":") {
            return String(s.prefix(5))
        }
        return s
    }
}
