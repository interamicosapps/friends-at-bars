// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CapacitorBarfestNativeLiveLocation",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapacitorBarfestNativeLiveLocation",
            targets: ["BarFestNativeLiveLocationPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "7.0.0")
    ],
    targets: [
        .target(
            name: "BarFestNativeLiveLocationPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/BarFestNativeLiveLocationPlugin")
    ]
)
