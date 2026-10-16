import Foundation

struct VenueRecord: Codable {
    let name: String
    let area: String
    /// Center pin [lat, lon] — map marker + multi-venue tie-break.
    let coordinates: [Double]
    /// NW → NE → SE → SW corners; empty means seed from center.
    let footprint: [VenueFootprintCorner]

    var centerLatitude: Double { coordinates.count >= 2 ? coordinates[0] : 0 }
    var centerLongitude: Double { coordinates.count >= 2 ? coordinates[1] : 0 }

    var resolvedCorners: [VenueFootprintCorner] {
        VenueFootprintGeometry.resolveCorners(
            footprint: footprint.isEmpty ? nil : footprint,
            centerLat: centerLatitude,
            centerLng: centerLongitude
        )
    }

    init(
        name: String,
        area: String,
        coordinates: [Double],
        footprint: [VenueFootprintCorner] = []
    ) {
        self.name = name
        self.area = area
        self.coordinates = coordinates
        self.footprint = footprint
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decode(String.self, forKey: .name)
        area = try c.decode(String.self, forKey: .area)
        coordinates = try c.decode([Double].self, forKey: .coordinates)
        footprint = (try? c.decode([VenueFootprintCorner].self, forKey: .footprint)) ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case name, area, coordinates, footprint
    }
}

struct LiveLocationPayload: Encodable {
    let user_id: String
    let venue_name: String
    let latitude: Double
    let longitude: Double
    let is_active: Bool
    let last_updated: String
}

struct DeactivatePayload: Encodable {
    let is_active: Bool
    let last_updated: String
}

struct PresenceVisitPayload: Encodable {
    let user_id: String
    let venue_name: String
    let mode: String
    let last_seen_at: String
}
