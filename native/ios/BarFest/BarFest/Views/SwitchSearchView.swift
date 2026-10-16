import SwiftUI

/// Casual Switch Search — Easy/Hard word-search (web parity, no ranked).
/// Presented via fullScreenCover from Games (no nav swipe-back).
struct SwitchSearchView: View {
    @StateObject private var engine = SwitchSearchEngine()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Group {
            switch engine.screen {
            case .home:
                homeScreen
            case .playing:
                gameScreen
            case .ended:
                endScreen
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(screenBackground.ignoresSafeArea())
        // Presented as fullScreenCover — no NavigationStack pop / edge swipe-back.
        .interactiveDismissDisabled(true)
        .onAppear { engine.appear() }
    }

    private var screenBackground: Color { Color.black }

    // MARK: - Home

    private var homeScreen: some View {
        VStack(spacing: 28) {
            HStack {
                Button("Games") { dismiss() }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                Spacer()
            }
            .padding(.horizontal)

            Spacer()
            Text("Switch Search")
                .font(.largeTitle.bold())
                .foregroundStyle(.white)
            Text("Find the hidden words before time runs out.")
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.7))
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            Picker("Difficulty", selection: $engine.difficulty) {
                ForEach(SwitchSearchDifficulty.allCases) { d in
                    Text(d.label).tag(d)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 40)

            Button {
                engine.start()
            } label: {
                Text("Start")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Color.accentColor)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 40)

            Button("Exit") { dismiss() }
                .font(.headline.weight(.semibold))
                .foregroundStyle(.white.opacity(0.9))
                .padding(.top, 4)

            Spacer()
        }
        .padding()
    }

    // MARK: - Game

    private var gameScreen: some View {
        VStack(spacing: 10) {
            Text("Found \(engine.totalFound)")
                .font(.system(size: 34, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(.white)
                .padding(.top, 4)

            progressBar(
                label: "Game Timer",
                value: engine.sessionLeft,
                total: Double(engine.difficulty.sessionSeconds),
                tint: engine.isFrozen ? .cyan : .accentColor,
                frozen: engine.isFrozen
            )
            .padding(.horizontal)

            letterGrid
                .padding(.horizontal, 8)

            progressBar(
                label: "Word-Search Timer",
                value: engine.puzzleLeft,
                total: Double(engine.difficulty.puzzleSeconds),
                tint: .orange,
                frozen: false
            )
            .padding(.horizontal)

            Text("Find These Words:")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white.opacity(0.55))
                .frame(maxWidth: .infinity)

            HStack(alignment: .center, spacing: 10) {
                Button("Exit") { engine.exitToHome() }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 52, alignment: .leading)

                // Whole-word chips wrap to new rows; letters within a word never split.
                SwitchSearchHintFlow(spacing: 8) {
                    ForEach(Array(engine.hints.enumerated()), id: \.offset) { idx, hint in
                        let word = idx < engine.currentWords.count
                            ? engine.currentWords[idx].lowercased()
                            : ""
                        let isFound = engine.foundWords.contains(word)
                        Text(hint)
                            .font(.system(size: 22, weight: .bold, design: .rounded).monospaced())
                            .lineLimit(1)
                            .minimumScaleFactor(0.65)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(isFound ? Color.white : Color.white.opacity(0.12))
                            .foregroundStyle(isFound ? Color.black : Color.white)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .strikethrough(isFound, color: .black.opacity(0.5))
                    }
                }
                .frame(maxWidth: .infinity)

                Button("Skip") { engine.skipPuzzle() }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 52, alignment: .trailing)
            }
            .padding(.horizontal)
            .padding(.bottom, 8)
        }
        .padding(.top, 4)
    }

    private var letterGrid: some View {
        let size = engine.difficulty.gridSize
        return GeometryReader { geo in
            let gap: CGFloat = 3
            let side = min(geo.size.width, geo.size.height)
            let cellSize = (side - gap * CGFloat(size - 1)) / CGFloat(size)
            let gridSide = cellSize * CGFloat(size) + gap * CGFloat(size - 1)

            ZStack {
                VStack(spacing: gap) {
                    ForEach(engine.grid.indices, id: \.self) { r in
                        HStack(spacing: gap) {
                            ForEach(engine.grid[r]) { cellModel in
                                SwitchSearchLetterCell(
                                    cell: cellModel,
                                    selected: engine.isSelected(row: cellModel.row, col: cellModel.col),
                                    size: cellSize
                                )
                            }
                        }
                    }
                }
                .allowsHitTesting(false)

                SwitchSearchTouchPad(
                    gridSize: size,
                    cell: cellSize,
                    gap: gap,
                    onMove: { r, c in engine.pointerMoved(toRow: r, col: c) },
                    onEnd: { r, c in engine.pointerEnded(atRow: r, col: c) }
                )
                .frame(width: gridSide, height: gridSide)
            }
            .frame(width: gridSide, height: gridSide)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .aspectRatio(1, contentMode: .fit)
    }

    private func progressBar(
        label: String,
        value: Double,
        total: Double,
        tint: Color,
        frozen: Bool
    ) -> some View {
        let displaySeconds = Int(ceil(max(0, value)))
        let fraction = max(0, min(1, value / max(total, 0.0001)))
        return VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label)
                    .font(.caption2)
                    .foregroundStyle(frozen ? Color.cyan : Color.white.opacity(0.55))
                Spacer()
                Text("\(displaySeconds)s")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(frozen ? Color.cyan : Color.white.opacity(0.55))
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.12))
                    Capsule()
                        .fill(tint)
                        .frame(width: geo.size.width * fraction)
                }
            }
            .frame(height: 6)
            .overlay(
                Capsule()
                    .strokeBorder(frozen ? Color.cyan.opacity(0.9) : Color.clear, lineWidth: 1.5)
                    .padding(-3)
            )
            .shadow(color: frozen ? Color.cyan.opacity(0.55) : .clear, radius: frozen ? 6 : 0)
        }
    }

    // MARK: - End

    private var endScreen: some View {
        VStack(spacing: 20) {
            Spacer()
            Text("Time is up!")
                .font(.largeTitle.bold())
                .foregroundStyle(.white)
            Text("You found \(engine.totalFound) word\(engine.totalFound == 1 ? "" : "s").")
                .font(.title3)
                .foregroundStyle(.white.opacity(0.7))
            Button {
                engine.restart()
            } label: {
                Text("Play again")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Color.accentColor)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 40)
            Button("Exit") { engine.exitToHome() }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
            Spacer()
        }
    }
}

/// Extracted so Swift can type-check the grid without timing out.
private struct SwitchSearchLetterCell: View {
    let cell: SwitchSearchCell
    let selected: Bool
    let size: CGFloat

    private var inverted: Bool { selected || cell.found }

    private var fill: Color {
        if cell.unfoundFlash { return .gray }
        if inverted { return .white }
        return Color.white.opacity(0.08)
    }

    private var border: Color {
        inverted ? .white : Color.white.opacity(0.25)
    }

    var body: some View {
        Text(cell.letter)
            .font(.system(size: max(12, size * 0.42), weight: .bold, design: .rounded))
            .foregroundStyle(inverted ? Color.black : Color.white)
            .frame(width: size, height: size)
            .background(fill)
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .strokeBorder(border, lineWidth: 1)
            )
    }
}

/// Wraps whole chips onto new rows (centered); never splits text inside a chip.
private struct SwitchSearchHintFlow: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) -> CGSize {
        arrange(proposal: proposal, subviews: subviews).size
    }

    func placeSubviews(
        in bounds: CGRect,
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) {
        let result = arrange(proposal: proposal, subviews: subviews)
        for index in subviews.indices {
            let place = result.places[index]
            subviews[index].place(
                at: CGPoint(x: bounds.minX + place.origin.x, y: bounds.minY + place.origin.y),
                proposal: ProposedViewSize(width: place.size.width, height: place.size.height)
            )
        }
    }

    private func arrange(
        proposal: ProposedViewSize,
        subviews: Subviews
    ) -> (size: CGSize, places: [CGRect]) {
        let maxWidth = proposal.width ?? .infinity

        // Measure chips
        var chipSizes: [CGSize] = []
        chipSizes.reserveCapacity(subviews.count)
        for subview in subviews {
            let unrestricted = subview.sizeThatFits(.unspecified)
            let chipWidth = min(unrestricted.width, maxWidth)
            let chipHeight = subview
                .sizeThatFits(ProposedViewSize(width: chipWidth, height: nil))
                .height
            chipSizes.append(CGSize(width: chipWidth, height: chipHeight))
        }

        // Pack into rows (left-to-right), then center each row in maxWidth.
        var rows: [[Int]] = [[]]
        var rowWidths: [CGFloat] = [0]
        var rowHeights: [CGFloat] = [0]

        for (index, size) in chipSizes.enumerated() {
            let rowIndex = rows.count - 1
            let currentWidth = rowWidths[rowIndex]
            let nextWidth = currentWidth == 0
                ? size.width
                : currentWidth + spacing + size.width

            if currentWidth > 0, nextWidth > maxWidth {
                rows.append([index])
                rowWidths.append(size.width)
                rowHeights.append(size.height)
            } else {
                rows[rowIndex].append(index)
                rowWidths[rowIndex] = nextWidth
                rowHeights[rowIndex] = max(rowHeights[rowIndex], size.height)
            }
        }

        var places = Array(repeating: CGRect.zero, count: subviews.count)
        var y: CGFloat = 0
        for (rowIndex, indices) in rows.enumerated() {
            let rowWidth = rowWidths[rowIndex]
            let rowHeight = rowHeights[rowIndex]
            var x = maxWidth.isFinite ? max(0, (maxWidth - rowWidth) / 2) : 0
            for index in indices {
                let size = chipSizes[index]
                places[index] = CGRect(x: x, y: y, width: size.width, height: size.height)
                x += size.width + spacing
            }
            y += rowHeight
            if rowIndex < rows.count - 1 {
                y += spacing
            }
        }

        let totalWidth: CGFloat
        if maxWidth.isFinite {
            totalWidth = maxWidth
        } else {
            totalWidth = rowWidths.max() ?? 0
        }

        return (CGSize(width: totalWidth, height: y), places)
    }
}
