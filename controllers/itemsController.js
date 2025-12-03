let items = [];

exports.createItem = (req, res) => {
    const item = req.body;
    items.push(item);
    res.status(201).send(item);
};

exports.getAllItems = (req, res) => {
    res.status(200).send(items);
};

exports.updateItem = (req, res) => {
    const id = req.params.id;
    items[id] = req.body;
    res.send(items[id]);
};

exports.deleteItem = (req, res) => {
    const id = req.params.id;
    items.splice(id, 1);
    res.status(204).send();
};