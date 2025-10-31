// limitedBonusScheduler.js (FINAL CORRECT VERSION)
const cron = require('node-cron');
const LimitedCampaign = require('../Model/limitedCampaign'); // Assumed path: ./models/limitedCampaign
const { startBroadcastJob, startDeleteJob } = require('../utils/broadcastUtils'); // Use the new utility

// A fixed callback data used on the button
const CLAIM_CALLBACK_DATA = 'CLAIM_DAILY_BONUS';

const startLimitedBonusScheduler = (bot) => {
    // Ensure the campaign document exists and is initialized
    LimitedCampaign.findOneAndUpdate(
        { campaignKey: 'DAILY_BONUS' },
        // ⭐ CRITICAL FIX: Ensure ALL necessary state fields are included on first insertion.
        { $setOnInsert: { 
            claimLimit: 2, 
            bonusAmount: 10,
            messageContent: '🎉 Daily Bonus is here! Click the button below to claim your reward.',
            claimsCount: 0, // <-- ADDED
            claimants: [], // <-- ADDED
            isActive: true, // <-- ADDED
            lastBroadcastAt: new Date(0) // ADDED for safety
        } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).then(initialCampaign => {
        console.log("✅ Limited Campaign State Initialized/Checked.");

        // Schedule to run at 21:25 UTC (12:25 AM EAT)
        cron.schedule('25 21 * * *', async () => { 
            console.log("🔄 Starting scheduled daily bonus broadcast cycle at 21:35 UTC...");
            await runDailyBroadcast(bot);
        });

    }).catch(err => {
        console.error("❌ Failed to initialize Limited Campaign State:", err);
    });
};

const runDailyBroadcast = async (bot) => {
    const campaign = await LimitedCampaign.findOne({ campaignKey: 'DAILY_BONUS' });

    if (!campaign) {
        console.error("❌ Campaign state not found. Aborting broadcast.");
        return;
    }

    // 1. CLEANUP PREVIOUS DAY'S ANNOUNCEMENT
    if (campaign.messageContent) {
        console.log("🧹 Cleaning up previous day's bonus message...");
        await startDeleteJob(bot, campaign.messageContent);
    }
    
    // 2. PREPARE AND BROADCAST NEW MESSAGE
    const uniqueCallbackData = `${CLAIM_CALLBACK_DATA}_${Date.now()}`; // Ensure unique click data per day
    const buttonText = `Click to Claim ${campaign.bonusAmount} Birr Bonus`;

    const replyMarkup = {
        inline_keyboard: [[{ text: buttonText, callback_data: uniqueCallbackData }]]
    };
    
    const jobPayload = {
        message: campaign.messageContent,
        replyMarkup: replyMarkup
    };

    const successCount = await startBroadcastJob(bot, jobPayload);

    if (successCount > 0) {
        // 3. RESET AND UPDATE CAMPAIGN STATE FOR NEW DAY
        await LimitedCampaign.updateOne(
            { campaignKey: 'DAILY_BONUS' },
            {
                $set: {
                    claimsCount: 0,
                    claimants: [],
                    isActive: true, // This confirms the new campaign is live
                    lastBroadcastAt: new Date(),
                    messageContent: campaign.messageContent // Keep message content for deletion
                }
            }
        );
        console.log(`✅ Daily bonus broadcast sent to ${successCount} users. Campaign is now live.`);
    }
};

module.exports = {
    startLimitedBonusScheduler,
    CLAIM_CALLBACK_DATA
};