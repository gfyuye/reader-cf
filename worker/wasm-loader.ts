let wasmModule: any = null;
let wasmAttempted = false;

export interface WasmChapter {
  index: number;
  title: string;
  url: string;
}

async function loadSourceBookWasm(): Promise<void> {
  if (wasmAttempted) return;
  wasmAttempted = true;
  try {
    // In Cloudflare Workers, use dynamic import with async init
    // In Node.js (testing), use initSync with wasm bytes
    // @ts-ignore - process is Node.js global
    if (typeof process !== 'undefined' && process.versions?.node) {
      // Node.js environment - read wasm file directly
      // @ts-ignore - fs/path are Node.js built-ins
      const fs = await import('fs');
      // @ts-ignore
      const path = await import('path');
      // @ts-ignore - __dirname is Node.js global
      const wasmPath = path.resolve(__dirname, 'wasm', 'source-book_bg.wasm');
      const wasmBytes = fs.readFileSync(wasmPath);
      const mod = await import('./wasm/source-book.js');
      // initSync expects { module: wasmBytes } object format (new wasm-bindgen API)
      mod.initSync({ module: wasmBytes });
      wasmModule = mod;
    } else {
      // Cloudflare Workers environment
      const mod = await import("./wasm/source-book.js");
      await mod.default();
      wasmModule = mod;
    }
  } catch (err: any) {
    wasmModule = null;
    console.warn("[SourceBookWasm] wasm parser not available, will fallback to TS builtin:", err.message || err);
  }
}

export function isWasmAvailable(): boolean {
  return wasmModule !== null;
}

/**
 * 调用 Wasm XPath 解析器提取目录章节。
 * 仅用于 ruleToc.chapterList 以 '/' 开头的 XPath 模式。
 * 未就绪时抛出错误，由调用方决定是否 fallback 到 TS 内置解析。
 */
export async function parseTocXpathWasm(
  html: string,
  xpathExpr: string,
  nameXpath: string,
  urlXpath: string,
  bookUrl: string
): Promise<WasmChapter[]> {
  await loadSourceBookWasm();
  if (!wasmModule) {
    throw new Error("Source-book Wasm parser not available");
  }
  const result: string = wasmModule.parse_toc_xpath(html, xpathExpr, nameXpath, urlXpath, bookUrl);
  const parsed = JSON.parse(result);
  if (parsed.error) {
    throw new Error(parsed.error);
  }
  const chapters = (parsed?.chapters || []).map((c: any) => ({
    index: c.index ?? 0,
    title: c.title,
    url: c.url,
  }));
  return chapters;
}