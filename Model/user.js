// models/User.js

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
    sparse: true, // Allows multiple null values but unique non-null values
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
  registeredAt: {
    type: Date,
    default: Date.now,
  },
  referralCount: {
    type: Number,
    default: 0,
  },
  // ✅ New dedicated fields for conversation state
  registrationInProgress: {
    type: Object, // Tracks registration flow state
    default: null,
  },
  withdrawalInProgress: {
    type: Object, // Tracks withdrawal flow state
    default: null,
  },
  transferInProgress: {
    type: Object, // Tracks transfer flow state (separate from withdrawal)
    default: null,
  },
  usernameChangeInProgress: {
    type: Object, // Tracks username change flow state
    default: null,
  },
  // Add other fields from your original schema here
});

const User = mongoose.model("User", userSchema);

module.exports = User;