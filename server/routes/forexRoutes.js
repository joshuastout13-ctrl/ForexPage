const express = require('express');
const router = express.Router();
const forexController = require('../controllers/forexController');

// GET /api/forex/pairs - Get all currency pairs
router.get('/pairs', forexController.getPairs);

// GET /api/forex/pairs/:pair - Get a specific currency pair
router.get('/pairs/:pair', forexController.getPairByName);

module.exports = router;
