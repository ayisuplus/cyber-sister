import UIKit
import WebKit
import Capacitor
import Security

@objc(AmieViewController)
class AmieViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(SessionVaultPlugin())
        let script = WKUserScript(source: textSizeScript(), injectionTime: .atDocumentEnd, forMainFrameOnly: true)
        webView?.configuration.userContentController.addUserScript(script)
        NotificationCenter.default.addObserver(self, selector: #selector(updateTextSize), name: UIContentSizeCategory.didChangeNotification, object: nil)
    }

    private func textSizeScript() -> String {
        let scale = UIFont.preferredFont(forTextStyle: .body).pointSize / 17.0
        return "document.documentElement.dataset.native='ios';document.documentElement.style.setProperty('--native-line','\(34.0 * scale)px');document.documentElement.style.setProperty('--native-hand-size','\(17.0 * scale)px');document.documentElement.style.setProperty('--native-print-size','\(16.0 * scale)px');document.documentElement.style.fontSize='\(16.0 * scale)px';window.dispatchEvent(new Event('resize'));"
    }

    @objc private func updateTextSize() {
        webView?.evaluateJavaScript(textSizeScript(), completionHandler: nil)
    }

    deinit { NotificationCenter.default.removeObserver(self) }
}

@objc(SessionVaultPlugin)
class SessionVaultPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "SessionVaultPlugin"
    let jsName = "SessionVault"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise)
    ]

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: (Bundle.main.bundleIdentifier ?? "com.amie.companion.dev") + ".session",
         kSecAttrAccount as String: "refreshToken"]
    }

    @objc func read(_ call: CAPPluginCall) {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { call.resolve(); return }
        guard status == errSecSuccess, let data = result as? Data, let value = String(data: data, encoding: .utf8) else {
            call.reject("无法读取登录凭据", "KEYCHAIN_READ"); return
        }
        call.resolve(["value": value])
    }

    @objc func write(_ call: CAPPluginCall) {
        guard let value = call.getString("value"), !value.isEmpty, value.utf8.count <= 4096 else {
            call.reject("登录凭据无效", "KEYCHAIN_INPUT"); return
        }
        let attributes: [String: Any] = [
            kSecValueData as String: Data(value.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil)
        }
        guard status == errSecSuccess else { call.reject("无法保存登录凭据", "KEYCHAIN_WRITE"); return }
        call.resolve()
    }

    @objc func clear(_ call: CAPPluginCall) {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            call.reject("无法清除登录凭据", "KEYCHAIN_CLEAR"); return
        }
        call.resolve()
    }
}
