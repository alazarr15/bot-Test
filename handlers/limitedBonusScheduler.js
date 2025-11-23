/*const cron = require('node-cron');
const LimitedCampaign = require('../Model/limitedCampaign'); // Assumed path: ./models/limitedCampaign
const { startBroadcastJob, startDeleteJob } = require('../utils/broadcastUtils'); // Use the new utility

// A fixed callback data used on the button
const CLAIM_CALLBACK_DATA = 'CLAIM_DAILY_BONUS';

const startLimitedBonusScheduler = (bot) => {
    console.log("--- SCHEDULER INITIALIZATION ---");
    
    // Ensure the campaign document exists and is initialized
   LimitedCampaign.findOneAndUpdate(
    { campaignKey: 'DAILY_BONUS' },
    { 
        // 1. $set: These values are APPLIED ON EVERY STARTUP, overriding any old value in the DB.
        $set: {
            claimLimit: 50,   // <-- This is now prioritized to be 50
            bonusAmount: 10, // <-- This is prioritized to be 10
        },
        
        // 2. $setOnInsert: These values are only applied if the document is created for the first time.
        $setOnInsert: { 
            messageContent: '🎉 Daily Bonus is here! Click the button below to claim your reward.',
            claimsCount: 0, 
            claimants: [], 
            isActive: true, 
            lastBroadcastAt: new Date(0)
        } 
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
).then(initialCampaign => {
        const campaignState = initialCampaign || { ...this._doc }; // Safely extract state
        
        console.log(`✅ Limited Campaign State Initialized/Checked at ${new Date().toISOString()}.`);
        console.log(`[DB STATE STARTUP] isActive: ${campaignState.isActive}, Claims: ${campaignState.claimsCount}/${campaignState.claimLimit}`);
        
        // Schedule to run daily at 18:00 UTC (9:00 PM EAT)
        cron.schedule('0 13 * * *', async () => { 
            console.log(`\n--- CRON JOB START ---`);
            console.log(`🔄 Starting scheduled daily bonus broadcast cycle at ${new Date().toISOString()} (Target: 13:00 UTC or 4 pm in eat)...`);
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
    
    // 2. RESET STATE
    console.log("💾 Guaranteeing state reset: Setting claims=0 and isActive=true.");
    try {
         const resetResult = await LimitedCampaign.updateOne(
            { campaignKey: 'DAILY_BONUS' },
            {
                $set: {
                    claimsCount: 0,
                    claimants: [],
                    isActive: true, // CRITICAL: Always set to true here
                    lastBroadcastAt: new Date(),
                    messageContent: campaign.messageContent 
                }
            }
        );
        console.log(`✅ DB Reset Success: Matched ${resetResult.matchedCount}, Modified ${resetResult.modifiedCount}.`);
    } catch (e) {
         console.error(`❌ CRITICAL: Failed to reset campaign state. Error: ${e.message}`);
         return; // Stop if we can't reset the state
    }
    
    // 3. VERIFY STATE BEFORE BROADCAST (New step for debugging)
    const activeCampaign = await LimitedCampaign.findOne({ campaignKey: 'DAILY_BONUS' });
    if (activeCampaign && activeCampaign.isActive) {
        console.log("✅ DEBUG: State verified. Campaign is ACTIVE (isActive=true) before broadcast setup.");
    } else {
        console.error("❌ CRITICAL DEBUG: State check failed. Campaign is STILL INACTIVE after reset attempt!");
        // We will proceed to broadcast, but this log confirms the database failed the reset.
    }
    
    // 4. PREPARE AND BROADCAST NEW MESSAGE (Now that the state is active)
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
        console.log(`✅ Daily bonus broadcast successfully sent to ${successCount} users. Campaign is live.`);
    } else {
        console.log("⚠️ Broadcast sent to 0 users. Campaign state has been reset, but no messages were sent.");
    }
};

module.exports = {
    startLimitedBonusScheduler,
    CLAIM_CALLBACK_DATA
};
*/

//working vesion of the cron job above if something happen uncomment the above one

const cron = require('node-cron');
const LimitedCampaign = require('../Model/limitedCampaign'); // Assumed path: ./models/limitedCampaign
const { startBroadcastJob, startDeleteJob } = require('../utils/broadcastUtils'); // Use the new utility
const BonusSettings = require("../Model/BonusSettings");
// A fixed callback data used on the button
const CLAIM_CALLBACK_DATA = 'CLAIM_DAILY_BONUS';

// --- Dynamic Cron Job Management ---

// 1. Variable to hold the running cron job instance (the daily broadcast)
let activeBroadcastJob = null;
// 2. Variable to track the currently used cron pattern to detect changes
let currentCronPattern = '30 11 * * *'; // Default to 11:30 UTC

/**
 * Stops the current cron job (if running) and schedules a new one if the pattern has changed.
 * This is called on startup and periodically by the monitor job.
 * @param {object} bot The Telegram bot instance.
 * @param {string} newCronPattern The new cron pattern to schedule (e.g., '0 12 * * *').
 */
const scheduleDailyBonus = (bot, newCronPattern) => {
    // 1. Validate the pattern before attempting to use it
    if (!cron.validate(newCronPattern)) {
        console.error(`❌ CRON ERROR: Attempted to schedule an invalid pattern: "${newCronPattern}". Job not restarted.`);
        return;
    }

    // 2. Check if the pattern has changed
    if (activeBroadcastJob && newCronPattern === currentCronPattern) {
        return; // No change, do nothing
    }

    // 3. Stop the old job if it exists
    if (activeBroadcastJob) {
        console.log(`⏱️ CRON UPDATE: Stopping old job (${currentCronPattern}). Starting new job (${newCronPattern}).`);
        activeBroadcastJob.stop();
        activeBroadcastJob = null;
    }

    // 4. Start the new job
    activeBroadcastJob = cron.schedule(newCronPattern, async () => {
        console.log(`\n--- CRON JOB START ---`);
        console.log(`🔄 Starting scheduled daily bonus broadcast cycle at ${new Date().toISOString()} (Pattern: ${newCronPattern})...`);
        await runDailyBroadcast(bot);
        console.log(`--- CRON JOB END ---\n`);
    });

    // 5. Update the current pattern tracker
    currentCronPattern = newCronPattern;
};

// --- Main Scheduler Function ---

const startLimitedBonusScheduler = (bot) => {
    console.log("--- SCHEDULER INITIALIZATION ---");

    (async () => {
        let claimLimitValue = 1; 
        let bonusAmountValue = 10; 
        let cronSchedulePattern = currentCronPattern; // Start with default/global value

        try {
            // 1. FETCH THE GLOBAL BONUS SETTINGS
            const settings = await BonusSettings.findOne({ settingId: 'GLOBAL_BONUS_CONFIG' });

            if (settings) {
                claimLimitValue = settings.claimLimitBonus;
                bonusAmountValue = settings.bonusAmountClimBonus;

                // *** DYNAMIC CRON TIME FETCH on STARTUP ***
                if (settings.broadcastCronSchedule && cron.validate(settings.broadcastCronSchedule)) {
                    cronSchedulePattern = settings.broadcastCronSchedule;
                }
                // *****************************************
                
                console.log(`✅ Bonus Settings Loaded: Claim Limit: ${claimLimitValue}, Bonus Amount: ${bonusAmountValue}. Cron: ${cronSchedulePattern}.`);
            } else {
                console.warn("⚠️ BonusSettings document not found. Using hardcoded defaults.");
            }

        } catch (err) {
            console.error("❌ Failed to fetch BonusSettings. Using default values.", err);
        }

        // 2. INITIALIZE/UPDATE THE CAMPAIGN WITH THE FETCHED VALUES (Limits/Amounts)
        LimitedCampaign.findOneAndUpdate(
            { campaignKey: 'DAILY_BONUS' },
            {
                $set: {
                    claimLimit: claimLimitValue,  
                    bonusAmount: bonusAmountValue, 
                },
                $setOnInsert: {
                    messageContent: '🎉 Daily Bonus is here! Click the button below to claim your reward.',
                    claimsCount: 0,
                    claimants: [],
                    isActive: true,
                    lastBroadcastAt: new Date(0)
                }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        ).then(initialCampaign => {
            const campaignState = initialCampaign || { ...this._doc }; 

            console.log(`✅ Limited Campaign State Initialized/Checked.`);
            console.log(`[DB STATE STARTUP] isActive: ${campaignState.isActive}, Claims: ${campaignState.claimsCount}/${campaignState.claimLimit}`);

            // 3. INITIAL SCHEDULE: Schedule the main job with the pattern fetched on startup.
            scheduleDailyBonus(bot, cronSchedulePattern);
            
            // 4. SETUP MONITOR JOB: Runs every 5 minutes to check the DB for schedule changes.
            cron.schedule('*/5 * * * *', async () => {
                try {
                    const monitorSettings = await BonusSettings.findOne({ settingId: 'GLOBAL_BONUS_CONFIG' });
                    if (monitorSettings && monitorSettings.broadcastCronSchedule) {
                        // Call the helper function, which will stop and restart the job ONLY if the pattern is new.
                        scheduleDailyBonus(bot, monitorSettings.broadcastCronSchedule);
                    }
                } catch (e) {
                    console.error("❌ MONITOR ERROR: Failed to check for cron schedule update:", e.message);
                }
            });
            console.log("✅ Dynamic cron monitor running every 5 minutes.");


        }).catch(err => {
            console.error("❌ Failed to initialize Limited Campaign State:", err);
        });
    })();
};


const runDailyBroadcast = async (bot) => {
    // Fetch the current state immediately before acting
    const campaign = await LimitedCampaign.findOne({ campaignKey: 'DAILY_BONUS' });

    if (!campaign) {
        console.error("❌ Campaign state not found. Aborting broadcast.");
        return;
    }

    if (campaign.claimLimit === 0) {
        console.log("🛑 Daily Bonus ABORTED: The claimLimit is set to 0. No messages will be sent.");
        
        // **Optional:** If you want to ensure the campaign is marked INACTIVE when the limit is 0
        try {
            await LimitedCampaign.updateOne(
                { campaignKey: 'DAILY_BONUS' },
                { $set: { isActive: false } }
            );
            console.log("✅ Campaign marked as inactive due to 0 limit.");
        } catch (e) {
            console.error(`⚠️ WARNING: Failed to set campaign inactive: ${e.message}`);
        }
        
        return; // Stop the function here
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
    
    // 2. RESET STATE
    console.log("💾 Guaranteeing state reset: Setting claims=0, isActive=true, and reaffirming limits.");
    try {
        const resetResult = await LimitedCampaign.updateOne(
            { campaignKey: 'DAILY_BONUS' },
            {
                $set: {
                    claimsCount: 0,
                    claimants: [],
                    isActive: true, // CRITICAL: Always set to true here
                    lastBroadcastAt: new Date(),
                    messageContent: campaign.messageContent,
                    // Reaffirm the limits/amounts from the document fetched at the start
                    claimLimit: campaign.claimLimit,    
                    bonusAmount: campaign.bonusAmount 
                }
            }
        );
        console.log(`✅ DB Reset Success: Matched ${resetResult.matchedCount}, Modified ${resetResult.modifiedCount}.`);
    } catch (e) {
        console.error(`❌ CRITICAL: Failed to reset campaign state. Error: ${e.message}`);
        return; // Stop if we can't reset the state
    }
    
    // 3. VERIFY STATE BEFORE BROADCAST (New step for debugging)
    const activeCampaign = await LimitedCampaign.findOne({ campaignKey: 'DAILY_BONUS' });
    if (activeCampaign && activeCampaign.isActive) {
        console.log("✅ DEBUG: State verified. Campaign is ACTIVE (isActive=true) before broadcast setup.");
    } else {
        console.error("❌ CRITICAL DEBUG: State check failed. Campaign is STILL INACTIVE after reset attempt!");
        // We will proceed to broadcast, but this log confirms the database failed the reset.
    }
    
    // 4. PREPARE AND BROADCAST NEW MESSAGE (Now that the state is active)
    const uniqueCallbackData = `${CLAIM_CALLBACK_DATA}_${Date.now()}`;
    // This line correctly uses the updated/reaffirmed bonusAmount from the 'campaign' document.
    const buttonText = `የ ${campaign.bonusAmount} ብር ቦነስ ለማግኘት ይጫኑ`; 

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
        console.log(`✅ Daily bonus broadcast successfully sent to ${successCount} users. Campaign is live.`);
    } else {
        console.log("⚠️ Broadcast sent to 0 users. Campaign state has been reset, but no messages were sent.");
    }
};

module.exports = {
    startLimitedBonusScheduler,
    CLAIM_CALLBACK_DATA
};
