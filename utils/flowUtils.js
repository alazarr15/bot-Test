const User = require("../Model/user");

/**
 * Clears all in-progress flow states for a given user.
 * This function should be called before starting a new multi-step process
 * to prevent conflicts.
 * @param {number} telegramId - The Telegram ID of the user.
 */
async function clearAllFlows(telegramId) {
    await User.findOneAndUpdate({ telegramId }, {
        $set: {
            withdrawalInProgress: null,
            transferInProgress: null,
            registrationInProgress: null,
            usernameChangeInProgress: null,
            depositInProgress: {
                step: null,
                amount: null,
                depositType: null,
                txId: null,
                timestamp: null
            }
        }
    });
}

module.exports = { clearAllFlows };