import SwiftUI

struct GamesHubView: View {
    @ObservedObject private var testMode = TestModeStore.shared
    @State private var showSwitchSearch = false
    @State private var showRideTheBus = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    GameHubCard(
                        title: "Switch Search",
                        imageName: "SwitchSearchCardIcon"
                    ) {
                        showSwitchSearch = true
                    }

                    GameHubCard(
                        title: "Ride The Bus beta",
                        imageName: nil
                    ) {
                        showRideTheBus = true
                    }

                    if testMode.uiEnabled {
                        NavigationLink {
                            Text("Mega Toe — placeholder board. Port full rules from React in a follow-up.")
                                .padding()
                        } label: {
                            GameHubCardLabel(
                                title: "Megatoe",
                                imageName: nil
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .background(Color.black.ignoresSafeArea())
            .navigationTitle("Games")
            .toolbarBackground(Color.black, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .fullScreenCover(isPresented: $showSwitchSearch) {
                SwitchSearchView()
            }
            .fullScreenCover(isPresented: $showRideTheBus) {
                RideTheBusView()
            }
        }
    }
}

/// Tappable game card — full black body, optional preview image, white title at bottom.
private struct GameHubCard: View {
    let title: String
    let imageName: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            GameHubCardLabel(title: title, imageName: imageName)
        }
        .buttonStyle(.plain)
    }
}

private struct GameHubCardLabel: View {
    let title: String
    let imageName: String?

    private let cornerRadius: CGFloat = 22

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                Color.black
                if let imageName {
                    Image(imageName)
                        .resizable()
                        .scaledToFill()
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 280)
            .clipped()

            Text(title)
                .font(.title3.bold())
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .padding(.horizontal, 12)
                .background(Color.black)
        }
        .background(Color.black)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .strokeBorder(Color.white.opacity(0.18), lineWidth: 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }
}
