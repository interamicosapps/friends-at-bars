import Foundation

/// Consumer copy for failed requests. Product messages (wait-time location, local chat) stay as written.
enum UserFacingError {
    static let tryAgain = "Something went wrong. Try again."

    static func message(for error: Error) -> String {
        if error is ChatLocalError { return error.localizedDescription }
        if (error as NSError).domain == "WaitTime" { return error.localizedDescription }
        return tryAgain
    }
}

enum SupabaseError: Error, LocalizedError {
    case invalidURL
    case http(Int, String)
    case decoding(Error)

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid Supabase URL"
        case .http(let code, let body): return "HTTP \(code): \(body)"
        case .decoding(let err): return err.localizedDescription
        }
    }
}

/// Lightweight PostgREST + RPC client (no SPM dependency).
final class SupabaseClient {
    static let shared = SupabaseClient()

    private let root: String
    private let anonKey: String
    private let session: URLSession

    private init(session: URLSession = .shared) {
        self.root = AppConfig.supabaseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        self.anonKey = AppConfig.supabaseAnonKey
        self.session = session
    }

    func get<T: Decodable>(
        path: String,
        query: [URLQueryItem] = []
    ) async throws -> T {
        let data = try await request(method: "GET", path: path, query: query, bodyData: nil, prefer: nil)
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw SupabaseError.decoding(error)
        }
    }

    func post(
        path: String,
        query: [URLQueryItem] = [],
        body: Encodable,
        prefer: String? = "return=representation"
    ) async throws -> Data {
        let bodyData = try JSONEncoder().encode(AnyEncodable(body))
        return try await request(method: "POST", path: path, query: query, bodyData: bodyData, prefer: prefer)
    }

    func rpcVoid(_ name: String, params: [String: Any]) async throws {
        let json = try JSONSerialization.data(withJSONObject: params)
        _ = try await request(
            method: "POST",
            path: "rest/v1/rpc/\(name)",
            query: [],
            bodyData: json,
            prefer: nil
        )
    }

    private func request(
        method: String,
        path: String,
        query: [URLQueryItem],
        bodyData: Data?,
        prefer: String?
    ) async throws -> Data {
        let cleaned = path.hasPrefix("/") ? String(path.dropFirst()) : path
        guard var components = URLComponents(string: "\(root)/\(cleaned)") else {
            throw SupabaseError.invalidURL
        }
        if !query.isEmpty {
            components.queryItems = query
        }
        guard let url = components.url else { throw SupabaseError.invalidURL }

        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(anonKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(anonKey)", forHTTPHeaderField: "Authorization")
        if let prefer {
            req.setValue(prefer, forHTTPHeaderField: "Prefer")
        }
        req.httpBody = bodyData

        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else {
            throw SupabaseError.http(-1, "No response")
        }
        guard (200 ... 299).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw SupabaseError.http(http.statusCode, body)
        }
        return data
    }
}

private struct AnyEncodable: Encodable {
    private let encodeFunc: (Encoder) throws -> Void
    init(_ value: Encodable) {
        encodeFunc = { try value.encode(to: $0) }
    }
    func encode(to encoder: Encoder) throws {
        try encodeFunc(encoder)
    }
}
