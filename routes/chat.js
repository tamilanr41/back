const express = require('express');
const Message = require('../models/Message');
const authMiddleware = require('../middleware/auth');
const { requireCouple } = require('../middleware/couple');

const router = express.Router();

router.use(authMiddleware, requireCouple);

/**
 * GET /api/chat/messages?limit=50&before=<messageId>
 * Returns messages for the couple, newest last.
 */
router.get('/messages', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const query = { coupleId: req.couple._id };

    if (req.query.before) {
      const beforeMsg = await Message.findById(req.query.before);
      if (beforeMsg) {
        query.createdAt = { $lt: beforeMsg.createdAt };
      }
    }

    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('sender', 'name nickname avatar');

    res.json({ messages: messages.reverse() });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/chat/messages
 * body: { text, type? }
 * Note: real-time delivery happens via Socket.IO; this is the persistence endpoint.
 */
router.post('/messages', async (req, res, next) => {
  try {
    const { text, type } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ message: 'text is required' });
    }

    const message = await Message.create({
      coupleId: req.couple._id,
      sender: req.userId,
      text: text.trim(),
      type: type === 'image' ? 'image' : 'text',
    });

    const populated = await message.populate('sender', 'name nickname avatar');

    // emit to the couple's room via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.to(`couple:${req.couple._id}`).emit('message:new', populated);
    }

    res.status(201).json({ message: populated });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/chat/messages/:id
 * body: { text }
 * Edit own message
 */
router.patch('/messages/:id', async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ message: 'text is required' });
    }

    const message = await Message.findOne({ _id: req.params.id, coupleId: req.couple._id });
    if (!message) return res.status(404).json({ message: 'Message not found' });
    if (String(message.sender) !== String(req.userId)) {
      return res.status(403).json({ message: 'You can only edit your own messages' });
    }

    message.text = text.trim();
    await message.save();

    const io = req.app.get('io');
    if (io) {
      io.to(`couple:${req.couple._id}`).emit('message:edit', { id: message._id, text: message.text });
    }

    res.json({ message });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/chat/messages/:id
 * Delete own message
 */
router.delete('/messages/:id', async (req, res, next) => {
  try {
    const message = await Message.findOne({ _id: req.params.id, coupleId: req.couple._id });
    if (!message) return res.status(404).json({ message: 'Message not found' });
    if (String(message.sender) !== String(req.userId)) {
      return res.status(403).json({ message: 'You can only delete your own messages' });
    }

    await message.deleteOne();

    const io = req.app.get('io');
    if (io) {
      io.to(`couple:${req.couple._id}`).emit('message:delete', { id: message._id });
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
