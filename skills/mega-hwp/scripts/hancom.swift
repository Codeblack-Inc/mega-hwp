// 한컴오피스 한글(macOS)로 문서를 열어 화면을 쪽 단위로 캡처한다 — 실제 한컴 조판 결과를 검수하기 위함.
//
//   swift hancom.swift <file.hwp> <outdir> [screens]
//
// - 사용자의 열린 창을 건드리지 않도록 파일을 임시 이름으로 복사해 열고, 끝나면 그 창만 닫는다.
// - 한컴 창만 캡처한다 (screencapture -l).
// - 필요 권한(시스템 설정 → 개인정보 보호 및 보안): 화면 기록 + 손쉬운 사용
//   대상은 명령을 실행하는 앱 (Claude Code라면 ~/Library/Application Support/Claude/claude-code/<버전>/claude.app)
import AppKit
import ApplicationServices

func fail(_ m: String) -> Never { FileHandle.standardError.write((m + "\n").data(using: .utf8)!); exit(1) }

let args = CommandLine.arguments
guard args.count >= 3 else { fail("usage: swift hancom.swift <file.hwp> <outdir> [screens]") }
let src = URL(fileURLWithPath: args[1])
let outDir = URL(fileURLWithPath: args[2])
let screens = args.count > 3 ? Int(args[3])! : 6

guard AXIsProcessTrusted() else { fail("손쉬운 사용 권한이 없습니다. 시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용에 이 명령을 실행하는 앱을 추가하세요.") }
guard let hancom = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.hancom.office.hwp12.mac.general")
  ?? ["/Applications/Hancom Office HWP.app", "/Applications/Hancom Office HWP 2024.app"].map(URL.init(fileURLWithPath:)).first(where: { FileManager.default.fileExists(atPath: $0.path) })
else { fail("한컴오피스 한글이 설치되어 있지 않습니다.") }

// 임시 이름으로 복사 — 같은 이름의 창이 이미 열려 있으면 한컴이 옛 내용을 보여 주기 때문
let stamp = Int(Date().timeIntervalSince1970)
let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("\(src.deletingPathExtension().lastPathComponent)-검수\(stamp).\(src.pathExtension)")
try? FileManager.default.removeItem(at: tmp)
do { try FileManager.default.copyItem(at: src, to: tmp) } catch { fail("복사 실패: \(error)") }
defer { try? FileManager.default.removeItem(at: tmp) }

let cfg = NSWorkspace.OpenConfiguration()
let sem = DispatchSemaphore(value: 0)
NSWorkspace.shared.open([tmp], withApplicationAt: hancom, configuration: cfg) { _, _ in sem.signal() }
sem.wait()

func hancomApp() -> NSRunningApplication? {
  NSWorkspace.shared.runningApplications.first { ($0.bundleURL?.path ?? "") == hancom.path }
}
func attr<T>(_ e: AXUIElement, _ k: String) -> T? {
  var v: CFTypeRef?
  AXUIElementCopyAttributeValue(e, k as CFString, &v)
  return v as? T
}

// 문서 창이 뜰 때까지 기다린다 (최대 30초)
let title = tmp.lastPathComponent
var app: NSRunningApplication?
var win: AXUIElement?
for _ in 0..<60 {
  app = hancomApp()
  if let a = app {
    let wins: [AXUIElement] = attr(AXUIElementCreateApplication(a.processIdentifier), kAXWindowsAttribute) ?? []
    win = wins.first { (attr($0, kAXTitleAttribute) as String?)?.contains(title) == true }
    if win != nil { break }
  }
  usleep(500_000)
}
guard let app, let win else { fail("한컴 창을 찾지 못했습니다: \(title)") }

app.activate()
AXUIElementPerformAction(win, kAXRaiseAction as CFString)
var pos = CGPoint(x: 0, y: 25), size = CGSize(width: 900, height: 1100)
AXUIElementSetAttributeValue(win, kAXPositionAttribute as CFString, AXValueCreate(.cgPoint, &pos)!)
AXUIElementSetAttributeValue(win, kAXSizeAttribute as CFString, AXValueCreate(.cgSize, &size)!)
usleep(1_500_000)

// 캡처할 창 번호 (CGWindowList)
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
guard let wid = list.first(where: { ($0[kCGWindowOwnerPID as String] as? Int32) == app.processIdentifier && (($0[kCGWindowName as String] as? String) ?? "").contains(title) })?[kCGWindowNumber as String] as? Int
else { fail("창 번호를 찾지 못했습니다. 화면 기록 권한을 확인하세요.") }

func key(_ code: CGKeyCode, _ flags: CGEventFlags = []) {
  for down in [true, false] {
    let e = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down)!
    e.flags = flags
    e.postToPid(app.processIdentifier)
  }
  usleep(200_000)
}

try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
var last = Data()
var n = 0
for _ in 0..<screens {
  let out = outDir.appendingPathComponent(String(format: "hancom-%02d.png", n + 1))
  let p = Process()
  p.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
  p.arguments = ["-x", "-o", "-l", String(wid), out.path]
  try? p.run(); p.waitUntilExit()
  guard let data = try? Data(contentsOf: out), !data.isEmpty else { fail("캡처 실패. 화면 기록 권한을 확인하세요.") }
  if data == last { try? FileManager.default.removeItem(at: out); break } // 끝까지 내려감
  last = data
  n += 1
  print(out.path)
  key(121) // Page Down
  usleep(700_000)
}

key(13, .maskCommand) // ⌘W — 방금 연 임시 문서만 닫는다 (수정하지 않았으므로 저장 질문 없음)
