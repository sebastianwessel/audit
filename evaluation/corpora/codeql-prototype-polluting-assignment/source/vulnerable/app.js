function updateTodo(req) {
  const id = req.params.id;
  let items = req.session.todos[id];
  if (!items) {
    items = req.session.todos[id] = {};
  }
  items[req.query.name] = req.query.text;
  return items;
}
