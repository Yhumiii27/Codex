// Codex.app — native macOS shell for the Codex web app.
// Starts the production server (next start) of the project it was built from, shows it in a WebKit window and
// stops the server when the app quits. Built by desktop/build-app.sh (npm run app).

import Cocoa
import WebKit

private let port = 3110
private let baseURL = URL(string: "http://127.0.0.1:\(port)/")!

private func info(_ key: String) -> String { Bundle.main.object(forInfoDictionaryKey: key) as? String ?? "" }

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
  private var window: NSWindow!
  private var webView: WKWebView!
  private var server: Process?
  private var logHandle: FileHandle?
  private var downloads: [ObjectIdentifier: URL] = [:]

  private let projectDir = info("CodexProjectDir")
  private let nodePath = info("CodexNodePath")
  private let supportDir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Codex", isDirectory: true)
  private let logURL = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0].appendingPathComponent("Logs/Codex/server.log")

  // MARK: Lifecycle

  func applicationDidFinishLaunching(_ notification: Notification) {
    buildMenu()
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default() // keeps the language and simulated-user cookies between launches
    webView = WKWebView(frame: .zero, configuration: config)
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.allowsBackForwardNavigationGestures = true
    webView.setValue(false, forKey: "drawsBackground") // no white flash: the page paints its own dark ground

    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
    window.title = "Codex — GED Groupe"
    window.minSize = NSSize(width: 1100, height: 680)
    window.backgroundColor = NSColor(red: 0x16 / 255, green: 0x18 / 255, blue: 0x26 / 255, alpha: 1)
    window.tabbingMode = .disallowed
    window.contentView = webView
    window.center()
    window.setFrameAutosaveName("CodexMain")
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)

    showStatus("Démarrage de Codex…")
    start()
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

  func applicationWillTerminate(_ notification: Notification) { stopServer() }

  // MARK: Server

  private func start() {
    DispatchQueue.global(qos: .userInitiated).async { [self] in
      if ping() { return DispatchQueue.main.async { self.webView.load(URLRequest(url: baseURL)) } }
      guard FileManager.default.fileExists(atPath: "\(projectDir)/package.json") else {
        return fail("Projet Codex introuvable : \(projectDir)\nReconstruisez l'app depuis le dossier du projet (npm run app).")
      }
      guard FileManager.default.isExecutableFile(atPath: nodePath) else {
        return fail("Node.js introuvable : \(nodePath)\nReconstruisez l'app (npm run app) après avoir installé Node.js.")
      }
      try? FileManager.default.createDirectory(at: supportDir.appendingPathComponent("data"), withIntermediateDirectories: true)
      try? FileManager.default.createDirectory(at: logURL.deletingLastPathComponent(), withIntermediateDirectories: true)
      if !FileManager.default.fileExists(atPath: logURL.path) { FileManager.default.createFile(atPath: logURL.path, contents: nil) }
      logHandle = try? FileHandle(forWritingTo: logURL)
      logHandle?.seekToEndOfFile()
      log("\n=== \(Date()) — Codex \(info("CFBundleShortVersionString"))")

      if needsBuild() {
        status("Compilation de Codex (première ouverture ou code modifié)…")
        let code = run(["node_modules/next/dist/bin/next", "build"], wait: true)
        if code != 0 { return fail("La compilation a échoué (code \(code)).") }
      }
      status("Démarrage du serveur…")
      server = Process()
      launchServer(server!)
      // The first launch also creates and seeds the database: allow a little time.
      for _ in 0..<240 {
        if server?.isRunning == false { return fail("Le serveur s'est arrêté au démarrage.") }
        if ping() { return DispatchQueue.main.async { self.webView.load(URLRequest(url: baseURL)) } }
        Thread.sleep(forTimeInterval: 0.5)
      }
      fail("Le serveur ne répond pas après 2 minutes.")
    }
  }

  private func environment() -> [String: String] {
    var env = ProcessInfo.processInfo.environment
    let nodeDir = (nodePath as NSString).deletingLastPathComponent
    env["PATH"] = "\(nodeDir):/usr/bin:/bin:/usr/sbin:/sbin"
    env["NODE_ENV"] = "production"
    env["NEXT_TELEMETRY_DISABLED"] = "1"
    env["CODEX_DATA_DIR"] = supportDir.appendingPathComponent("data").path
    env["DATABASE_URL"] = ""
    return env
  }

  private func launch(_ p: Process, _ args: [String]) {
    p.executableURL = URL(fileURLWithPath: nodePath)
    p.arguments = args
    p.currentDirectoryURL = URL(fileURLWithPath: projectDir)
    p.environment = environment()
    if let h = logHandle { p.standardOutput = h; p.standardError = h }
    do { try p.run() } catch { log("launch failed: \(error)") }
  }

  /// `next start` behind a small shell watchdog: the server also stops if the app is killed or crashes.
  private func launchServer(_ p: Process) {
    let script = """
    "$CODEX_NODE" node_modules/next/dist/bin/next start -p \(port) -H 127.0.0.1 &
    child=$!
    trap 'kill -TERM $child 2>/dev/null; wait $child; exit 0' TERM INT HUP
    while kill -0 "$CODEX_APP_PID" 2>/dev/null && kill -0 $child 2>/dev/null; do sleep 1; done
    kill -TERM $child 2>/dev/null; wait $child
    """
    p.executableURL = URL(fileURLWithPath: "/bin/sh")
    p.arguments = ["-c", script]
    p.currentDirectoryURL = URL(fileURLWithPath: projectDir)
    var env = environment()
    env["CODEX_NODE"] = nodePath
    env["CODEX_APP_PID"] = "\(ProcessInfo.processInfo.processIdentifier)"
    p.environment = env
    if let h = logHandle { p.standardOutput = h; p.standardError = h }
    do { try p.run() } catch { log("launch failed: \(error)") }
  }

  @discardableResult
  private func run(_ args: [String], wait: Bool) -> Int32 {
    let p = Process()
    launch(p, args)
    if wait { p.waitUntilExit() }
    return wait ? p.terminationStatus : 0
  }

  /// A production build is needed when there is none, or when the sources changed since the last one.
  private func needsBuild() -> Bool {
    let fm = FileManager.default
    let buildId = "\(projectDir)/.next/BUILD_ID"
    guard let built = (try? fm.attributesOfItem(atPath: buildId))?[.modificationDate] as? Date else { return true }
    for root in ["src", "drizzle"] {
      guard let e = fm.enumerator(at: URL(fileURLWithPath: "\(projectDir)/\(root)"), includingPropertiesForKeys: [.contentModificationDateKey]) else { continue }
      for case let url as URL in e {
        if let d = try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate, d > built { return true }
      }
    }
    for file in ["package.json", "next.config.ts", "package-lock.json"] {
      if let d = (try? fm.attributesOfItem(atPath: "\(projectDir)/\(file)"))?[.modificationDate] as? Date, d > built { return true }
    }
    return false
  }

  private func ping() -> Bool {
    var ok = false
    let sem = DispatchSemaphore(value: 0)
    var req = URLRequest(url: baseURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 2)
    req.httpMethod = "HEAD"
    URLSession.shared.dataTask(with: req) { _, resp, _ in
      ok = ((resp as? HTTPURLResponse)?.statusCode ?? 0) > 0
      sem.signal()
    }.resume()
    _ = sem.wait(timeout: .now() + 3)
    return ok
  }

  private func stopServer() {
    guard let p = server, p.isRunning else { return }
    p.terminate() // the watchdog stops next start, then exits
    let deadline = Date().addingTimeInterval(5)
    while p.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.1) }
    if p.isRunning {
      let kill = Process()
      kill.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
      kill.arguments = ["-KILL", "-P", "\(p.processIdentifier)"]
      try? kill.run(); kill.waitUntilExit()
      Darwin.kill(p.processIdentifier, SIGKILL)
    }
  }

  private func log(_ s: String) { logHandle?.write((s + "\n").data(using: .utf8)!) }

  // MARK: Status pages

  private func page(_ body: String) -> String {
    """
    <!doctype html><html><head><meta charset="utf-8"><style>
    html,body{height:100%;margin:0;background:#161826;color:#e9e9ed;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Inter",sans-serif}
    .c{height:100%;display:grid;place-items:center}.b{display:flex;flex-direction:column;align-items:center;gap:14px;max-width:560px;text-align:center}
    .logo{width:44px;height:44px;border:1px solid #9184d9;border-radius:10px;display:grid;place-items:center;color:#9184d9;box-shadow:0 0 22px rgba(145,132,217,.35)}
    h1{font-weight:500;font-size:18px;margin:0}.m{color:rgba(233,233,237,.55)}pre{white-space:pre-wrap;color:rgba(233,233,237,.7);font-size:12px}
    button{font:inherit;color:#9184d9;background:transparent;border:1px solid #9184d9;border-radius:8px;padding:6px 14px;cursor:pointer}
    .dot{width:6px;height:6px;border-radius:50%;background:#9184d9;animation:p 1.2s infinite}@keyframes p{50%{opacity:.25}}
    </style></head><body><div class="c"><div class="b">
    <div class="logo"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l4 4v14H6zM15 3v4h4M9 12h6M9 16h6"/></svg></div>
    <h1>Codex</h1>\(body)</div></div></body></html>
    """
  }

  private func showStatus(_ text: String) {
    webView.loadHTMLString(page("<div class=\"dot\"></div><div class=\"m\" id=\"s\">\(text)</div>"), baseURL: nil)
  }

  private func status(_ text: String) {
    DispatchQueue.main.async {
      let js = "document.getElementById('s') && (document.getElementById('s').textContent = \(Self.jsString(text)))"
      self.webView.evaluateJavaScript(js, completionHandler: nil)
    }
  }

  private func fail(_ message: String) {
    log("error: \(message)")
    DispatchQueue.main.async {
      let html = self.page("<div>\(message.replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: "\n", with: "<br>"))</div><pre>Journal : \(self.logURL.path)</pre><button onclick=\"location.href='codex://retry'\">Réessayer</button>")
      self.webView.loadHTMLString(html, baseURL: nil)
    }
  }

  private static func jsString(_ s: String) -> String {
    let data = try! JSONSerialization.data(withJSONObject: [s])
    return String(String(data: data, encoding: .utf8)!.dropFirst().dropLast())
  }

  // MARK: Navigation

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
    guard let url = action.request.url else { return decisionHandler(.allow) }
    if url.scheme == "codex" {
      decisionHandler(.cancel)
      stopServer(); showStatus("Nouvelle tentative…"); start()
      return
    }
    if action.shouldPerformDownload { return decisionHandler(.download) }
    // Links to other apps (Keystone, Vigie) or the web open in the default browser.
    let local = url.host == "127.0.0.1" || url.host == "localhost"
    if !local && (url.scheme == "http" || url.scheme == "https" || url.scheme == "mailto") {
      NSWorkspace.shared.open(url)
      return decisionHandler(.cancel)
    }
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping @MainActor @Sendable (WKNavigationResponsePolicy) -> Void) {
    let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
    if disposition.lowercased().hasPrefix("attachment") || !response.canShowMIMEType { return decisionHandler(.download) }
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    if webView.url?.scheme == "http" { log("page: \(webView.url!.absoluteString)") }
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    log("navigation failed: \(error.localizedDescription)")
    if (error as NSError).code != NSURLErrorCancelled, server?.isRunning != true { fail("Le serveur Codex ne répond plus.") }
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

  /// target=_blank: open in the default browser.
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = action.request.url { NSWorkspace.shared.open(url) }
    return nil
  }

  // MARK: Downloads → ~/Downloads

  func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping @MainActor @Sendable (URL?) -> Void) {
    let dir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
    let base = (suggestedFilename as NSString).deletingPathExtension, ext = (suggestedFilename as NSString).pathExtension
    var url = dir.appendingPathComponent(suggestedFilename)
    var n = 2
    while FileManager.default.fileExists(atPath: url.path) {
      url = dir.appendingPathComponent(ext.isEmpty ? "\(base) (\(n))" : "\(base) (\(n)).\(ext)"); n += 1
    }
    downloads[ObjectIdentifier(download)] = url
    completionHandler(url)
  }

  func downloadDidFinish(_ download: WKDownload) {
    if let url = downloads.removeValue(forKey: ObjectIdentifier(download)) {
      DistributedNotificationCenter.default().post(name: .init("com.apple.DownloadFileFinished"), object: url.path)
      NSApp.requestUserAttention(.informationalRequest)
    }
  }

  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    downloads.removeValue(forKey: ObjectIdentifier(download))
    alert("Le téléchargement a échoué.", error.localizedDescription)
  }

  // MARK: Panels (file inputs, confirm, alert)

  func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable ([URL]?) -> Void) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection
    panel.canChooseDirectories = false
    panel.canChooseFiles = true
    panel.beginSheetModal(for: window) { r in completionHandler(r == .OK ? panel.urls : nil) }
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable (Bool) -> Void) {
    let a = NSAlert()
    a.messageText = message
    a.addButton(withTitle: "OK")
    a.addButton(withTitle: "Annuler")
    a.beginSheetModal(for: window) { r in completionHandler(r == .alertFirstButtonReturn) }
  }

  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable () -> Void) {
    let a = NSAlert()
    a.messageText = message
    a.beginSheetModal(for: window) { _ in completionHandler() }
  }

  private func alert(_ title: String, _ text: String) {
    let a = NSAlert()
    a.messageText = title
    a.informativeText = text
    a.beginSheetModal(for: window, completionHandler: nil)
  }

  // MARK: Menu

  private func buildMenu() {
    let main = NSMenu()
    func add(_ title: String, _ items: [NSMenuItem]) {
      let top = NSMenuItem(); let menu = NSMenu(title: title)
      items.forEach(menu.addItem); top.submenu = menu; main.addItem(top)
    }
    func item(_ title: String, _ action: Selector?, _ key: String, _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
      let i = NSMenuItem(title: title, action: action, keyEquivalent: key); i.keyEquivalentModifierMask = mods; return i
    }
    add("Codex", [
      item("À propos de Codex", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), ""),
      .separator(),
      item("Masquer Codex", #selector(NSApplication.hide(_:)), "h"),
      item("Masquer les autres", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
      .separator(),
      item("Quitter Codex", #selector(NSApplication.terminate(_:)), "q"),
    ])
    // Standard edit actions so copy / paste / undo work in the page's fields.
    add("Édition", [
      item("Annuler", Selector(("undo:")), "z"),
      item("Rétablir", Selector(("redo:")), "z", [.command, .shift]),
      .separator(),
      item("Couper", #selector(NSText.cut(_:)), "x"),
      item("Copier", #selector(NSText.copy(_:)), "c"),
      item("Coller", #selector(NSText.paste(_:)), "v"),
      item("Tout sélectionner", #selector(NSText.selectAll(_:)), "a"),
    ])
    add("Présentation", [
      item("Recharger", #selector(reload), "r"),
      item("Accueil", #selector(goHome), "h", [.command, .shift]),
      .separator(),
      item("Taille réelle", #selector(zoomReset), "0"),
      item("Agrandir", #selector(zoomIn), "+"),
      item("Réduire", #selector(zoomOut), "-"),
      .separator(),
      item("Ouvrir dans le navigateur", #selector(openInBrowser), "o", [.command, .shift]),
      item("Afficher le journal du serveur", #selector(showLog), ""),
    ])
    add("Navigation", [
      item("Précédent", #selector(goBack), "["),
      item("Suivant", #selector(goForward), "]"),
    ])
    add("Fenêtre", [
      item("Placer dans le Dock", #selector(NSWindow.performMiniaturize(_:)), "m"),
      item("Réduire / agrandir", #selector(NSWindow.performZoom(_:)), ""),
    ])
    NSApp.mainMenu = main
  }

  @objc private func reload() { if webView.url?.scheme == "http" { webView.reload() } }
  @objc private func goHome() { webView.load(URLRequest(url: baseURL)) }
  @objc private func goBack() { webView.goBack() }
  @objc private func goForward() { webView.goForward() }
  @objc private func zoomReset() { webView.pageZoom = 1 }
  @objc private func zoomIn() { webView.pageZoom = min(webView.pageZoom + 0.1, 2) }
  @objc private func zoomOut() { webView.pageZoom = max(webView.pageZoom - 0.1, 0.6) }
  @objc private func openInBrowser() { NSWorkspace.shared.open(webView.url?.scheme == "http" ? webView.url! : baseURL) }
  @objc private func showLog() { NSWorkspace.shared.open(logURL) }
}

signal(SIGTERM, SIG_IGN)
let sigterm = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
sigterm.setEventHandler { NSApp.terminate(nil) }
sigterm.resume()

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
