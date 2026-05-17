// excalidraw-desktop/electron/http-server.ts
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { parse as parseUrl } from "url";
import { dialog } from "electron";

const PORT = 19530;
const HOST = "127.0.0.1";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

let server: http.Server | null = null;
let rendererDir = "";

function getMimeType(ext: string): string {
  return MIME_TYPES[ext] || "application/octet-stream";
}

interface SimpleFileInfo {
  name: string;
  path: string;
  modifiedAt: number;
}

interface RecentProject {
  directory: string;
  lastFile: string | null;
  lastOpened: number;
}

const RECENT_PROJECTS_FILE = "recent-projects.json";
const MAX_RECENT_PROJECTS = 20;

function isPathSafe(unsafePath: string): boolean {
  try {
    const resolved = path.resolve(unsafePath);
    return !unsafePath.includes('\0');
  } catch {
    return false;
  }
}

function getRecentProjectsPath(userDataPath: string): string {
  return path.join(userDataPath, RECENT_PROJECTS_FILE);
}

function readRecentProjects(userDataPath: string): RecentProject[] {
  try {
    const filePath = getRecentProjectsPath(userDataPath);
    if (!fs.existsSync(filePath)) return [];
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return [];
  }
}

async function handleApiRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  userDataPath: string,
): Promise<void> {
  const url = parseUrl(req.url || "", true);
  const pathname = url.pathname || "";
  const query = url.query;

  const sendJson = (status: number, data: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data));
  };

  const sendError = (status: number, message: string) => {
    sendJson(status, { error: message });
  };

  const readBody = (): Promise<any> =>
    new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk: string) => (body += chunk));
      req.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error("Invalid JSON")); }
      });
    });

  // GET /api/health
  if (pathname === "/api/health" && req.method === "GET") {
    sendJson(200, { status: "ok", version: "0.1.0" });
    return;
  }

  // GET /api/files?dir=xxx
  if (pathname === "/api/files" && req.method === "GET") {
    const dir = query.dir as string;
    if (!dir) return sendError(400, "Missing 'dir' query parameter");
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files: SimpleFileInfo[] = entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".excalidraw"))
        .map((entry) => {
          const filePath = path.join(dir, entry.name);
          const stat = fs.statSync(filePath);
          return { name: entry.name, path: filePath, modifiedAt: stat.mtimeMs };
        })
        .sort((a, b) => b.modifiedAt - a.modifiedAt);
      sendJson(200, { files });
    } catch (err: any) { sendError(500, err.message); }
    return;
  }

  // GET /api/files/read?path=xxx
  if (pathname === "/api/files/read" && req.method === "GET") {
    const filePath = query.path as string;
    if (!filePath || !isPathSafe(filePath)) return sendError(400, "Invalid or missing 'path' parameter");
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const data = JSON.parse(content);
      sendJson(200, { data });
    } catch (err: any) {
      if (err instanceof SyntaxError) sendJson(422, { error: "corrupted" });
      else sendError(500, err.message);
    }
    return;
  }

  // POST /api/files/write
  if (pathname === "/api/files/write" && req.method === "POST") {
    try {
      const body = await readBody();
      if (!body.path || !body.content) return sendError(400, "Missing 'path' or 'content'");
      if (!isPathSafe(body.path)) return sendError(400, "Invalid path");
      JSON.parse(body.content);
      fs.writeFileSync(body.path, body.content, "utf-8");
      sendJson(200, { success: true });
    } catch (err: any) { sendError(500, err.message); }
    return;
  }

  // POST /api/files/create
  if (pathname === "/api/files/create" && req.method === "POST") {
    try {
      const body = await readBody();
      if (!body.dir || !body.name) return sendError(400, "Missing 'dir' or 'name'");
      const filePath = path.join(body.dir, body.name);
      if (!isPathSafe(filePath)) return sendError(400, "Invalid path");
      const emptyScene = JSON.stringify({
        type: "excalidraw", version: 2, source: "excalidraw-desktop",
        elements: [], appState: {}, files: {},
      });
      fs.writeFileSync(filePath, emptyScene, "utf-8");
      sendJson(200, { path: filePath });
    } catch (err: any) { sendError(500, err.message); }
    return;
  }

  // POST /api/files/rename
  if (pathname === "/api/files/rename" && req.method === "POST") {
    try {
      const body = await readBody();
      if (!body.oldPath || !body.newName) return sendError(400, "Missing 'oldPath' or 'newName'");
      if (!isPathSafe(body.oldPath)) return sendError(400, "Invalid path");
      if (/[/\\]/.test(body.newName)) return sendError(400, "文件名不能包含路径分隔符");
      const dir = path.dirname(body.oldPath);
      const newPath = path.join(dir, body.newName);
      if (fs.existsSync(newPath)) return sendError(409, "文件名已存在");
      fs.renameSync(body.oldPath, newPath);
      sendJson(200, { newPath });
    } catch (err: any) { sendError(500, err.message); }
    return;
  }

  // POST /api/files/delete
  if (pathname === "/api/files/delete" && req.method === "POST") {
    try {
      const body = await readBody();
      if (!body.filePath) return sendError(400, "Missing 'filePath'");
      if (!isPathSafe(body.filePath)) return sendError(400, "Invalid path");
      fs.unlinkSync(body.filePath);
      sendJson(200, { success: true });
    } catch (err: any) { sendError(500, err.message); }
    return;
  }

  // GET /api/files/poll?dir=xxx&since=timestamp
  if (pathname === "/api/files/poll" && req.method === "GET") {
    const dir = query.dir as string;
    if (!dir) return sendError(400, "Missing 'dir' query parameter");
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files: SimpleFileInfo[] = entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".excalidraw"))
        .map((entry) => {
          const filePath = path.join(dir, entry.name);
          const stat = fs.statSync(filePath);
          return { name: entry.name, path: filePath, modifiedAt: stat.mtimeMs };
        })
        .sort((a, b) => b.modifiedAt - a.modifiedAt);
      sendJson(200, { files });
    } catch (err: any) { sendError(500, err.message); }
    return;
  }

  // GET /api/projects/recent
  if (pathname === "/api/projects/recent" && req.method === "GET") {
    sendJson(200, readRecentProjects(userDataPath));
    return;
  }

  // POST /api/projects/recent
  if (pathname === "/api/projects/recent" && req.method === "POST") {
    try {
      const body = await readBody();
      const projects = readRecentProjects(userDataPath);
      const filtered = projects.filter((p: RecentProject) => p.directory !== body.directory);
      filtered.unshift(body);
      const recentPath = getRecentProjectsPath(userDataPath);
      fs.writeFileSync(recentPath, JSON.stringify(filtered.slice(0, MAX_RECENT_PROJECTS), null, 2));
      sendJson(200, { success: true });
    } catch (err: any) { sendError(500, err.message); }
    return;
  }

  // GET /api/directory/pick — open native OS picker
  // Query: mode=file|dir|both (default: both)
  if (pathname === "/api/directory/pick" && req.method === "GET") {
    const mode = (query.mode as string) || "both";
    try {
      const properties: Array<"openFile" | "openDirectory"> = [];
      if (mode === "file") properties.push("openFile");
      else if (mode === "dir") properties.push("openDirectory");
      else properties.push("openFile", "openDirectory");

      const options: Electron.OpenDialogOptions = { properties };
      if (mode !== "dir") {
        options.filters = [{ name: "Excalidraw", extensions: ["excalidraw"] }];
      }

      const result = await dialog.showOpenDialog(options);
      if (result.canceled || result.filePaths.length === 0) {
        sendJson(200, { canceled: true });
      } else {
        const selectedPath = path.resolve(result.filePaths[0]);
        const stats = fs.statSync(selectedPath);
        sendJson(200, {
          canceled: false,
          path: selectedPath,
          isDirectory: stats.isDirectory(),
          isFile: stats.isFile(),
        });
      }
    } catch (err: any) {
      sendError(500, err.message);
    }
    return;
  }

  // GET /api/directory/browse?path=xxx
  if (pathname === "/api/directory/browse" && req.method === "GET") {
    const dirPath = query.path as string;
    if (!dirPath || !isPathSafe(dirPath)) return sendError(400, "Invalid or missing 'path' parameter");
    try {
      const stat = fs.statSync(dirPath);
      if (!stat.isDirectory()) return sendError(400, "Path is not a directory");

      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const subdirs: { name: string; path: string }[] = [];
      const files: SimpleFileInfo[] = [];

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          subdirs.push({ name: entry.name, path: fullPath });
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".excalidraw")) {
          const stat = fs.statSync(fullPath);
          files.push({ name: entry.name, path: fullPath, modifiedAt: stat.mtimeMs });
        }
      }

      subdirs.sort((a, b) => a.name.localeCompare(b.name));
      files.sort((a, b) => b.modifiedAt - a.modifiedAt);

      const parentDir = dirPath === "/" ? null : path.resolve(dirPath, "..");

      sendJson(200, {
        currentDir: dirPath,
        parentDir: parentDir !== dirPath ? parentDir : null,
        subdirs,
        files,
      });
    } catch (err: any) { sendError(500, err.message); }
    return;
  }

  sendError(404, `Unknown endpoint: ${req.method} ${pathname}`);
}

function handleStaticFile(res: http.ServerResponse, filePath: string): void {
  const ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback: serve index.html for unknown paths
      const indexPath = path.join(rendererDir, "index.html");
      fs.readFile(indexPath, (err2, data2) => {
        if (err2) {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end("Internal server error");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(data2);
      });
      return;
    }
    res.writeHead(200, { "Content-Type": getMimeType(ext) });
    res.end(data);
  });
}

export function getServerPort(): number { return PORT; }

export function isServerRunning(): boolean { return server !== null; }

export function startServer(rendererDirPath: string, userDataPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (server) { resolve(); return; }
    rendererDir = rendererDirPath;
    if (!fs.existsSync(rendererDir)) {
      reject(new Error(`Renderer build output not found: ${rendererDir}`));
      return;
    }
    server = http.createServer((req, res) => {
      const url = parseUrl(req.url || "", true);
      const pathname = url.pathname || "";
      if (pathname.startsWith("/api/")) {
        handleApiRequest(req, res, userDataPath).catch((err) => {
          console.error("[WebUI] API handler error:", err);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Internal server error" }));
          }
        });
        return;
      }
      const filePath = path.join(rendererDir, pathname === "/" ? "index.html" : pathname);
      handleStaticFile(res, filePath);
    });
    server.listen(PORT, HOST, () => {
      console.log(`[WebUI] HTTP server running at http://${HOST}:${PORT}`);
      resolve();
    });
    server.on("error", (err: NodeJS.ErrnoException) => {
      server = null;
      reject(err.code === "EADDRINUSE"
        ? new Error(`Port ${PORT} is already in use. Please close the other program and try again.`)
        : err);
    });
  });
}

export function stopServer(): void {
  if (server) { server.close(); server = null; }
}
