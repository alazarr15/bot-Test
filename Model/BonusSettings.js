const mongoose = require("mongoose");

// This model is used to store the global configuration for bonus amounts.
// We expect only one document in this collection.
const bonusSettingsSchema = new mongoose.Schema({
    // A unique identifier to ensure only one settings document exists
    settingId: {
        type: String,
        required: true,
        default: 'GLOBAL_BONUS_CONFIG',
        unique: true,
    },
    // The bonus amount granted upon user initiation/sign-up
    initiationBonus: {
        type: Number,
        required: true,
        default: 0,
    },
     registerationBonus: {
        type: Number,
        required: true,
        default: 0,
    },

    claimLimitBonus:{
        type: Number,
        required: true,
        default: 1,
    },
    bonusAmountClimBonus:{
         type: Number,
        required: true,
        default: 10,
    },
     broadcastCronSchedule: {
        type: String,
        required: true,
        default: '30 11 * * *', 
    },
    depositBonus: {
        type: Number,
        required: true,
        default: 0,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    }
});

module.exports = mongoose.model("BonusSettings", bonusSettingsSchema);
