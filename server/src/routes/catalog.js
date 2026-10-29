'use strict';

const express = require('express');
const catalog = require('../catalog');

const router = express.Router();

router.get('/catalog', (req, res) => {
  res.json({
    keyless: catalog.KEYLESS,
    providers: catalog.PROVIDERS,
    loras: catalog.LORAS,
  });
});

module.exports = router;
