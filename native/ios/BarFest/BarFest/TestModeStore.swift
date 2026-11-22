import Foundation
import Combine

/// In-app Test Mode preferences (mock data + chat location gate simulation).
@MainActor
final class TestModeStore: ObservableObject {
    static let shared = TestModeStore()

    private static let mockKey = "barfest_dev_test_mock_data"
    private static let locKey = "barfest_dev_test_simulate_location_allowed"

    /// When true, Activities/Map use mock headcounts; catalog includes test venues.
    @Published var useMockCheckIns: Bool {
        didSet { UserDefaults.standard.set(useMockCheckIns, forKey: Self.mockKey) }
    }

    /// Test Mode chat: when false, composer acts as if location is denied.
    @Published var simulateLocationAllowed: Bool {
        didSet { UserDefaults.standard.set(simulateLocationAllowed, forKey: Self.locKey) }
    }

    /// Drives the mock wait-time check-in card (session only).
    @Published var showMockWaitReport = false

    var uiEnabled: Bool { DevTestMode.isUIEnabled }

    /// Mock data is only active on the Test bundle with the chrome toggle on.
    var isMockActive: Bool { DevTestMode.isUIEnabled && useMockCheckIns }

    private init() {
        if DevTestMode.isUIEnabled {
            useMockCheckIns = UserDefaults.standard.bool(forKey: Self.mockKey)
        } else {
            useMockCheckIns = false
            UserDefaults.standard.removeObject(forKey: Self.mockKey)
        }
        if UserDefaults.standard.object(forKey: Self.locKey) == nil {
            simulateLocationAllowed = true
        } else {
            simulateLocationAllowed = UserDefaults.standard.bool(forKey: Self.locKey)
        }
    }
}
