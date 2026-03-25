// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "BarFestNativeMap",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "BarFestNativeMap",
            targets: ["BarFestNativeMapPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "7.6.0")
    ],
    targets: [
        .target(
            name: "BarFestNativeMapPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/BarFestNativeMapPlugin"
        )
    ]
)
