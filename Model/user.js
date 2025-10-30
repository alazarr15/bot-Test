const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  telegramId: {
    type: Number,
    required: true,
    unique: true,
    index: true,
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
   coin_balance: { // ⭐ NEW: Bonus balance field
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
   referrerId: {
    // The Telegram ID of the user who invited this user (null if direct signup)
    type: Number,
    default: null, 
    index: true,
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
    step: {
      type: String,
      enum: ['getAmount', 'selectMethod', 'awaitingSMS', 'processing', 'completed', 'cancelled'],
    },
    amount: {
      type: Number,
    },
    depositType: {
      type: String,
      enum: ['CBE', 'Telebirr'],
    },
    txId: {
      type: String,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  usernameChangeInProgress: {
    type: Object,
    default: null,
  },
});

const User = mongoose.model("User", userSchema);

module.exports = User;