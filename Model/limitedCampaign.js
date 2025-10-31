// models/limitedCampaign.js
const mongoose = require("mongoose");

const limitedCampaignSchema = new mongoose.Schema({
    campaignKey: {
        type: String,
        required: true,
        unique: true,
        default: 'DAILY_BONUS', 
        enum: ['DAILY_BONUS']
    },
    claimLimit: {
        type: Number,
        default: 2
    },
    bonusAmount: {
        type: Number,
        default: 10 // The 10 Birr reward
    },
    messageContent: {
        type: String,
        default: '🎉 Hurry! Be one of the first 10 people to click this button and claim a **10 Birr Bonus**! Once the limit is reached, this message disappears.' 
    },
    
    claimsCount: {
        type: Number,
        default: 0
    },
    claimants: {
        type: [Number], // Array of Telegram user IDs who have claimed
        default: []
    },
    isActive: {
        type: Boolean,
        default: false // Only true when the message is live/active for claiming
    },
    lastBroadcastAt: {
        type: Date,
        default: null
    }
}, { timestamps: true });

const LimitedCampaign = mongoose.model("LimitedCampaign", limitedCampaignSchema);

module.exports = LimitedCampaign;