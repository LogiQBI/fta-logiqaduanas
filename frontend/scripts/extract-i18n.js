/* Extrae los textos visibles de la UI (page.tsx) para armar el diccionario
 * ES→EN: JSXText, atributos de texto, arreglos head=[...], propiedades
 * label/desc/title/hint/txt de objetos, y argumentos string de setMsg/setErr.
 * Uso: node scripts/extract-i18n.js > /tmp/i18n_strings.txt */
const ts = require("typescript");
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "src", "app", "page.tsx");
const src = fs.readFileSync(file, "utf8");
const sf = ts.createSourceFile("page.tsx", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

const TEXT_ATTRS = new Set(["placeholder", "title", "label", "desc", "hint", "caption"]);
const OBJ_PROPS = new Set(["label", "desc", "title", "hint", "txt"]);
const out = new Set();

function looksHuman(s) {
  const v = s.trim();
  if (v.length < 2) return false;
  if (!/[a-záéíóúñü]/i.test(v)) return false;      // debe tener letras
  if (/^[a-z0-9_\-./:]+$/.test(v) && !/\s/.test(v)) return false; // ids/clases
  return true;
}
function add(s) {
  const v = s.replace(/\s+/g, " ").trim();
  if (looksHuman(v)) out.add(v);
}

function walk(node) {
  if (ts.isJsxText(node)) add(node.text);
  if (ts.isJsxAttribute(node) && node.initializer) {
    const name = node.name.getText();
    if (TEXT_ATTRS.has(name)) {
      if (ts.isStringLiteral(node.initializer)) add(node.initializer.text);
      if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        const e = node.initializer.expression;
        if (ts.isStringLiteral(e)) add(e.text);
      }
    }
    if (name === "head" && ts.isJsxExpression(node.initializer) && node.initializer.expression
        && ts.isArrayLiteralExpression(node.initializer.expression)) {
      node.initializer.expression.elements.forEach((el) => {
        if (ts.isStringLiteral(el)) add(el.text);
      });
    }
  }
  if (ts.isPropertyAssignment(node) && OBJ_PROPS.has(node.name.getText())
      && ts.isStringLiteral(node.initializer)) {
    add(node.initializer.text);
  }
  // Mensajes: setMsg("..."), setErr("..."), alert("...")
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && /^(setMsg|setErr|setError|alert)$/.test(node.expression.text)) {
    node.arguments.forEach((a) => { if (ts.isStringLiteral(a)) add(a.text); });
  }
  ts.forEachChild(node, walk);
}
walk(sf);

console.log([...out].sort((a, b) => a.localeCompare(b, "es")).join("\n"));
