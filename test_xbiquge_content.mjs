import { extractTextFromHtml } from '/workspaces/reader-cf/worker/handlers/source-book.ts';
import * as fs from 'fs';

async function main() {
  const html = fs.readFileSync('/tmp/kilo/xbiquge_chapter.html', 'utf-8');
  console.log('HTML length:', html.length);

  // 测试 #txt@textNodes
  const result1 = extractTextFromHtml(html, '#txt@textNodes');
  console.log('\n=== #txt@textNodes ===');
  console.log('length:', result1.length);
  console.log('preview:', JSON.stringify(result1.substring(0, 300)));

  // 测试 #txt@text
  const result2 = extractTextFromHtml(html, '#txt@text');
  console.log('\n=== #txt@text ===');
  console.log('length:', result2.length);
  console.log('preview:', JSON.stringify(result2.substring(0, 300)));

  // 测试 #txt@html
  const result3 = extractTextFromHtml(html, '#txt@html');
  console.log('\n=== #txt@html ===');
  console.log('length:', result3.length);
  console.log('preview:', JSON.stringify(result3.substring(0, 300)));

  // 检查页面中是否有 #txt 元素
  const hasTxt = html.includes('id="txt"');
  console.log('\nContains id="txt":', hasTxt);
}

main();
