import SwiftUI

/// One-time Chat rules acceptance before the first live post or reply.
struct ChatRulesSheet: View {
    var onAgree: () -> Void
    var onCancel: () -> Void

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("Bar Fest Chat rules")
                    .font(.title2.bold())

                Text(
                    """
                    Keep it about the night. No harassment or threats. Do not post personal \
                    information about others. No illegal activity.

                    Posts are anonymous, but reported posts are reviewed.
                    """
                )
                .font(.body)
                .foregroundStyle(.secondary)

                Link("Terms", destination: LocationPrivacyCopy.termsURL)
                    .font(.subheadline.weight(.semibold))

                Spacer()

                Button {
                    onAgree()
                } label: {
                    Text("I agree")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.accentColor)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)

                Button("Cancel", role: .cancel) {
                    onCancel()
                }
                .frame(maxWidth: .infinity)
            }
            .padding(20)
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
    }
}
