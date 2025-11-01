const cron = require('node-cron');
const LimitedCampaign = require('../Model/limitedCampaign'); // Assumed path: ./models/limitedCampaign
const { startBroadcastJob, startDeleteJob } = require('../utils/broadcastUtils'); // Use the new utility

// A fixed callback data used on the button
const CLAIM_CALLBACK_DATA = 'CLAIM_DAILY_BONUS';

const startLimitedBonusScheduler = (bot) => {
    console.log("--- SCHEDULER INITIALIZATION ---");
    
    // Ensure the campaign document exists and is initialized
    LimitedCampaign.findOneAndUpdate(
        { campaignKey: 'DAILY_BONUS' },
        { $setOnInsert: { 
            claimLimit: 2, 
            bonusAmount: 10,
            messageContent: '🎉 Daily Bonus is here! Click the button below to claim your reward.',
            claimsCount: 0, 
            claimants: [], 
            isActive: true, // Crucial initial state
            lastBroadcastAt: new Date(0)
        } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).then(initialCampaign => {
        const campaignState = initialCampaign || { ...this._doc }; // Safely extract state
        
        console.log(`✅ Limited Campaign State Initialized/Checked at ${new Date().toISOString()}.`);
        console.log(`[DB STATE STARTUP] isActive: ${campaignState.isActive}, Claims: ${campaignState.claimsCount}/${campaignState.claimLimit}`);
        
        // Schedule to run at 21:00 UTC (9:00 PM) every day
        cron.schedule('15 18 * * *', async () => { 
            console.log(`\n--- CRON JOB START ---`);
            console.log(`🔄 Starting scheduled daily bonus broadcast cycle at ${new Date().toISOString()} (Target: 18:07 UTC)...`);
            await runDailyBroadcast(bot);
            console.log(`--- CRON JOB END ---\n`);
        });
        
    }).catch(err => {
        console.error("❌ Failed to initialize Limited Campaign State:", err);
    });
};

const runDailyBroadcast = async (bot) => {
    // Fetch the current state immediately before acting
    const campaign = await LimitedCampaign.findOne({ campaignKey: 'DAILY_BONUS' });

    if (!campaign) {
        console.error("❌ Campaign state not found. Aborting broadcast.");
        return;
    }

    console.log(`[DB STATE PRE-CLEANUP] isActive: ${campaign.isActive}, Claims: ${campaign.claimsCount}/${campaign.claimLimit}.`);

    // 1. CLEANUP PREVIOUS DAY'S ANNOUNCEMENT
    if (campaign.messageContent) {
        console.log("🧹 Cleaning up previous day's bonus message...");
        
        try {
            await startDeleteJob(bot, campaign.messageContent);
            console.log("✅ Previous day's message cleanup completed.");
        } catch (e) {
            console.error(`⚠️ WARNING: Previous message cleanup failed. Error: ${e.message}`);
        }
    }
    
    // 2. PREPARE AND BROADCAST NEW MESSAGE
    const uniqueCallbackData = `${CLAIM_CALLBACK_DATA}_${Date.now()}`;
    const buttonText = `Click to Claim ${campaign.bonusAmount} Birr Bonus`;

    const replyMarkup = {
        inline_keyboard: [[{ text: buttonText, callback_data: uniqueCallbackData }]]
    };
    
    const jobPayload = {
        message: campaign.messageContent,
        replyMarkup: replyMarkup
    };

    console.log("🚀 Starting broadcast job...");
    const successCount = await startBroadcastJob(bot, jobPayload);
    console.log(`📤 Broadcast job finished. Sent to ${successCount} users.`);

    if (successCount > 0) {
        // 3. RESET AND UPDATE CAMPAIGN STATE FOR NEW DAY
        console.log("💾 Resetting campaign state for new day...");
        
        try {
             const updateResult = await LimitedCampaign.updateOne(
                { campaignKey: 'DAILY_BONUS' },
                {
                    $set: {
                        claimsCount: 0,
                        claimants: [],
                        isActive: true, // This confirms the new campaign is live
                        lastBroadcastAt: new Date(),
                        messageContent: campaign.messageContent 
                    }
                }
            );

            // Log the raw result of the DB update
            console.log(`✅ DB Update Success: Matched ${updateResult.matchedCount}, Modified ${updateResult.modifiedCount}.`);
            console.log(`✅ Daily bonus broadcast sent to ${successCount} users. Campaign is now live.`);
        
        } catch (e) {
             console.error(`❌ CRITICAL: Failed to reset campaign state after broadcast. Error: ${e.message}`);
        }
    } else {
        // This case means no chats were found to send the message to.
        console.log("⚠️ Broadcast sent to 0 users. Campaign state not reset.");
    }
};

module.exports = {
    startLimitedBonusScheduler,
    CLAIM_CALLBACK_DATA
};
