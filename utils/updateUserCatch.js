// utils/updateUserCache.js
const User = require("../Model/user");

async function updateUserCache(telegramId, redis) {
    console.log(`[updateUserCache] Updating cache for Telegram ID: ${telegramId}, ${redis}`);
    try {
        const user = await User.findOne(
            { telegramId: Number(telegramId) },
            { balance: 1, bonus_balance: 1, username: 1 }
        ).lean();

        if (!user) return;

        await redis.set(
            `userData:${telegramId}`,
            JSON.stringify({
                balance:       user.balance,
                bonus_balance: user.bonus_balance,
                username:      user.username || null,
            }),
            { EX: 600 }
        );
    } catch (err) {
        console.warn(`[updateUserCache] Failed for ${telegramId}:`, err.message);
    }
}

module.exports = { updateUserCache };