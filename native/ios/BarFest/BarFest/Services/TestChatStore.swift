import Foundation
import Combine

/// Local Test Mode chat feed (web `testChatService` parity).
@MainActor
final class TestChatStore: ObservableObject {
    static let shared = TestChatStore()
    static nonisolated let otherAuthorId = "test_chat_other"

    enum Sender: String, CaseIterable, Identifiable {
        case user
        case other
        var id: String { rawValue }
        var label: String { self == .user ? "You" : "Other user" }
    }

    @Published private(set) var posts: [ChatPost] = []
    @Published var sender: Sender = .user
    @Published var simulatedVenueName: String = "Test Location 1"

    private var votes: [String: Int] = [:]
    /// Cosmetic Recent order. Ids missing from this list stay at the top, newest first.
    private var recentOrder: [UUID] = []
    /// Trash, report, and swipe-delete. Score hides stay revealable in select mode.
    private var removedIds: Set<UUID> = []
    private let postsKey = "barfest_test_chat_posts"
    private let votesKey = "barfest_test_chat_votes"
    private let orderKey = "barfest_test_chat_recent_order"
    private let removedKey = "barfest_test_chat_removed_ids"

    private init() {
        load()
    }

    func feed(sort: String, includeHidden: Bool = false) -> [ChatPost] {
        let active = posts.filter { post in
            guard post.parent_id == nil else { return false }
            guard expiryOk(post) else { return false }
            if removedIds.contains(post.id) { return false }
            if post.is_hidden && !includeHidden { return false }
            return true
        }
        if sort == "popular" {
            return active.sorted {
                if $0.score != $1.score { return $0.score > $1.score }
                return $0.created_at > $1.created_at
            }
        }
        return orderedRecent(active)
    }

    func createPost(
        body: String,
        avatar: ChatAvatarSelection,
        venueName: String?,
        geographyId: UUID
    ) throws {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw ChatLocalError.message("Message cannot be empty") }
        guard trimmed.count <= AppConfig.maxChatChars else {
            throw ChatLocalError.message("150 Character Limit")
        }
        let author =
            sender == .other
            ? Self.otherAuthorId
            : AnonymousIdentity.userId()
        let venue = venueName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let now = ISO8601DateFormatter().string(from: Date())
        let expires = ISO8601DateFormatter().string(
            from: Date().addingTimeInterval(24 * 60 * 60)
        )
        let post = ChatPost(
            id: UUID(),
            author_id: author,
            body: trimmed,
            venue_name: venue,
            geography_id: geographyId,
            score: 0,
            is_hidden: false,
            created_at: now,
            expires_at: expires,
            my_vote: nil,
            avatar_icon: avatar.icon.rawValue,
            avatar_color: avatar.color.rawValue,
            parent_id: nil,
            reply_count: 0
        )
        posts.insert(post, at: 0)
        persist()
    }

    func createReply(parentId: UUID, body: String, avatar: ChatAvatarSelection) throws {
        guard let parent = posts.first(where: { $0.id == parentId && $0.parent_id == nil }) else {
            throw ChatLocalError.message("Chat not found")
        }
        guard !parent.is_hidden, !removedIds.contains(parentId), expiryOk(parent) else {
            throw ChatLocalError.message("Chat is no longer available")
        }
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw ChatLocalError.message("Message cannot be empty") }
        guard trimmed.count <= AppConfig.maxChatChars else {
            throw ChatLocalError.message("150 Character Limit")
        }
        let author = sender == .other ? Self.otherAuthorId : AnonymousIdentity.userId()
        let now = ISO8601DateFormatter().string(from: Date())
        let reply = ChatPost(
            id: UUID(),
            author_id: author,
            body: trimmed,
            venue_name: parent.venue_name,
            geography_id: parent.geography_id,
            score: 0,
            is_hidden: false,
            created_at: now,
            expires_at: parent.expires_at,
            my_vote: nil,
            avatar_icon: avatar.icon.rawValue,
            avatar_color: avatar.color.rawValue,
            parent_id: parentId,
            reply_count: 0
        )
        posts.insert(reply, at: 0)
        refreshReplyCount(parentId)
        persist()
    }

    func replies(parentId: UUID, includeHidden: Bool = false) -> [ChatPost] {
        posts
            .filter {
                $0.parent_id == parentId
                    && !removedIds.contains($0.id)
                    && expiryOk($0)
                    && (includeHidden || !$0.is_hidden)
            }
            .sorted { $0.created_at < $1.created_at }
    }

    func parentPost(id: UUID, includeHidden: Bool = false) -> ChatPost? {
        guard let post = posts.first(where: { $0.id == id && $0.parent_id == nil }) else { return nil }
        guard !removedIds.contains(id), expiryOk(post) else { return nil }
        if post.is_hidden && !includeHidden { return nil }
        return post
    }

    func setVote(postId: UUID, direction: String) throws {
        let userId = AnonymousIdentity.userId()
        guard let idx = posts.firstIndex(where: { $0.id == postId }) else {
            throw ChatLocalError.message("Post not found")
        }
        var post = posts[idx]
        if post.author_id == userId {
            throw ChatLocalError.message("Cannot vote on your own post")
        }
        let desired = direction == "up" ? 1 : -1
        let key = postId.uuidString
        let existing = votes[key]
        var delta = 0
        if existing == desired {
            votes.removeValue(forKey: key)
            delta = -desired
        } else if existing == nil {
            votes[key] = desired
            delta = desired
        } else {
            votes[key] = desired
            delta = desired - (existing ?? 0)
        }
        post.score += delta
        if post.score <= -4 {
            post.is_hidden = true
            concealChildren(of: post.id, in: &posts)
        }
        post.my_vote = votes[key]
        if let parentId = post.parent_id {
            posts[idx] = post
            refreshReplyCount(parentId)
        } else {
            posts[idx] = post
        }
        persist()
    }

    /// Select-mode score bump. Does not set the signed-in user's vote arrow.
    /// Four or more net downvotes still soft-hide (score <= -4), and that hide sticks.
    func nudgeScore(postIds: [UUID], direction: String) {
        let delta = direction == "down" ? -1 : 1
        var next = posts
        var changed = false
        for id in postIds {
            guard !removedIds.contains(id),
                  let idx = next.firstIndex(where: { $0.id == id }),
                  expiryOk(next[idx]) else { continue }
            next[idx].score += delta
            if next[idx].score <= -4 {
                next[idx].is_hidden = true
                concealChildren(of: id, in: &next)
            }
            changed = true
        }
        guard changed else { return }
        posts = next
        for id in postIds {
            if let parentId = posts.first(where: { $0.id == id })?.parent_id {
                refreshReplyCount(parentId)
            }
        }
        persist()
    }

    /// Saves a cosmetic Recent order for the chats currently on screen.
    /// Chats not in `originalDisplayed` (other regions, or soft-hidden while the eye is off) keep their slots.
    func applyDisplayedRecentOrder(originalDisplayed: [UUID], reordered: [UUID]) {
        let displayedSet = Set(originalDisplayed)
        let canonical = orderedRecent(
            posts.filter { $0.parent_id == nil && expiryOk($0) && !removedIds.contains($0.id) }
        ).map(\.id)
        var merged: [UUID] = []
        merged.reserveCapacity(canonical.count)
        var visibleIndex = 0
        for id in canonical {
            if displayedSet.contains(id) {
                if visibleIndex < reordered.count {
                    merged.append(reordered[visibleIndex])
                    visibleIndex += 1
                }
            } else {
                merged.append(id)
            }
        }
        if visibleIndex < reordered.count {
            merged.append(contentsOf: reordered[visibleIndex...])
        }
        objectWillChange.send()
        recentOrder = merged
        persist()
    }

    func hide(postIds: [UUID]) {
        guard !postIds.isEmpty else { return }
        var next = posts
        var ids = Set(postIds)
        for id in postIds {
            for child in next where child.parent_id == id {
                ids.insert(child.id)
            }
        }
        var parentIds = Set<UUID>()
        for id in ids {
            removedIds.insert(id)
            votes.removeValue(forKey: id.uuidString)
            if let idx = next.firstIndex(where: { $0.id == id }) {
                if let parentId = next[idx].parent_id {
                    parentIds.insert(parentId)
                }
                next[idx].is_hidden = true
                next[idx].my_vote = nil
            }
        }
        recentOrder.removeAll { ids.contains($0) }
        posts = next
        for parentId in parentIds {
            refreshReplyCount(parentId)
        }
        persist()
    }

    func clearAll() {
        posts = []
        votes = [:]
        recentOrder = []
        removedIds = []
        persist()
    }

    private func concealChildren(of parentId: UUID, in posts: inout [ChatPost]) {
        for index in posts.indices where posts[index].parent_id == parentId {
            posts[index].is_hidden = true
        }
    }

    private func refreshReplyCount(_ parentId: UUID) {
        guard let idx = posts.firstIndex(where: { $0.id == parentId }) else { return }
        let count = posts.filter {
            $0.parent_id == parentId
                && !$0.is_hidden
                && !removedIds.contains($0.id)
                && expiryOk($0)
        }.count
        posts[idx].reply_count = count
    }

    /// Newest chats that have never been placed stay at the top. Saved ids follow in their stored order.
    private func orderedRecent(_ active: [ChatPost]) -> [ChatPost] {
        let byId = Dictionary(uniqueKeysWithValues: active.map { ($0.id, $0) })
        let known = Set(recentOrder)
        let fresh = active
            .filter { !known.contains($0.id) }
            .sorted { $0.created_at > $1.created_at }
        var result = fresh
        var seen = Set(fresh.map(\.id))
        for id in recentOrder {
            guard let post = byId[id], !seen.contains(id) else { continue }
            result.append(post)
            seen.insert(id)
        }
        return result
    }

    private func expiryOk(_ post: ChatPost) -> Bool {
        guard let d = ISO8601DateFormatter().date(from: post.expires_at)
            ?? ISO8601DateFormatter().date(from: post.expires_at.replacingOccurrences(of: "\\.\\d+", with: "", options: .regularExpression))
        else { return true }
        return d > Date()
    }

    private func load() {
        guard let data = UserDefaults.standard.data(forKey: postsKey),
              let decoded = try? JSONDecoder().decode([ChatPost].self, from: data)
        else {
            posts = []
            return
        }
        posts = decoded
        if let vdata = UserDefaults.standard.data(forKey: votesKey),
           let v = try? JSONDecoder().decode([String: Int].self, from: vdata) {
            votes = v
        }
        if let odata = UserDefaults.standard.data(forKey: orderKey),
           let ids = try? JSONDecoder().decode([UUID].self, from: odata) {
            recentOrder = ids
        }
        if UserDefaults.standard.object(forKey: removedKey) == nil {
            // Older deletes set is_hidden without crossing -4. Keep those removed.
            removedIds = Set(posts.filter { $0.is_hidden && $0.score > -4 }.map(\.id))
            persist()
        } else if let rdata = UserDefaults.standard.data(forKey: removedKey),
                  let ids = try? JSONDecoder().decode([UUID].self, from: rdata) {
            removedIds = Set(ids)
        }
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(posts) {
            UserDefaults.standard.set(data, forKey: postsKey)
        }
        if let data = try? JSONEncoder().encode(votes) {
            UserDefaults.standard.set(data, forKey: votesKey)
        }
        if let data = try? JSONEncoder().encode(recentOrder) {
            UserDefaults.standard.set(data, forKey: orderKey)
        }
        if let data = try? JSONEncoder().encode(Array(removedIds)) {
            UserDefaults.standard.set(data, forKey: removedKey)
        }
    }
}

enum ChatLocalError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        if case .message(let s) = self { return s }
        return nil
    }
}
