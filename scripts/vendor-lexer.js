// Erzeugt shared/vendor/es-module-lexer.js aus node_modules (nach einem Update von es-module-lexer ausführen)
const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'node_modules/es-module-lexer/package.json'));
const src = fs.readFileSync(path.join(root, 'node_modules/es-module-lexer/dist/lexer.asm.js'), 'utf8');
const lic = `// es-module-lexer ${pkg.version} (asm.js-Build) – MIT License, Copyright (C) 2018-2022 Guy Bedford. https://github.com/guybedford/es-module-lexer\n// Automatisch erzeugt (scripts/vendor-lexer.js). Der Quelltext wird als Blob-Modul geladen, um import-Pfade zu finden.\n`;
fs.writeFileSync(path.join(root, 'shared/vendor/es-module-lexer.js'), lic + "(function (root, factory) { const s = factory(); if (typeof module === 'object' && module.exports) module.exports = s; else root.CodenLexerSrc = s; })(typeof self !== 'undefined' ? self : this, function () { return " + JSON.stringify(src).replace(/<\//g, '<\\/') + '; });\n');
console.log('shared/vendor/es-module-lexer.js geschrieben');
