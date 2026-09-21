import SwiftUI

/// Shared area filter chip — idle neutral outline; selected fills with area accent.
struct AreaFilterChip: View {
    let title: String
    let accent: Color
    let selected: Bool
    let action: () -> Void

    private static let idleStroke = Color.white.opacity(0.28)
    private static let idleText = Color.white.opacity(0.72)

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.caption.weight(.semibold))
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .foregroundStyle(selected ? Color.white : Self.idleText)
                .background(
                    Capsule()
                        .fill(selected ? accent : Color.clear)
                )
                .overlay(
                    Capsule()
                        .strokeBorder(
                            selected ? Color.clear : Self.idleStroke,
                            lineWidth: 1.5
                        )
                )
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
