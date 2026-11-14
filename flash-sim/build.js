// Inlines src/core.js and src/app.js into src/page.html.
// Writes muzzle-flash-aspect.html (page content, published as an artifact) and index.html (open directly in a browser).
'use strict';
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const read = f => fs.readFileSync(path.join(dir, 'src', f), 'utf8');
const page = read('page.html').split('/*@CORE*/').join(read('core.js')).split('/*@APP*/').join(read('app.js'));
if (page.includes('</script>', page.indexOf('<script id="core-src">') + 30) === false) throw new Error('script tags missing');
fs.writeFileSync(path.join(dir, 'muzzle-flash-aspect.html'), page);
const doc = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n' + page + '\n</body>\n</html>\n';
fs.writeFileSync(path.join(dir, 'index.html'), doc);
console.log('wrote muzzle-flash-aspect.html and index.html (' + Math.round(doc.length / 1024) + ' KB)');
