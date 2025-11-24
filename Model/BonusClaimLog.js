const mongoose = require('mongoose');

const BonusClaimLogSchema = new mongoose.Schema({
    // Telegram ID of the user who claimed the bonus (for linking to the User model)
    telegramId: {
        type: Number,
        required: true,
        index: true // Index for fast lookup in admin dashboard
    },
    // The amount of bonus received
    bonusAmount: {
        type: Number,
        required: true
    },
    // The specific campaign key (e.g., 'DAILY_BONUS')
    campaignKey: {
        type: String,
        required: true
    },
    // The timestamp of when the claim occurred
    claimedAt: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true }); // Mongoose will automatically add createdAt/updatedAt fields

// 1. Define the model
const BonusClaimLog = mongoose.model('BonusClaimLog', BonusClaimLogSchema);

// 2. Export the model
module.exports = BonusClaimLog;