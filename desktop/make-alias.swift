// Creates a Finder alias (like ⌘L in the Finder) without scripting the Finder. Usage: make-alias <target> <alias path>
import Foundation

let args = CommandLine.arguments
guard args.count == 3 else { FileHandle.standardError.write("usage: make-alias <target> <alias>\n".data(using: .utf8)!); exit(2) }
let target = URL(fileURLWithPath: args[1]), alias = URL(fileURLWithPath: args[2])
do {
  let data = try target.bookmarkData(options: .suitableForBookmarkFile, includingResourceValuesForKeys: nil, relativeTo: nil)
  // Replace only a previous alias; never delete a file or folder that happens to have the same name.
  if FileManager.default.fileExists(atPath: alias.path) {
    guard (try? alias.resourceValues(forKeys: [.isAliasFileKey]).isAliasFile) == true else {
      FileHandle.standardError.write("make-alias: \(alias.path) existe déjà et n'est pas un alias : laissé tel quel.\n".data(using: .utf8)!)
      exit(1)
    }
    try FileManager.default.removeItem(at: alias)
  }
  try URL.writeBookmarkData(data, to: alias)
} catch {
  FileHandle.standardError.write("make-alias: \(error.localizedDescription)\n".data(using: .utf8)!)
  exit(1)
}
