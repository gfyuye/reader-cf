# reader-wasm-parser

WASM 解析器，用于书源目录页章节列表提取。

## 功能

- 支持 **CSS/legacy 选择器** 解析 HTML 目录页（对应 `ruleToc.chapterList`、`chapterName`、`chapterUrl`）
- 支持 **JSONPath** 解析 JSON 格式目录数据
- 自动处理相对 URL → 绝对 URL
- `@js:` / `<js>` 规则**不支持**（返回错误，由 TS 侧 fallback 处理）

## 接口

```rust
#[wasm_bindgen]
pub fn parse_toc(html: String, source_json: String, book_url: String) -> Result<String, JsValue>
```

**输入**：
- `html` — 目录页原始 HTML 或 JSON 字符串
- `source_json` — 书源完整 JSON（含 `ruleToc`）
- `book_url` — 目录页 URL（用于补全相对链接）

**输出**：JSON 字符串
```json
{
  "chapters": [
    {"index": 0, "title": "第一章", "url": "https://..."},
    {"index": 1, "title": "第二章", "url": "https://..."}
  ]
}
```

## 构建

```bash
# 需要 wasm32-unknown-unknown target
rustup target add wasm32-unknown-unknown

# 安装 wasm-pack
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

# 编译为 web 目标（生成 ES 模块 + .wasm）
cd /workspaces/reader-cf/wasm-parser
wasm-pack build --target web --out-dir ../worker/wasm
```

产出：
- `worker/wasm/source-book.js` — wasm-bindgen 胶水代码
- `worker/wasm/source-book_bg.wasm` — Wasm 二进制

## TS 侧加载

`worker/wasm-loader.ts` 会动态 `import("./wasm/source-book")`，若加载失败自动 fallback 到 TS 内置解析器。

## 与 rust-bk 关系

本 crate 为 **reader-cf 独立复刻**，仅包含 Wasm 所需的最小依赖（scraper、jsonpath_lib、regex、serde、wasm-bindgen），不依赖 tokio/reqwest/rquickjs 等非 wasm 兼容 crate。

完整规则引擎（XPath、Regex、JS 沙箱、format_js、loginCheckJs 等）仍在 `rust-bk/src/parser/rule_engine.rs`，后续可按需移植。