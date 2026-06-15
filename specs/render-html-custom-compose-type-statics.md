---
scenario: "Custom compose template receives and renders type_statics"
feature: render
tags: [render, html, compose-template, type-statics, customization]
---

## Given

- A store with bootstrap
- A schema with an HTML instance template
- A static template producing `{"css": ".custom { display: flex; }"}`
- A custom compose template registered at `@ocas/template/html/_compose`:
  ```html
  <!DOCTYPE html>
  <html>
  <head>
    <title>Custom App</title>
    {% for ts in type_statics %}
      {% if ts.css %}<style>{{ ts.css }}</style>{% endif %}
    {% endfor %}
  </head>
  <body>
    <main>{{ content }}</main>
    {% for ts in type_statics %}
      {% if ts.js %}<script>{{ ts.js }}</script>{% endif %}
    {% endfor %}
  </body>
  </html>
  ```

## When

- `renderAsync(store, nodeHash, { format: 'html' })` is called
- `findComposeTemplate` returns the custom compose template
- LiquidJS renders the compose template with `{ content, type_statics }`

## Then

- The custom compose template is used (not the builtin)
- `type_statics` is an iterable array of objects, each with `type_hash`, `css`, `js` (and any other slots)
- The custom template can iterate `type_statics` with `{% for ts in type_statics %}`
- CSS slots are available as `{{ ts.css }}`
- JS slots are available as `{{ ts.js }}`
- The output follows the custom template structure with CSS/JS injected per the custom layout
- This allows users full control over where and how CSS/JS is placed in the document
