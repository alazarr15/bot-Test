// utils/broadcastUtils.js
const User = require('../Model/user');
const Announcement = require('../Model/announcement'); // Assumed path: ../models/announcement

// Helper for adding delay (already in broadcast_message.js)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// =========================================================================
// 1. ASYNCHRONOUS BROADCAST JOB 🚀
// =========================================================================
const startBroadcastJob = async (bot, jobPayload) => {
    const { message, replyMarkup } = jobPayload;
    // NOTE: This utility currently does not support image sending easily since we 
    // don't have the image file buffer in this context. It only supports text + buttons.
    // If you need images, we'll need to save the image to disk or upload to Telegram first.

    console.log(`[LIMITED BROADCAST START] Job started for message: "${message.substring(0, 30)}..."`);

    try {
        // Fetch all users
        const users = await User.find({}, 'telegramId');
        
        let successCount = 0;

        for (const user of users) {
            try {
                const extra = { 
                    parse_mode: 'Markdown',
                    ...(replyMarkup && { reply_markup: replyMarkup }) 
                };

                const sentMessage = await bot.telegram.sendMessage(user.telegramId, message, extra);
                
                // CRITICAL: Log the message for later deletion
                await Announcement.create({
                    userId: user.telegramId,
                    messageId: sentMessage.message_id,
                    messageContent: message, // Use messageContent as the key for the whole campaign
                    sentAt: new Date(), 
                });
                successCount++;
            } catch (error) {
                const errorMessage = error.message || String(error);
                // Handle 403 Forbidden (Bot blocked) and 429 (Rate Limit)
                if (errorMessage.includes('429') || errorMessage.includes('Too Many Requests')) {
                    await sleep(5000); // Pause for 5 seconds on rate limit
                }
            }
            
            await sleep(50); // Delay for Telegram API limits
        }

        console.log(`[LIMITED BROADCAST COMPLETE] Sent: ${successCount}`);
        return successCount;

    } catch (error) {
        console.error('❌ CRITICAL JOB ERROR during limited broadcast process:', error);
        return 0;
    }
};


// =========================================================================
// 2. ASYNCHRONOUS DELETION JOB 🗑️
// =========================================================================
const startDeleteJob = async (bot, messageContent) => {
    console.log(`[LIMITED DELETE START] Deletion job started for: "${messageContent.substring(0, 30)}..."`);
    
    try {
        // Find all announcements matching the campaign's message content
        const announcementsToDelete = await Announcement.find({ messageContent });
        let successCount = 0;

        for (const ann of announcementsToDelete) {
            try {
                // --- TELEGRAM API CALL ---
                await bot.telegram.deleteMessage(ann.userId, ann.messageId);
                // -------------------------
                successCount++;
            } catch (error) {
                // Ignore errors like "message to delete not found" or "bot was blocked"
            }
            await sleep(50); 
        }
        
        // CRITICAL STEP: DELETE DB RECORDS 
        const dbDeleteResult = await Announcement.deleteMany({ messageContent });
        console.log(`[LIMITED DELETE COMPLETE] DB cleanup successful. Removed ${dbDeleteResult.deletedCount} records.`);
        console.log(`[LIMITED DELETE COMPLETE] Job finished. Deleted in Telegram: ${successCount}`);
        
    } catch (error) {
        console.error('❌ CRITICAL JOB ERROR during mass deletion process:', error);
    }
};


const rewardBonusBalance = async (telegramId, amount) => {
    // Atomically update DB to ensure correct counting
    const user = await User.findOneAndUpdate(
        { telegramId }, 
        { $inc: { bonus_balance: amount } }, // Target bonus_balance
        { new: true, select: 'bonus_balance' } // Return the updated document
    );

    if (user) {
        // You may want to update Redis here as well if you cache bonus_balance
        // await redis.set(`userBonusBalance:${telegramId}`, user.bonus_balance.toString(), { EX: 60 });
        console.log(`[REWARD] User ${telegramId} rewarded ${amount} Birr bonus. New balance: ${user.bonus_balance}`);
        return true;
    }
    return false;
};

module.exports = {
    startBroadcastJob,
    startDeleteJob,
    rewardBonusBalance
};
