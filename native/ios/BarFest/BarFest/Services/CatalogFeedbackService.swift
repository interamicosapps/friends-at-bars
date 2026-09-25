import Foundation

enum CatalogFeedbackCategory: String, CaseIterable, Identifiable {
    case missingBar = "missing_bar"
    case missingDeal = "missing_deal"
    case outdatedListing = "outdated_listing"
    case closedBar = "closed_bar"
    case other = "other"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .missingBar: return "Missing bar"
        case .missingDeal: return "Missing deal"
        case .outdatedListing: return "Outdated listing"
        case .closedBar: return "Closed / remove"
        case .other: return "Other"
        }
    }
}

struct CatalogFeedbackContext: Identifiable {
    let id = UUID()
    var category: CatalogFeedbackCategory?
    var venueName: String?
    var listingId: UUID?
    var listingTitle: String?
    var sourceScreen: String
    var geographyId: UUID?
}

enum CatalogFeedbackService {
    static func submit(
        category: CatalogFeedbackCategory,
        message: String,
        context: CatalogFeedbackContext
    ) async throws {
        var params: [String: Any] = [
            "p_reporter_id": AnonymousIdentity.userId(),
            "p_category": category.rawValue,
            "p_message": message,
            "p_source_screen": context.sourceScreen,
        ]
        if let geo = context.geographyId {
            params["p_geography_id"] = geo.uuidString
        } else {
            params["p_geography_id"] = NSNull()
        }
        if let venue = context.venueName, !venue.isEmpty {
            params["p_venue_name"] = venue
        } else {
            params["p_venue_name"] = NSNull()
        }
        if let listingId = context.listingId {
            params["p_listing_id"] = listingId.uuidString
        } else {
            params["p_listing_id"] = NSNull()
        }
        if let title = context.listingTitle, !title.isEmpty {
            params["p_listing_title"] = title
        } else {
            params["p_listing_title"] = NSNull()
        }

        try await SupabaseClient.shared.rpcVoid("submit_catalog_feedback", params: params)
        await MainActor.run {
            DiagnosticLog.shared.append(
                category: "system",
                message: "catalog_feedback submitted category=\(category.rawValue) screen=\(context.sourceScreen)"
            )
        }
    }
}
