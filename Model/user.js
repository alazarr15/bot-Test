const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  telegramId: {
    type: Number,
    required: true,
    unique: true,
  },
  username: {
    type: String,
    trim: true,
    sparse: true,
  },
  phoneNumber: {
    type: String,
    trim: true,
    unique: true,
    sparse: true,
  },
  balance: {
    type: Number,
    default: 0,
  },
  bonus_balance: { // ⭐ NEW: Bonus balance field
    type: Number,
    default: 0,
  },
  registeredAt: {
    type: Date,
    default: Date.now,
  },
  referralCount: {
    type: Number,
    default: 0,
  },
  registrationInProgress: {
    type: Object,
    default: null,
  },
  withdrawalInProgress: {
    type: Object,
    default: null,
  },
  transferInProgress: {
    type: Object,
    default: null,
  },
depositInProgress: {
    status: { type: String, enum: ["awaiting_amount", "awaiting_method", "awaiting_sms", null], default: null },
    amount: { type: Number, min: 0, default: null },
    method: { type: String, enum: ["CBE", "Telebirr", null], default: null },
},

  usernameChangeInProgress: {
    type: Object,
    default: null,
  },
});

const User = mongoose.model("User", userSchema);

module.exports = User;