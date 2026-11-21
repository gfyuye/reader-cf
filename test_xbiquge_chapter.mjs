import * as cheerio from 'cheerio';
import * as fs from 'fs';

const html = fs.readFileSync('/tmp/kilo/xbiquge_chapter.html', 'utf-8');
console.log('HTML length:', html.length);

const $ = cheerio.load(html, { decodeEntities: false });

const txt = $('#txt');
console.log('\n=== #txt element ===');
console.log('count:', txt.length);
console.log('html length:', txt.html()?.length || 0);
console.log('text length:', txt.text().length);
console.log('text preview:', JSON.stringify(txt.text().substring(0, 500)));
console.log('html preview:', JSON.stringify(txt.html()?.substring(0, 500)));

// 检查 textNodes 方式
const textNodes = txt.contents().filter((i, e) => e.type === 'text');
console.log('\n=== textNodes ===');
console.log('count:', textNodes.length);
textNodes.slice(0, 5).each((i, e) => {
  console.log(`  node ${i}:`, JSON.stringify($(e).text().substring(0, 100)));
});

// 看看 #txt 下面的所有子节点
console.log('\n=== #txt children ===');
txt.children().each((i, e) => {
  console.log(`  child ${i}:`, $(e).prop('tagName'), 'text:', JSON.stringify($(e).text().substring(0, 100)), 'html:', $(e).html()?.substring(0, 100)));
});
