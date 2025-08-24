const mongoose = require("mongoose");

const transferSchema = new mongoose.Schema({
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  recipientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true,  default: null},
  senderPhone: { type: String, required: true },
  recipientPhone: { type: String, required: true },
  senderTelegramId: { type: Number, required: true },
  recipientTelegramId: { type: Number, required: true },
  amount: { type: Number, required: true },
  date: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Transfer", transferSchema);
