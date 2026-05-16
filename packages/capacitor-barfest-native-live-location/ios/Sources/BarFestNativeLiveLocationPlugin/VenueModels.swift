import Foundation

struct VenueRecord: Codable {
    let name: String
    let area: String
    let coordinates: [Double]
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
