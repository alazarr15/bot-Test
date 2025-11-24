// utils/broadcastUtils.js
const User = require('../Model/user');
const Announcement = require('../Model/announcement'); 

// Helper for adding delay
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// =========================================================================
// 1. FAST BATCH BROADCAST JOB 🚀 (OPTIMIZED)
// =========================================================================
const startBroadcastJob = async (bot, jobPayload) => {
    const { message, replyMarkup } = jobPayload;
    console.log(`[FAST BROADCAST START] Job started for message: "${message.substring(0, 30)}..."`);

    try {
        // 1. Fetch only necessary fields (lean query)
        const users = await User.find({}, 'telegramId');
        const totalUsers = users.length;
        console.log(`[FAST BROADCAST] Found ${totalUsers} users. Starting batch send...`);
        
        let successCount = 0;
        
        // --- BATCH CONFIGURATION ---
        const BATCH_SIZE = 25; // Send 25 messages concurrently
        const BATCH_DELAY = 1050; // Wait 1.05 seconds between batches (Safety buffer)

        // 2. Loop through users in chunks
        for (let i = 0; i < totalUsers; i += BATCH_SIZE) {
            const batch = users.slice(i, i + BATCH_SIZE);
            
            // Create an array of promises for this batch
            const batchPromises = batch.map(async (user) => {
                try {
                    const extra = { 
                        parse_mode: 'Markdown',
                        ...(replyMarkup && { reply_markup: replyMarkup }) 
                    };

                    // Send Message
                    const sentMessage = await bot.telegram.sendMessage(user.telegramId, message, extra);
                    
                    // CRITICAL: Log to DB for future deletion (Done concurrently)
                    await Announcement.create({
                        userId: user.telegramId,
                        messageId: sentMessage.message_id,
                        messageContent: message,
                        sentAt: new Date(), 
                    });
                    
                    return true; // Success
                } catch (error) {
                    const errorMessage = error.message || String(error);
                    // Handle blocked users (403) silently, log others
                    if (!errorMessage.includes('403') && !errorMessage.includes('blocked')) {
                        console.error(`Failed to send to ${user.telegramId}: ${errorMessage}`);
                    }
                    return false; // Failed
                }
            });

            // 3. Execute the batch (Parallel execution)
            const results = await Promise.all(batchPromises);
            
            // Count successes
            successCount += results.filter(res => res === true).length;

            // Log progress every 500 users
            if ((i + BATCH_SIZE) % 500 === 0) {
                console.log(`🚀 Progress: ${Math.min(i + BATCH_SIZE, totalUsers)}/${totalUsers} processed...`);
            }

            // 4. Rate Limit Sleep (Wait 1 second after every batch of 25)
            if (i + BATCH_SIZE < totalUsers) {
                await sleep(BATCH_DELAY);
            }
        }

        console.log(`[FAST BROADCAST COMPLETE] Sent: ${successCount}/${totalUsers}`);
        return successCount;

    } catch (error) {
        console.error('❌ CRITICAL JOB ERROR during fast broadcast:', error);
        return 0;
    }
};


// =========================================================================
// 2. ASYNCHRONOUS DELETION JOB 🗑️ (Keep as is, logic is fine)
// =========================================================================
const startDeleteJob = async (bot, messageContent) => {
    console.log(`[LIMITED DELETE START] Deletion job started for: "${messageContent.substring(0, 30)}..."`);
    
    try {
        const announcementsToDelete = await Announcement.find({ messageContent });
        let successCount = 0;

        // Deletion can remain sequential or be batched similarly if speed is needed later
        for (const ann of announcementsToDelete) {
            try {
                await bot.telegram.deleteMessage(ann.userId, ann.messageId);
                successCount++;
            } catch (error) {
                // Ignore errors
            }
            await sleep(40); // Small delay to be safe
        }
        
        const dbDeleteResult = await Announcement.deleteMany({ messageContent });
        console.log(`[LIMITED DELETE COMPLETE] DB cleanup: ${dbDeleteResult.deletedCount}, Telegram Delete: ${successCount}`);
        
    } catch (error) {
        console.error('❌ CRITICAL JOB ERROR during mass deletion process:', error);
    }
};


const rewardBonusBalance = async (telegramId, amount) => {
    const user = await User.findOneAndUpdate(
        { telegramId }, 
        { $inc: { bonus_balance: amount } }, 
        { new: true, select: 'bonus_balance' } 
    );

    if (user) {
        console.log(`[REWARD] User ${telegramId} rewarded ${amount}. New balance: ${user.bonus_balance}`);
        return true;
    }
    return false;
};

module.exports = {
    startBroadcastJob,
    startDeleteJob,
    rewardBonusBalance
};