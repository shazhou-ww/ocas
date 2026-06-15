---
scenario: "HTML templates use LiquidJS for rendering"
feature: render
tags: [render, html, template, liquidjs]
---

## Given

- An HTML instance template stored at `@ocas/template/html/<type-hash>`
- Template contains LiquidJS syntax (e.g., `{{ payload.field }}`, `{% for item in payload.items %}...{% endfor %}`)
- A node with matching type

## When

- `renderAsync` processes the node with `format: 'html'`
- Map phase loads the HTML template for the node's type
- LiquidJS renders the template with context `{ payload: <node-payload>, context: <render-context> }`

## Then

- The rendered output is an HTML fragment (no `<html>`, `<head>`, or `<body>` wrapper)
- LiquidJS variables like `{{ payload.foo }}` are substituted with actual values
- LiquidJS control structures (loops, conditionals) are evaluated
- The fragment is valid HTML suitable for insertion into a document shell
