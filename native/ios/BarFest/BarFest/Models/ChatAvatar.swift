import SwiftUI

/// Nightlife-themed anonymous chat avatars (Yik Yak–style emoji on colored discs).
enum ChatAvatarIcon: String, CaseIterable, Identifiable, Codable {
    case shotGlass
    case beerBong
    case martini
    case beerPint
    case wineBottle
    case olive
    case champagne
    case party
    case disco
    case popcorn
    case cheers
    case tropicalDrink

    var id: String { rawValue }

    var emoji: String {
        switch self {
        case .shotGlass: return "🥃"
        case .beerBong: return "🍻"
        case .martini: return "🍸"
        case .beerPint: return "🍺"
        case .wineBottle: return "🍷"
        case .olive: return "🫒"
        case .champagne: return "🍾"
        case .party: return "🎉"
        case .disco: return "🪩"
        case .popcorn: return "🍿"
        case .cheers: return "🥂"
        case .tropicalDrink: return "🍹"
        }
    }

    var label: String {
        switch self {
        case .shotGlass: return "Shot glass"
        case .beerBong: return "Beer bong"
        case .martini: return "Martini"
        case .beerPint: return "Beer pint"
        case .wineBottle: return "Wine"
        case .olive: return "Olive"
        case .champagne: return "Champagne"
        case .party: return "Party"
        case .disco: return "Disco"
        case .popcorn: return "Popcorn"
        case .cheers: return "Cheers"
        case .tropicalDrink: return "Tropical drink"
        }
    }

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        // Map removed icons (beerCan, lime) and unknown values to a safe default.
        self = ChatAvatarIcon(rawValue: raw) ?? .beerPint
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

enum ChatAvatarColor: String, CaseIterable, Identifiable, Codable {
    case redMatte, redNeon
    case orangeMatte, orangeNeon
    case greenMatte, greenNeon
    case blueMatte, blueNeon
    case purpleMatte, purpleNeon

    var id: String { rawValue }

    var label: String {
        switch self {
        case .redMatte: return "Red (matte)"
        case .redNeon: return "Red (neon)"
        case .orangeMatte: return "Orange (matte)"
        case .orangeNeon: return "Orange (neon)"
        case .greenMatte: return "Green (matte)"
        case .greenNeon: return "Green (neon)"
        case .blueMatte: return "Blue (matte)"
        case .blueNeon: return "Blue (neon)"
        case .purpleMatte: return "Purple (matte)"
        case .purpleNeon: return "Purple (neon)"
        }
    }

    var swiftUIColor: Color {
        switch self {
        case .redMatte: return Color(red: 0.55, green: 0.18, blue: 0.18)
        case .redNeon: return Color(red: 1.0, green: 0.2, blue: 0.35)
        case .orangeMatte: return Color(red: 0.65, green: 0.35, blue: 0.12)
        case .orangeNeon: return Color(red: 1.0, green: 0.55, blue: 0.1)
        case .greenMatte: return Color(red: 0.2, green: 0.45, blue: 0.28)
        case .greenNeon: return Color(red: 0.2, green: 0.95, blue: 0.45)
        case .blueMatte: return Color(red: 0.18, green: 0.32, blue: 0.55)
        case .blueNeon: return Color(red: 0.25, green: 0.55, blue: 1.0)
        case .purpleMatte: return Color(red: 0.38, green: 0.22, blue: 0.5)
        case .purpleNeon: return Color(red: 0.75, green: 0.35, blue: 1.0)
        }
    }
}

struct ChatAvatarSelection: Equatable, Codable {
    var icon: ChatAvatarIcon
    var color: ChatAvatarColor

    static let `default` = ChatAvatarSelection(icon: .beerPint, color: .blueMatte)

    /// Fresh random icon + color (used for first-time assignment).
    static func random() -> ChatAvatarSelection {
        ChatAvatarSelection(
            icon: ChatAvatarIcon.allCases.randomElement() ?? .beerPint,
            color: ChatAvatarColor.allCases.randomElement() ?? .blueMatte
        )
    }
}

extension ChatPost {
    /// Avatar frozen on this message at send time, if present.
    var avatarSelection: ChatAvatarSelection? {
        guard let iconRaw = avatar_icon,
              let colorRaw = avatar_color,
              let icon = ChatAvatarIcon(rawValue: iconRaw),
              let color = ChatAvatarColor(rawValue: colorRaw)
        else { return nil }
        return ChatAvatarSelection(icon: icon, color: color)
    }
}

enum ChatAvatarResolver {
    /// Prefer the avatar frozen on the post; otherwise resolve from current preferences / hash.
    static func selection(
        for post: ChatPost,
        preference: ChatAvatarSelection?,
        otherPreference: ChatAvatarSelection? = nil
    ) -> ChatAvatarSelection {
        if let snapped = post.avatarSelection {
            return snapped
        }
        if post.is_mine, let preference {
            return preference
        }
        if post.author_key == TestChatStore.otherAuthorId, let otherPreference {
            return otherPreference
        }
        return derived(from: post.author_key)
    }

    /// Own / other-user preference when matched; otherwise a stable hash so strangers stay consistent.
    static func selection(
        forAuthorId authorId: String,
        preference: ChatAvatarSelection?,
        otherPreference: ChatAvatarSelection? = nil
    ) -> ChatAvatarSelection {
        if authorId == AnonymousIdentity.userId(), let preference {
            return preference
        }
        if authorId == TestChatStore.otherAuthorId, let otherPreference {
            return otherPreference
        }
        return derived(from: authorId)
    }

    static func derived(from authorId: String) -> ChatAvatarSelection {
        var hash: UInt64 = 5381
        for b in authorId.utf8 {
            hash = ((hash << 5) &+ hash) &+ UInt64(b)
        }
        let icons = ChatAvatarIcon.allCases
        let colors = ChatAvatarColor.allCases
        let icon = icons[Int(hash % UInt64(icons.count))]
        let color = colors[Int((hash / UInt64(icons.count)) % UInt64(colors.count))]
        return ChatAvatarSelection(icon: icon, color: color)
    }
}

struct ChatAvatarBadge: View {
    let selection: ChatAvatarSelection
    var size: CGFloat = 36

    var body: some View {
        Text(selection.icon.emoji)
            .font(.system(size: size * 0.48))
            .frame(width: size, height: size)
            .background(selection.color.swiftUIColor)
            .clipShape(Circle())
            .overlay(Circle().strokeBorder(Color.white.opacity(0.2), lineWidth: 1))
    }
}
