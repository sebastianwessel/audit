function updateTodo(req) {
  const id = req.params.id;
  let items = req.session.todos.get(id);
  if (!items) {
    items = new Map();
    req.session.todos.set(id, items);
  }
  items.set(req.query.name, req.query.text);
  return items;
}
