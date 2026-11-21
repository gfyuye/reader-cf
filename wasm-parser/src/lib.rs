use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use sxd_document::parser::parse;
use sxd_xpath::{Context, Factory, Value as XPathValue};

#[wasm_bindgen]
extern "C" {}

#[derive(Serialize, Deserialize)]
struct XPathResult {
    chapters: Vec<XPathChapter>,
    error: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct XPathChapter {
    index: i32,
    title: String,
    url: String,
}

fn extract_base_url(book_url: &str) -> String {
    let mut s = book_url.trim();
    // Find the last '/' before query or fragment
    let path_end = s.find('?').or_else(|| s.find('#')).unwrap_or(s.len());
    let path_part = &s[..path_end];
    
    // If path ends with '/', it's a directory, use as-is
    // Otherwise, strip the last segment (filename) to get directory
    if path_part.ends_with('/') {
        return path_part.to_string();
    }
    if let Some(last_slash) = path_part.rfind('/') {
        // Check if there's a protocol (http:// or https://)
        if let Some(proto_end) = path_part.find("://") {
            if last_slash > proto_end + 2 {
                return path_part[..=last_slash].to_string();
            }
        }
    }
    // Fallback: just return domain
    if let Some(idx) = s.find("://") {
        if let Some(idx2) = s[idx + 3..].find('/') {
            return s[..idx + 3 + idx2 + 1].to_string(); // include trailing slash
        }
        return format!("{}/", s);
    }
    format!("https://{}/", s)
}

fn absolute_url(base_url: &str, url: &str) -> String {
    if url.starts_with("//") {
        // Protocol-relative URL
        let proto = if base_url.starts_with("http://") { "http:" } else { "https:" };
        return format!("{}{}", proto, url);
    }
    if url.starts_with("http://") || url.starts_with("https://") {
        return url.to_string();
    }
    if url.starts_with('/') {
        // Absolute path - resolve against domain root
        let domain_end = if let Some(proto_end) = base_url.find("://") {
            base_url[proto_end + 3..].find('/').map(|i| proto_end + 3 + i).unwrap_or(base_url.len())
        } else {
            base_url.find('/').unwrap_or(base_url.len())
        };
        return format!("{}{}", &base_url[..domain_end], url);
    }
    if url.is_empty() {
        return String::new();
    }
    // Relative path - resolve against base_url (which ends with /)
    let base = if base_url.ends_with('/') { base_url } else { &format!("{}/", base_url) };
    format!("{}{}", base, url)
}

/// 解析 XPath 规则提取章节列表
/// html: 目录页 HTML 字符串
/// xpath_expr: XPath 表达式（如 //div[@id="list"]/dl/dd/a）
/// name_xpath: 章节标题相对 XPath（如 ./text() 或 @title）
/// url_xpath: 章节链接相对 XPath（如 ./@href）
/// book_url: 目录页 URL（用于补全相对链接）
#[wasm_bindgen]
pub fn parse_toc_xpath(
    html: String,
    xpath_expr: String,
    name_xpath: String,
    url_xpath: String,
    book_url: String,
) -> String {
    let result = parse_toc_xpath_impl(html, xpath_expr, name_xpath, url_xpath, book_url);
    serde_json::to_string(&result).unwrap()
}

fn parse_toc_xpath_impl(
    html: String,
    xpath_expr: String,
    name_xpath: String,
    url_xpath: String,
    book_url: String,
) -> XPathResult {
    if xpath_expr.trim().is_empty() {
        return XPathResult { chapters: vec![], error: None };
    }

    let base_url = extract_base_url(&book_url);

    let package = match parse(&html) {
        Ok(p) => p,
        Err(e) => return XPathResult { chapters: vec![], error: Some(format!("HTML parse error: {e}")) },
    };
    let document = package.as_document();

    let factory = Factory::new();
    let xpath = match factory.build(&xpath_expr) {
        Ok(Some(x)) => x,
        Ok(None) => return XPathResult { chapters: vec![], error: Some("XPath compile failed".to_string()) },
        Err(e) => return XPathResult { chapters: vec![], error: Some(format!("XPath compile error: {e}")) },
    };

    let context = Context::new();
    let nodeset = match xpath.evaluate(&context, document.root()) {
        Ok(XPathValue::Nodeset(ns)) => ns,
        Ok(_) => return XPathResult { chapters: vec![], error: Some("XPath result is not a nodeset".to_string()) },
        Err(e) => return XPathResult { chapters: vec![], error: Some(format!("XPath eval error: {e}")) },
    };

    // Compile relative XPaths for name/url
    let name_xpath_compiled = if name_xpath.trim().is_empty() {
        None
    } else {
        match factory.build(&name_xpath) {
            Ok(Some(x)) => Some(x),
            Ok(None) => return XPathResult { chapters: vec![], error: Some("name_xpath compile failed".to_string()) },
            Err(e) => return XPathResult { chapters: vec![], error: Some(format!("name_xpath compile error: {e}")) },
        }
    };
    let url_xpath_compiled = if url_xpath.trim().is_empty() {
        None
    } else {
        match factory.build(&url_xpath) {
            Ok(Some(x)) => Some(x),
            Ok(None) => return XPathResult { chapters: vec![], error: Some("url_xpath compile failed".to_string()) },
            Err(e) => return XPathResult { chapters: vec![], error: Some(format!("url_xpath compile error: {e}")) },
        }
    };

    let mut chapters = Vec::new();
    for (idx, node) in nodeset.document_order().iter().enumerate() {
        // Get title
        let title = if let Some(ref name_xp) = name_xpath_compiled {
            let ctx = Context::new();
            match name_xp.evaluate(&ctx, *node) {
                Ok(XPathValue::String(s)) => s,
                Ok(XPathValue::Nodeset(ns)) => ns
                    .document_order()
                    .iter()
                    .map(|n| n.string_value())
                    .collect::<Vec<_>>()
                    .join(""),
                _ => String::new(),
            }
        } else {
            node.string_value()
        };

        // Get URL
        let url = if let Some(ref url_xp) = url_xpath_compiled {
            let ctx = Context::new();
            match url_xp.evaluate(&ctx, *node) {
                Ok(XPathValue::String(s)) => s,
                Ok(XPathValue::Nodeset(ns)) => ns
                    .document_order()
                    .iter()
                    .map(|n| n.string_value())
                    .collect::<Vec<_>>()
                    .join(""),
                _ => String::new(),
            }
        } else {
            String::new()
        };

        let title = title.trim().to_string();
        let url = absolute_url(&base_url, url.trim());

        if !title.is_empty() && !url.is_empty() {
            chapters.push(XPathChapter {
                index: idx as i32,
                title,
                url,
            });
        }
    }

    XPathResult { chapters, error: None }
}