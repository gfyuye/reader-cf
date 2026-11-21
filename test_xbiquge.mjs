import * as cheerio from 'cheerio';
import * as fs from 'fs';

const html = fs.readFileSync('/tmp/kilo/xbiquge_search.html', 'utf-8');
console.log('HTML length:', html.length);

const $ = cheerio.load(html, { decodeEntities: false });

// 查找 .lastupdate
const lastupdate = $('.lastupdate');
console.log('.lastupdate count:', lastupdate.length);
if (lastupdate.length > 0) {
  console.log('.lastupdate html length:', lastupdate.first().html()?.length || 0);
  console.log('.lastupdate text:', JSON.stringify(lastupdate.first().text().substring(0, 300)));
  console.log('.lastupdate children:', lastupdate.first().children().length);
  lastupdate.first().children().each((i, el) => {
    console.log(`  child ${i}:`, $(el).prop('tagName'), 'class:', $(el).attr('class'), 'text:', JSON.stringify($(el).text().substring(0, 100)));
  });
}

// 查找 ul.lastupdate 或 .lastupdate ul
const ulLastupdate = $('ul.lastupdate');
console.log('\nul.lastupdate count:', ulLastupdate.length);
const lastupdateUl = $('.lastupdate ul');
console.log('.lastupdate ul count:', lastupdateUl.length);

// 查找 li
const lis = $('li');
console.log('\nli count:', lis.length);

// 查找 .name 元素
const names = $('.name');
console.log('.name count:', names.length);
names.slice(0, 5).each((i, el) => {
  console.log(`  name ${i}:`, JSON.stringify($(el).text().substring(0, 100)), 'tag:', $(el).prop('tagName'));
});

// 查找 .zuo 元素
const zuos = $('.zuo');
console.log('\n.zuo count:', zuos.length);
zuos.slice(0, 5).each((i, el) => {
  console.log(`  zuo ${i}:`, JSON.stringify($(el).text().substring(0, 100)));
});

// 查找 .jie 元素
const jies = $('.jie');
console.log('\n.jie count:', jies.length);
jies.slice(0, 5).each((i, el) => {
  console.log(`  jie ${i}:`, JSON.stringify($(el).text().substring(0, 100)));
});

// 查找 .time 元素
const times = $('.time');
console.log('\n.time count:', times.length);
times.slice(0, 5).each((i, el) => {
  console.log(`  time ${i}:`, JSON.stringify($(el).text().substring(0, 100)));
});

// 查找 .lei 元素
const leis = $('.lei');
console.log('\n.lei count:', leis.length);
leis.slice(0, 5).each((i, el) => {
  console.log(`  lei ${i}:`, JSON.stringify($(el).text().substring(0, 100)));
});
