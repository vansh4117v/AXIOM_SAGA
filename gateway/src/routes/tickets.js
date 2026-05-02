const express = require('express');
const router = express.Router();
const ticketsController = require('../controllers/tickets.controller');
const { zodValidate } = require('../middleware/zodValidate');
const { ticketListQuerySchema } = require('../schemas/ticket.schema');

// POST /tickets — manual ticket submission
router.post('/', ticketsController.submit);

// GET /tickets — list with pagination + filtering
router.get('/', zodValidate(ticketListQuerySchema, 'query'), ticketsController.list);

// GET /tickets/:ticketKey — single ticket detail
router.get('/:ticketKey', ticketsController.getDetail);

module.exports = router;
