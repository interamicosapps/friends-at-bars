import SwiftUI
import UIKit

struct ChatView: View {
    @EnvironmentObject private var appModel: AppModel
    @ObservedObject private var testMode = TestModeStore.shared
    @ObservedObject private var localChat = TestChatStore.shared
    @ObservedObject private var locationAuth = LocationAuthorizationStore.shared
    @ObservedObject private var avatarStore = ChatAvatarStore.shared

    @State private var posts: [ChatPost] = []
    @State private var sort = "recent"
    @State private var draft = ""
    @State private var error: String?
    @State private var selectMode = false
    @State private var selectedIds: Set<UUID> = []
    @State private var showSoftHidden = false
    @State private var draggingId: UUID?
    @State private var dragTranslation: CGFloat = 0
    @State private var rowHeights: [UUID: CGFloat] = [:]
    @State private var suppressSelectUntil = Date.distantPast
    @State private var openThreadId: UUID?
    @State private var avatarPickerTarget: ChatAvatarPickerTarget?
    @FocusState private var composerFocused: Bool
    @State private var regionWarningFlash = false

    private var useLocal: Bool { testMode.uiEnabled && testMode.useMockCheckIns }
    private var remaining: Int { AppConfig.maxChatChars - draft.count }
    private var overCharLimit: Bool { remaining < 0 }

    private var venueOptions: [CatalogVenue] {
        appModel.scopedVenues.sorted {
            if $0.area != $1.area { return $0.area < $1.area }
            return $0.name < $1.name
        }
    }

    /// Production: When In Use or Always. Test local: simulateLocationAllowed.
    private var needLocationGate: Bool {
        if useLocal { return !testMode.simulateLocationAllowed }
        return !locationAuth.canUseChatLocation
    }

    private var viewedGeography: CatalogGeography? {
        appModel.resolvedGeography
    }

    /// User GPS must be inside the geography they are viewing to send.
    private var canSendInViewedGeography: Bool {
        if useLocal && testMode.simulateLocationAllowed { return true }
        guard let viewed = viewedGeography, let gps = appModel.gpsGeography else { return false }
        return viewed.id == gps.id
    }

    private var sendVenueName: String? {
        if useLocal {
            let v = localChat.simulatedVenueName.trimmingCharacters(in: .whitespacesAndNewlines)
            return v.isEmpty ? nil : v
        }
        if let venue = appModel.lastVenueName {
            return venue
        }
        guard let coord = appModel.lastKnownCoordinate else { return nil }
        var best: (name: String, distance: Double)?
        for venue in appModel.scopedVenues {
            let meters = GeographyResolver.haversineMeters(
                lat1: coord.latitude,
                lon1: coord.longitude,
                lat2: venue.latitude,
                lon2: venue.longitude
            )
            guard meters <= Double(venue.radius_m) else { continue }
            if best == nil || meters < best!.distance {
                best = (venue.name, meters)
            }
        }
        return best?.name
    }

    private var regionGateMessage: String {
        let name = viewedGeography?.name ?? "this"
        return "Must be located within \(name) region to send chat"
    }

    private var canReorder: Bool {
        useLocal && selectMode && sort == "recent"
    }

    private var displayedPosts: [ChatPost] {
        let feed = useLocal
            ? localChat.feed(sort: sort, includeHidden: selectMode && showSoftHidden)
            : posts
        guard let geoId = viewedGeography?.id else { return [] }
        let venueNames = Set(appModel.scopedVenues.map(\.name))
        return feed.filter { post in
            guard post.parent_id == nil else { return false }
            if let postGeo = post.geography_id {
                return postGeo == geoId
            }
            if post.venue_name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return false
            }
            return venueNames.contains(post.venue_name)
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if needLocationGate {
                    if useLocal {
                        HStack {
                            Spacer()
                            Button {
                                testMode.simulateLocationAllowed.toggle()
                                DiagnosticLog.shared.append(
                                    category: "chat",
                                    message: "Simulate location allowed=\(testMode.simulateLocationAllowed)"
                                )
                            } label: {
                                Image(systemName: testMode.simulateLocationAllowed
                                      ? "location.fill"
                                      : "location.slash")
                            }
                            .padding()
                        }
                    }
                    Spacer(minLength: 24)
                    ChatLocationInlineGate {
                        if useLocal {
                            testMode.simulateLocationAllowed = true
                        } else {
                            locationAuth.requestChatLocation()
                            startChatLocationIfNeeded()
                        }
                    }
                    .padding(.horizontal)
                    Spacer()
                } else {
                    if useLocal {
                    HStack {
                        Picker("Sort", selection: $sort) {
                            Text("Recent").tag("recent")
                            Text("Popular").tag("popular")
                        }
                        .pickerStyle(.segmented)

                        Button {
                            testMode.simulateLocationAllowed.toggle()
                            DiagnosticLog.shared.append(
                                category: "chat",
                                message: "Simulate location allowed=\(testMode.simulateLocationAllowed)"
                            )
                        } label: {
                            Image(systemName: testMode.simulateLocationAllowed
                                  ? "location.fill"
                                  : "location.slash")
                        }

                        Button {
                            if selectMode {
                                exitSelectMode()
                            } else {
                                selectMode = true
                                logSelectModeState(reason: "enter")
                            }
                        } label: {
                            Image(systemName: selectMode ? "xmark" : "list.bullet")
                        }
                        .accessibilityLabel(selectMode ? "Exit select mode" : "Select messages")
                    }
                    .padding()
                    .dismissKeyboardOnTap()
                    .onChange(of: sort) { _, newSort in
                        composerFocused = false
                        cancelDrag(reason: "sort-changed")
                        if selectMode {
                            logSelectModeState(reason: "sort→\(newSort)")
                        }
                        Task { await load() }
                    }
                    } else {
                    HStack(spacing: 12) {
                        Button {
                            avatarPickerTarget = .own
                        } label: {
                            ChatAvatarBadge(selection: avatarStore.selection, size: 32)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Change chat icon")

                        Picker("Sort", selection: $sort) {
                            Text("Recent").tag("recent")
                            Text("Popular").tag("popular")
                        }
                        .pickerStyle(.segmented)
                    }
                    .padding(.horizontal)
                    .padding(.top, 6)
                    .padding(.bottom, 8)
                    .dismissKeyboardOnTap()
                    .onChange(of: sort) { _, _ in
                        composerFocused = false
                        Task { await load() }
                    }
                    }

                    if selectMode && useLocal {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text("\(selectedIds.count) selected")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Spacer()
                                Button {
                                    showSoftHidden.toggle()
                                    DiagnosticLog.shared.append(
                                        category: "chat",
                                        message: "Select mode eye → showHidden=\(showSoftHidden)"
                                    )
                                } label: {
                                    Image(systemName: showSoftHidden ? "eye" : "eye.slash")
                                }
                                .accessibilityLabel(
                                    showSoftHidden
                                        ? "Hide soft-hidden chats"
                                        : "Show soft-hidden chats"
                                )
                                .foregroundStyle(showSoftHidden ? Color.accentColor : Color.secondary)
                                Button {
                                    let ids = Array(selectedIds)
                                    localChat.nudgeScore(postIds: ids, direction: "up")
                                    DiagnosticLog.shared.append(
                                        category: "chat",
                                        message: "Select mode nudge +1 on \(ids.count) chat(s)"
                                    )
                                } label: {
                                    Image(systemName: "chevron.up")
                                }
                                .disabled(selectedIds.isEmpty)
                                .accessibilityLabel("Add upvote to selected")
                                Button {
                                    let ids = Array(selectedIds)
                                    localChat.nudgeScore(postIds: ids, direction: "down")
                                    DiagnosticLog.shared.append(
                                        category: "chat",
                                        message: "Select mode nudge -1 on \(ids.count) chat(s)"
                                    )
                                } label: {
                                    Image(systemName: "chevron.down")
                                }
                                .disabled(selectedIds.isEmpty)
                                .accessibilityLabel("Add downvote to selected")
                                Button(role: .destructive) {
                                    let ids = Array(selectedIds)
                                    localChat.hide(postIds: ids)
                                    selectedIds.subtract(ids)
                                    DiagnosticLog.shared.append(
                                        category: "chat",
                                        message: "Select mode delete \(ids.count) chat(s)"
                                    )
                                } label: {
                                    Image(systemName: "trash")
                                }
                                .disabled(selectedIds.isEmpty)
                                .accessibilityLabel("Delete selected")
                            }
                            if canReorder, displayedPosts.count > 1 {
                                Text("Hold the ≡ grip, then drag to reorder")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            } else if selectMode && sort != "recent" {
                                Text("Switch to Recent to reorder")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(.horizontal)
                        .padding(.bottom, 8)
                    }

                    if useLocal && !selectMode {
                        Text("Local test feed")
                            .font(.caption2)
                            .foregroundStyle(.cyan)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal)
                            .padding(.bottom, 4)
                    }

                    if useLocal && selectMode {
                        selectModeList
                    } else {
                        List {
                            ForEach(displayedPosts) { post in
                                chatRow(post)
                            }
                        }
                        .listStyle(.plain)
                        .scrollDismissesKeyboard(.interactively)
                        .dismissKeyboardOnTap()
                    }

                    if let error {
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(.red)
                            .padding(.horizontal)
                    }

                    composer
                }
            }
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(needLocationGate || useLocal ? .automatic : .hidden, for: .navigationBar)
            .toolbar {
                if !needLocationGate && useLocal {
                    ToolbarItem(placement: .topBarLeading) {
                        HStack(spacing: 8) {
                            Button {
                                avatarPickerTarget = .own
                            } label: {
                                ChatAvatarBadge(selection: avatarStore.selection, size: 32)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Change chat icon")

                            if useLocal {
                                Button {
                                    avatarPickerTarget = .otherUser
                                } label: {
                                    ChatAvatarBadge(selection: avatarStore.otherSelection, size: 32)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Change other user chat icon")
                            }
                        }
                    }
                    if useLocal {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button("Clear local") {
                                localChat.clearAll()
                                exitSelectMode()
                            }
                            .font(.caption)
                        }
                    }
                }
            }
            .sheet(item: $avatarPickerTarget) { target in
                ChatAvatarPickerSheet(target: target)
            }
            .navigationDestination(item: $openThreadId) { id in
                ChatThreadView(
                    parentId: id,
                    selectModeEnabled: selectMode && useLocal,
                    initiallyShowSoftHidden: selectMode && useLocal && showSoftHidden
                )
            }
            .onChange(of: openThreadId) { _, id in
                if id == nil {
                    Task { await load() }
                }
            }
            .task {
                await load()
                startChatLocationIfNeeded()
                if useLocal, !venueOptions.isEmpty {
                    let names = Set(venueOptions.map(\.name))
                    // An empty selection represents a geography-only post.
                    if !localChat.simulatedVenueName.isEmpty
                        && !names.contains(localChat.simulatedVenueName) {
                        localChat.simulatedVenueName =
                            venueOptions.first(where: { $0.name == "Test Location 1" })?.name
                            ?? venueOptions[0].name
                    }
                }
            }
            .onDisappear {
                ChatLocationReader.shared.stop()
            }
            .refreshable { await load() }
            .onChange(of: testMode.useMockCheckIns) { _, _ in
                exitSelectMode()
                Task { await load() }
            }
            .onChange(of: locationAuth.canUseChatLocation) { _, _ in
                startChatLocationIfNeeded()
                Task { await load() }
            }
            .onChange(of: testMode.simulateLocationAllowed) { _, _ in
                Task { await load() }
            }
            .onChange(of: localChat.posts.count) { _, _ in
                if useLocal { posts = localChat.feed(sort: sort) }
            }
            .onChange(of: appModel.resolvedGeography?.id) { _, _ in
                if !localChat.simulatedVenueName.isEmpty
                    && !venueOptions.contains(where: { $0.name == localChat.simulatedVenueName }) {
                    localChat.simulatedVenueName = venueOptions.first?.name ?? ""
                }
                Task { await load() }
            }
        }
    }

    @ViewBuilder
    private func chatRow(_ post: ChatPost) -> some View {
        let isOwn = post.author_id == AnonymousIdentity.userId()
        let avatar = ChatAvatarResolver.selection(
            for: post,
            preference: avatarStore.selection,
            otherPreference: avatarStore.otherSelection
        )
        let bodyColor: Color = isOwn ? .black : .white
        let metaColor: Color = isOwn ? Color.black.opacity(0.45) : Color.secondary
        let rowBg: Color = isOwn ? .white : Color.clear

        HStack(alignment: .top, spacing: 10) {
            if selectMode && useLocal {
                Button {
                    toggleSelect(post.id)
                } label: {
                    Image(systemName: selectedIds.contains(post.id) ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 22))
                        .foregroundStyle(selectedIds.contains(post.id) ? Color.accentColor : .secondary)
                        .frame(width: 36, height: 36)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(selectedIds.contains(post.id) ? "Deselect message" : "Select message")
            }

            ChatAvatarBadge(selection: avatar, size: 36)

            VStack(alignment: .leading, spacing: 8) {
                Text(post.body)
                    .font(.body)
                    .foregroundStyle(bodyColor)
                    .frame(maxWidth: .infinity, alignment: .leading)

                HStack(alignment: .center, spacing: 8) {
                    HStack(spacing: 6) {
                        let venueLabel = post.venue_name.trimmingCharacters(in: .whitespacesAndNewlines)
                        if !venueLabel.isEmpty {
                            Text(venueLabel)
                                .font(.caption)
                                .foregroundStyle(metaColor)
                        }
                        if post.is_hidden {
                            Text("Hidden")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(isOwn ? Color.black.opacity(0.55) : Color.orange)
                        }
                        Button {
                            openThreadId = post.id
                        } label: {
                            HStack(spacing: 3) {
                                Image(systemName: "bubble.right")
                                    .font(.system(size: 11))
                                Text("\(replyCount(for: post))")
                                    .font(.caption)
                            }
                            .foregroundStyle(metaColor)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(replyCount(for: post)) replies")
                    }
                    Spacer(minLength: 8)
                    RedditVotePill(
                        score: post.score,
                        myVote: post.my_vote,
                        disabled: isOwn || (selectMode && useLocal),
                        onLightBackground: isOwn,
                        onUp: { Task { await vote(postId: post.id, direction: "up") } },
                        onDown: { Task { await vote(postId: post.id, direction: "down") } }
                    )
                }
            }
            .contentShape(Rectangle())
            .onTapGesture {
                if selectMode && useLocal {
                    toggleSelect(post.id)
                } else if !selectMode {
                    openThreadId = post.id
                }
            }

            if canReorder {
                ZStack {
                    ChatReorderTouch(
                        postId: post.id,
                        shouldBegin: {
                            draggingId == nil || draggingId == post.id
                        },
                        onChange: { translation in
                            guard draggingId == nil || draggingId == post.id else { return }
                            suppressSelectUntil = Date().addingTimeInterval(0.45)
                            if draggingId != post.id {
                                DiagnosticLog.shared.append(
                                    category: "chat",
                                    message: "Reorder drag began id=\(post.id.uuidString.prefix(8))…"
                                )
                            }
                            draggingId = post.id
                            dragTranslation = translation
                        },
                        onFinish: { translation, commit in
                            guard draggingId == nil || draggingId == post.id else {
                                DiagnosticLog.shared.append(
                                    category: "chat",
                                    message: "Reorder finish ignored (not owner) id=\(post.id.uuidString.prefix(8))…",
                                    level: "warn"
                                )
                                return
                            }
                            if commit && abs(translation) > 4 {
                                commitDrag(originId: post.id, translation: translation)
                            } else {
                                cancelDrag(
                                    reason: commit
                                        ? "release-no-move(\(Int(translation)))"
                                        : "gesture-cancelled"
                                )
                            }
                        }
                    )
                    Image(systemName: "line.3.horizontal")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .allowsHitTesting(false)
                }
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
                .accessibilityLabel("Drag to reorder")
            }
        }
        .padding(.horizontal, isOwn ? 10 : 0)
        .padding(.vertical, 8)
        .background(rowBg)
        .clipShape(RoundedRectangle(cornerRadius: isOwn ? 12 : 0, style: .continuous))
        .contentShape(Rectangle())
        .listRowInsets(EdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12))
        .listRowBackground(Color.clear)
        .swipeActions(edge: .trailing, allowsFullSwipe: !(selectMode && useLocal)) {
            if !(selectMode && useLocal) {
                if isOwn {
                    Button(role: .destructive) {
                        Task { await hideOwn(postId: post.id) }
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                } else {
                    Button {
                        Task { await reportPost(postId: post.id) }
                    } label: {
                        Label("Report", systemImage: "flag")
                    }
                    .tint(.orange)
                }
            }
        }
    }

    @ViewBuilder
    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            if useLocal && testMode.simulateLocationAllowed {
                HStack(spacing: 8) {
                    Text("Send as")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Picker("Sender", selection: $localChat.sender) {
                        ForEach(TestChatStore.Sender.allCases) { s in
                            Text(s.label).tag(s)
                        }
                    }
                    .pickerStyle(.segmented)
                    .frame(maxWidth: 200)
                }

                HStack(alignment: .center, spacing: 8) {
                    Text("Bar")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Picker("Bar", selection: $localChat.simulatedVenueName) {
                        if let geography = viewedGeography {
                            Text(geography.name).tag("")
                        }
                        ForEach(venueOptions) { v in
                            Text("\(v.name)").tag(v.name)
                        }
                    }
                    .pickerStyle(.menu)
                    Spacer(minLength: 8)
                    if overCharLimit {
                        Text("150 Character Limit")
                            .font(.caption.bold())
                            .foregroundStyle(.red)
                            .multilineTextAlignment(.trailing)
                    }
                }
            }

            if !canSendInViewedGeography {
                Button {
                    flashRegionWarning()
                } label: {
                    HStack {
                        Text(regionGateMessage)
                            .font(.system(size: 17))
                            .foregroundStyle(regionWarningFlash ? Color.red : Color.secondary)
                            .multilineTextAlignment(.leading)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(10)
                    .background(Color(.secondarySystemBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 18))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(regionGateMessage)
            } else {
                if !useLocal {
                    HStack(alignment: .center, spacing: 8) {
                        if let venue = sendVenueName {
                            Text("Posting from \(venue)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 8)
                        if overCharLimit {
                            Text("150 Character Limit")
                                .font(.caption.bold())
                                .foregroundStyle(.red)
                                .multilineTextAlignment(.trailing)
                        }
                    }
                }

                HStack(alignment: .bottom, spacing: 8) {
                    TextField(
                        placeholder,
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
                        Task { await send() }
                    } label: {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 32))
                    }
                    .disabled(
                        draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            || overCharLimit
                    )
                }
            }
        }
        .padding()
    }

    private var placeholder: String {
        if useLocal && localChat.sender == .other {
            return "Message as another user…"
        }
        if let venue = sendVenueName {
            return "What's happening at \(venue)?"
        }
        return "Say something…"
    }

    private func startChatLocationIfNeeded() {
        guard !needLocationGate else { return }
        ChatLocationReader.shared.start { coord in
            appModel.lastKnownCoordinate = coord
        }
    }

    private func flashRegionWarning() {
        guard !canSendInViewedGeography else { return }
        Task { @MainActor in
            for _ in 0 ..< 2 {
                withAnimation(.easeInOut(duration: 0.12)) {
                    regionWarningFlash = true
                }
                try? await Task.sleep(nanoseconds: 120_000_000)
                withAnimation(.easeInOut(duration: 0.12)) {
                    regionWarningFlash = false
                }
                try? await Task.sleep(nanoseconds: 120_000_000)
            }
        }
    }

    private func replyCount(for post: ChatPost) -> Int {
        if useLocal {
            return localChat.replies(parentId: post.id).count
        }
        return post.visibleReplyCount
    }

    private func exitSelectMode() {
        logSelectModeState(reason: "exit")
        selectMode = false
        selectedIds = []
        showSoftHidden = false
        cancelDrag(reason: "exit-select")
    }

    private func logSelectModeState(reason: String) {
        DiagnosticLog.shared.append(
            category: "chat",
            message: """
            Select mode \(reason): sort=\(sort) local=\(useLocal) \
            canReorder=\(canReorder) posts=\(displayedPosts.count) \
            selected=\(selectedIds.count) showHidden=\(showSoftHidden) \
            dragging=\(draggingId?.uuidString.prefix(8) ?? "nil")
            """
        )
    }

    private func toggleSelect(_ id: UUID) {
        if Date() < suppressSelectUntil {
            DiagnosticLog.shared.append(
                category: "chat",
                message: "Select tap ignored (drag cooldown) id=\(id.uuidString.prefix(8))…",
                level: "warn"
            )
            return
        }
        let turningOn = !selectedIds.contains(id)
        if turningOn {
            selectedIds.insert(id)
        } else {
            selectedIds.remove(id)
        }
        let snippet = String(
            (displayedPosts.first(where: { $0.id == id })?.body ?? "")
                .prefix(32)
        )
        DiagnosticLog.shared.append(
            category: "chat",
            message: "\(turningOn ? "Selected" : "Deselected") chat\(snippet.isEmpty ? "" : " “\(snippet)”") total=\(selectedIds.count)"
        )
    }

    private var selectModeList: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(displayedPosts) { post in
                    VStack(spacing: 0) {
                        selectModeRow(post)
                        Divider()
                    }
                }
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .dismissKeyboardOnTap()
        .onPreferenceChange(ChatRowHeightKey.self) { heights in
            if heights != rowHeights {
                rowHeights = heights
            }
        }
    }

    @ViewBuilder
    private func selectModeRow(_ post: ChatPost) -> some View {
        let row = chatRow(post)
            .opacity(post.is_hidden ? 0.55 : 1)
            .padding(.horizontal, 12)
            .background {
                GeometryReader { proxy in
                    Color.clear.preference(
                        key: ChatRowHeightKey.self,
                        value: [post.id: proxy.size.height]
                    )
                }
                .allowsHitTesting(false)
            }
            .contentShape(Rectangle())
            .offset(y: canReorder ? dragOffset(for: post.id) : 0)
            .zIndex(draggingId == post.id ? 1 : 0)
            .shadow(
                color: draggingId == post.id ? Color.black.opacity(0.28) : .clear,
                radius: draggingId == post.id ? 8 : 0,
                y: draggingId == post.id ? 4 : 0
            )
        row
    }

    private func dragOffset(for id: UUID) -> CGFloat {
        guard let draggingId,
              let from = displayedPosts.firstIndex(where: { $0.id == draggingId }) else { return 0 }
        if id == draggingId { return dragTranslation }
        guard let index = displayedPosts.firstIndex(where: { $0.id == id }) else { return 0 }
        let target = dropIndex(from: from, translation: dragTranslation)
        let height = rowHeights[draggingId] ?? 80
        if target > from && index > from && index <= target { return -height }
        if target < from && index < from && index >= target { return height }
        return 0
    }

    private func dropIndex(from: Int, translation: CGFloat) -> Int {
        let items = displayedPosts
        guard from >= 0, from < items.count else { return from }
        var cursor: CGFloat = 0
        var mids: [CGFloat] = []
        mids.reserveCapacity(items.count)
        for post in items {
            let height = rowHeights[post.id] ?? 80
            mids.append(cursor + height / 2)
            cursor += height
        }
        let proposed = mids[from] + translation
        var best = from
        var bestDistance = CGFloat.infinity
        for (index, mid) in mids.enumerated() {
            let distance = abs(mid - proposed)
            if distance < bestDistance {
                bestDistance = distance
                best = index
            }
        }
        return best
    }

    private func commitDrag(originId: UUID, translation: CGFloat) {
        suppressSelectUntil = Date().addingTimeInterval(0.45)
        guard let from = displayedPosts.firstIndex(where: { $0.id == originId }) else {
            cancelDrag(reason: "commit-missing-origin")
            return
        }
        let target = dropIndex(from: from, translation: translation)
        guard target != from else {
            cancelDrag(reason: "commit-same-index(\(from)) dy=\(Int(translation))")
            return
        }
        var ids = displayedPosts.map(\.id)
        let original = ids
        let item = ids.remove(at: from)
        let clamped = min(max(target, 0), ids.count)
        ids.insert(item, at: clamped)
        DiagnosticLog.shared.append(
            category: "chat",
            message: "Reorder commit \(from)→\(clamped) dy=\(Int(translation)) id=\(originId.uuidString.prefix(8))…"
        )
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            draggingId = nil
            dragTranslation = 0
            localChat.applyDisplayedRecentOrder(originalDisplayed: original, reordered: ids)
        }
    }

    private func cancelDrag(reason: String = "cancel") {
        if draggingId != nil || dragTranslation != 0 {
            DiagnosticLog.shared.append(
                category: "chat",
                message: "Reorder cancel (\(reason)) id=\(draggingId?.uuidString.prefix(8) ?? "nil") dy=\(Int(dragTranslation))"
            )
        }
        draggingId = nil
        dragTranslation = 0
    }

    private func load() async {
        guard !needLocationGate else {
            posts = []
            error = nil
            return
        }
        if useLocal {
            posts = localChat.feed(sort: sort)
            error = nil
            return
        }
        do {
            posts = try await ChatService.fetchFeed(sort: sort)
            error = nil
        } catch {
            self.error = UserFacingError.message(for: error)
            DiagnosticLog.shared.append(
                category: "chat",
                message: error.localizedDescription,
                level: "error"
            )
        }
    }

    private func vote(postId: UUID, direction: String) async {
        do {
            if useLocal {
                try localChat.setVote(postId: postId, direction: direction)
            } else {
                try await ChatService.setVote(postId: postId, direction: direction)
                await load()
            }
            error = nil
        } catch {
            self.error = UserFacingError.message(for: error)
        }
    }

    private func hideOwn(postId: UUID) async {
        if useLocal {
            localChat.hide(postIds: [postId])
        } else {
            try? await ChatService.hideOwn(postId: postId)
            await load()
        }
    }

    private func reportPost(postId: UUID) async {
        if useLocal {
            // Local feed has no server report — soft-hide + log for Test Mode parity.
            localChat.hide(postIds: [postId])
            DiagnosticLog.shared.append(
                category: "chat",
                message: "Reported (local) post \(postId.uuidString.prefix(8))…"
            )
        } else {
            do {
                try await ChatService.report(postId: postId, reason: nil)
                DiagnosticLog.shared.append(category: "chat", message: "Reported post")
                await load()
            } catch {
                self.error = UserFacingError.message(for: error)
                DiagnosticLog.shared.append(
                    category: "chat",
                    message: "Report failed: \(error.localizedDescription)",
                    level: "error"
                )
            }
        }
    }

    private func send() async {
        guard canSendInViewedGeography else {
            flashRegionWarning()
            return
        }
        guard let geo = viewedGeography else { return }
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        guard trimmed.count <= AppConfig.maxChatChars else {
            error = "150 Character Limit"
            return
        }
        do {
            let avatar =
                (useLocal && localChat.sender == .other)
                ? avatarStore.otherSelection
                : avatarStore.selection
            if useLocal {
                try localChat.createPost(
                    body: trimmed,
                    avatar: avatar,
                    venueName: sendVenueName,
                    geographyId: geo.id
                )
                draft = ""
                composerFocused = false
                let venueLog = sendVenueName ?? "(no bar)"
                DiagnosticLog.shared.append(category: "chat", message: "Local post at \(venueLog)")
            } else {
                guard let coord = appModel.lastKnownCoordinate else {
                    error = regionGateMessage
                    flashRegionWarning()
                    return
                }
                try await ChatService.createPost(
                    body: trimmed,
                    geographyId: geo.id,
                    latitude: coord.latitude,
                    longitude: coord.longitude,
                    venueName: sendVenueName,
                    avatarIcon: avatar.icon.rawValue,
                    avatarColor: avatar.color.rawValue
                )
                draft = ""
                composerFocused = false
                let venueLog = sendVenueName ?? "(no bar)"
                DiagnosticLog.shared.append(category: "chat", message: "Posted at \(venueLog)")
                await load()
            }
            error = nil
        } catch {
            self.error = UserFacingError.message(for: error)
            DiagnosticLog.shared.append(
                category: "chat",
                message: error.localizedDescription,
                level: "error"
            )
        }
    }
}

private struct ChatRowHeightKey: PreferenceKey {
    static var defaultValue: [UUID: CGFloat] = [:]

    static func reduce(value: inout [UUID: CGFloat], nextValue: () -> [UUID: CGFloat]) {
        value.merge(nextValue(), uniquingKeysWith: { $1 })
    }
}

/// Hold-to-reorder for select mode. Gesture attaches to one chat-row host only
/// (never the multi-row stack), so taps/scroll still work on the rest of the list.
private struct ChatReorderTouch: UIViewRepresentable {
    let postId: UUID
    var shouldBegin: () -> Bool
    var onChange: (CGFloat) -> Void
    var onFinish: (_ translation: CGFloat, _ commit: Bool) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(
            postId: postId,
            shouldBegin: shouldBegin,
            onChange: onChange,
            onFinish: onFinish
        )
    }

    func makeUIView(context: Context) -> InstallerView {
        let view = InstallerView()
        // Grip-sized host: receives the hold itself so each chat has a unique recognizer.
        view.isUserInteractionEnabled = true
        view.backgroundColor = .clear
        view.coordinator = context.coordinator
        return view
    }

    func updateUIView(_ uiView: InstallerView, context: Context) {
        context.coordinator.postId = postId
        context.coordinator.shouldBegin = shouldBegin
        context.coordinator.onChange = onChange
        context.coordinator.onFinish = onFinish
        uiView.coordinator = context.coordinator
        uiView.installIfNeeded()
    }

    static func dismantleUIView(_ uiView: InstallerView, coordinator: Coordinator) {
        uiView.removeRecognizer()
        coordinator.setScrollEnabled(true)
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var postId: UUID
        var shouldBegin: () -> Bool
        var onChange: (CGFloat) -> Void
        var onFinish: (CGFloat, Bool) -> Void
        var startY: CGFloat = 0
        private var isActive = false
        weak var recognizer: UILongPressGestureRecognizer?
        private weak var lockedScroll: UIScrollView?
        private var loggedInstallHost: ObjectIdentifier?
        private var didLogInstallFailure = false

        init(
            postId: UUID,
            shouldBegin: @escaping () -> Bool,
            onChange: @escaping (CGFloat) -> Void,
            onFinish: @escaping (CGFloat, Bool) -> Void
        ) {
            self.postId = postId
            self.shouldBegin = shouldBegin
            self.onChange = onChange
            self.onFinish = onFinish
        }

        @objc func handle(_ gesture: UILongPressGestureRecognizer) {
            let y = gesture.location(in: gesture.view?.window).y
            let shortId = String(postId.uuidString.prefix(8))
            switch gesture.state {
            case .began:
                guard shouldBegin() else {
                    DiagnosticLog.log(
                        category: "chat",
                        message: "Reorder hold rejected (not owner) id=\(shortId)…",
                        level: "warn"
                    )
                    // Force-fail this recognizer so it cannot keep delivering .changed.
                    gesture.isEnabled = false
                    gesture.isEnabled = true
                    return
                }
                isActive = true
                startY = y
                setScrollEnabled(false, from: gesture.view)
                DiagnosticLog.log(
                    category: "chat",
                    message: "Reorder hold began id=\(shortId)… scrollLocked=\(lockedScroll != nil)"
                )
                onChange(0)
            case .changed:
                guard isActive else { return }
                onChange(y - startY)
            case .ended:
                let translation = y - startY
                let active = isActive
                isActive = false
                setScrollEnabled(true)
                guard active else { return }
                DiagnosticLog.log(
                    category: "chat",
                    message: "Reorder hold ended id=\(shortId)… dy=\(Int(translation))"
                )
                onFinish(translation, true)
            case .cancelled:
                let active = isActive
                isActive = false
                setScrollEnabled(true)
                guard active else { return }
                DiagnosticLog.log(
                    category: "chat",
                    message: "Reorder hold cancelled id=\(shortId)…",
                    level: "warn"
                )
                onFinish(0, false)
            case .failed:
                let active = isActive
                isActive = false
                setScrollEnabled(true)
                guard active else { return }
                DiagnosticLog.log(
                    category: "chat",
                    message: "Reorder hold failed id=\(shortId)… (moved during press or conflict)",
                    level: "warn"
                )
                onFinish(0, false)
            default:
                break
            }
        }

        func setScrollEnabled(_ enabled: Bool, from view: UIView? = nil) {
            if !enabled, lockedScroll == nil {
                lockedScroll = enclosingScrollView(from: view)
                if lockedScroll == nil {
                    DiagnosticLog.log(
                        category: "chat",
                        message: "Reorder could not find UIScrollView to lock id=\(postId.uuidString.prefix(8))…",
                        level: "warn"
                    )
                }
            }
            lockedScroll?.isScrollEnabled = enabled
            if enabled { lockedScroll = nil }
        }

        private func enclosingScrollView(from view: UIView?) -> UIScrollView? {
            var current = view
            while let next = current {
                if let scroll = next as? UIScrollView { return scroll }
                current = next.superview
            }
            return nil
        }

        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            shouldBegin()
        }

        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
        ) -> Bool {
            if other is UIPanGestureRecognizer {
                return gestureRecognizer.state == .possible
            }
            // Never run two row long-presses at once.
            if other is UILongPressGestureRecognizer {
                return false
            }
            return true
        }

        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldBeRequiredToFailBy other: UIGestureRecognizer
        ) -> Bool {
            false
        }

        func noteInstalled(on host: UIView) {
            let id = ObjectIdentifier(host)
            guard loggedInstallHost != id else { return }
            loggedInstallHost = id
            let typeName = String(describing: type(of: host))
            DiagnosticLog.log(
                category: "chat",
                message: """
                Reorder gesture installed id=\(postId.uuidString.prefix(8))… \
                host=\(typeName) size=\(Int(host.bounds.width))x\(Int(host.bounds.height))
                """
            )
        }

        func noteInstallFailed(_ reason: String) {
            guard !didLogInstallFailure else { return }
            didLogInstallFailure = true
            DiagnosticLog.log(
                category: "chat",
                message: "Reorder install failed id=\(postId.uuidString.prefix(8))… \(reason)",
                level: "warn"
            )
        }
    }

    final class InstallerView: UIView {
        weak var coordinator: Coordinator?
        private weak var installedOn: UIView?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            installIfNeeded()
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            installIfNeeded()
        }

        override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
            guard isUserInteractionEnabled, !isHidden, alpha > 0.01, bounds.contains(point) else {
                return nil
            }
            return self
        }

        func installIfNeeded() {
            guard let coordinator else { return }
            guard window != nil else { return }
            // Always install on this grip view — unique per chat, never a shared list host.
            let host = self
            if installedOn === host, coordinator.recognizer != nil { return }
            removeRecognizer()
            let gesture = UILongPressGestureRecognizer(
                target: coordinator,
                action: #selector(Coordinator.handle)
            )
            gesture.minimumPressDuration = 0.28
            gesture.allowableMovement = 44
            gesture.cancelsTouchesInView = true
            gesture.delaysTouchesBegan = false
            gesture.delaysTouchesEnded = false
            gesture.delegate = coordinator
            host.addGestureRecognizer(gesture)
            coordinator.recognizer = gesture
            installedOn = host
            coordinator.noteInstalled(on: host)
        }

        func removeRecognizer() {
            if let host = installedOn, let gesture = coordinator?.recognizer {
                host.removeGestureRecognizer(gesture)
            }
            coordinator?.recognizer = nil
            installedOn = nil
        }
    }
}
