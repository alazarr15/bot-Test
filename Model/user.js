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
        type: Object,
        default: null,
    },
  usernameChangeInProgress: {
    type: Object,
    default: null,
  },
});

const User = mongoose.model("User", userSchema);

module.exports = User;