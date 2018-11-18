const t = require('@babel/types')

const VISITED = Symbol()

module.exports = () => ({
  pre() {
    this.injected = new Set()
  },

  visitor: {
    ImportDeclaration(path, state) {
      if (path.node.source.value !== 'react') return
      if (path.node[VISITED]) return

      const options = { declaration: 'const', extract: 'all', ...state.opts }

      const {
        variable,
        namedSpecifiers,
        imported,
        locals
      } = getDataFromImportNode(path.node)

      if (!this.injected.has(state.filename)) {
        if (!imported.includes('createElement')) {
          namedSpecifiers.push(emulateImportSpecifier('createElement'))
        }
        if (!imported.includes('Fragment')) {
          namedSpecifiers.push(emulateImportSpecifier('Fragment'))
        }
        this.injected.add(state.filename)
      }

      const ast = JSON.parse(JSON.stringify(path.parent))
      const currentNodeIndex = path.parent.body.indexOf(path.node)
      ast.body[currentNodeIndex] = null
      const amount = getAmountOfUse(locals, ast)

      const imports = {}
      const extract = {}

      for (let i = 0, l = namedSpecifiers.length; i < l; i++) {
        const importedName = namedSpecifiers[i].imported.name
        const localName = namedSpecifiers[i].local.name
        const count = amount[localName]

        if (options.extract === 'all' && count > 0) {
          extract[importedName] = localName
        } else {
          if (count >= options.extract) {
            extract[importedName] = localName
          } else if (count > 0) {
            imports[importedName] = localName
          }
        }
      }

      const identifier = variable
        ? t.identifier(variable)
        : path.scope.generateUidIdentifier('React')
      const importNode = createImportNode(identifier, imports, 'react')
      importNode[VISITED] = true
      const extractNode =
        Object.keys(extract).length > 0
          ? createExtractNode(options.declaration, identifier, extract)
          : null

      path.replaceWithMultiple([importNode, extractNode].filter(Boolean))
    },

    MemberExpression(path) {
      const { object, property } = path.node
      const { name } = property

      if (object.name !== 'React') return
      if (t.isVariableDeclarator(path.parent)) return
      if (name !== 'createElement' && name !== 'Fragment') return

      const expression = t.expressionStatement(t.identifier(name))
      path.replaceWith(expression)
    }
  }
})

function getDataFromImportNode(node) {
  const { specifiers } = node

  const variable =
    t.isImportNamespaceSpecifier(specifiers[0]) ||
    t.isImportDefaultSpecifier(specifiers[0])
      ? specifiers[0].local.name
      : null
  const namedSpecifiers = specifiers.filter(t.isImportSpecifier)
  const imported = namedSpecifiers.map(s => s.imported.name)
  const locals = namedSpecifiers.map(s => s.local.name)

  return { variable, namedSpecifiers, imported, locals }
}

function emulateImportSpecifier(name) {
  return { imported: { name }, local: { name } }
}

function getAmountOfUse(names, ast) {
  const amount = {}
  const increment = prop => (amount[prop] = (amount[prop] || 0) + 1)
  t.traverse(ast, {
    enter(path) {
      if (names.includes(path.name) && t.isIdentifier(path)) {
        increment(path.name)
      } else if (t.isJSXElement(path)) {
        increment('createElement')
        const name = path.openingElement.name.name
        if (names.includes(name)) {
          increment(name)
        }
      } else if (t.isJSXFragment(path)) {
        increment('createElement')
        increment('Fragment')
      }
    }
  })
  return amount
}

function createImportNode(identifier, imports, source) {
  const specifiers = [
    t.importDefaultSpecifier(identifier),
    ...Object.keys(imports).map(name =>
      t.importSpecifier(t.identifier(imports[name]), t.identifier(name))
    )
  ]
  return t.importDeclaration(specifiers, t.stringLiteral(source))
}

function createExtractNode(kind, identifier, extract) {
  const id = t.objectPattern(
    Object.keys(extract).map(name =>
      t.objectProperty(t.identifier(name), t.identifier(extract[name]))
    )
  )
  return t.variableDeclaration(kind, [t.variableDeclarator(id, identifier)])
}
