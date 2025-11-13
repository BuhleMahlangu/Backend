const express = require('express');
const bodyParser = require('body-parser');
const itemsRoutes = require('./routes/items');

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use('/api/items', itemsRoutes);

app.listen(port, () => {
    console.log(`API server running at http://localhost:${port}`);
});