import SwiftUI

/// One-level replies under a single chat. Replies use the same vote and region rules as posts.
struct ChatThreadView: View {
    let parentId: UUID

    @EnvironmentObject private var appModel: AppModel
    @ObservedObject private var testMode = TestModeStore.shared
    @ObservedObject private var localChat = TestChatStore.shared
    @ObservedObject private var locationAuth = LocationAuthorizationStore.shared
    @ObservedObject private var avatarStore = ChatAvatarStore.shared

    @State private var parent: ChatPost?
    @State private var replies: [ChatPost] = []
    @State private var draft = ""
    @State private var error: String?
    @State private var regionWarningFlash = false
    @FocusState private var composerFocused: Bool

    private var useLocal: Bool { testMode.uiEnabled && testMode.useMockCheckIns }
    private var overCharLimit: Bool { draft.count > AppConfig.maxChatChars }

    private var canSendInViewedGeography: Bool {
        if useLocal && testMode.simulateLocationAllowed { return true }
        guard let viewed = appModel.resolvedGeography, let gps = appModel.gpsGeography else { return false }
        return viewed.id == gps.id
    }

    private var regionGateMessage: String {
        let name = appModel.resolvedGeography?.name ?? "this"
        return "Must be located within \(name) region to send chat"
    }

    var body: some View {
        VStack(spacing: 0) {
            if parent == nil {
                Spacer()
                Text("This chat is no longer available")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding()
                Spacer()
            } else {
                List {
                    if let parent {
                        threadRow(parent, isParent: true)
                    }
                    if replies.isEmpty {
                        Text("No replies yet")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .listRowBackground(Color.clear)
                    }
                    ForEach(replies) { reply in
                        threadRow(reply, isParent: false)
                    }
                }
                .listStyle(.plain)
                .scrollDismissesKeyboard(.interactively)

                if let error {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .padding(.horizontal)
                }
                composer
            }
        }
        .navigationTitle("Replies")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .task { await reload() }
        .onChange(of: localChat.posts.count) { _, _ in
            if useLocal { applyLocal() }
        }
    }

    @ViewBuilder
    private func threadRow(_ post: ChatPost, isParent: Bool) -> some View {
        let isOwn = post.author_id == AnonymousIdentity.userId()
        let avatar = ChatAvatarResolver.selection(
            for: post,
            preference: avatarStore.selection,
            otherPreference: avatarStore.otherSelection
        )
        let bodyColor: Color = isOwn ? .black : .white
        let metaColor: Color = isOwn ? Color.black.opacity(0.45) : Color.secondary

        HStack(alignment: .top, spacing: 10) {
            ChatAvatarBadge(selection: avatar, size: 36)
            VStack(alignment: .leading, spacing: 8) {
                Text(post.body)
                    .font(isParent ? .body.weight(.semibold) : .body)
                    .foregroundStyle(bodyColor)
                    .frame(maxWidth: .infinity, alignment: .leading)
                HStack {
                    let venue = post.venue_name.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !venue.isEmpty {
                        Text(venue)
                            .font(.caption)
                            .foregroundStyle(metaColor)
                    }
                    Spacer(minLength: 8)
                    RedditVotePill(
                        score: post.score,
                        myVote: post.my_vote,
                        disabled: isOwn,
                        onLightBackground: isOwn,
                        onUp: { Task { await vote(postId: post.id, direction: "up") } },
                        onDown: { Task { await vote(postId: post.id, direction: "down") } }
                    )
                }
            }
        }
        .padding(.horizontal, isOwn ? 10 : 0)
        .padding(.vertical, 8)
        .background(isOwn ? Color.white : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: isOwn ? 12 : 0, style: .continuous))
        .listRowInsets(EdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12))
        .listRowBackground(Color.clear)
        .listRowSeparator(isParent ? .visible : .automatic)
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            if isOwn {
                Button(role: .destructive) {
                    Task { await hideOwn(postId: post.id, isParent: isParent) }
                } label: {
                    Label("Delete", systemImage: "trash")
                }
            } else {
                Button {
                    Task { await report(postId: post.id) }
                } label: {
                    Label("Report", systemImage: "flag")
                }
                .tint(.orange)
            }
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            if useLocal && testMode.simulateLocationAllowed {
                HStack(spacing: 8) {
                    Text("Send as")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Picker("Sender", selection: $localChat.sender) {
                        ForEach(TestChatStore.Sender.allCases) { sender in
                            Text(sender.label).tag(sender)
                        }
                    }
                    .pickerStyle(.segmented)
                    .frame(maxWidth: 220)
                }
            }

            if !canSendInViewedGeography {
                Button {
                    flashRegionWarning()
                } label: {
                    Text(regionGateMessage)
                        .font(.system(size: 17))
                        .foregroundStyle(regionWarningFlash ? Color.red : Color.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10)
                        .background(Color(.secondarySystemBackground))
                        .clipShape(RoundedRectangle(cornerRadius: 18))
                }
                .buttonStyle(.plain)
            } else {
                HStack(alignment: .center) {
                    Spacer()
                    if overCharLimit {
                        Text("150 Character Limit")
                            .font(.caption.bold())
                            .foregroundStyle(.red)
                    }
                }
                HStack(alignment: .bottom, spacing: 8) {
                    TextField(
                        useLocal && localChat.sender == .other ? "Reply as another user…" : "Reply",
                        text: $draft,
                        axis: .vertical
                    )
                    .lineLimit(1 ... 6)
                    .font(.system(size: 17))
                    .foregroundStyle(overCharLimit ? Color.red : Color.primary)
                    .focused($composerFocused)
                    .padding(10)
                    .background(Color(.secondarySystemBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 18))

                    Button {
                        Task { await sendReply() }
                    } label: {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 32))
                    }
                    .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || overCharLimit)
                }
            }
        }
        .padding()
    }

    private func applyLocal() {
        parent = localChat.parentPost(id: parentId)
        replies = parent == nil ? [] : localChat.replies(parentId: parentId)
    }

    private func reload() async {
        if useLocal {
            applyLocal()
            error = nil
            return
        }
        do {
            let loaded = try await ChatService.fetchPost(id: parentId)
            if let loaded, !loaded.is_hidden, !isExpired(loaded) {
                parent = loaded
                replies = try await ChatService.fetchReplies(parentId: parentId)
            } else {
                parent = nil
                replies = []
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func isExpired(_ post: ChatPost) -> Bool {
        guard let date = ISO8601DateFormatter().date(from: post.expires_at) else { return false }
        return date <= Date()
    }

    private func vote(postId: UUID, direction: String) async {
        do {
            if useLocal {
                try localChat.setVote(postId: postId, direction: direction)
                applyLocal()
            } else {
                try await ChatService.setVote(postId: postId, direction: direction)
                await reload()
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func hideOwn(postId: UUID, isParent: Bool) async {
        if useLocal {
            localChat.hide(postIds: [postId])
            applyLocal()
        } else {
            try? await ChatService.hideOwn(postId: postId)
            await reload()
        }
        if isParent {
            parent = nil
            replies = []
        }
    }

    private func report(postId: UUID) async {
        if useLocal {
            localChat.hide(postIds: [postId])
            applyLocal()
            DiagnosticLog.shared.append(category: "chat", message: "Reported (local) reply")
        } else {
            do {
                try await ChatService.report(postId: postId, reason: nil)
                await reload()
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    private func sendReply() async {
        guard canSendInViewedGeography, let parent else {
            flashRegionWarning()
            return
        }
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= AppConfig.maxChatChars else { return }
        guard let geoId = parent.geography_id ?? appModel.resolvedGeography?.id else { return }
        do {
            let avatar = (useLocal && localChat.sender == .other)
                ? avatarStore.otherSelection
                : avatarStore.selection
            if useLocal {
                try localChat.createReply(parentId: parent.id, body: trimmed, avatar: avatar)
                draft = ""
                composerFocused = false
                applyLocal()
                DiagnosticLog.shared.append(category: "chat", message: "Local reply")
            } else {
                guard let coord = appModel.lastKnownCoordinate else {
                    error = regionGateMessage
                    flashRegionWarning()
                    return
                }
                try await ChatService.createPost(
                    body: trimmed,
                    geographyId: geoId,
                    latitude: coord.latitude,
                    longitude: coord.longitude,
                    venueName: parent.venue_name,
                    avatarIcon: avatar.icon.rawValue,
                    avatarColor: avatar.color.rawValue,
                    parentId: parent.id
                )
                draft = ""
                composerFocused = false
                DiagnosticLog.shared.append(category: "chat", message: "Replied")
                await reload()
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func flashRegionWarning() {
        guard !canSendInViewedGeography else { return }
        Task { @MainActor in
            for _ in 0 ..< 2 {
                withAnimation(.easeInOut(duration: 0.12)) { regionWarningFlash = true }
                try? await Task.sleep(nanoseconds: 120_000_000)
                withAnimation(.easeInOut(duration: 0.12)) { regionWarningFlash = false }
                try? await Task.sleep(nanoseconds: 120_000_000)
            }
        }
    }
}
