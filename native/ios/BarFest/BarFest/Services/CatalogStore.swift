import Foundation

actor CatalogStore {
    static let shared = CatalogStore()

    private(set) var venues: [CatalogVenue] = []
    private(set) var listings: [CatalogListing] = []
    private(set) var geographies: [CatalogGeography] = []
    private(set) var areas: [CatalogArea] = []
    private(set) var contentVersion: Int?
    private(set) var wordPack: [String] = []
    /// Bucketed Switch Search pack from `catalog_game_content` (nil if CMS missing/empty).
    private(set) var switchSearchLibrary: WordLibrary?

    private let cacheURL: URL = {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        return dir.appendingPathComponent("catalog_bundle.json")
    }()

    private let legacyVenueCacheURL: URL = {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        return dir.appendingPathComponent("catalog_venues.json")
    }()

    private struct CatalogCache: Codable {
        var venues: [CatalogVenue]
        var listings: [CatalogListing]
        var geographies: [CatalogGeography]
        var areas: [CatalogArea]
    }

    func refresh(includeTest: Bool = false) async throws {
        var query: [URLQueryItem] = [
            URLQueryItem(name: "is_active", value: "eq.true"),
            URLQueryItem(name: "order", value: "sort_order.asc"),
            URLQueryItem(name: "select", value: "*"),
        ]
        if !includeTest {
            query.append(URLQueryItem(name: "is_test", value: "eq.false"))
        }

        let fetched: [CatalogVenue] = try await SupabaseClient.shared.get(
            path: "rest/v1/catalog_venues",
            query: query
        )
        venues = fetched

        let listingQuery: [URLQueryItem] = [
            URLQueryItem(name: "is_active", value: "eq.true"),
            URLQueryItem(name: "order", value: "priority.desc"),
            URLQueryItem(name: "select", value: "*"),
        ]
        if let rows: [CatalogListing] = try? await SupabaseClient.shared.get(
            path: "rest/v1/catalog_listings",
            query: listingQuery
        ) {
            listings = rows
        }

        if let rows: [CatalogGeography] = try? await SupabaseClient.shared.get(
            path: "rest/v1/catalog_geographies",
            query: {
                var items = [
                    URLQueryItem(name: "is_active", value: "eq.true"),
                    URLQueryItem(name: "order", value: "sort_order.asc"),
                    URLQueryItem(name: "select", value: "*"),
                ]
                if !includeTest {
                    items.append(URLQueryItem(name: "is_test", value: "eq.false"))
                }
                return items
            }()
        ) {
            geographies = rows
        }

        if let rows: [CatalogArea] = try? await SupabaseClient.shared.get(
            path: "rest/v1/catalog_areas",
            query: [
                URLQueryItem(name: "is_active", value: "eq.true"),
                URLQueryItem(name: "order", value: "sort_order.asc"),
                URLQueryItem(name: "select", value: "*"),
            ]
        ) {
            areas = rows
        }

        try? saveCache()

        struct ConfigRow: Decodable {
            struct Value: Decodable { let version: Int? }
            let value: Value
        }
        if let config: [ConfigRow] = try? await SupabaseClient.shared.get(
            path: "rest/v1/catalog_app_config",
            query: [
                URLQueryItem(name: "key", value: "eq.content_version"),
                URLQueryItem(name: "select", value: "value"),
            ]
        ), let version = config.first?.value.version {
            contentVersion = version
        }

        await loadWordPack()
    }

    func loadCachedCatalogIfNeeded() {
        guard venues.isEmpty, listings.isEmpty, geographies.isEmpty, areas.isEmpty else { return }
        let decoder = JSONDecoder()
        if let data = try? Data(contentsOf: cacheURL),
           let bundle = try? decoder.decode(CatalogCache.self, from: data) {
            venues = bundle.venues
            listings = bundle.listings
            geographies = bundle.geographies
            areas = bundle.areas
            return
        }
        if let data = try? Data(contentsOf: legacyVenueCacheURL) {
            venues = (try? decoder.decode([CatalogVenue].self, from: data)) ?? []
        }
    }

    private func saveCache() throws {
        let bundle = CatalogCache(
            venues: venues,
            listings: listings,
            geographies: geographies,
            areas: areas
        )
        let data = try JSONEncoder().encode(bundle)
        try data.write(to: cacheURL, options: .atomic)
    }

    private func loadWordPack() async {
        struct PackRow: Decodable {
            let payload: WordLibrary
        }

        if let rows: [PackRow] = try? await SupabaseClient.shared.get(
            path: "rest/v1/catalog_game_content",
            query: [
                URLQueryItem(name: "game_key", value: "eq.switch-search"),
                URLQueryItem(name: "pack_key", value: "eq.default"),
                URLQueryItem(name: "is_active", value: "eq.true"),
                URLQueryItem(name: "select", value: "payload"),
            ]
        ), let lib = rows.first?.payload, !lib.isEmpty {
            switchSearchLibrary = lib
            wordPack = lib.allWords
        } else {
            switchSearchLibrary = nil
            wordPack = []
        }
    }
}

/// Flexible JSON box used only for config version extraction.
enum AnyDecodableBox: Decodable {
    case int(Int)
    case double(Double)
    case string(String)
    case bool(Bool)
    case object([String: AnyDecodableBox])
    case array([AnyDecodableBox])
    case null

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        if let v = try? c.decode(Int.self) { self = .int(v); return }
        if let v = try? c.decode(Double.self) { self = .double(v); return }
        if let v = try? c.decode(Bool.self) { self = .bool(v); return }
        if let v = try? c.decode(String.self) { self = .string(v); return }
        if let v = try? c.decode([String: AnyDecodableBox].self) { self = .object(v); return }
        if let v = try? c.decode([AnyDecodableBox].self) { self = .array(v); return }
        self = .null
    }

    var object: [String: AnyDecodableBox]? {
        if case .object(let o) = self { return o }
        return nil
    }

    var intValue: Int? {
        switch self {
        case .int(let i): return i
        case .double(let d): return Int(d)
        default: return nil
        }
    }
}
