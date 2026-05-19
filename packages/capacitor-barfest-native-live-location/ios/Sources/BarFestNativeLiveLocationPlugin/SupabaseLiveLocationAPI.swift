import Foundation

enum SupabaseAPIError: Error {
    case invalidURL
    case httpStatus(Int, String)
}

/// PostgREST client for `live_locations` (mirrors JS upsert / deactivate).
final class SupabaseLiveLocationAPI {
    private let baseURL: URL
    private let anonKey: String
    private let session: URLSession

    init(supabaseUrl: String, anonKey: String, session: URLSession = .shared) throws {
        guard let base = URL(string: supabaseUrl.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            throw SupabaseAPIError.invalidURL
        }
        self.baseURL = base
        self.anonKey = anonKey
        self.session = session
    }

    func upsertLiveLocation(
        userId: String,
        venueName: String,
        latitude: Double,
        longitude: Double,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        guard var components = URLComponents(
            url: baseURL.appendingPathComponent("rest/v1/live_locations"),
            resolvingAgainstBaseURL: false
        ) else {
            completion(.failure(SupabaseAPIError.invalidURL))
            return
        }
        components.queryItems = [URLQueryItem(name: "on_conflict", value: "user_id")]

        guard let url = components.url else {
            completion(.failure(SupabaseAPIError.invalidURL))
            return
        }

        let iso = ISO8601DateFormatter().string(from: Date())
        let body = LiveLocationPayload(
            user_id: userId,
            venue_name: venueName,
            latitude: latitude,
            longitude: longitude,
            is_active: true,
            last_updated: iso
        )

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        applyHeaders(&request)
        // Single Prefer value — a second setValue(forHTTPHeaderField: "Prefer") overwrites the first
        // and causes plain INSERT → HTTP 409 on existing user_id.
        request.setValue(
            "return=minimal, resolution=merge-duplicates",
            forHTTPHeaderField: "Prefer"
        )

        do {
            request.httpBody = try JSONEncoder().encode(body)
        } catch {
            completion(.failure(error))
            return
        }

        run(request: request, completion: completion)
    }

    func deactivateLiveLocation(
        userId: String,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        guard var components = URLComponents(
            url: baseURL.appendingPathComponent("rest/v1/live_locations"),
            resolvingAgainstBaseURL: false
        ) else {
            completion(.failure(SupabaseAPIError.invalidURL))
            return
        }
        components.queryItems = [URLQueryItem(name: "user_id", value: "eq.\(userId)")]

        guard let url = components.url else {
            completion(.failure(SupabaseAPIError.invalidURL))
            return
        }

        let body = DeactivatePayload(
            is_active: false,
            last_updated: ISO8601DateFormatter().string(from: Date())
        )

        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        applyHeaders(&request)
        request.setValue("return=minimal", forHTTPHeaderField: "Prefer")

        do {
            request.httpBody = try JSONEncoder().encode(body)
        } catch {
            completion(.failure(error))
            return
        }

        run(request: request, completion: completion)
    }

    private func applyHeaders(_ request: inout URLRequest) {
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(anonKey)", forHTTPHeaderField: "Authorization")
    }

    private func run(request: URLRequest, completion: @escaping (Result<Void, Error>) -> Void) {
        session.dataTask(with: request) { data, response, error in
            if let error = error {
                completion(.failure(error))
                return
            }
            guard let http = response as? HTTPURLResponse else {
                completion(.failure(SupabaseAPIError.httpStatus(-1, "No HTTP response")))
                return
            }
            guard (200 ... 299).contains(http.statusCode) else {
                let body = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                completion(.failure(SupabaseAPIError.httpStatus(http.statusCode, body)))
                return
            }
            completion(.success(()))
        }.resume()
    }
}
