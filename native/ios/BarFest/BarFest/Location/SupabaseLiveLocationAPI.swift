import Foundation

enum SupabaseAPIError: Error {
    case invalidURL
    case httpStatus(Int, String)
}

/// PostgREST RPC client for presence (v1.0.3+). Coordinates are checked server-side and never stored.
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
        rpc(
            "report_presence",
            body: [
                "p_user_id": userId,
                "p_venue_name": venueName,
                "p_latitude": latitude,
                "p_longitude": longitude,
            ],
            label: "upsert:\(venueName)",
            completion: completion
        )
    }

    /// Records a While Using App visit for the quieter "N recent" Activities count.
    func upsertPresenceVisit(
        userId: String,
        venueName: String,
        latitude: Double,
        longitude: Double,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        rpc(
            "record_presence_visit",
            body: [
                "p_user_id": userId,
                "p_venue_name": venueName,
                "p_latitude": latitude,
                "p_longitude": longitude,
            ],
            label: "visit:\(venueName)",
            completion: completion
        )
    }

    /// Drops a While Using visit out of the recent window after the user says they are not there.
    func expirePresenceVisit(
        userId: String,
        venueName: String,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        rpc(
            "expire_presence_visit",
            body: [
                "p_user_id": userId,
                "p_venue_name": venueName,
            ],
            label: "visit-expire:\(venueName)",
            completion: completion
        )
    }

    func deactivateLiveLocation(
        userId: String,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        rpc(
            "clear_presence",
            body: [
                "p_user_id": userId,
            ],
            label: "deactivate",
            completion: completion
        )
    }

    private func rpc(
        _ name: String,
        body: [String: Any],
        label: String,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        guard let url = URL(string: "rest/v1/rpc/\(name)", relativeTo: baseURL)?.absoluteURL else {
            completion(.failure(SupabaseAPIError.invalidURL))
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        applyHeaders(&request)
        request.setValue("return=minimal", forHTTPHeaderField: "Prefer")

        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        } catch {
            DiagnosticLog.log(
                category: "location",
                message: "\(label) encode failed: \(error.localizedDescription)",
                level: "error"
            )
            completion(.failure(error))
            return
        }

        run(request: request, label: label, completion: completion)
    }

    private func applyHeaders(_ request: inout URLRequest) {
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(anonKey)", forHTTPHeaderField: "Authorization")
    }

    private func run(
        request: URLRequest,
        label: String,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        session.dataTask(with: request) { data, response, error in
            if let error = error {
                DiagnosticLog.log(
                    category: "location",
                    message: "\(label) network error: \(error.localizedDescription)",
                    level: "error"
                )
                completion(.failure(error))
                return
            }
            guard let http = response as? HTTPURLResponse else {
                DiagnosticLog.log(
                    category: "location",
                    message: "\(label) no HTTP response",
                    level: "error"
                )
                completion(.failure(SupabaseAPIError.httpStatus(-1, "No HTTP response")))
                return
            }
            guard (200 ... 299).contains(http.statusCode) else {
                let body = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                let snippet = String(body.prefix(180))
                DiagnosticLog.log(
                    category: "location",
                    message: "\(label) HTTP \(http.statusCode) \(snippet)",
                    level: "error"
                )
                completion(.failure(SupabaseAPIError.httpStatus(http.statusCode, body)))
                return
            }
            completion(.success(()))
        }.resume()
    }
}
