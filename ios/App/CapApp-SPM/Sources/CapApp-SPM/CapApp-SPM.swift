import NativeSettingsPlugin

public let isCapacitorApp = true

// MARK: - SPM: force-load native Capacitor plugins
// Swift/SPM can strip plugin types that are only reached from JavaScript. Without a
// concrete reference here, the runtime bridge reports "NativeSettings plugin is not
// implemented on ios" even though the NativeSettingsPlugin SPM product is linked.
private let _capacitorForceLoadNativeSettings: NativeSettingsPlugin.Type = NativeSettingsPlugin.self
